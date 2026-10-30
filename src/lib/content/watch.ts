/**
 * Catalog watch: finds category pages whose product range changed since their text was written.
 *
 * Every result stores a fingerprint of the catalog it was written from (brands, families, total). Once a week the
 * watcher re-reads the products of every category that has a result (store API only, no language model) and compares.
 * A page is flagged only for changes a reader would notice: a new or vanished brand or product family, or a large
 * change in the number of products. Flagged pages wait in the panel; nothing is regenerated or published by itself.
 */
import type { Catalog } from './catalog';
import { fetchProductData } from './site';
import { kv, listResults } from './store';
import { allKnownBrands, getCategory, norm, profilesFor } from './taxonomy';

export interface CatalogFingerprint {
  total: number;
  brands: Record<string, number>;
  families: Record<string, number>;
  at: string;
}

export interface WatchChange {
  kind: 'brand-new' | 'brand-gone' | 'family-new' | 'family-gone' | 'total';
  detail: string;
}

export interface WatchEntry {
  categoryId: string;
  name: string;
  resultId: string;
  checkedAt: string;
  changes: WatchChange[];
  error?: string;
}

export function fingerprintOf(input: { total: number; brands: Array<{ brand: string; count: number }>; catalog?: Catalog }): CatalogFingerprint {
  return {
    total: input.total,
    brands: Object.fromEntries(input.brands.map(b => [b.brand, b.count])),
    families: Object.fromEntries((input.catalog?.families ?? []).map(f => [f.family, f.count])),
    at: new Date().toISOString(),
  };
}

/**
 * What changed in a way the page text would mention. Small noise is ignored: a brand or family counts only with at
 * least 3 products (or 5% of the category), and the total only when it moves by 30% and at least 10 products.
 */
export function compareFingerprints(before: CatalogFingerprint, after: CatalogFingerprint): WatchChange[] {
  const out: WatchChange[] = [];
  const total = Math.max(after.total, 1);
  const matters = (n: number) => n >= 3 || n / total >= 0.05;
  const has = (m: Record<string, number>, k: string) => Object.keys(m).some(x => norm(x) === norm(k));
  // brands and families are the top of a list (15 brands, 18–25 families): one counts as new/gone only when it is
  // big enough to have been listed on the other side too, so slipping to 16th place is not «gone»
  const famMin = (m: Record<string, number>) => Math.min(...Object.values(m), Number.POSITIVE_INFINITY);
  const full = (m: Record<string, number>) => Object.keys(m).length < 15;
  const bBefore = full(before.brands) ? 0 : famMin(before.brands);
  const bAfter = full(after.brands) ? 0 : famMin(after.brands);
  for (const [b, n] of Object.entries(after.brands)) if (!has(before.brands, b) && matters(n) && n > bBefore) out.push({ kind: 'brand-new', detail: `${b} (${n})` });
  for (const [b, n] of Object.entries(before.brands)) if (!has(after.brands, b) && matters(n) && n > bAfter) out.push({ kind: 'brand-gone', detail: `${b} (${n})` });
  const beforeMin = famMin(before.families);
  const afterMin = famMin(after.families);
  for (const [f, n] of Object.entries(after.families)) if (!has(before.families, f) && matters(n) && n > beforeMin) out.push({ kind: 'family-new', detail: `${f} (${n})` });
  for (const [f, n] of Object.entries(before.families)) if (!has(after.families, f) && matters(n) && n > afterMin) out.push({ kind: 'family-gone', detail: `${f} (${n})` });
  const diff = after.total - before.total;
  if (Math.abs(diff) >= 10 && Math.abs(diff) / Math.max(before.total, 1) >= 0.3) out.push({ kind: 'total', detail: `${before.total} → ${after.total}` });
  return out;
}

const WATCH_KEY = 'content:watch';
const WATCH_LAST = 'content:watch:last';
const g = globalThis as typeof globalThis & { __negareshWatch?: { running: boolean; done: number; total: number; startedAt?: string } };
const state = (g.__negareshWatch ??= { running: false, done: 0, total: 0 });

export function watchState() {
  return { ...state };
}

