/**
 * Category content pipeline:
 *   data (taxonomy + profiles + live products) → brief (cheap model) → draft (strong model)
 *   → humanize (existing pipeline, optional) → automatic QA → stored result for review.
 * Nothing is published to the site from here.
 */
import { randomUUID } from 'node:crypto';
import { PipelineError, type StepEvent } from '@/lib/api/runner';
import { createExecutionContext, generateText, HumanizerError, rewriteText } from '@/lib/humanizer';
import { countWords, transformUnprotected } from '@/lib/text';
import { CONTENT_TYPES, VOICES, type ContentType, type Voice } from '@/lib/types';
import { usageByStage, usageSummary } from '@/lib/usage-ledger';
import { briefMessages, draftMessages, normalizeHeadings, parseBrief, parseDraft, PROMPT_VERSION, repairMessages, type Brief, type DraftSections } from './prompts';
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
  /** Multiplier on the word range asked of the draft model (experiments); default per model, see lengthFactor. */
  lengthScale?: number;
  /** Writer model inside the humanizer for this run (default: CONTENT_HUMANIZER_WRITER or the humanizer's own). */
  humanizerWriter?: string;
  /**
   * How much the humanizer is constrained. 'light' (default): only "no H1" — the humanizer rewrites freely and
   * our QA flags problems afterwards. 'strict': also no new claims + hold length + source fallback (too conservative:
   * 88–100% of sentences came back unchanged).
   */
  humanizerGuards?: 'light' | 'strict';
}

export interface ContentResult {
  resultId: string;
  createdAt: string;
  label?: string;
  promptVersion: string;
  category: { id: string; name: string; path: string; level: number; tier: Tier; productCount: number; url: string | null; flags: string };
  models: { brief: string; draft: string; humanize: boolean; lengthScale?: number; humanizerWriter?: string; humanizerGuards?: string };
  data: { productSample: number; brands: Array<{ brand: string; count: number }>; specs: Record<string, string[]>; siteError?: string };
  brief: Brief & { droppedFacts: number };
  content: DraftSections;
  draftBelow: string;
  humanized: {
    applied: boolean;
    warning?: string;
    sourceKept?: boolean;
    /** Humanizer internals, to see why a rewrite was kept or replaced. */
    diag?: { chosen?: string; firstDraftMissingAnchors?: string[]; criticVerdict: string | null; refineRan: boolean; refinedIssueCodes: string[]; initialIssues: string[]; missingAnchors: string[]; llmCalls: number };
  };
  /** Optional targeted fix of QA problems in the draft, before humanizing. */
  repair?: { ran: boolean; accepted: boolean; problems: string[]; before: { level: QaLevel; words: number }; after?: { level: QaLevel; words: number } };
  qa: { level: QaLevel; checks: QaCheck[]; words: number };
  qaDraft: { level: QaLevel; words: number };
  cost: {
    usd: number | null;
    promptTokens: number;
    completionTokens: number;
    calls: number;
    byStage?: Array<{ stage: string; model: string; calls: number; usd: number; completionTokens?: number; reasoningTokens?: number; finish?: string }>;
  };
  durationMs: number;
}

const env = (name: string, fallback: string) => process.env[name]?.trim() || fallback;
export const DEFAULT_BRIEF_MODEL = () => env('CONTENT_BRIEF_MODEL', 'anthropic/claude-haiku-5.5');
export const DEFAULT_DRAFT_MODEL = () => env('CONTENT_DRAFT_MODEL', 'anthropic/claude-sonnet-5.5');
export const DRAFT_MODELS = () =>
  [...new Set([DEFAULT_DRAFT_MODEL(), ...env('CONTENT_DRAFT_MODELS', 'anthropic/claude-sonnet-5.5,deepseek/deepseek-v4-flash-0731,google/gemini-4-argon,openai/gpt-6.1-sol').split(',').map(s => s.trim()).filter(Boolean)])];
