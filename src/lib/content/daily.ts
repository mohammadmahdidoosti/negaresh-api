/**
 * Daily rule (2026-11): once a day, read every product category of the store, bring the taxonomy up to date (new
 * categories, product counts) and queue every category that has products but no current content — generated and
 * published by itself (text, short description, meta title and description, internal links), under a daily budget.
 * CONTENT_DAILY=off stops it; CONTENT_DAILY_MAX_USD sets the budget (default 1).
 */
import { createCampaign, listCampaigns, categoriesWithCurrentResult, plannedElsewhere, setCampaignStatus } from './campaigns';
import { RELINK_LAST, startRelink } from './relink';
import { kv } from './store';
import { applyOverlay, categoryBySlug, getCategory, searchCategories, writeOverlayFile, type TaxonomyOverlay } from './taxonomy';
import { wpGet } from './wp';

const OVERLAY_KEY = 'taxonomy:overlay';
const LAST_KEY = 'daily:last';
const REPORT_KEY = 'daily:report';
export const DAILY_LABEL = 'روزانه';

interface WpTerm {
  id: number;
  name: string;
  slug: string;
  parent: number;
  count: number;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#8211;/g, '–').replace(/&#8220;|&#8221;/g, '"').replace(/&quot;/g, '"').replace(/&#039;|&#8217;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function allTerms(): Promise<WpTerm[]> {
  const out: WpTerm[] = [];
  for (let page = 1; page <= 400; page++) {
    const r = await wpGet<WpTerm[]>(`/wp-json/wp/v2/product_cat?per_page=100&page=${page}&orderby=id&_fields=id,name,slug,parent,count`);
    if (r.status === 400 && page > 1) break; // past the last page
    if (r.status !== 200 || !Array.isArray(r.data)) throw new Error(`خواندن دسته‌های سایت ناموفق بود (صفحهٔ ${page}، ${r.status}): ${r.error ?? ''}`);
    out.push(...r.data);
    if (r.data.length < 100) break;
  }
  return out;
}

/** Store categories → overlay on the taxonomy (pure: testable without the network). */
export function buildOverlay(terms: WpTerm[], lookup: (slug: string) => { id: string; level: number } | undefined): TaxonomyOverlay {
  const byWp = new Map(terms.map(t => [t.id, t]));
  const resolved = new Map<number, { id: string; level: number }>();
  const counts: Record<string, number> = {};
  const wpIds: Record<string, number> = {};
  const added: TaxonomyOverlay['added'] = [];
  const resolve = (t: WpTerm, depth = 0): { id: string; level: number } | null => {
    if (resolved.has(t.id)) return resolved.get(t.id)!;
    if (depth > 12) return null;
    const known = lookup(decodeURIComponent(t.slug));
    if (known) {
      resolved.set(t.id, known);
      counts[known.id] = t.count;
      wpIds[known.id] = t.id;
      return known;
    }
    const parentTerm = t.parent ? byWp.get(t.parent) : undefined;
    const parent = parentTerm ? resolve(parentTerm, depth + 1) : null;
    if (t.parent && !parent) return null;
    const me = { id: `w${t.id}`, level: parent ? parent.level + 1 : 1 };
    resolved.set(t.id, me);
    added.push({ id: me.id, name: decode(t.name), level: me.level, parent: parent?.id ?? null, slug: decodeURIComponent(t.slug), products: t.count });
    return me;
  };
  for (const t of terms) resolve(t);
  return { at: new Date().toISOString(), counts, added, wpIds };
}

/** Load the last overlay at start, so new categories are known before the next sync. */
export async function loadOverlay(): Promise<void> {
  const client = await kv();
  const raw = client ? await client.get(OVERLAY_KEY).catch(() => null) : null;
  if (raw) {
    const o = JSON.parse(raw) as TaxonomyOverlay;
    writeOverlayFile(o);
    applyOverlay(o);
  }
}

