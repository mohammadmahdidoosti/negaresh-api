/**
 * Automatic checks on generated category content. Each check is cheap and explainable,
 * so a reviewer sees exactly why a page is flagged.
 */
import { countWords } from '@/lib/text';
import { wrongTermUses } from './glossary';
import { norm, TIER_WORDS, type Tier } from './taxonomy';

export type QaLevel = 'pass' | 'warn' | 'fail';
export interface QaCheck {
  id: string;
  level: QaLevel;
  label: string;
  detail?: string;
}

const toLatin = (s: string) => s.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const UNIT_AFTER = /^\s*(آمپر|ولت|وات|کیلووات|کیلووار|اسب|اینچ|میلی|سانت|متر|لیتر|بار|psi|درجه|پل|فاز|کیلو|گرم|دور|هرتز|درصد|٪|%)/i;

/** Numbers that look like specs (≥ 11, decimals, fractions, or followed by a unit). */
function specNumbers(text: string): string[] {
  const t = toLatin(text.replace(/\[\[[^\]]*\]\]/g, ''));
  const out: string[] = [];
  for (const m of t.matchAll(/\d+(?:[./]\d+)?/g)) {
    const value = m[0];
    const after = t.slice((m.index ?? 0) + value.length, (m.index ?? 0) + value.length + 12);
    const n = parseFloat(value);
    if (/[./]/.test(value) || n > 10 || UNIT_AFTER.test(after)) out.push(value);
  }
  return out;
}

/** Absolute or guaranteed outcomes. «کاملاً» alone is fine («کاملاً متفاوت»); only with a safety/quality word. */
export const ABSOLUTE =
  /(?<![\p{L}])((?:نشتی|نشت|خرابی|گرفتگی|رسوب|خوردگی|زنگ[‌ ]?زدگی|خطر|صدا|لرزش|افت\s+فشار)[^.،؛\n]{0,25}?(?:حذف|برطرف)\s*می[‌ ]?(?:کند|شود)|(?:نشتی|نشت|خرابی|گرفتگی|رسوب|خوردگی|خطر)[^.،؛\n]{0,25}?از\s*بین\s*می[‌ ]?(?:برد|رود)|تضمین\s*می[‌ ]?(?:کند|شود)|هرگز\s+[^.،؛\n]{0,30}?نمی[‌ ]?\S+|کاملاً\s+(?:ایمن|بی[‌ ]?خطر|مطمئن|بدون\s+نشتی|آب[‌ ]?بند)|بدون\s+هیچ\s+(?:مشکل|نشتی|خطر)|هیچ[‌ ]?گاه\s+[^.،؛\n]{0,30}?نمی[‌ ]?\S+)/gu;