/** Latest result per category that carries a fingerprint. */
async function latestWithFingerprint(): Promise<Map<string, { resultId: string; name: string; fp: CatalogFingerprint }>> {
  const out = new Map<string, { resultId: string; name: string; fp: CatalogFingerprint }>();
  for (const r of await listResults()) {
    if (out.has(r.category.id)) continue; // listResults is newest first
    // results written before fingerprints existed: brands and total only (families are not compared)
    const fp = (r.data as { fingerprint?: CatalogFingerprint }).fingerprint
      ?? (r.data.productsRead && r.data.brands?.length
        ? { total: r.category.productCount, brands: Object.fromEntries(r.data.brands.map(b => [b.brand, b.count])), families: {}, at: r.createdAt }
        : undefined);
    if (!fp) continue;
    out.set(r.category.id, { resultId: r.resultId, name: r.category.name, fp });
  }
  return out;
}

export async function runWatch(opts: { categories?: string[]; delayMs?: number; signal?: AbortSignal } = {}): Promise<WatchEntry[]> {
  if (state.running) throw new Error('بررسی کاتالوگ همین الان در حال اجراست.');
  const latest = await latestWithFingerprint();
  const ids = opts.categories?.length ? opts.categories.filter(id => latest.has(id)) : [...latest.keys()];
  Object.assign(state, { running: true, done: 0, total: ids.length, startedAt: new Date().toISOString() });
  const entries: WatchEntry[] = [];
  const client = await kv();
  try {
    for (const id of ids) {
      opts.signal?.throwIfAborted();
      const cat = getCategory(id);
      const base = latest.get(id)!;
      const entry: WatchEntry = { categoryId: id, name: base.name, resultId: base.resultId, checkedAt: new Date().toISOString(), changes: [] };
      if (!cat) entry.error = 'دسته در تاکسونومی نیست';
      else {
        const { l1 } = profilesFor(cat);
        const known = [...new Set([...(l1?.brands_in_store ?? []), ...allKnownBrands()])];
        const data = await fetchProductData(cat.slug, known, opts.signal);
        if (data.error) entry.error = data.error;
        else entry.changes = compareFingerprints(base.fp, fingerprintOf({ total: data.total, brands: data.brands, catalog: data.catalog }));
      }
      entries.push(entry);
      if (client) await client.hSet(WATCH_KEY, id, JSON.stringify(entry)).catch(() => undefined);
      state.done += 1;
      if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs));
    }
    if (client && !opts.categories?.length) await client.set(WATCH_LAST, new Date().toISOString()).catch(() => undefined);
  } finally {
    state.running = false;
  }
  return entries;
}

/** Pages flagged by the last check (newest check per category). */
export async function watchReport(): Promise<{ lastFullRun: string | null; flagged: WatchEntry[]; checked: number; errors: number }> {
  const client = await kv();
  if (!client) return { lastFullRun: null, flagged: [], checked: 0, errors: 0 };
  const all = Object.values(await client.hGetAll(WATCH_KEY)).map(v => JSON.parse(v) as WatchEntry);
  return {
    lastFullRun: await client.get(WATCH_LAST),
    flagged: all.filter(e => e.changes.length).sort((a, b) => b.changes.length - a.changes.length),
    checked: all.length,
    errors: all.filter(e => e.error).length,
  };
}

/**
 * Weekly schedule inside the server (CONTENT_WATCH=off disables it): checks once a day whether the last full run
 * is older than 7 days and, if so, runs one slowly (a pause between categories keeps the store unburdened).
 */
export function startWatchSchedule(): void {
  if (process.env.CONTENT_WATCH === 'off' || (globalThis as { __negareshWatchTimer?: unknown }).__negareshWatchTimer) return;
  const tick = async () => {
    try {
      const client = await kv();
      if (!client || state.running) return;
      const last = await client.get(WATCH_LAST);
      if (last && Date.now() - Date.parse(last) < 7 * 24 * 3600_000) return;
      // nothing to compare until results with fingerprints exist
      if ((await latestWithFingerprint()).size === 0) return;
      await runWatch({ delayMs: 1500 });
    } catch (error) {
      console.error('[content-watch]', error);
    }
  };
  (globalThis as { __negareshWatchTimer?: unknown }).__negareshWatchTimer = setInterval(tick, 24 * 3600_000);
  setTimeout(tick, 10 * 60_000); // first look ten minutes after start, not during a deploy
}
