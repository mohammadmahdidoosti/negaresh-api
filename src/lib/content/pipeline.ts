/**
 * Category content pipeline:
 *   data (taxonomy + profiles + live products) → brief (cheap model) → draft (strong model)
 *   → humanize (existing pipeline, optional) → automatic QA → stored result for review.
 * Nothing is published to the site from here.
 */
import { randomUUID } from 'node:crypto';
import { PipelineError, type StepEvent } from '@/lib/api/runner';
import { createExecutionContext, generateText, HumanizerError, rewriteText } from '@/lib/humanizer';
import { countWords } from '@/lib/text';
import { CONTENT_TYPES, VOICES, type ContentType, type Voice } from '@/lib/types';
import { usageSummary } from '@/lib/usage-ledger';
import { briefMessages, draftMessages, parseBrief, parseDraft, PROMPT_VERSION, type Brief, type DraftSections } from './prompts';
import { runQa, type QaCheck, type QaLevel } from './qa';
import { fetchProductData } from './site';
import { saveResult } from './store';
import {
  allKnownBrands,
  breadcrumb,
  childrenOf,
  findCategory,
  norm,
  profilesFor,
  siblingsOf,
  TIER_WORDS,
  tierFor,
  type Tier,
} from './taxonomy';

export interface ContentRequest {
  category: string;
  draftModel?: string;
  briefModel?: string;
  humanize?: boolean;
  /** Generate even when the category has no products (default false). */
  force?: boolean;
  label?: string;
}

export interface ContentResult {
  resultId: string;
  createdAt: string;
  label?: string;
  promptVersion: string;
  category: { id: string; name: string; path: string; level: number; tier: Tier; productCount: number; url: string | null; flags: string };
  models: { brief: string; draft: string; humanize: boolean };
  data: { productSample: number; brands: Array<{ brand: string; count: number }>; specs: Record<string, string[]>; siteError?: string };
  brief: Brief & { droppedFacts: number };
  content: DraftSections;
  draftBelow: string;
  humanized: { applied: boolean; warning?: string };
  qa: { level: QaLevel; checks: QaCheck[]; words: number };
  qaDraft: { level: QaLevel; words: number };
  cost: { usd: number | null; promptTokens: number; completionTokens: number; calls: number };
  durationMs: number;
}

const env = (name: string, fallback: string) => process.env[name]?.trim() || fallback;
export const DEFAULT_BRIEF_MODEL = () => env('CONTENT_BRIEF_MODEL', 'anthropic/claude-haiku-5.5');
export const DEFAULT_DRAFT_MODEL = () => env('CONTENT_DRAFT_MODEL', 'anthropic/claude-sonnet-5.5');
export const DRAFT_MODELS = () =>
  [...new Set([DEFAULT_DRAFT_MODEL(), ...env('CONTENT_DRAFT_MODELS', 'anthropic/claude-sonnet-5.5,google/gemini-4-argon,openai/gpt-6.1-sol').split(',').map(s => s.trim()).filter(Boolean)])];
const caps = () => ({
  maxInputPrice: Number(env('CONTENT_MAX_INPUT_PRICE', '5')),
  maxOutputPrice: Number(env('CONTENT_MAX_OUTPUT_PRICE', '25')),
});

const MAX_TOKENS: Record<Tier, number> = { hub: 8000, standard: 5000, small: 3500, skip: 3000 };

function asVoice(v: string): Voice {
  return (VOICES as readonly string[]).includes(v) ? (v as Voice) : 'standard';
}
function asContentType(v: string): ContentType {
  return (CONTENT_TYPES as readonly string[]).includes(v) ? (v as ContentType) : 'commercial';
}