export async function syncTaxonomy() {
  const terms = await allTerms();
  const overlay = buildOverlay(terms, slug => {
    const c = categoryBySlug(slug);
    return c && !c.id.startsWith('w') ? { id: c.id, level: c.level } : undefined;
  });
  // a category of the file whose slug the store no longer has (renamed or removed) has no products to write about
  for (const c of searchCategories('', { hasProducts: true, limit: 100_000 })) {
    if (!c.id.startsWith('w') && !(c.id in overlay.counts)) overlay.counts[c.id] = 0;
  }
  writeOverlayFile(overlay);
  const client = await kv();
  if (client) await client.set(OVERLAY_KEY, JSON.stringify(overlay));
  const applied = applyOverlay(overlay);
  return {
    at: overlay.at,
    storeCategories: terms.length,
    storeWithProducts: terms.filter(t => t.count > 0).length,
    added: overlay.added.length,
    addedWithProducts: overlay.added.filter(a => a.products > 0).length,
    countsChanged: applied.counts,
  };
}

/** Categories with products and no current content, not already waiting in another campaign; most products first. */
export async function missingCategories(): Promise<string[]> {
  const done = await categoriesWithCurrentResult();
  const elsewhere = await plannedElsewhere(DAILY_LABEL);
  return searchCategories('', { hasProducts: true, limit: 100_000 })
    .filter(c => !done.has(c.id) && !elsewhere.has(c.id) && getCategory(c.id))
    .map(c => c.id);
}

export async function runDaily(opts: { maxUsd?: number; label?: string } = {}) {
  const client = await kv();
  if (!client) throw new Error('Redis در دسترس نیست.');
  const sync = await syncTaxonomy();
  // yesterday's daily campaign hands over what it did not finish
  for (const c of opts.label ? [] : await listCampaigns()) {
    if (c.label.startsWith(DAILY_LABEL) && (c.status === 'running' || c.status === 'paused')) await setCampaignStatus(c.id, 'cancel');
  }
  const ids = await missingCategories();
  const maxUsd = opts.maxUsd ?? Number(process.env.CONTENT_DAILY_MAX_USD ?? 1); // 0 = no budget (stops when credit runs out)
  let campaign: { id: string; total: number } | null = null;
  if (ids.length) {
    const c = await createCampaign({
      // a catch-up run gets its own label, so the next daily run does not cancel it (and skips what it holds)
      label: opts.label ?? `${DAILY_LABEL} ${new Date().toISOString().slice(0, 10)}`,
      categories: ids,
      onlyMissing: true,
      ...(maxUsd > 0 ? { maxUsd } : {}),
      options: { autoPublish: true },
    });
    campaign = { id: c.id, total: c.total };
  }
  const report = { ...sync, missing: ids.length, campaign, maxUsd };
  await client.set(LAST_KEY, new Date().toISOString());
  await client.set(REPORT_KEY, JSON.stringify(report));
  return report;
}

export async function dailyStatus() {
  const client = await kv();
  if (!client) return null;
  const [last, report] = await Promise.all([client.get(LAST_KEY), client.get(REPORT_KEY)]);
  return { last, report: report ? JSON.parse(report) : null, enabled: process.env.CONTENT_DAILY !== 'off' };
}

export function startDailySchedule(): void {
  const g = globalThis as { __negareshDailyTimer?: unknown };
  if (g.__negareshDailyTimer) return;
  void loadOverlay().catch(error => console.error('[daily] overlay', error));
  if (process.env.CONTENT_DAILY === 'off') return;
  const tick = async () => {
    try {
      const client = await kv();
      if (!client) return;
      const last = await client.get(LAST_KEY);
      if (last && Date.now() - Date.parse(last) < 23 * 3600_000) return;
      // one instance per day
      if (!(await client.set('daily:lock', '1', { NX: true, EX: 3600 }))) return;
      // the very first run catches up with everything missing, without a budget (it pauses when credit runs out);
      // later runs use the daily budget and leave the catch-up queue alone
      // weekly: refresh internal links of published categories (new categories since they were published)
      const relinkLast = await client.get(RELINK_LAST);
      if (last && (!relinkLast || Date.now() - Date.parse(relinkLast) > 7 * 24 * 3600_000)) void startRelink();
      const r = last ? await runDaily() : await runDaily({ label: 'جبران عقب‌ماندگی', maxUsd: Number(process.env.CONTENT_CATCHUP_MAX_USD ?? 0) });
      console.log('[daily]', JSON.stringify(r));
    } catch (error) {
      console.error('[daily]', error);
    }
  };
  g.__negareshDailyTimer = setInterval(tick, 3600_000);
  setTimeout(tick, 15 * 60_000);
}
