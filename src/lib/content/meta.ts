/**
 * SEO title and meta description, written in their own small step after the page text is final.
 *
 * Written inside the long draft, 40% of titles came out longer than 60 characters and some promised «لیست قیمت»
 * on pages without prices. Here the model proposes several candidates and code picks one that meets hard rules;
 * if none does, a fixed pattern is used. Length is counted in characters, as Google truncates titles at ~60.
 */
import { norm } from './taxonomy';

export const TITLE_MAX = 60;
export const TITLE_MIN = 25;
export const DESC_MIN = 120;
export const DESC_MAX = 155;
export const SITE_SUFFIX = ' | کاروان صنعت';

/** Words a category page cannot promise (no prices or deals on the page) or superlatives. */
export const META_BANNED = /(قیمت|تخفیف|ارزان|بهترین|برترین|بزرگ[‌ ]?ترین|ارسال\s*رایگان|اورجینال|۱۰۰٪|100%|صد\s*درصد)/;

const toLatin = (s: string) => s.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
const nk = (s: string) => norm(toLatin(s));
const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^["«']+|["»']+$/g, '').trim();

export const suffixOn = () => process.env.CONTENT_META_SITE_SUFFIX !== 'off';

export function titleProblems(t: string, name: string): string[] {
  const out: string[] = [];
  if (t.length > TITLE_MAX) out.push(`بیش از ${TITLE_MAX} نویسه`);
  if (t.length < TITLE_MIN) out.push(`کمتر از ${TITLE_MIN} نویسه`);
  if (!nk(t).startsWith(nk(name))) out.push('با نام دسته شروع نمی‌شود');
  if (META_BANNED.test(t)) out.push('کلمهٔ ممنوع');
  return out;
}

export function descProblems(d: string, name: string): string[] {
  const out: string[] = [];
  if (d.length > DESC_MAX) out.push(`بیش از ${DESC_MAX} نویسه`);
  if (d.length < DESC_MIN) out.push(`کمتر از ${DESC_MIN} نویسه`);
  if (!nk(d).includes(nk(name))) out.push('نام دسته را ندارد');
  if (META_BANNED.test(d)) out.push('کلمهٔ ممنوع');
  return out;
}

/** The site name at the end when it fits (and the title does not already carry it). */
export function withSuffix(t: string): string {
  if (!suffixOn() || t.includes('کاروان صنعت')) return t;
  return (t + SITE_SUFFIX).length <= TITLE_MAX ? t + SITE_SUFFIX : t;
}

/** Prefers titles that name a store brand, then the longer (more informative) one within the limit. */
function titleScore(t: string, brands: string[]): number {
  const b = brands.filter(x => nk(t).includes(nk(x))).length;
  return b * 100 + t.length;
}
function descScore(d: string, brands: string[]): number {
  const b = brands.filter(x => nk(d).includes(nk(x))).length;
  const cta = /(مشاوره|استعلام|خرید|سفارش)/.test(d) ? 50 : 0;
  return b * 100 + cta + d.length / 10;
}

export function fallbackTitle(name: string, brands: string[]): string {
  const [b1, b2] = brands;
  const tries = [
    b1 && b2 ? `${name} | ${b1} و ${b2}` : '',
    b1 ? `${name} | ${b1}` : '',
    `${name} | راهنمای انتخاب و خرید`,
    name,
  ].filter(Boolean);
  for (const t of tries) {
    const s = withSuffix(t);
    if (s.length <= TITLE_MAX && !titleProblems(s, name).some(p => p.includes('بیش از'))) return s;
  }
  return name.slice(0, TITLE_MAX);
}

/** Cut at a word boundary, never mid-word. */
function cutWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const room = max - 1; // the closing «.»
  const cut = s.slice(0, room + 1);
  const at = cut.lastIndexOf(' ');
  return (at > room * 0.6 ? cut.slice(0, at) : s.slice(0, room)).replace(/[،,؛:.\s]+$/, '') + '.';
}