export async function runCategoryContent(
  req: ContentRequest,
  opts: { signal?: AbortSignal; onStep?: (s: StepEvent) => void } = {},
): Promise<ContentResult> {
  const started = Date.now();
  const step = (stage: string, message: string) => opts.onStep?.({ stage, message, at: new Date().toISOString() });
  const ctx = createExecutionContext(opts.signal);

  const draftModel = req.draftModel || DEFAULT_DRAFT_MODEL();
  if (!DRAFT_MODELS().includes(draftModel)) {
    throw new PipelineError(`مدل نگارش مجاز نیست. مجازها: ${DRAFT_MODELS().join(', ')}`, 400, 'invalid_model');
  }
  const briefModel = req.briefModel || DEFAULT_BRIEF_MODEL();

  // ---------- 1. data ----------
  const cat = findCategory(req.category);
  if (!cat) throw new PipelineError('دسته در تاکسونومی پیدا نشد.', 404, 'category_not_found');
  const { l1, l2, l1Cat, l2Cat } = profilesFor(cat);
  const path = breadcrumb(cat);
  step('data', `دریافت محصولات «${cat.name}» از سایت`);
  const known = [...new Set([...(l1?.brands_in_store ?? []), ...allKnownBrands()])];
  const products = await fetchProductData(cat.slug, known, ctx.signal);
  const productCount = products.live?.count ?? cat.products;
  const tier = tierFor(cat, productCount);
  if (tier === 'skip' && !req.force) {
    throw new PipelineError('این دسته فعلاً محصولی ندارد؛ طبق برنامه محتوا فقط برای دسته‌های دارای محصول تولید می‌شود.', 422, 'no_products');
  }
  const effectiveTier: Tier = tier === 'skip' ? 'small' : tier;
  const words = TIER_WORDS[effectiveTier];
  const isOwnL2 = l2Cat?.id === cat.id;

  // ---------- 2. brief ----------
  step('brief', `بریف با ${briefModel}`);
  const briefInput = {
    category: {
      name: cat.name,
      path,
      level: cat.level,
      synonyms: cat.synonyms,
      productCount,
      tier: effectiveTier,
      ...(cat.oldNames && norm(cat.oldNames) !== norm(cat.name) ? { marketNameNote: `نام‌های دیگر این دسته در سایت: ${cat.oldNames}` } : {}),
    },
    l1Profile: l1,
    l2Profile: l2 ? (isOwnL2 ? l2 : { ...l2, note: 'این پروفایلِ والد است؛ تیترها را برای صفحهٔ فعلی اختصاصی کن.' }) : null,
    siblings: siblingsOf(cat).slice(0, 25).map(c => c.name),
    children: childrenOf(cat).slice(0, 25).map(c => `${c.name} (${c.products})`),
    products: {
      sample: products.names,
      brands: products.brands,
      specs: products.specs,
      ...(products.error ? { note: products.error } : {}),
    },
  };
  let brief: Brief | undefined;
  for (let attempt = 1; attempt <= 2 && !brief; attempt++) {
    const raw = await generateText(briefMessages(briefInput), {
      model: briefModel,
      maxTokens: 4000,
      temperature: 0.3,
      stage: 'content-brief',
      useFallback: false,
      ...caps(),
    }, ctx);
    try {
      brief = parseBrief(raw);
    } catch (error) {
      if (attempt === 2) throw new PipelineError(`بریف قابل خواندن نبود: ${(error as Error).message}`, 502, 'brief_invalid');
    }
  }
  // Keep only facts/brands whose evidence is a real product name.
  const nameCorpus = products.names.map(norm);
  const evidenced = (e: string) => !!e && nameCorpus.some(n => n.includes(norm(e)) || norm(e).includes(n));
  const facts = brief!.facts.filter(f => evidenced(f.evidence));
  const brands = brief!.brands.filter(b => evidenced(b.evidence) || products.brands.some(x => norm(x.brand) === norm(b.name)));
  const cleanBrief = { ...brief!, facts, brands, droppedFacts: brief!.facts.length - facts.length + (brief!.brands.length - brands.length) };

  // ---------- 3. draft ----------
  step('draft', `نگارش با ${draftModel}`);
  const draftInput = {
    category: briefInput.category,
    industry: [l1Cat.name, l2Cat && !isOwnL2 ? l2Cat.name : null].filter(Boolean).join(' / '),
    brief: cleanBrief,
    tone: l1?.tone ?? '',
    audienceDesc: l1?.audience_desc ?? '',
    sectionRules: l1?.section_rules ?? { include: [], exclude: [] },
    profileCautions: [...(l1?.cautions ?? []), ...(l2?.cautions ?? [])],
    words,
  };
  let draft: DraftSections | undefined;
  for (let attempt = 1; attempt <= 2 && !draft; attempt++) {
    const raw = await generateText(draftMessages(draftInput), {
      model: draftModel,
      maxTokens: MAX_TOKENS[effectiveTier],
      temperature: 0.6,
      stage: 'content-draft',
      useFallback: false,
      ...caps(),
    }, ctx);
    const parsed = parseDraft(raw);
    if (parsed.above && parsed.below) draft = parsed;
    else if (attempt === 2) throw new PipelineError('خروجی نگارش ساختار مورد انتظار را نداشت.', 502, 'draft_invalid');
  }

  // ---------- 4. humanize ----------
  let finalBelow = draft!.below;
  const humanized: ContentResult['humanized'] = { applied: false };
  if (req.humanize !== false) {
    step('humanize', 'هیومنایز راهنمای زیر لیست');
    const draftWords = countWords(draft!.below);
    const keywords = [...new Set([cat.name, 'کاروان صنعت', ...brands.map(b => b.name)])].filter(k => k.length <= 120).slice(0, 30);
    try {
      const out = await rewriteText(
        {
          text: draft!.below,
          voice: asVoice(l1?.humanizer.voice ?? 'standard'),
          contentType: asContentType(l1?.humanizer.contentType ?? 'commercial'),
          perspective: 'third_person',
          quality: 'precise',
          keywords,
          targetWords: Math.min(3000, Math.max(100, draftWords)),
          wordTolerance: 0.15,
          articleGoal: cleanBrief.angle.slice(0, 2000),
          audience: (l1?.audience_desc ?? '').slice(0, 2000),
        },
        (stage, message) => step(`humanize:${stage}`, message),
        ctx,
      );
      finalBelow = out.text;
      humanized.applied = true;
      if (out.quality.warnings.length) humanized.warning = out.quality.warnings.join(' ');
    } catch (error) {
      ctx.signal?.throwIfAborted();
      humanized.warning = `هیومنایز انجام نشد؛ نسخهٔ نگارش نگه داشته شد. ${error instanceof HumanizerError ? error.message : ''}`.trim();
    }
  }

  // ---------- 5. QA ----------
  step('qa', 'کنترل کیفیت خودکار');
  const content: DraftSections = { ...draft!, below: finalBelow };
  const evidence = [
    cat.name,
    path,
    cat.synonyms,
    ...products.names,
    ...Object.entries(products.specs).flatMap(([u, v]) => v.map(x => `${x} ${u}`)),
    JSON.stringify(l1 ?? {}),
    JSON.stringify(l2 ?? {}),
    ...facts.map(f => f.fact),
  ].join('\n');
  const qaBase = {
    name: cat.name,
    tier: effectiveTier,
    metaTitle: content.metaTitle,
    metaDescription: content.metaDescription,
    evidence,
    allowedBrands: [...brands.map(b => b.name), ...products.brands.map(b => b.brand)],
    knownBrands: allKnownBrands(),
    siteDataAvailable: !products.error && products.names.length > 0,
  };
  const qa = runQa({ ...qaBase, above: content.above, below: content.below });
  const qaDraftFull = runQa({ ...qaBase, above: content.above, below: draft!.below });

  const usage = usageSummary(ctx.runId) as { knownCostUsd: number; promptTokens: number; completionTokens: number; attempts: number } | undefined;
  const result: ContentResult = {
    resultId: randomUUID(),
    createdAt: new Date().toISOString(),
    ...(req.label ? { label: req.label } : {}),
    promptVersion: PROMPT_VERSION,
    category: { id: cat.id, name: cat.name, path, level: cat.level, tier: effectiveTier, productCount, url: products.live?.link ?? null, flags: cat.flags },
    models: { brief: briefModel, draft: draftModel, humanize: humanized.applied },
    data: { productSample: products.names.length, brands: products.brands, specs: products.specs, ...(products.error ? { siteError: products.error } : {}) },
    brief: cleanBrief,
    content,
    draftBelow: draft!.below,
    humanized,
    qa,
    qaDraft: { level: qaDraftFull.level, words: qaDraftFull.words },
    cost: {
      usd: usage ? Number(usage.knownCostUsd.toFixed(4)) : null,
      promptTokens: usage?.promptTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 0,
      calls: usage?.attempts ?? 0,
    },
    durationMs: Date.now() - started,
  };
  saveResult(result);
  step('done', `پایان؛ کنترل کیفیت: ${qa.level}`);
  return result;
}
