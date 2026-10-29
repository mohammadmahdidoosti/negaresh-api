/**
 * Category content pipeline:
 *   data (taxonomy + profiles + live products) → brief (cheap model) → draft (strong model)
 *   → humanize (existing pipeline, optional) → automatic QA → stored result for review.
 * Nothing is published to the site from here.
 */
import { randomUUID } from 'node:crypto';
import { PipelineError, type StepEvent } from '@/lib/api/runner';
import { createExecutionContext, generateText, HumanizerError, rewriteText } from '@/lib/humanizer';
import { lintText } from '@/lib/linter';
import { countWords, transformUnprotected } from '@/lib/text';
import { CONTENT_TYPES, QUALITY_LEVELS, VOICES, type ContentType, type QualityLevel, type Voice } from '@/lib/types';
import { usageByStage, usageSummary } from '@/lib/usage-ledger';
import { catalogText } from './catalog';
import { chooseMeta, metaMessages, parseMetaCandidates, type MetaChoice } from './meta';
import { termsFor, VERIFIED_TERMS } from './glossary';
import { briefMessages, draftMessages, factCheckMessages, formatDraft, normalizeHeadings, parseBrief, parseDraft, parseFactFindings, PROMPT_VERSION, repairMessages, zwnjMessages, type Brief, type DraftSections, type FactFinding } from './prompts';
import { repeatedSentences, runQa, type QaCheck, type QaLevel } from './qa';
import { fetchProductData } from './site';
import { getResult, saveResult } from './store';
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
  /** Reuse the brief and pre-humanize draft of a stored result (controlled humanizer comparisons). */
  reuseDraftFrom?: string;
  /** Humanizer strictness (default CONTENT_HUMANIZER_QUALITY or 'precise'): 'readable' rewrites more freely. */
  humanizerQuality?: QualityLevel;
  /** Natural-writing rules in the draft prompt (default CONTENT_NATURAL_DRAFT=on|off, off). */
  naturalDraft?: boolean;
  /**
   * Counted catalog of the whole category in the brief and draft prompts, confirmed terms, and a fact check of the
   * draft against the catalog (default CONTENT_CATALOG_FACTS=on|off, off).
   */
  catalogFacts?: boolean;
  /**
   * No word target: the writer covers what the data supports, at any length (default CONTENT_FREE_LENGTH=on|off, off).
   * QA reports the length but does not flag it, and the repair never asks to shorten.
   */
  freeLength?: boolean;
}