const sentencesOf = (md: string) =>
  md
    .split('\n')
    .filter(l => !/^\s*\|/.test(l) && !/^#/.test(l))
    .join('\n')
    .split(/(?<=[.؟?!])\s+|\n+/)
    .map(s => s.replace(/[*_>\-•]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(s => s.split(' ').length >= 6);
const wordsOf = (s: string) => new Set(norm(toLatin(s)).split(/[\s،,.؛:()«»؟?!]+/).filter(w => w.length > 2));

/** Later sentences that repeat an earlier one (Jaccard ≥ 0.5 over words longer than 2 letters). */
export function repeatedSentences(md: string, threshold = 0.5): Array<{ first: string; second: string }> {
  const ss = sentencesOf(md);
  const ws = ss.map(wordsOf);
  const out: Array<{ first: string; second: string }> = [];
  for (let k = 1; k < ss.length; k++) {
    for (let i = 0; i < k; i++) {
      let common = 0;
      for (const w of ws[k]) if (ws[i].has(w)) common++;
      const union = ws[i].size + ws[k].size - common;
      if (union && common / union >= threshold) {
        out.push({ first: ss[i], second: ss[k] });
        break;
      }
    }
  }
  return out;
}

export interface QaInput {
  name: string;
  tier: Tier;
  above: string;
  below: string;
  metaTitle: string;
  metaDescription: string;
  /** Text whose numbers/brands are considered evidence (product names, path, profiles, facts). */
  evidence: string;
  allowedBrands: string[];
  knownBrands: string[];
  siteDataAvailable: boolean;
  /** Length is free: reported, never flagged. */
  freeLength?: boolean;
}

export function runQa(q: QaInput): { level: QaLevel; checks: QaCheck[]; words: number } {
  const checks: QaCheck[] = [];
  const add = (id: string, level: QaLevel, label: string, detail?: string) => checks.push({ id, level, label, detail });
  // «250» in the name and «۲۵۰» in the text are the same keyword
  const nk = (s: string) => norm(toLatin(s));
  const nName = nk(q.name);
  const words = countWords(q.below);
  const range = TIER_WORDS[q.tier];

  // 1. keyword placement
  add('kw-above', nk(q.above).includes(nName) ? 'pass' : 'fail', 'نام دقیق دسته در متن بالای لیست');
  const first100 = q.below.split(/\s+/).slice(0, 110).join(' ');
  add('kw-below', nk(first100).includes(nName) ? 'pass' : 'warn', 'نام دسته در ۱۰۰ کلمهٔ اول راهنما');
  add('kw-title', nk(q.metaTitle).includes(nName) ? 'pass' : 'warn', 'نام دسته در عنوان سئو');

  // 2. structure
  const h1 = (q.below.match(/^#\s/gm) ?? []).length;
  add('no-h1', h1 === 0 ? 'pass' : 'fail', 'بدون H1 در متن (قالب خودش H1 دارد)', h1 ? `${h1} مورد` : undefined);
  const h2 = (q.below.match(/^##\s/gm) ?? []).length;
  const minH2 = q.tier === 'hub' ? 7 : q.tier === 'standard' ? 5 : 3;
  add('h2-count', h2 >= minH2 ? 'pass' : 'warn', `حداقل ${minH2} تیتر H2`, `${h2} تیتر`);
  add('no-conclusion', /^##.*(نتیجه[‌ ]?گیری|جمع[‌ ]?بندی)/m.test(q.below) ? 'fail' : 'pass', 'تیتر «نتیجه‌گیری/جمع‌بندی» ندارد');
  add('faq', /^##.*(سوال|سؤال|پرسش)/m.test(q.below) ? 'pass' : 'warn', 'بخش سؤالات متداول');

  // 3. length
  const lenOk = words >= range.min * 0.85 && words <= range.max * 1.2;
  if (q.freeLength) add('length', 'pass', 'طول راهنما (آزاد)', `${words} کلمه`);
  else add('length', lenOk ? 'pass' : 'warn', `طول راهنما ${range.min} تا ${range.max} کلمه`, `${words} کلمه`);
  const aboveWords = countWords(q.above);
  add('above-length', aboveWords >= 45 && aboveWords <= 140 ? 'pass' : 'warn', 'متن بالای لیست ۶۰ تا ۱۱۰ کلمه', `${aboveWords} کلمه`);

  // 4. accuracy
  const all = `${q.above}\n${q.below}\n${q.metaTitle}\n${q.metaDescription}`;
  // whole words only: «ریال» must not match inside «متریال»
  const price = all.match(/(?<![\p{L}])(تومان|ریال|قیمت\s*[0-9۰-۹]|تخفیف\s*[0-9۰-۹]|ارسال رایگان)(?![\p{L}])/u);
  add('no-price', price ? 'fail' : 'pass', 'بدون قیمت، تخفیف یا وعدهٔ ارسال', price?.[0]);
  // well-known standard values (mains voltage, frequency, common DC voltages) need no product evidence
  const STANDARD = new Set(['12', '24', '48', '50', '60', '110', '220', '230', '380', '400']);
  const evidenceNums = new Set([...specNumbers(q.evidence), ...STANDARD]);
  const unknown = [...new Set(specNumbers(all))].filter(n => !evidenceNums.has(n));
  // informational only: a number missing from product names is usually a correct general fact
  add(
    'numbers',
    unknown.length === 0 ? 'pass' : 'warn',
    'هر عدد فنی در دادهٔ واقعی یا پروفایل وجود دارد',
    unknown.length ? `بدون پشتوانه: ${unknown.slice(0, 12).join('، ')}` : undefined,
  );
  const allowed = q.allowedBrands.map(norm);
  const text = ` ${norm(all).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  // Brand names that are also everyday Persian words cannot be checked by word matching.
  const COMMON = new Set(['هدف', 'راحت', 'اتصال', 'پارس', 'رعد', 'صبا', 'توسن', 'وال', 'ایران', 'برکت', 'نوین', 'پیشرو']);
  const foreign = q.knownBrands.filter(b => {
    if (COMMON.has(norm(b))) return false;
    const nb = norm(b).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    // whole-word match only, so «وال» does not match inside «سوالات»
    return nb.length >= 2 && text.includes(` ${nb} `) && !allowed.some(a => a.includes(nb) || nb.includes(a));
  });
  add('brands', foreign.length ? 'fail' : 'pass', 'فقط برندهای موجود در همین دسته', foreign.length ? foreign.join('، ') : undefined);
  const hype = all.match(/(تضمین|بهترین|بزرگ[‌ ]?ترین|صد درصد|۱۰۰٪|100%|بی[‌ ]?نظیر|اورجینال)/g);
  add('hype', hype ? 'warn' : 'pass', 'بدون ادعای تبلیغاتی و تضمین', hype ? [...new Set(hype)].join('، ') : undefined);
  // absolute claims («نشتی را حذف می‌کند»، «هرگز خراب نمی‌شود»): an easy-to-spot sign of the writer guessing
  const absolute = [...new Set(all.match(ABSOLUTE) ?? [])];
  add('absolute', absolute.length ? 'warn' : 'pass', 'بدون ادعای قطعی و مطلق', absolute.length ? absolute.slice(0, 6).join('، ') : undefined);
  const wrongTerms = wrongTermUses(`${q.above}\n${q.below}`);
  add('terms', wrongTerms.length ? 'warn' : 'pass', 'تعریف اصطلاحات تأییدشده درست است', wrongTerms.length ? wrongTerms.map(w => `${w.term}: «${w.sentence.slice(0, 90)}»`).join(' | ') : undefined);
  const placeholders = (all.match(/\[\[[^\]]+\]\]/g) ?? []).length;
  add('placeholders', placeholders === 0 ? 'pass' : placeholders <= 2 ? 'warn' : 'fail', 'جای خالی نیازمند منبع', placeholders ? `${placeholders} مورد` : undefined);
  add('site-data', q.siteDataAvailable ? 'pass' : 'warn', 'دادهٔ زندهٔ محصولات از سایت');
  const textWords = countWords(`${q.above}\n${q.below}`);
  const zwnj = (`${q.above}\n${q.below}`.match(/\u200c/g) ?? []).length;
  const aboveZwnj = (q.above.match(/\u200c/g) ?? []).length;
  const zwnjOk = (textWords < 80 || zwnj >= textWords * 0.01) && (aboveWords < 35 || aboveZwnj > 0);
  add('zwnj', zwnjOk ? 'pass' : 'warn', 'نیم‌فاصله‌ها سالم (مثل «می‌شود»)', `${zwnj} نیم‌فاصله در ${textWords} کلمه${aboveWords >= 35 && !aboveZwnj ? '؛ متن بالای لیست هیچ نیم‌فاصله‌ای ندارد' : ''}`);
  // the same point said twice (sentences sharing most of their words), tables excluded
  const repeats = repeatedSentences(q.below);
  add('repeat', repeats.length >= 3 ? 'warn' : 'pass', 'بدون تکرار یک نکته در چند بخش', repeats.length ? `${repeats.length} جملهٔ تکراری: ${repeats.slice(0, 4).map(r => `«${r.second.slice(0, 70)}»`).join('، ')}` : undefined);

  // 5. meta
  const t = q.metaTitle.length;
  add('meta-title', t >= 25 && t <= 65 ? 'pass' : 'warn', 'طول عنوان سئو ۲۵ تا ۶۰ نویسه', `${t} نویسه`);
  const d = q.metaDescription.length;
  add('meta-desc', d >= 100 && d <= 165 ? 'pass' : 'warn', 'طول توضیح متا ۱۲۰ تا ۱۵۵ نویسه', `${d} نویسه`);

  const level: QaLevel = checks.some(c => c.level === 'fail') ? 'fail' : checks.some(c => c.level === 'warn') ? 'warn' : 'pass';
  return { level, checks, words };
}