export function fallbackDescription(name: string, brands: string[], fact?: string): string {
  const brandPart = brands.length >= 2 ? ` از برندهای ${brands[0]} و ${brands[1]}` : brands.length ? ` برند ${brands[0]}` : '';
  // whole sentences only: each is added while the description stays within the limit (never cut mid-phrase)
  const parts = [
    `${name}${brandPart} در کاروان صنعت.`,
    fact ? `${fact.replace(/[.\s]+$/, '')}.` : '',
    'راهنمای انتخاب، مشاورهٔ فنی و خرید آنلاین.',
    'مقایسهٔ انواع و نکات پیش از سفارش در همین صفحه.',
    'نکات انتخاب را پیش از سفارش بخوانید.',
  ].filter(Boolean);
  let d = '';
  for (const p of parts) {
    const next = d ? `${d} ${p}` : p;
    if (next.length <= DESC_MAX) d = next;
    if (d.length >= DESC_MIN) break;
  }
  return d.length <= DESC_MAX ? d : cutWords(d, DESC_MAX);
}

export interface MetaChoice {
  title: string;
  description: string;
  source: { title: 'model' | 'fallback'; description: 'model' | 'fallback' };
  candidates: number;
}

export function chooseMeta(input: { titles: string[]; descriptions: string[]; name: string; brands: string[]; fact?: string }): MetaChoice {
  const titles = input.titles
    .map(clean)
    .map(t => (t.length <= TITLE_MAX ? withSuffix(t) : t))
    .filter(t => titleProblems(t, input.name).length === 0)
    .sort((a, b) => titleScore(b, input.brands) - titleScore(a, input.brands));
  const descs = input.descriptions
    .map(clean)
    .filter(d => descProblems(d, input.name).length === 0)
    .sort((a, b) => descScore(b, input.brands) - descScore(a, input.brands));
  return {
    title: titles[0] ?? fallbackTitle(input.name, input.brands),
    description: descs[0] ?? fallbackDescription(input.name, input.brands, input.fact),
    source: { title: titles[0] ? 'model' : 'fallback', description: descs[0] ? 'model' : 'fallback' },
    candidates: input.titles.length + input.descriptions.length,
  };
}

export function metaMessages(input: { name: string; path: string; above: string; brands: string[]; facts: string[]; families: string[] }) {
  const system = `تو متخصص سئوی فروشگاه «کاروان صنعت» هستی. برای صفحهٔ دستهٔ محصول «${input.name}» عنوان سئو (title) و توضیح متا (meta description) بنویس.
قواعد عنوان (هر کدام):
- دقیقاً با «${input.name}» شروع شود (همین املا).
- حداکثر ${TITLE_MAX - SITE_SUFFIX.length} نویسه (نام سایت بعداً اضافه می‌شود)، بدون نام سایت.
- بعد از نام دسته، با « | » مهم‌ترین تمایز واقعی همین دسته: برندهای اصلی، نوع‌ها یا بازهٔ مشخصات (فقط از داده).
قواعد توضیح متا (هر کدام):
- ${DESC_MIN} تا ${DESC_MAX} نویسه (این مهم است؛ بشمار).
- نام دسته، یک یا دو برند اصلی، یک واقعیت مشخص از داده (مثلاً بازهٔ سایز یا نوع‌ها) و دعوت کوتاه به مشاوره یا خرید از کاروان صنعت.
ممنوع در هر دو: قیمت، لیست قیمت، تخفیف، ارزان، بهترین، برترین، ارسال رایگان، اغراق؛ هر برند یا عددی که در داده نیست.
فقط JSON (بدون توضیح و بدون \`\`\`): {"titles": ["۴ گزینهٔ متفاوت"], "descriptions": ["۴ گزینهٔ متفاوت"]}`;
  const user = JSON.stringify(
    {
      'نام دسته': input.name,
      'مسیر': input.path,
      'برندهای اصلی (به ترتیب سهم)': input.brands,
      'خانواده‌های اصلی محصول': input.families,
      'واقعیت‌ها': input.facts,
      'متن بالای لیست': input.above.slice(0, 900),
    },
    null,
    1,
  );
  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
}

export function parseMetaCandidates(raw: string): { titles: string[]; descriptions: string[] } {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return { titles: [], descriptions: [] };
  try {
    const o = JSON.parse(raw.slice(start, end + 1)) as { titles?: unknown; descriptions?: unknown };
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : []);
    return { titles: arr(o.titles), descriptions: arr(o.descriptions) };
  } catch {
    return { titles: [], descriptions: [] };
  }
}
