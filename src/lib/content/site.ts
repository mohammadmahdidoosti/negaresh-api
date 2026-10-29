/**
 * Live, read-only data from the WooCommerce site. Uses only public endpoints:
 *   - /wp-json/wp/v2/product_cat?slug=…   (category id, live product count, URL)
 *   - /wp-json/wc/store/v1/products?category=…   (product names and stock)
 * Nothing is ever written to the site from here.
 */
import { buildCatalog, decodeName, type Catalog, type CatalogProduct } from './catalog';
import { norm } from './taxonomy';

/**
 * The WooCommerce store we read products from. Deliberately NOT `SITE_URL`: on the VPS that variable holds
 * Negaresh's own address (https://negaresh.caravansanat.com), and reading products from there finds nothing.
 */
export function storeBaseUrl(): string {
  return (process.env.STORE_URL?.trim() || 'https://caravansanat.com').replace(/\/$/, '');
}
const UA = 'Mozilla/5.0 (compatible; NegareshContent/1.0; +https://negaresh.caravansanat.com)';
const TTL_MS = 30 * 60_000;

export interface LiveCategory {
  wpId: number;
  name: string;
  count: number;
  link: string;
}

export interface ProductData {
  live: LiveCategory | null;
  total: number;
  names: string[]; // representative sample, de-duplicated by product family
  /** Every product name read (evidence for QA; not stored with results). */
  allNames?: string[];
  inStockRatio: number | null;
  brands: Array<{ brand: string; count: number }>;
  specs: Record<string, string[]>; // unit -> distinct observed values
  /** Counted fact sheet over (almost) every product of the category; see catalog.ts. */
  catalog?: Catalog;
  error?: string;
}

/** Pages of 100 products read per category (CONTENT_MAX_PRODUCT_PAGES, default 40 = 4,000 products). */
const maxPages = () => {
  const n = Number(process.env.CONTENT_MAX_PRODUCT_PAGES);
  return Number.isFinite(n) && n >= 2 && n <= 200 ? Math.round(n) : 40;
};
/** Parallel requests to the store while reading one category. */
const STORE_CONCURRENCY = 3;

/** Which pages to read: all of them, or an even spread over the whole category when there are more than `max`. */
export function pagesToRead(totalPages: number, max: number): number[] {
  if (totalPages <= max) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out = new Set<number>([1]);
  for (let i = 1; i < max; i++) out.add(1 + Math.round((i * (totalPages - 1)) / (max - 1)));
  return [...out].sort((a, b) => a - b);
}

const cache = new Map<string, { at: number; value: ProductData }>();

