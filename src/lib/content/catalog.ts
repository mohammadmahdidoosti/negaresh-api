/**
 * Catalog fact sheet: what the category really sells, counted over (almost) every product in it.
 *
 * The first version read only the first 200 products (newest first). In big categories that is one supplier's
 * latest import: «پمپ هیدرولیک پره ای» (1,203 products) was written from 200 Scenery pumps and never mentioned
 * Yuken; «تجهیزات تابلو برق» (3,620) only from «اتصال». The model then filled the gaps from memory.
 *
 * Products are grouped into families (the name without sizes, numbers and long model codes), and each family
 * carries its own counted sizes, values and series codes, so the writer can say exactly which series has which
 * sizes instead of guessing.
 */
import { norm } from './taxonomy';

export interface CatalogProduct {
  name: string;
  inStock: boolean;
  categories: string[];
}

export interface CatalogFamily {
  family: string;
  count: number;
  inStock: number;
  sizes: string[];
  values: Record<string, string[]>;
}

export interface Catalog {
  /** Products actually read (may be fewer than the category's total in very large categories). */
  counted: number;
  total: number;
  subcategories: Array<{ name: string; count: number }>;
  families: CatalogFamily[];
  /** Families beyond the listed ones (counted, not shown). */
  otherFamilies: number;
  otherProducts: number;
}

export const toLatinDigits = (s: string) =>
  s.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

export function decodeName(s: string): string {
  return s
    .replace(/&#8211;|&#8212;/g, '–')
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&#8217;|&#8216;/g, "'")
    .replace(/&#215;/g, '×')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)));
}

export const UNIT_RE =
  /(\d+\s+\d+\/\d+|\d+(?:[.,/]\d+)?(?:\s*(?:تا|-)\s*\d+(?:[.,/]\d+)?)?)\s*(کیلووار|کیلو\s?وار|کیلووات|کیلو\s?وات|کیلو\s?آمپر|آمپر|ولت|وات|اسب(?:\s*بخار)?|اینچ|میلی\s?متر|میلیمتر|سانتی\s?متر|سانت|لیتری|لیتر|بار|psi|درجه|پل|فاز|کیلوگرم|کیلویی|گرم|متری|متر|دور|هرتز|kva|kvar|kw|hp|mm|bar)(?![\p{L}])/giu;

const UNIT_CANON: Record<string, string> = {
  'کیلو وار': 'کیلووار', kvar: 'کیلووار', 'کیلو وات': 'کیلووات', kw: 'کیلووات', 'کیلو آمپر': 'کیلوآمپر', 'کیلوآمپر': 'کیلوآمپر',
  'میلی متر': 'میلی‌متر', میلیمتر: 'میلی‌متر', mm: 'میلی‌متر', 'سانتی متر': 'سانتی‌متر', سانت: 'سانتی‌متر', hp: 'اسب بخار', اسب: 'اسب بخار',
  'اسب بخار': 'اسب بخار', bar: 'بار', kva: 'کیلوولت‌آمپر', لیتری: 'لیتر', متری: 'متر', کیلویی: 'کیلوگرم',
};
const canonUnit = (u: string) => {
  const k = u.replace(/\s+/g, ' ').toLowerCase();
  return UNIT_CANON[k] ?? k;
};

/** Tokens that can belong to a size after «سایز»: numbers, fractions, separators and length units. */
const SIZE_TOKEN = /^(?:[0-9][0-9./"”'+×x*\-]*["”']?|[×x*+\-/"”]+|میلی|متر|میلیمتر|میلی‌متر|اینچ|در|سانت)$/i;
/** Short series codes stay in the family name (T6EC, NH1, C2); long order codes do not (HDM3400F40033XXT). */
const SERIES = /^[A-Z]{1,4}\d{0,2}[A-Z]{0,3}$/i;

export function splitName(raw: string): { family: string; size: string | null } {
  const name = toLatinDigits(decodeName(raw)).replace(/\s+/g, ' ').trim();
  const tokens = name.split(' ');
  const out: string[] = [];
  let size: string[] | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'سایز' && size === null) {
      const s: string[] = [];
      while (i + 1 < tokens.length && SIZE_TOKEN.test(tokens[i + 1])) s.push(tokens[++i]);
      size = s;
      continue;
    }
    if (/[0-9]/.test(t)) {
      if (SERIES.test(t) && /[A-Z]/i.test(t[0])) out.push(t.toUpperCase());
      continue;
    }
    out.push(t);
  }
  const family = out
    .join(' ')
    .replace(/\(\s*[^\p{L})]*\)/gu, ' ') // brackets left empty after removing numbers
    .replace(/\s[–\-,،:+×*/]+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s–\-,،:]+$/, '')
    .trim();
  const sizeText = size && size.length ? size.join(' ').replace(/\s*([×x*+])\s*/g, '$1').trim() : null;
  return { family, size: sizeText };
}

/**
 * «63-10 بار» is «قطر ۶۳، فشار ۱۰ بار», not a range from 63 to 10: a dash range counts only when it rises
 * (1.6-2.5 آمپر); otherwise only the number next to the unit is the value.
 */
