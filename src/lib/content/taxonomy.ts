/**
 * Read-only access to the category taxonomy and the content profiles (data/).
 * Category names are search keywords: they are never renamed here, only explained in content.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Category {
  id: string;
  name: string;
  level: number;
  parent: string | null;
  slug: string;
  products: number;
  synonyms: string;
  flags: string;
  oldNames: string;
}

export interface L1Profile {
  id: string;
  name: string;
  audience: string;
  audience_desc: string;
  tone: string;
  humanizer: { voice: string; contentType: string };
  core_lsi: string[];
  standards: string[];
  brands_in_store: string[];
  spec_attributes: string[];
  section_rules: { include: string[]; exclude: string[] };
  cautions: string[];
  faq_themes: string[];
  notes: string;
}

export interface L2Profile {
  id: string;
  name: string;
  parent: string;
  audience: string;
  content_tier: string;
  search_intent: string;
  lsi: string[];
  headings: Array<{ h2: string; covers: string }>;
  spec_table_columns: string[];
  faq: string[];
  child_links: string[];
  boundaries: string;
  cautions: string[];
}

export type Tier = 'hub' | 'standard' | 'small' | 'skip';

interface Store {
  byId: Map<string, Category>;
  bySlug: Map<string, Category>;
  byName: Map<string, Category[]>;
  children: Map<string, Category[]>;
  l1: Map<string, L1Profile>;
  l2: Map<string, L2Profile>;
}

const DATA_DIR = process.env.CONTENT_DATA_DIR || join(process.cwd(), 'data');
let store: Store | undefined;

/** Persian-aware normalization for matching names (not for display). */
export function norm(value: string): string {
  return value
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌‏‎]/g, ' ')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function load(): Store {
  if (store) return store;
  const raw = JSON.parse(readFileSync(join(DATA_DIR, 'taxonomy.json'), 'utf8')) as {
    columns: string[];
    rows: Array<Array<string | number | null>>;
  };
  const byId = new Map<string, Category>();
  const bySlug = new Map<string, Category>();
  const byName = new Map<string, Category[]>();
  const children = new Map<string, Category[]>();
  for (const row of raw.rows) {
    const [id, name, level, parent, slug, products, synonyms, flags, oldNames] = row;
    const cat: Category = {
      id: String(id),
      name: String(name),
      level: Number(level),
      parent: parent ? String(parent) : null,
      slug: String(slug),
      products: Number(products) || 0,
      synonyms: String(synonyms ?? ''),
      flags: String(flags ?? ''),
      oldNames: String(oldNames ?? ''),
    };
    byId.set(cat.id, cat);
    if (cat.slug) bySlug.set(norm(cat.slug), cat);
    const key = norm(cat.name);
    byName.set(key, [...(byName.get(key) ?? []), cat]);
  }
  for (const cat of byId.values()) {
    if (!cat.parent) continue;
    children.set(cat.parent, [...(children.get(cat.parent) ?? []), cat]);
  }
  const l1 = new Map<string, L1Profile>();
  const l2 = new Map<string, L2Profile>();
  const dir = join(DATA_DIR, 'profiles');
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const profile = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (file.startsWith('P1_')) l1.set(String(profile.id), profile as L1Profile);
    else if (file.startsWith('P2_')) l2.set(String(profile.id), profile as L2Profile);
  }
  store = { byId, bySlug, byName, children, l1, l2 };
  return store;
}

/** Accepts a taxonomy id, a slug, a category URL or an exact category name. */
export function findCategory(ref: string): Category | undefined {
  const s = load();
  const value = ref.trim();
  if (s.byId.has(value)) return s.byId.get(value);
  let slug = value;
  try {
    const decoded = decodeURIComponent(value);
    const m = decoded.match(/product-category\/(?:.*\/)?([^/]+)\/?$/);
    slug = m ? m[1] : decoded;
  } catch {
    /* keep raw value */
  }
  const bySlug = s.bySlug.get(norm(slug));
  if (bySlug) return bySlug;
  const byName = s.byName.get(norm(value));
  return byName?.sort((a, b) => b.products - a.products)[0];
}

export function getCategory(id: string): Category | undefined {
  return load().byId.get(id);
}

export function ancestors(cat: Category): Category[] {
  const chain: Category[] = [];
  let current = cat.parent ? getCategory(cat.parent) : undefined;
  while (current) {
    chain.unshift(current);
    current = current.parent ? getCategory(current.parent) : undefined;
  }
  return chain;
}

export function childrenOf(cat: Category, withProductsOnly = true): Category[] {
  return (load().children.get(cat.id) ?? [])
    .filter(c => !withProductsOnly || c.products > 0)
    .sort((a, b) => b.products - a.products);
}

export function siblingsOf(cat: Category, withProductsOnly = true): Category[] {
  if (!cat.parent) return [];
  return childrenOf(getCategory(cat.parent)!, withProductsOnly).filter(c => c.id !== cat.id);
}

export function breadcrumb(cat: Category): string {
  return [...ancestors(cat), cat].map(c => c.name).join(' > ');
}

export function profilesFor(cat: Category): { l1: L1Profile | null; l2: L2Profile | null; l1Cat: Category; l2Cat: Category | null } {
  const chain = [...ancestors(cat), cat];
  const l1Cat = chain[0];
  const l2Cat = chain[1] ?? null;
  const s = load();
  return { l1: s.l1.get(l1Cat.id) ?? null, l2: l2Cat ? (s.l2.get(l2Cat.id) ?? null) : null, l1Cat, l2Cat };
}

/** Every brand any L1 profile knows about — used by QA to catch brands that do not belong on a page. */
export function allKnownBrands(): string[] {
  const set = new Set<string>();
  for (const p of load().l1.values()) for (const b of p.brands_in_store) set.add(b.replace(/\(.*?\)/g, '').trim());
  return [...set].filter(b => b.length >= 2);
}

/**
 * Content depth by importance. Broad pages (L1/L2) become hubs; deep pages scale with product count.
 * Kept here so the rule is easy to discuss and change in one place.
 */
export function tierFor(cat: Category, productCount: number): Tier {
  if (productCount <= 0) return 'skip';
  const hasChildren = childrenOf(cat).length > 0;
  if (cat.level <= 2) return productCount >= 20 ? 'hub' : productCount >= 5 ? 'standard' : 'small';
  if (productCount >= 100 && hasChildren) return 'hub';
  return productCount >= 5 ? 'standard' : 'small';
}

export const TIER_WORDS: Record<Tier, { min: number; max: number }> = {
  hub: { min: 900, max: 1300 },
  standard: { min: 500, max: 800 },
  small: { min: 250, max: 400 },
  skip: { min: 0, max: 0 },
};

export function searchCategories(q: string, opts: { hasProducts?: boolean; limit?: number } = {}): Category[] {
  const needle = norm(q);
  const out: Category[] = [];
  for (const cat of load().byId.values()) {
    if (opts.hasProducts && cat.products <= 0) continue;
    if (needle && !norm(cat.name).includes(needle) && !norm(cat.slug).includes(needle)) continue;
    out.push(cat);
  }
  return out.sort((a, b) => b.products - a.products).slice(0, opts.limit ?? 30);
}

export function taxonomyStats() {
  const s = load();
  let withProducts = 0;
  for (const c of s.byId.values()) if (c.products > 0) withProducts += 1;
  return { categories: s.byId.size, withProducts, l1Profiles: s.l1.size, l2Profiles: s.l2.size };
}