const caps = () => ({
  maxInputPrice: Number(env('CONTENT_MAX_INPUT_PRICE', '5')),
  maxOutputPrice: Number(env('CONTENT_MAX_OUTPUT_PRICE', '25')),
});

/**
 * Models differ in how they read a word budget: DeepSeek writes ~1.5–1.8× the asked length, Sonnet stays in range.
 * The draft is asked for (range × factor); QA still measures against the real range.
 * CONTENT_LENGTH_FACTORS="deepseek=0.6,gemini=0.8" (substring of the model id = factor).
 */
export function lengthFactor(model: string): number {
  for (const pair of env('CONTENT_LENGTH_FACTORS', 'deepseek=0.6').split(',')) {
    const [key, value] = pair.split('=').map(x => x.trim());
    const f = Number(value);
    if (key && model.includes(key) && f > 0.2 && f <= 1.5) return f;
  }
  return 1;
}

/**
 * Some DeepSeek responses arrive with every ZWNJ dropped («میرود»، «قطعکننده»). Normal Persian output has
 * a ZWNJ every ~15–20 words; a long text with almost none is regenerated rather than "repaired" by guessing.
 */
export function zwnjHealthy(text: string): boolean {
  const words = countWords(text);
  if (words < 80) return true;
  return (text.match(/\u200c/g) ?? []).length >= words * 0.01;
}

const MAX_TOKENS: Record<Tier, number> = { hub: 8000, standard: 5000, small: 3500, skip: 3000 };