export function unitValue(raw: string): string {
  if (/^\d+\s+\d+\/\d+$/.test(raw.trim())) return raw.trim().replace(/\s+/g, ' '); // «1 1/4» اینچ
  const v = raw.replace(/\s+/g, '');
  const m = v.match(/^(\d+(?:[.,/]\d+)?)-(\d+(?:[.,/]\d+)?)$/);
  if (m && parseFloat(m[1]) >= parseFloat(m[2])) return m[2];
  return v;
}

const numericKey = (s: string) => {
  const m = s.match(/\d+(?:[./]\d+)?/);
  if (!m) return Number.POSITIVE_INFINITY;
  return m[0].includes('/') ? Number(m[0].split('/')[0]) / Number(m[0].split('/')[1] || 1) : parseFloat(m[0]);
};
const sortValues = (v: Iterable<string>) => [...v].sort((a, b) => numericKey(a) - numericKey(b) || a.localeCompare(b));

export function buildCatalog(products: CatalogProduct[], opts: { categoryName: string; total?: number; maxFamilies?: number }): Catalog {
  const maxFamilies = opts.maxFamilies ?? 25;
  const self = norm(opts.categoryName);
  const subs = new Map<string, number>();
  const fams = new Map<string, { display: string; count: number; inStock: number; sizes: Set<string>; values: Map<string, Set<string>> }>();
  for (const p of products) {
    for (const c of p.categories) {
      const n = decodeName(c).trim();
      if (n && norm(n) !== self) subs.set(n, (subs.get(n) ?? 0) + 1);
    }
    const { family, size } = splitName(p.name);
    if (!family) continue;
    const key = norm(family);
    const f = fams.get(key) ?? { display: family, count: 0, inStock: 0, sizes: new Set(), values: new Map() };
    f.count += 1;
    if (p.inStock) f.inStock += 1;
    if (size) f.sizes.add(size);
    const name = toLatinDigits(decodeName(p.name));
    for (const m of name.matchAll(UNIT_RE)) {
      const unit = canonUnit(m[2]);
      if (['میلی‌متر', 'اینچ'].includes(unit) && size) continue; // already part of the size
      const set = f.values.get(unit) ?? new Set<string>();
      set.add(unitValue(m[1]));
      f.values.set(unit, set);
    }
    fams.set(key, f);
  }
  const all = [...fams.values()].sort((a, b) => b.count - a.count);
  const shown = all.slice(0, maxFamilies);
  return {
    counted: products.length,
    total: Math.max(opts.total ?? 0, products.length),
    subcategories: [...subs.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 20),
    families: shown.map(f => ({
      family: f.display,
      count: f.count,
      inStock: f.inStock,
      sizes: sortValues(f.sizes),
      values: Object.fromEntries([...f.values.entries()].map(([u, v]) => [u, sortValues(v)])),
    })),
    otherFamilies: all.length - shown.length,
    otherProducts: all.slice(maxFamilies).reduce((n, f) => n + f.count, 0),
  };
}

const fa = (n: number) => n.toLocaleString('fa-IR');
/**
 * Short lists in full; long ones as count + smallest and largest + an even spread of real values.
 * (Showing only the first values made the writer state ranges like «10-10 تا 12-14» for a family that goes to 45-50.)
 */
export function valueList(v: string[], max: number): string {
  if (v.length <= max) return v.join('، ');
  const k = Math.max(3, max - 2);
  const spread = Array.from({ length: k }, (_, i) => v[Math.round((i * (v.length - 1)) / (k - 1))]);
  return `${fa(v.length)} مقدار، از ${v[0]} تا ${v[v.length - 1]}؛ از جمله ${[...new Set(spread)].join('، ')}`;
}
const list = valueList;

/** Plain-text fact sheet for the prompts (Persian labels, values as in product names). */
export function catalogText(c: Catalog, opts: { maxValues?: number } = {}): string {
  const maxValues = opts.maxValues ?? 14;
  const lines: string[] = [];
  lines.push(
    c.counted < c.total
      ? `شمارش از ${fa(c.counted)} محصول از ${fa(c.total)} محصول این دسته (نمونهٔ پخش در کل دسته).`
      : `شمارش از همهٔ ${fa(c.counted)} محصول این دسته.`,
  );
  if (c.subcategories.length) {
    lines.push(`زیردسته‌ها (تعداد محصول): ${c.subcategories.map(s => `${s.name} (${fa(s.count)})`).join('، ')}`);
  }
  lines.push('خانواده‌های محصول (هر خط: نام خانواده — تعداد؛ سایزها و مقدارهایی که دقیقاً در همین خانواده هست):');
  for (const f of c.families) {
    const parts = [`${f.family} — ${fa(f.count)} محصول`];
    if (f.sizes.length) parts.push(`سایز: ${list(f.sizes, maxValues)}`);
    for (const [u, v] of Object.entries(f.values)) parts.push(`${u}: ${list(v, maxValues)}`);
    lines.push(`- ${parts.join('؛ ')}`);
  }
  if (c.otherFamilies > 0) lines.push(`- و ${fa(c.otherFamilies)} خانوادهٔ کوچک‌تر دیگر با ${fa(c.otherProducts)} محصول.`);
  return lines.join('\n');
}