/** The store can be slow under load: 60 s per request and one retry after a short pause. */
async function getJson<T>(path: string, signal?: AbortSignal): Promise<{ data: T; headers: Headers }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(60_000);
    try {
      const res = await fetch(`${storeBaseUrl()}${path}`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (res.ok) return { data: (await res.json()) as T, headers: res.headers };
      lastError = new Error(`HTTP ${res.status} for ${path.split('?')[0]}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
    if (attempt === 1) await new Promise(r => setTimeout(r, 3000));
  }
  throw lastError;
}

export async function fetchLiveCategory(slug: string, signal?: AbortSignal): Promise<LiveCategory | null> {
  const { data } = await getJson<Array<{ id: number; name: string; count: number; link: string }>>(
    `/wp-json/wp/v2/product_cat?slug=${encodeURIComponent(slug)}&_fields=id,name,count,link`,
    signal,
  );
  const hit = data[0];
  return hit ? { wpId: hit.id, name: hit.name, count: hit.count, link: decodeURI(hit.link) } : null;
}

const toLatin = (s: string) => s.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

const UNIT_RE =
  /(\d+(?:[.,/]\d+)?(?:\s*(?:تا|-)\s*\d+(?:[.,/]\d+)?)?)\s*(کیلووار|کیلووات|کیلو وات|آمپر|ولت|وات|اسب(?:\s*بخار)?|اینچ|میلی\s?متر|میلیمتر|سانتی\s?متر|سانت|لیتری|لیتر|بار|psi|درجه|پل|فاز|کیلوگرم|کیلویی|گرم|متری|متر|دور|هرتز|kva|kw|hp|mm|v|a|w|bar)(?![\p{L}])/giu;
const SIZE_RE = /سایز\s+([0-9][0-9./\-×x*]*)/gu;
const BRAND_RE = /برند\s+([^\s(،,0-9|]+(?:\s+[^\s(،,0-9|]+){0,2})/gu;

/** Group product names by family (name without numbers/sizes) and take a spread across families. */
function representative(names: string[], limit: number): string[] {
  const families = new Map<string, string[]>();
  for (const n of names) {
    const key = norm(toLatin(n)).replace(/[0-9./×x*\-]+/g, ' ').replace(/\s+/g, ' ').trim();
    families.set(key, [...(families.get(key) ?? []), n]);
  }
  const groups = [...families.values()].sort((a, b) => b.length - a.length);
  const out: string[] = [];
  for (let round = 0; out.length < limit && round < 6; round++) {
    for (const g of groups) {
      if (g[round]) out.push(g[round]);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function extractFacts(names: string[], knownBrands: string[]) {
  const specs: Record<string, Set<string>> = {};
  const brandCounts = new Map<string, number>();
  const corpus = names.map(n => norm(n));
  for (const raw of names) {
    const name = toLatin(raw);
    for (const m of name.matchAll(UNIT_RE)) {
      const unit = m[2].replace(/\s+/g, ' ').toLowerCase();
      (specs[unit] ??= new Set()).add(m[1].replace(/\s+/g, ''));
    }
    for (const m of name.matchAll(SIZE_RE)) (specs['سایز'] ??= new Set()).add(m[1]);
    for (const m of raw.matchAll(BRAND_RE)) {
      const b = m[1].trim();
      brandCounts.set(b, (brandCounts.get(b) ?? 0) + 1);
    }
  }
  for (const b of knownBrands) {
    const nb = norm(b);
    if (!nb || [...brandCounts.keys()].some(k => norm(k).includes(nb) || nb.includes(norm(k)))) continue;
    brandCounts.set(b, 0);
  }
  // Count every candidate across all names (with or without the word «برند»).
  for (const b of [...brandCounts.keys()]) {
    const count = corpus.filter(n => n.includes(norm(b))).length;
    if (count > 0) brandCounts.set(b, count);
    else brandCounts.delete(b);
  }
  const numericSort = (a: string, b: string) => (parseFloat(a) || 0) - (parseFloat(b) || 0);
  return {
    brands: [...brandCounts.entries()].map(([brand, count]) => ({ brand, count })).sort((a, b) => b.count - a.count).slice(0, 15),
    specs: Object.fromEntries(
      Object.entries(specs)
        .filter(([, v]) => v.size > 0)
        .map(([k, v]) => [k, [...v].sort(numericSort).slice(0, 25)]),
    ),
  };
}

export async function fetchProductData(slug: string, knownBrands: string[], signal?: AbortSignal): Promise<ProductData> {
  const key = norm(slug);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: ProductData;
  try {
    const live = await fetchLiveCategory(slug, signal);
    if (!live) {
      value = { live: null, total: 0, names: [], inStockRatio: null, brands: [], specs: {}, error: 'دسته در سایت پیدا نشد' };
    } else {
      type Row = { name: string; is_in_stock: boolean; categories?: Array<{ name: string }> };
      const page = (n: number) =>
        getJson<Row[]>(`/wp-json/wc/store/v1/products?category=${live.wpId}&per_page=100&page=${n}&_fields=name,is_in_stock,categories`, signal);
      const first = await page(1);
      const total = Number(first.headers.get('x-wp-total')) || live.count;
      const totalPages = Number(first.headers.get('x-wp-totalpages')) || Math.ceil(total / 100) || 1;
      const rows: Row[] = [...first.data];
      const rest = pagesToRead(totalPages, maxPages()).filter(n => n !== 1);
      for (let i = 0; i < rest.length; i += STORE_CONCURRENCY) {
        const batch = await Promise.all(rest.slice(i, i + STORE_CONCURRENCY).map(page));
        for (const b of batch) rows.push(...b.data);
      }
      const products: CatalogProduct[] = rows.map(r => ({
        name: decodeName(r.name),
        inStock: !!r.is_in_stock,
        categories: (r.categories ?? []).map(c => decodeName(c.name)),
      }));
      const names = products.map(p => p.name);
      const inStock = products.filter(p => p.inStock).length;
      const facts = extractFacts(names, knownBrands);
      value = {
        live,
        total,
        names: representative(names, 80),
        allNames: names,
        inStockRatio: names.length ? Number((inStock / names.length).toFixed(2)) : null,
        ...facts,
        catalog: buildCatalog(products, { categoryName: live.name, total, maxFamilies: total > 600 ? 25 : 18 }),
      };
    }
  } catch (error) {
    value = {
      live: null,
      total: 0,
      names: [],
      inStockRatio: null,
      brands: [],
      specs: {},
      error: `دریافت داده از سایت ناموفق بود: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!value.error) cache.set(key, { at: Date.now(), value });
  return value;
}