/** The theme renders the category name as H1, so any H1 in content becomes an H2. */
export function demoteH1(md: string): string {
  return md.replace(/^#\s+/gm, '## ');
}

/**
 * The humanizer replaces every ZWNJ with a space (by design). For published store pages we restore
 * only the standard, unambiguous joins: می/نمی + verb, and the suffixes ها/های/هایی/تر/ترین.
 * Latin words, numbers and protected keywords are untouched.
 */
export function restoreZwnj(md: string, keep: string[] = []): string {
  return transformUnprotected(md, part => part
    .replace(/(^|[\s(«])(ن?می) (?=[\u0600-\u06FF])/g, '$1$2\u200c')
    .replace(/([\u0600-\u06FF]) (ها|های|هایی|هایم|هایش|تر|ترین)(?=[\s،؛.!؟:)»]|$)/g, '$1\u200c$2'), keep);
}

/**
 * Headings come from the brief (SEO + structure); the humanizer may only reword the body.
 * Same heading count → put the draft's headings back in order; otherwise at least undo a «جمع‌بندی/نتیجه‌گیری» rename.
 */
export function keepDraftHeadings(final: string, draft: string, all = true): string {
  const re = /^#{2,4}[ \t].*$/gm;
  const want = draft.match(re) ?? [];
  const got = final.match(re) ?? [];
  if (all && want.length && want.length === got.length) {
    let i = 0;
    return final.replace(re, () => want[i++]);
  }
  const lastH2 = [...want].reverse().find(h => h.startsWith('## '));
  return lastH2 ? final.replace(/^##[ \t].*(نتیجه[\u200c ]?گیری|جمع[\u200c ]?بندی).*$/gm, lastH2) : final;
}

function asVoice(v: string): Voice {
  return (VOICES as readonly string[]).includes(v) ? (v as Voice) : 'standard';
}
function asContentType(v: string): ContentType {
  return (CONTENT_TYPES as readonly string[]).includes(v) ? (v as ContentType) : 'commercial';
}

const detailList = (c?: QaCheck) => (c?.detail ?? '').replace(/^[^:]*:\s*/, '');

/** QA findings the draft model can fix in one targeted edit. Never asks to add length (that invites filler). */
export function repairProblems(qa: { checks: QaCheck[]; words: number }, tier: Tier, name: string): string[] {
  const by = new Map(qa.checks.filter(c => c.level !== 'pass').map(c => [c.id, c]));
  const range = TIER_WORDS[tier];
  const out: string[] = [];
  if (by.has('kw-above')) out.push(`نام دقیق دسته «${name}» را در جملهٔ اول متن بالای لیست (ABOVE) بیاور.`);
  if (by.has('no-conclusion')) out.push('تیتر «نتیجه‌گیری/جمع‌بندی» را با یک تیتر جذاب دیگر عوض کن.');
  if (by.has('no-price')) out.push(`قیمت، تخفیف و وعدهٔ ارسال را حذف کن (${by.get('no-price')!.detail ?? ''}).`);
  if (by.has('brands')) out.push(`این برندها در این دسته فروخته نمی‌شوند؛ نامشان را حذف کن: ${by.get('brands')!.detail}`);
  if (by.has('numbers')) out.push(`این عددها در دادهٔ محصولات نیستند؛ حذفشان کن یا جمله را بدون عدد بنویس: ${detailList(by.get('numbers'))}`);
  if (by.has('hype')) out.push(`این کلمات تبلیغاتی را حذف یا با جملهٔ واقع‌بینانه جایگزین کن: ${by.get('hype')!.detail}`);
  if (by.has('placeholders')) out.push('جاهای خالی [[...]] را حذف کن و جمله را بدون آن کامل کن.');
  if (by.has('h2-count')) out.push(`تیتر هر بخش اصلی باید H2 (## ) باشد و فقط سؤال‌های متداول H3 (### ) باشند؛ حداقل ${tier === 'hub' ? 7 : tier === 'standard' ? 5 : 3} تیتر ##.`);
  if (qa.words > range.max * 1.1) {
    const aim = Math.round((range.min + range.max) / 2);
    const cut = Math.round((1 - aim / qa.words) * 100);
    out.push(`راهنمای زیر لیست (BELOW) ${qa.words} کلمه است و باید حدود ${aim} کلمه شود: از هر بخش حدود ${cut}٪ کم کن (پاراگراف‌ها را به ۲ تا ۳ جمله برسان، جمله‌های تکراری و توضیح کلی را حذف کن، پاسخ هر سؤال متداول حداکثر ۲ جمله). تیترها، جدول و بولت‌های «قبل از سفارش» بمانند.`);
  }
  if (by.has('kw-title') || by.has('meta-title')) out.push(`عنوان سئو (META_TITLE) را ۳۰ تا ۶۰ نویسه بنویس و با «${name}» شروع کن.`);
  if (by.has('meta-desc')) out.push(`توضیح متا (META_DESCRIPTION) را ۱۲۰ تا ۱۵۵ نویسه بنویس، شامل «${name}»، بدون قیمت و اغراق.`);
  return out;
}

const qaScore = (q: { checks: QaCheck[] }) => q.checks.reduce((n, c) => n + (c.level === 'fail' ? 10 : c.level === 'warn' ? 1 : 0), 0);

export async function runCategoryContent(
  req: ContentRequest,
  opts: { signal?: AbortSignal; onStep?: (s: StepEvent) => void } = {},
): Promise<ContentResult> {
  try {
    return await runCategoryContentInner(req, opts);
  } catch (error) {
    if (error instanceof HumanizerError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      throw new PipelineError(error.message, status, 'provider_error');
    }
    throw error;
  }
}

async function runCategoryContentInner(
  req: ContentRequest,
  opts: { signal?: AbortSignal; onStep?: (s: StepEvent) => void },
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
      maxTokens: 10000,
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
  const scale = req.lengthScale && req.lengthScale >= 0.4 && req.lengthScale <= 1.5 ? req.lengthScale : lengthFactor(draftModel);
  step('draft', `نگارش با ${draftModel}`);
  const draftInput = {
    category: briefInput.category,
    industry: [l1Cat.name, l2Cat && !isOwnL2 ? l2Cat.name : null].filter(Boolean).join(' / '),
    brief: cleanBrief,
    tone: l1?.tone ?? '',
    audienceDesc: l1?.audience_desc ?? '',
    sectionRules: l1?.section_rules ?? { include: [], exclude: [] },
    profileCautions: [...(l1?.cautions ?? []), ...(l2?.cautions ?? [])],
    words: { min: Math.round(words.min * scale), max: Math.round(words.max * scale) },
  };
  let draft: DraftSections | undefined;
  let lastParsed: DraftSections | undefined;
  for (let attempt = 1; attempt <= 3 && !draft; attempt++) {
    const raw = await generateText(draftMessages(draftInput), {
      model: draftModel,
      maxTokens: MAX_TOKENS[effectiveTier],
      temperature: 0.6,
      stage: 'content-draft',
      useFallback: false,
      ...caps(),
    }, ctx);
    const parsed = parseDraft(raw);
    parsed.below = normalizeHeadings(demoteH1(parsed.below));
    if (parsed.above && parsed.below) {
      lastParsed = parsed;
      if (zwnjHealthy(`${parsed.above}\n${parsed.below}`)) draft = parsed;
      else step('draft', 'نیم‌فاصله‌های پیش‌نویس حذف شده بود؛ نگارش دوباره');
    }
  }
  draft ??= lastParsed;
  if (!draft) throw new PipelineError('خروجی نگارش ساختار مورد انتظار را نداشت.', 502, 'draft_invalid');

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
    evidence,
    // a brand that is part of the category name or path is allowed by definition (e.g. «کلید فیوز زاویر»)
    allowedBrands: [...brands.map(b => b.name), ...products.brands.map(b => b.brand), ...allKnownBrands().filter(b => norm(path).includes(norm(b)))],
    knownBrands: allKnownBrands(),
    siteDataAvailable: !products.error && products.names.length > 0,
  };
  // ---------- 3b. targeted repair of the draft (cheap, one call, kept only if QA improves) ----------
  let repair: ContentResult['repair'];
  const draftQa = runQa({ ...qaBase, above: draft!.above, below: draft!.below, metaTitle: draft!.metaTitle, metaDescription: draft!.metaDescription });
  const problems = process.env.CONTENT_REPAIR === 'off' ? [] : repairProblems(draftQa, effectiveTier, cat.name);
  if (problems.length) {
    step('repair', `اصلاح ${problems.length} ایراد پیش‌نویس با ${draftModel}`);
    repair = { ran: true, accepted: false, problems, before: { level: draftQa.level, words: draftQa.words } };
    try {
      const raw = await generateText(repairMessages(cat.name, draft!, problems), {
        model: draftModel,
        maxTokens: MAX_TOKENS[effectiveTier],
        temperature: 0.2,
        stage: 'content-repair',
        useFallback: false,
        ...caps(),
      }, ctx);
      const fixed = parseDraft(raw);
      fixed.below = normalizeHeadings(demoteH1(fixed.below));
      fixed.metaTitle ||= draft!.metaTitle;
      fixed.metaDescription ||= draft!.metaDescription;
      if (fixed.above && fixed.below) {
        const fixedQa = runQa({ ...qaBase, above: fixed.above, below: fixed.below, metaTitle: fixed.metaTitle, metaDescription: fixed.metaDescription });
        repair.after = { level: fixedQa.level, words: fixedQa.words };
        // must not lose much of the guide (a model that "fixes" by deleting sections is rejected)
        const keepsZwnj = zwnjHealthy(`${fixed.above}\n${fixed.below}`) || !zwnjHealthy(`${draft!.above}\n${draft!.below}`);
        if (keepsZwnj && qaScore(fixedQa) < qaScore(draftQa) && fixedQa.words >= TIER_WORDS[effectiveTier].min * 0.85) {
          draft = fixed;
          repair.accepted = true;
        }
      }
    } catch (error) {
      ctx.signal?.throwIfAborted();
      repair.problems.push(`اصلاح انجام نشد: ${error instanceof Error ? error.message.slice(0, 120) : ''}`);
    }
  }

  // ---------- 4. humanize ----------
  const humanizerWriter = req.humanizerWriter || process.env.CONTENT_HUMANIZER_WRITER?.trim() || undefined;
  const guardMode = req.humanizerGuards ?? (process.env.CONTENT_HUMANIZER_GUARDS === 'strict' ? 'strict' : 'light');
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
          // store page: theme owns the H1. 'strict' also forbids new claims and length changes.
          guards: guardMode === 'strict' ? { embedded: true, noNewClaims: true, holdLength: true } : { embedded: true },
        },
        (stage, message) => step(`humanize:${stage}`, message),
        ctx,
        humanizerWriter ? { writerModel: humanizerWriter } : {},
      );
      finalBelow = keepDraftHeadings(restoreZwnj(demoteH1(out.text), keywords), draft!.below, guardMode === 'strict');
      humanized.applied = true;
      if (out.quality.sourceKept) humanized.sourceKept = true;
      humanized.diag = {
        chosen: out.quality.chosen,
        firstDraftMissingAnchors: out.quality.firstDraftMissingAnchors,
        criticVerdict: out.quality.criticVerdict ?? null,
        refineRan: out.quality.refineRan,
        refinedIssueCodes: out.quality.refinedIssueCodes ?? [],
        initialIssues: out.quality.initial.issues.map(i => `${i.code}: ${i.fix}`.slice(0, 200)),
        missingAnchors: (out.validation.missingAnchors ?? []).slice(0, 30),
        llmCalls: out.quality.llmCalls,
      };
      if (out.quality.warnings.length) humanized.warning = out.quality.warnings.join(' ');
    } catch (error) {
      ctx.signal?.throwIfAborted();
      humanized.warning = `هیومنایز انجام نشد؛ نسخهٔ نگارش نگه داشته شد. ${error instanceof HumanizerError ? error.message : ''}`.trim();
    }
  }

  // ---------- 5. QA ----------
  step('qa', 'کنترل کیفیت خودکار');
  const content: DraftSections = { ...draft!, below: finalBelow };
  const qa = runQa({ ...qaBase, above: content.above, below: content.below, metaTitle: content.metaTitle, metaDescription: content.metaDescription });
  const qaDraftFull = runQa({ ...qaBase, above: content.above, below: draft!.below, metaTitle: content.metaTitle, metaDescription: content.metaDescription });

  const usage = usageSummary(ctx.runId) as { knownCostUsd: number; promptTokens: number; completionTokens: number; attempts: number } | undefined;
  const result: ContentResult = {
    resultId: randomUUID(),
    createdAt: new Date().toISOString(),
    ...(req.label ? { label: req.label } : {}),
    promptVersion: PROMPT_VERSION,
    category: { id: cat.id, name: cat.name, path, level: cat.level, tier: effectiveTier, productCount, url: products.live?.link ?? null, flags: cat.flags },
    models: { brief: briefModel, draft: draftModel, humanize: humanized.applied, lengthScale: scale, ...(humanizerWriter ? { humanizerWriter } : {}), ...(humanized.applied ? { humanizerGuards: guardMode } : {}) },
    data: { productSample: products.names.length, brands: products.brands, specs: products.specs, ...(products.error ? { siteError: products.error } : {}) },
    brief: cleanBrief,
    content,
    draftBelow: draft!.below,
    humanized,
    ...(repair ? { repair } : {}),
    qa,
    qaDraft: { level: qaDraftFull.level, words: qaDraftFull.words },
    cost: {
      usd: usage ? Number(usage.knownCostUsd.toFixed(4)) : null,
      promptTokens: usage?.promptTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 0,
      calls: usage?.attempts ?? 0,
      byStage: usageByStage(ctx.runId).map(r => ({
        stage: r.stage, model: r.model, calls: r.calls, usd: Number(r.usd.toFixed(5)),
        completionTokens: r.completionTokens, reasoningTokens: r.reasoningTokens, finish: r.finish,
      })),
    },
    durationMs: Date.now() - started,
  };
  await saveResult(result);
  step('done', `پایان؛ کنترل کیفیت: ${qa.level}`);
  return result;
}