export interface ContentResult {
  resultId: string;
  createdAt: string;
  label?: string;
  promptVersion: string;
  category: { id: string; name: string; path: string; level: number; tier: Tier; productCount: number; url: string | null; flags: string };
  models: { brief: string; draft: string; humanize: boolean; lengthScale?: number; humanizerWriter?: string; humanizerGuards?: string; humanizerQuality?: string; naturalDraft?: boolean; catalogFacts?: boolean; freeLength?: boolean };
  data: { productSample: number; productsRead?: number; brands: Array<{ brand: string; count: number }>; specs: Record<string, string[]>; catalog?: string; siteError?: string };
  /** Draft compared with the catalog by a second reader; findings go into the repair call. */
  factCheck?: { ran: boolean; findings: FactFinding[]; remaining: FactFinding[] };
  /** How the SEO title/description were chosen (separate meta step). */
  meta?: Omit<MetaChoice, 'title' | 'description'> & { ran: boolean };
  brief: Brief & { droppedFacts: number };
  content: DraftSections;
  draftBelow: string;
  humanized: {
    applied: boolean;
    warning?: string;
    sourceKept?: boolean;
    /** Humanizer internals, to see why a rewrite was kept or replaced. */
    diag?: { chosen?: string; writerWords?: number; firstDraftMissingAnchors?: string[]; criticVerdict: string | null; refineRan: boolean; refinedIssueCodes: string[]; initialIssues: string[]; missingAnchors: string[]; llmCalls: number };
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
/**
 * The humanizer is off by default since content-v1.9: the draft already follows its checklist, and with the full
 * catalog it added little (CONTENT_HUMANIZE=on turns it back on for requests that do not say).
 */
export const defaultHumanize = () => process.env.CONTENT_HUMANIZE === 'on';
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
export function zwnjHealthy(text: string, minWords = 80): boolean {
  const words = countWords(text);
  if (words < minWords) return true;
  return (text.match(/\u200c/g) ?? []).length >= words * 0.01;
}

/** Both parts are checked on their own: a short ABOVE without any ZWNJ hides inside a long, healthy BELOW. */
export function draftZwnjHealthy(d: { above: string; below: string }): boolean {
  return zwnjHealthy(d.below) && zwnjHealthy(d.above, 35);
}

const MAX_TOKENS: Record<Tier, number> = { hub: 8000, standard: 5000, small: 3500, skip: 3000 };
/** Room for long pages when the length is free (Persian is ~2 tokens per word). */
const MAX_TOKENS_FREE: Record<Tier, number> = { hub: 20000, standard: 14000, small: 9000, skip: 6000 };

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

const CTA_WORDS = ['مشاوره', 'سفارش', 'خرید', 'استعلام', 'تماس'];
const lastH2At = (t: string) => {
  const all = [...t.matchAll(/^##[ \t].*$/gm)];
  return all.length ? all[all.length - 1].index! : -1;
};

/**
 * The closing section is humanized like the rest, but it must still invite the reader to consult or buy.
 * Only when the humanized closing lost that invitation is the draft's closing put back.
 */
export function keepDraftClosing(final: string, draft: string): string {
  const f = lastH2At(final);
  const d = lastH2At(draft);
  if (f < 0 || d < 0) return final;
  const hasCta = (t: string) => CTA_WORDS.some(w => t.includes(w));
  if (hasCta(final.slice(f)) || !hasCta(draft.slice(d))) return final;
  return `${final.slice(0, f).trimEnd()}\n\n${draft.slice(d).trim()}`;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/**
 * Brand names are spelled as the store spells them (product names / taxonomy), whoever wrote the text.
 * A near variant («وینیکو» for «ونیکو») next to «برند» or another store brand is replaced by the store spelling.
 * Names shorter than 4 letters are left alone.
 */
export function fixNameSpelling(text: string, names: string[], protect: Iterable<string> = []): string {
  const flat = (t: string) => t.replace(/\u200c/g, ' ');
  // words of the category name, its path and the product names are real words, never misspellings of a brand
  // («زانو» is one letter away from the brand «زاکو»)
  const real = new Set([...protect].map(w => flat(w).trim()).filter(Boolean));
  let out = text;
  for (const name of [...new Set(names)].filter(n => flat(n).replace(/\s/g, '').length >= 4)) {
    const n = flat(name).split(/\s+/).length;
    const limit = name.length >= 8 ? 2 : 1;
    const words = out.split(/(\s+)/);
    for (let i = 0; i < words.length; i += 2) {
      const span = words.slice(i, i + n * 2 - 1).join('');
      const lead = span.match(/^[«(]+/)?.[0] ?? '';
      const tail = span.match(/[»).,،؛:!؟]+$/)?.[0] ?? '';
      const core = span.slice(lead.length, span.length - tail.length);
      // same first letter and a brand context (the word «برند» or another store brand nearby):
      // avoids turning ordinary words into brands
      if (!core || core[0] !== name[0] || real.has(flat(core))) continue;
      const around = words.slice(Math.max(0, i - 12), i + n * 2 + 12).join('');
      if (!around.includes('برند') && !names.some(o => o !== name && around.includes(o))) continue;
      const d = editDistance(flat(core), flat(name));
      if (d > 0 && d <= limit) words.splice(i, n * 2 - 1, `${lead}${name}${tail}`);
    }
    out = words.join('');
  }
  return out;
}

function asVoice(v: string): Voice {
  return (VOICES as readonly string[]).includes(v) ? (v as Voice) : 'standard';
}
function asContentType(v: string): ContentType {
  return (CONTENT_TYPES as readonly string[]).includes(v) ? (v as ContentType) : 'commercial';
}

const detailList = (c?: QaCheck) => (c?.detail ?? '').replace(/^[^:]*:\s*/, '');

/** QA findings the draft model can fix in one targeted edit. Never asks to add length (that invites filler). */
export function repairProblems(qa: { checks: QaCheck[]; words: number }, tier: Tier, name: string, freeLength = false, belowForRepeat = ''): string[] {
  const by = new Map(qa.checks.filter(c => c.level !== 'pass').map(c => [c.id, c]));
  const range = TIER_WORDS[tier];
  const out: string[] = [];
  if (by.has('kw-above')) out.push(`نام دقیق دسته «${name}» را در جملهٔ اول متن بالای لیست (ABOVE) بیاور.`);
  if (by.has('no-conclusion')) out.push('تیتر «نتیجه‌گیری/جمع‌بندی» را با یک تیتر جذاب دیگر عوض کن.');
  if (by.has('no-price')) out.push(`قیمت، تخفیف و وعدهٔ ارسال را حذف کن (${by.get('no-price')!.detail ?? ''}).`);
  if (by.has('brands')) out.push(`این برندها در این دسته فروخته نمی‌شوند؛ نامشان را حذف کن: ${by.get('brands')!.detail}`);
  if (by.has('numbers') && detailList(by.get('numbers')).split('،').filter(x => x.trim()).length >= 3) out.push(`این عددها در دادهٔ محصولات نیستند؛ حذفشان کن یا جمله را بدون عدد بنویس: ${detailList(by.get('numbers'))}`);
  if (by.has('repeat')) {
    const reps = repeatedSentences(belowForRepeat);
    if (reps.length) out.push(`این جمله‌ها همان نکتهٔ جمله‌ای قبلی را تکرار می‌کنند؛ تکرار دوم را حذف کن یا دو جمله را در جای اول ادغام کن (اگر بخشی با حذف تکرار خالی شد، آن بخش را حذف کن):\n${reps.slice(0, 10).map(r => `   - «${r.second.slice(0, 160)}» (تکرار: «${r.first.slice(0, 80)}»)`).join('\n')}`);
  }
  if (by.has('absolute')) out.push(`این ادعاهای قطعی را واقع‌بینانه کن (مثلاً «احتمال نشتی را کم می‌کند» به جای «نشتی را حذف می‌کند»): ${by.get('absolute')!.detail}`);
  if (by.has('terms')) {
    const detail = by.get('terms')!.detail ?? '';
    const defs = VERIFIED_TERMS.filter(t => detail.includes(t.term)).map(t => `${t.term}: ${t.definition}`).join(' ');
    out.push(`تعریف این اصطلاح‌ها اشتباه است؛ مطابق تعریف تأییدشده درستشان کن (${defs}): ${detail}`);
  }
  if (by.has('hype')) out.push(`این کلمات تبلیغاتی را حذف یا با جملهٔ واقع‌بینانه جایگزین کن: ${by.get('hype')!.detail}`);
  if (by.has('placeholders')) out.push('جاهای خالی [[...]] را حذف کن و جمله را بدون آن کامل کن.');
  if (by.has('h2-count')) out.push(`تیتر هر بخش اصلی باید H2 (## ) باشد و فقط سؤال‌های متداول H3 (### ) باشند؛ حداقل ${tier === 'hub' ? 7 : tier === 'standard' ? 5 : 3} تیتر ##.`);
  if (!freeLength && qa.words > range.max * 1.1) {
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
  const catalogFacts = (req.catalogFacts ?? process.env.CONTENT_CATALOG_FACTS !== 'off') && !!products.catalog;
  const catalog = catalogFacts && products.catalog ? catalogText(products.catalog) : undefined;
  const freeLength = req.freeLength ?? process.env.CONTENT_FREE_LENGTH !== 'off';
  const maxTokens = (freeLength ? MAX_TOKENS_FREE : MAX_TOKENS)[effectiveTier];
  const allNames = products.allNames?.length ? products.allNames : products.names;
  const terms = catalogFacts ? termsFor([cat.name, path, ...allNames].join('\n')).map(t => ({ term: t.term, definition: t.definition })) : [];

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
      // the catalog already summarizes every product; a shorter sample keeps the brief call small
      sample: catalog ? products.names.slice(0, 30) : products.names,
      brands: products.brands,
      specs: products.specs,
      ...(catalog ? { catalog } : {}),
      ...(products.error ? { note: products.error } : {}),
    },
  };
  const reused = req.reuseDraftFrom ? await getResult(req.reuseDraftFrom) : undefined;
  if (req.reuseDraftFrom && (!reused || reused.category.id !== cat.id)) {
    throw new PipelineError('نتیجهٔ ذخیره‌شده برای استفادهٔ دوباره پیدا نشد یا مال این دسته نیست.', 404, 'result_not_found');
  }
  let brief: Brief | undefined = reused?.brief;
  if (reused) step('brief', 'استفاده از بریف و پیش‌نویس نتیجهٔ قبلی');
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
  const nameCorpus = allNames.map(norm);
  const catalogNorm = catalog ? norm(catalog) : '';
  const evidenced = (e: string) => {
    if (!e) return false;
    const fromCatalog = e.replace(/^\s*کاتالوگ\s*[:：]\s*/, '');
    if (catalogNorm && fromCatalog !== e && norm(fromCatalog).length >= 3 && catalogNorm.includes(norm(fromCatalog))) return true;
    return nameCorpus.some(n => n.includes(norm(e)) || norm(e).includes(n));
  };
  const facts = brief!.facts.filter(f => evidenced(f.evidence));
  const brands = brief!.brands.filter(b => evidenced(b.evidence) || products.brands.some(x => norm(x.brand) === norm(b.name)));
  const cleanBrief = { ...brief!, facts, brands, droppedFacts: brief!.facts.length - facts.length + (brief!.brands.length - brands.length) };

  // ---------- 3. draft ----------
  const freeHumanizer = (req.humanize ?? defaultHumanize()) && (req.humanizerGuards ?? (process.env.CONTENT_HUMANIZER_GUARDS === 'strict' ? 'strict' : 'light')) === 'light';
  // a free humanizer lengthens the text ~1.5×, so the draft is asked shorter
  const scale = req.lengthScale && req.lengthScale >= 0.3 && req.lengthScale <= 1.5
    ? req.lengthScale
    : lengthFactor(draftModel) * (freeHumanizer ? 0.7 : 1) * (catalogFacts ? 0.75 : 1);
  const naturalDraft = req.naturalDraft ?? process.env.CONTENT_NATURAL_DRAFT !== 'off';
  if (!reused) step('draft', `نگارش با ${draftModel}${naturalDraft ? ' (نگارش طبیعی)' : ''}`);
  // with the catalog, the main brands of the category may be named even if the brief listed fewer
  const draftBrief = catalogFacts
    ? { ...cleanBrief, brands: [...cleanBrief.brands, ...products.brands.slice(0, 8).filter(b => !cleanBrief.brands.some(x => norm(x.name) === norm(b.brand))).map(b => ({ name: b.brand, evidence: 'کاتالوگ' }))] }
    : cleanBrief;
  const draftInput = {
    category: briefInput.category,
    industry: [l1Cat.name, l2Cat && !isOwnL2 ? l2Cat.name : null].filter(Boolean).join(' / '),
    brief: draftBrief,
    tone: l1?.tone ?? '',
    audienceDesc: l1?.audience_desc ?? '',
    sectionRules: l1?.section_rules ?? { include: [], exclude: [] },
    profileCautions: [...(l1?.cautions ?? []), ...(l2?.cautions ?? [])],
    words: { min: Math.round(words.min * scale), max: Math.round(words.max * scale) },
    freeLength,
    natural: naturalDraft,
    ...(catalog ? { catalog, terms } : {}),
  };
  let draft: DraftSections | undefined = reused
    ? { above: reused.content.above, below: reused.draftBelow, metaTitle: reused.content.metaTitle, metaDescription: reused.content.metaDescription }
    : undefined;
  let lastParsed: DraftSections | undefined;
  for (let attempt = 1; attempt <= 3 && !draft; attempt++) {
    const raw = await generateText(draftMessages(draftInput), {
      model: draftModel,
      maxTokens,
      temperature: 0.6,
      stage: 'content-draft',
      useFallback: false,
      ...caps(),
    }, ctx);
    const parsed = parseDraft(raw);
    parsed.below = normalizeHeadings(demoteH1(parsed.below));
    if (parsed.above && parsed.below) {
      lastParsed = parsed;
      if (draftZwnjHealthy(parsed)) draft = parsed;
      else step('draft', 'نیم‌فاصله‌های پیش‌نویس حذف شده بود؛ نگارش دوباره');
    }
  }
  draft ??= lastParsed;
  if (!draft) throw new PipelineError('خروجی نگارش ساختار مورد انتظار را نداشت.', 502, 'draft_invalid');
  if (!draftZwnjHealthy(draft)) {
    // Some categories come back without ZWNJ on every retry: let the cheap brief model put them back,
    // and accept its answer only if nothing but spacing changed.
    step('draft', 'گذاشتن نیم‌فاصله‌ها با مدل ارزان');
    try {
      const raw = await generateText(zwnjMessages(formatDraft(draft)), {
        model: briefModel, maxTokens: maxTokens * 2, temperature: 0, stage: 'content-repair', useFallback: false, ...caps(),
      }, ctx);
      const fixed = parseDraft(raw);
      const bare = (t: string) => t.replace(/[\u200c\s]+/g, '');
      // spacing only, give or take a few letters (the model sometimes also fixes a typo); never content
      const a = bare(formatDraft(fixed));
      const b = bare(formatDraft(draft));
      const close = a === b || (Math.abs(a.length - b.length) <= b.length * 0.005 && editDistance(a, b) <= Math.max(5, b.length * 0.005));
      if (fixed.above && fixed.below && close) draft = fixed;
    } catch {
      ctx.signal?.throwIfAborted();
    }
  }

  const evidence = [
    cat.name,
    path,
    cat.synonyms,
    ...allNames,
    ...(catalog ? [catalog] : []),
    ...Object.entries(products.specs).flatMap(([u, v]) => v.map(x => `${x} ${u}`)),
    JSON.stringify(l1 ?? {}),
    JSON.stringify(l2 ?? {}),
    ...facts.map(f => f.fact),
  ].join('\n');
  const qaBase = {
    name: cat.name,
    tier: effectiveTier,
    freeLength,
    evidence,
    // a brand that is part of the category name or path is allowed by definition (e.g. «کلید فیوز زاویر»)
    // plus every store brand that occurs in this category's product names or subcategory names («لوله نیوفیت و پکس»)
    allowedBrands: [
      ...brands.map(b => b.name),
      ...products.brands.map(b => b.brand),
      ...allKnownBrands().filter(b => norm(path).includes(norm(b))),
      ...(() => {
        const local = norm([...allNames, ...childrenOf(cat).map(c => c.name), ...(products.catalog?.subcategories.map(s => s.name) ?? [])].join('\n'));
        return allKnownBrands().filter(b => norm(b).length >= 3 && local.includes(norm(b)));
      })(),
    ],
    knownBrands: allKnownBrands(),
    siteDataAvailable: !products.error && products.names.length > 0,
  };
  // ---------- 3a. fact check of the draft against the catalog (cheap model, one call) ----------
  let factCheck: ContentResult['factCheck'];
  const checkFacts = async (text: string): Promise<FactFinding[]> => {
    const raw = await generateText(factCheckMessages({ name: cat.name, catalog: catalog!, terms, text }), {
      model: briefModel, maxTokens: 3000, temperature: 0, stage: 'content-factcheck', useFallback: false, ...caps(),
    }, ctx);
    return parseFactFindings(raw);
  };
  if (catalog && !reused) {
    step('factcheck', 'مقایسهٔ پیش‌نویس با کاتالوگ');
    try {
      const findings = await checkFacts(`${draft!.above}\n\n${draft!.below}`);
      factCheck = { ran: true, findings, remaining: findings };
    } catch (error) {
      ctx.signal?.throwIfAborted();
      factCheck = { ran: false, findings: [], remaining: [] };
    }
  }
  // ---------- 3b. targeted repair of the draft (cheap, one call, kept only if QA improves) ----------
  let repair: ContentResult['repair'];
  const draftQa = runQa({ ...qaBase, above: draft!.above, below: draft!.below, metaTitle: draft!.metaTitle, metaDescription: draft!.metaDescription });
  const problems = process.env.CONTENT_REPAIR === 'off' || reused ? [] : repairProblems(draftQa, effectiveTier, cat.name, freeLength, draft!.below);
  let lintHitsBefore = 0;
  const lintHits = (md: string) =>
    new Set(lintText(md, { voice: 'standard', contentType: 'commercial', quality: 'readable' }).violations
      .filter(v => v.category === 'filler' || v.category === 'bureaucratic_verb').map(v => v.match.trim())).size;
  if (naturalDraft && !reused && process.env.CONTENT_REPAIR !== 'off') {
    // the humanizer's linter, on the draft: filler and bureaucratic verbs are fixed in the same repair call
    const lint = lintText(draft!.below, { voice: 'standard', contentType: 'commercial', quality: 'readable' });
    const hits = [...new Set(lint.violations.filter(v => v.category === 'filler' || v.category === 'bureaucratic_verb').map(v => v.match.trim()))];
    lintHitsBefore = hits.length;
    if (hits.length >= 2) problems.push(`این عبارت‌های کلیشه‌ای/اداری را با بیان ساده و مستقیم عوض کن: ${hits.slice(0, 12).join('، ')}`);
  }
  if (factCheck?.findings.length && process.env.CONTENT_REPAIR !== 'off') {
    problems.push(`این جمله‌ها با برگهٔ کاتالوگ یا اصطلاحات تأییدشده نمی‌خوانند؛ هر کدام را مطابق دادهٔ کاتالوگ درست کن یا اگر داده‌ای برایش نیست حذفش کن:\n${factCheck.findings.map(f => `   - «${f.quote}»: ${f.problem}`).join('\n')}`);
  }
  if (problems.length) {
    step('repair', `اصلاح ${problems.length} ایراد پیش‌نویس با ${draftModel}`);
    repair = { ran: true, accepted: false, problems, before: { level: draftQa.level, words: draftQa.words } };
    try {
      const raw = await generateText(repairMessages(cat.name, draft!, problems), {
        model: draftModel,
        maxTokens,
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
        const keepsZwnj = draftZwnjHealthy(fixed) || !draftZwnjHealthy(draft!);
        let remaining = factCheck?.findings ?? [];
        if (factCheck?.findings.length) {
          try {
            remaining = await checkFacts(`${fixed.above}\n\n${fixed.below}`);
          } catch {
            ctx.signal?.throwIfAborted();
          }
        }
        const factsBetter = !!factCheck?.findings.length && remaining.length < factCheck.findings.length;
        const factsWorse = !!factCheck && remaining.length > factCheck.findings.length;
        const better = !factsWorse && (
          qaScore(fixedQa) < qaScore(draftQa) ||
          (qaScore(fixedQa) === qaScore(draftQa) && ((lintHitsBefore >= 2 && lintHits(fixed.below) < lintHitsBefore) || factsBetter)) ||
          (factsBetter && qaScore(fixedQa) <= qaScore(draftQa) + 1)
        );
        // a repair must not delete much of the guide
        const keepsBody = freeLength ? fixedQa.words >= draftQa.words * 0.8 : fixedQa.words >= TIER_WORDS[effectiveTier].min * 0.85;
        if (keepsZwnj && better && keepsBody) {
          draft = fixed;
          repair.accepted = true;
          if (factCheck) factCheck.remaining = remaining;
        }
      }
    } catch (error) {
      ctx.signal?.throwIfAborted();
      repair.problems.push(`اصلاح انجام نشد: ${error instanceof Error ? error.message.slice(0, 120) : ''}`);
    }
  }

  // ---------- 4. humanize ----------
  const humanizerWriter = req.humanizerWriter || process.env.CONTENT_HUMANIZER_WRITER?.trim() || undefined;
  const envQuality = process.env.CONTENT_HUMANIZER_QUALITY?.trim() as QualityLevel | undefined;
  const humanizerQuality: QualityLevel = req.humanizerQuality ?? (envQuality && QUALITY_LEVELS.includes(envQuality) ? envQuality : 'precise');
  const guardMode = req.humanizerGuards ?? (process.env.CONTENT_HUMANIZER_GUARDS === 'strict' ? 'strict' : 'light');
  let finalBelow = draft!.below;
  const humanized: ContentResult['humanized'] = { applied: false };
  if ((req.humanize ?? defaultHumanize())) {
    step('humanize', 'هیومنایز راهنمای زیر لیست');
    const draftWords = countWords(draft!.below);
    const keywords = [...new Set([cat.name, 'کاروان صنعت', ...brands.map(b => b.name), ...products.brands.map(b => b.brand)])].filter(k => k.length <= 120).slice(0, 30);
    try {
      const out = await rewriteText(
        {
          text: draft!.below,
          voice: asVoice(l1?.humanizer.voice ?? 'standard'),
          contentType: asContentType(l1?.humanizer.contentType ?? 'commercial'),
          perspective: 'third_person',
          quality: humanizerQuality,
          keywords,
          // The humanizer's writer expands 1.4–2×. Any word target made it run a "compress" refine that rewrote the
          // text back to the draft (87–100% of sentences unchanged).
          // 'light' behaves like the web tool: no word target, so no compress-refine that reverts the rewrite.
          ...(guardMode === 'strict' ? { targetWords: Math.min(3000, Math.max(100, draftWords)), wordTolerance: 0.15 } : {}),
          articleGoal: cleanBrief.angle.slice(0, 2000),
          audience: (l1?.audience_desc ?? '').slice(0, 2000),
          // store page: theme owns the H1. 'strict' also forbids new claims and length changes.
          guards: guardMode === 'strict' ? { embedded: true, noNewClaims: true, holdLength: true, surgicalRepair: true } : { embedded: true, surgicalRepair: true },
        },
        (stage, message) => step(`humanize:${stage}`, message),
        ctx,
        humanizerWriter ? { writerModel: humanizerWriter } : {},
      );
      finalBelow = keepDraftHeadings(restoreZwnj(demoteH1(out.text), keywords), draft!.below, guardMode === 'strict');
      finalBelow = keepDraftClosing(finalBelow, draft!.below);
      humanized.applied = true;
      if (out.quality.sourceKept) humanized.sourceKept = true;
      humanized.diag = {
        chosen: out.quality.chosen,
        writerWords: out.quality.firstDraftWords,
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
  // brands of this category as the store spells them (product names), applied to every section
  const storeNames = [...products.brands.map(b => b.brand), ...allKnownBrands().filter(b => products.names.some(n => n.includes(b)))];
  const realWords = new Set(
    [cat.name, path, cat.synonyms, ...allNames.slice(0, 5000)].join(' ').split(/[\s،,.;:()«»"'/|\-–+*×]+/).filter(w => w.length >= 2),
  );
  const spell = (t: string) => fixNameSpelling(t, storeNames, realWords);
  const content: DraftSections = {
    above: spell(draft!.above),
    below: spell(finalBelow),
    metaTitle: spell(draft!.metaTitle),
    metaDescription: spell(draft!.metaDescription),
  };
  // ---------- 5a. SEO title and description in their own step (candidates checked by code, pattern fallback) ----------
  let meta: ContentResult['meta'];
  if (process.env.CONTENT_META_STEP !== 'off') {
    step('meta', 'عنوان سئو و توضیح متا');
    const metaBrands = products.brands.slice(0, 4).map(b => b.brand);
    let candidates = { titles: [] as string[], descriptions: [] as string[] };
    try {
      const raw = await generateText(metaMessages({
        name: cat.name,
        path,
        above: content.above,
        brands: metaBrands,
        facts: facts.slice(0, 8).map(f => f.fact),
        families: products.catalog?.families.slice(0, 6).map(f => `${f.family} (${f.count})`) ?? [],
      }), { model: briefModel, maxTokens: 2500, temperature: 0.7, stage: 'content-meta', useFallback: false, ...caps() }, ctx);
      candidates = parseMetaCandidates(raw);
    } catch {
      ctx.signal?.throwIfAborted();
    }
    const choice = chooseMeta({
      titles: [...candidates.titles, content.metaTitle],
      descriptions: [...candidates.descriptions, content.metaDescription],
      name: cat.name,
      brands: metaBrands,
      fact: facts[0]?.fact,
    });
    content.metaTitle = spell(choice.title);
    content.metaDescription = spell(choice.description);
    meta = { ran: true, source: choice.source, candidates: choice.candidates };
  }
  const qa = runQa({ ...qaBase, above: content.above, below: content.below, metaTitle: content.metaTitle, metaDescription: content.metaDescription });
  if (factCheck?.ran) {
    const left = factCheck.remaining;
    qa.checks.push({
      id: 'facts', level: left.length ? 'warn' : 'pass', label: 'هم‌خوانی با کاتالوگ (بازبین دوم)',
      detail: left.length ? left.map(f => `«${f.quote.slice(0, 80)}»: ${f.problem.slice(0, 120)}`).join(' | ') : (factCheck.findings.length ? `${factCheck.findings.length} ایراد پیدا و اصلاح شد` : undefined),
    });
    if (left.length && qa.level === 'pass') qa.level = 'warn';
  }
  const qaDraftFull = runQa({ ...qaBase, above: content.above, below: draft!.below, metaTitle: content.metaTitle, metaDescription: content.metaDescription });

  const usage = usageSummary(ctx.runId) as { knownCostUsd: number; promptTokens: number; completionTokens: number; attempts: number } | undefined;
  const result: ContentResult = {
    resultId: randomUUID(),
    createdAt: new Date().toISOString(),
    ...(req.label ? { label: req.label } : {}),
    promptVersion: PROMPT_VERSION,
    category: { id: cat.id, name: cat.name, path, level: cat.level, tier: effectiveTier, productCount, url: products.live?.link ?? null, flags: cat.flags },
    models: { brief: briefModel, draft: draftModel, humanize: humanized.applied, lengthScale: scale, naturalDraft, catalogFacts, freeLength, ...(humanizerWriter ? { humanizerWriter } : {}), ...(humanized.applied ? { humanizerGuards: guardMode, humanizerQuality } : {}) },
    data: { productSample: products.names.length, productsRead: allNames.length, brands: products.brands, specs: products.specs, ...(catalog ? { catalog } : {}), ...(products.error ? { siteError: products.error } : {}) },
    ...(factCheck ? { factCheck } : {}),
    ...(meta ? { meta } : {}),
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
