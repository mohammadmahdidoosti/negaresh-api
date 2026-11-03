/**
 * Monthly keyword review (2026-11). For categories with content, Google Suggest phrases are sorted into blog ideas
 * and category additions. Nothing reaches a page by itself: the store owner approves category phrases, and the
 * monthly update regenerates those categories with the approved phrases in the brief, then publishes them.
 * Blog phrases form the blog content plan (CSV export).
 */
import { createCampaign } from './campaigns';
import { bucketOf, gapOf, researchCategory, seedsFor, type Bucket } from './keywords';
import { getResult, kv, listResults } from './store';
import { ancestors, getCategory } from './taxonomy';

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'applied';
export interface ReviewRow {
  catId: string;
  name: string;
  path: string;
  q: string;
  bucket: Bucket;
  status: ReviewStatus;
  at: string;
}

const ROWS = 'kw:review';
const REVIEWED = (id: string) => `kw:reviewed:${id}`;
export const REVIEW_LAST = 'kw:review:last';
const STATE = 'kw:review:state';
const field = (catId: string, q: string) => `${catId}|${q}`;

const g = globalThis as { __negareshReview?: { running: boolean } };
const flag = (g.__negareshReview ??= { running: false });

export async function reviewState() {
  const c = await kv();
  const raw = c ? await c.get(STATE) : null;
  return { running: flag.running, ...(raw ? JSON.parse(raw) : {}) };
}

/** Research up to `limit` categories not reviewed in the last 30 days, most products first (background). */
export async function startReview(limit = 150): Promise<boolean> {
  const c = await kv();
  if (flag.running || !c || !(await c.set('kw:review:lock', '1', { NX: true, EX: 3 * 3600 }))) return false;
  flag.running = true;
  void runReview(limit).finally(() => {
    flag.running = false;
    void c.del('kw:review:lock').catch(() => undefined);
  });
  return true;
}

async function runReview(limit: number) {
  const c = (await kv())!;
  const newest = new Map<string, { resultId: string; createdAt: string; products: number }>();
  for (const r of await listResults()) {
    const prev = newest.get(r.category.id);
    if (!prev || r.createdAt > prev.createdAt) newest.set(r.category.id, { resultId: r.resultId, createdAt: r.createdAt, products: r.category.productCount ?? 0 });
  }
  const order = [...newest.entries()].sort((a, b) => b[1].products - a[1].products);
  const state = { startedAt: new Date().toISOString(), categories: 0, added: 0, blog: 0, category: 0, errors: 0 };
  for (const [catId, v] of order) {
    if (state.categories >= limit) break;
    if (await c.get(REVIEWED(catId))) continue;
    try {
      const r = await getResult(v.resultId);
      const cat = getCategory(catId);
      if (!r || !cat) continue;
      const synonyms = (cat.synonyms ?? '').split(/[،,|]/).map(s => s.trim()).filter(s => s && s.length < 40);
      const parent = ancestors(cat).at(-1)?.name;
      const rows = await researchCategory({ categoryId: catId, name: cat.name, seeds: seedsFor(cat.name, parent, synonyms), maxRequests: 12, delayMs: 800 });
      const page = [r.content.metaTitle, r.content.metaDescription, r.content.above, r.content.below].join('\n');
      const data = [r.data.catalog ?? '', r.data.brands.map(b => b.brand).join(' '), Object.values(r.data.specs ?? {}).flat().join(' ')].join('\n');
      for (const row of gapOf(rows, cat.name, page, data, r.category.path)) {
        const bucket = bucketOf(row);
        if (bucket !== 'blog' && bucket !== 'category') continue;
        const f = field(catId, row.q);
        if (await c.hExists(ROWS, f)) continue;
        const rec: ReviewRow = { catId, name: cat.name, path: r.category.path, q: row.q, bucket, status: 'pending', at: new Date().toISOString() };
        await c.hSet(ROWS, f, JSON.stringify(rec));
        state.added += 1;
        state[bucket] += 1;
      }
      await c.set(REVIEWED(catId), '1', { EX: 30 * 24 * 3600 });
      state.categories += 1;
    } catch {
      state.errors += 1;
    }
    if (state.categories % 10 === 0) await c.set(STATE, JSON.stringify(state));
  }
  await c.set(STATE, JSON.stringify({ ...state, finishedAt: new Date().toISOString() }));
  await c.set(REVIEW_LAST, new Date().toISOString());
}

export async function reviewRows(filter: { status?: string; bucket?: string } = {}): Promise<ReviewRow[]> {
  const c = await kv();
  if (!c) return [];
  const all = Object.values(await c.hGetAll(ROWS)).map(v => JSON.parse(v) as ReviewRow);
  return all
    .filter(r => (!filter.status || r.status === filter.status) && (!filter.bucket || r.bucket === filter.bucket))
    .sort((a, b) => a.path.localeCompare(b.path, 'fa') || a.q.localeCompare(b.q, 'fa'));
}

/** The owner's decisions: approve/reject, or move a phrase between blog and category. */
export async function decide(items: Array<{ catId: string; q: string; status?: ReviewStatus; bucket?: Bucket }>) {
  const c = await kv();
  if (!c) throw new Error('Redis در دسترس نیست.');
  let n = 0;
  for (const it of items) {
    const f = field(it.catId, it.q);
    const raw = await c.hGet(ROWS, f);
    if (!raw) continue;
    const row = JSON.parse(raw) as ReviewRow;
    if (it.status && ['pending', 'approved', 'rejected'].includes(it.status)) row.status = it.status;
    if (it.bucket === 'blog' || it.bucket === 'category') row.bucket = it.bucket;
    await c.hSet(ROWS, f, JSON.stringify(row));
    n += 1;
  }
  return n;
}

/** Monthly update: approved category phrases go into the brief of their category, which is regenerated and published. */
export async function applyApproved(): Promise<{ categories: number; phrases: number; campaign: string | null }> {
  const c = await kv();
  if (!c) throw new Error('Redis در دسترس نیست.');
  const rows = (await reviewRows({ status: 'approved', bucket: 'category' }));
  const byCat = new Map<string, ReviewRow[]>();
  for (const r of rows) byCat.set(r.catId, [...(byCat.get(r.catId) ?? []), r]);
  if (!byCat.size) return { categories: 0, phrases: 0, campaign: null };
  for (const [catId, list] of byCat) {
    const prev = await c.get(`kw:approved:${catId}`);
    const merged = [...new Set([...(prev ? (JSON.parse(prev) as string[]) : []), ...list.map(r => r.q)])].slice(-15);
    await c.set(`kw:approved:${catId}`, JSON.stringify(merged));
  }
  const camp = await createCampaign({
    label: `به‌روزرسانی ماهانهٔ کلمات ${new Date().toISOString().slice(0, 10)}`,
    categories: [...byCat.keys()],
    onlyMissing: false,
    options: { autoPublish: true },
  });
  for (const r of rows) await c.hSet(ROWS, field(r.catId, r.q), JSON.stringify({ ...r, status: 'applied' }));
  return { categories: byCat.size, phrases: rows.length, campaign: camp.id };
}

export function toCsv(rows: ReviewRow[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return ['﻿مسیر دسته,دسته,عبارت جست‌وجو,پیشنهاد,وضعیت', ...rows.map(r => [r.path, r.name, r.q, r.bucket === 'blog' ? 'بلاگ' : 'دسته', r.status].map(esc).join(','))].join('\n');
}
