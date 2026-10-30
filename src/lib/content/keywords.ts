/**
 * Keyword research for a category page from Google Suggest (no account needed): what buyers type around the
 * category name, sorted by search intent, and which of it the page text does not cover yet («keyword gap»).
 * Adapted from the store owner's Suggest sheet: seeds × prefixes/suffixes, depth 1, a pause between requests,
 * intent rules in priority order. Search volume (Keyword Planner) can be added to the same rows later.
 */
import { kv } from './store';
import { norm } from './taxonomy';

export type Intent =
  | 'نامرتبط'
  | 'قیمت و خرید'
  | 'نمایندگی و فروشنده'
  | 'مقایسه'
  | 'علت و عیب‌یابی'
  | 'آموزش و نصب'
  | 'مشخصات و سایز'
  | 'برند و مدل'
  | 'عمومی';

const ZW = '[\\s\\u200c]?';
/** In priority order: the first match wins (as in the sheet). */
const RULES: Array<[Intent, RegExp]> = [
  ['نامرتبط', /(دانلود|فیلم|آهنگ|بازی|خودرو|پراید|پژو|سمند|گوشی|لپ ?تاپ|استخدام|آموزشگاه|کاریابی)/i],
  ['مقایسه', /(فرق|تفاوت|مقایسه|بهتر[\s‌]?است|یا\s|بهتره|vs)/i],
  ['علت و عیب‌یابی', new RegExp(`(علت|چرا|دلیل|مشکل|خرابی|خراب|عیب|نشتی|نشت|چکه|صدا|داغ|نمی${ZW}(کند|کنه|شود|شه|زند|زنه|گیرد|گیره))`, 'i')],
  ['آموزش و نصب', /(آموزش|اموزش|نحوه|نصب|روش|چگونه|چطور|طریقه|راهنما|سیم[\s‌]?کشی|نقشه|شماتیک|چیست|کاربرد|کار ?می ?کند|pdf|کاتالوگ)/i],
  ['قیمت و خرید', /(قیمت|خرید|فروش|ارزان|لیست|بازار|هزینه|نرخ|چند|عمده|تخفیف)/i],
  ['نمایندگی و فروشنده', /(نمایندگی|فروشگاه|فروشنده|عاملیت|پخش|تهران|شوش|لاله[\s‌]?زار|بازار|آدرس|تلفن|شماره|نزدیک)/i],
  ['مشخصات و سایز', /(سایز|اینچ|میل|میلی|متر|ابعاد|وزن|فشار|بار|ولت|آمپر|وات|کیلو|اسب|مشخصات|جنس|فنی|استاندارد|\d)/i],
  ['برند و مدل', /([a-z]{3,}|مدل|برند|مارک|ایرانی|خارجی|چینی|ترک|ایتالیا|آلمان)/i],
];

export function intentOf(q: string): Intent {
  for (const [intent, re] of RULES) if (re.test(q)) return intent;
  return 'عمومی';
}

export const PREFIXES = ['قیمت', 'خرید', 'انواع', 'مشخصات'];
export const SUFFIXES = ['قیمت', 'خرید', 'سایز', 'مدل', 'برند', 'چیست', 'فرق', 'نصب', 'عمده', 'نمایندگی'];

async function suggest(q: string, signal?: AbortSignal): Promise<string[]> {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=fa&gl=ir&ie=utf-8&oe=utf-8&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Suggest HTTP ${res.status}`);
  const data = (await res.json()) as [string, string[]];
  return Array.isArray(data?.[1]) ? data[1] : [];
}

export interface SuggestRow {
  q: string;
  intent: Intent;
  seed: string;
  /** Every distinguishing word of the query appears in the page text. */
  covered?: boolean;
  /** Its distinguishing words appear in the category's product data (so the page can honestly cover it). */
  supported?: boolean;
  /** The words of the query that are not part of the category name. */
  extra?: string[];
  /**
   * At least one distinguishing word is known to the page, its data or its category path. «زانو بند طبی» shares only
   * the name with «زانو» (a pipe elbow is not a knee brace) and is dropped as unrelated.
   */
  relevant?: boolean;
}

const words = (s: string) => norm(s.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))).split(/[\s،,.؛:()«»؟?!\-/]+/).filter(w => w.length > 1);
/** Words that say nothing about content (search intent words are counted as covered by any buying page). */
const FILLER = new Set(['قیمت', 'خرید', 'فروش', 'انواع', 'بهترین', 'لیست', 'مدل', 'برند', 'در', 'با', 'و', 'از', 'برای', 'به', 'چیست', 'های', 'ها', 'جدید', 'ارزان', 'عمده', 'نمایندگی', 'سایز', 'مشخصات', 'روز', 'امروز', '1403', '1404', '1405', 'تهران']);

export function gapOf(rows: SuggestRow[], name: string, pageText: string, dataText: string, pathText = ''): SuggestRow[] {
  const nameW = new Set(words(name));
  const page = new Set(words(pageText));
  const data = new Set(words(dataText));
  const path = new Set(words(pathText));
  return rows.map(r => {
    const extra = words(r.q).filter(w => !nameW.has(w) && !FILLER.has(w));
    const known = (w: string) => data.has(w) || page.has(w) || path.has(w);
    const relevant = r.intent !== 'نامرتبط' && (extra.length === 0 || extra.some(known));
    return {
      ...r,
      intent: relevant ? r.intent : 'نامرتبط',
      extra,
      relevant,
      covered: extra.every(w => page.has(w)),
      supported: extra.length === 0 || extra.every(w => data.has(w) || page.has(w)),
    };
  });
}

/** Seeds for an everyday one-word name («زانو») carry the parent's first word («زانو لوله») to keep Suggest on topic. */
export function seedsFor(name: string, parentName: string | undefined, synonyms: string[]): string[] {
  const out = [name, ...synonyms];
  const ctx = (parentName ?? '').split(/[\s،,]+/)[0];
  if (!name.trim().includes(' ') && ctx && ctx !== name) out.splice(1, 0, `${name} ${ctx}`);
  return [...new Set(out.map(s => s.trim()).filter(Boolean))].slice(0, 3);
}

export async function researchCategory(input: { categoryId: string; name: string; seeds?: string[]; maxRequests?: number; delayMs?: number; signal?: AbortSignal; fresh?: boolean }): Promise<SuggestRow[]> {
  const client = await kv();
  const key = `kw:suggest:${input.categoryId}`;
  if (client && !input.fresh) {
    const hit = await client.get(key).catch(() => null);
    if (hit) return JSON.parse(hit) as SuggestRow[];
  }
  const seeds = input.seeds?.length ? input.seeds.slice(0, 3) : [input.name];
  const queries: Array<[string, string]> = [];
  for (const s of seeds) {
    queries.push([s, s]);
    for (const p of PREFIXES) queries.push([`${p} ${s}`, s]);
    for (const x of SUFFIXES) queries.push([`${s} ${x}`, s]);
  }
  const seen = new Map<string, SuggestRow>();
  for (const [q, seed] of queries.slice(0, input.maxRequests ?? 45)) {
    input.signal?.throwIfAborted();
    try {
      for (const s of await suggest(q, input.signal)) {
        const k = norm(s);
        if (!seen.has(k)) seen.set(k, { q: s, intent: intentOf(s), seed });
      }
    } catch {
      // one failed request does not stop the research
    }
    await new Promise(r => setTimeout(r, input.delayMs ?? 400));
  }
  const rows = [...seen.values()];
  if (client) await client.set(key, JSON.stringify(rows), { EX: 30 * 24 * 3600 }).catch(() => undefined);
  return rows;
}
