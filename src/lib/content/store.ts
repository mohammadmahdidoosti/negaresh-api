/**
 * Store of generated category content.
 * - Always keeps an in-memory cache (latest 10 results per category).
 * - When REDIS_URL / KV_URL is set (Render Key Value), every result is also written there, so results
 *   survive restarts and sleep of the free web service.
 */
import { createClient } from 'redis';
import type { ContentResult } from './pipeline';

const KEEP_PER_CATEGORY = 10;
const catKey = (categoryId: string) => `content:cat:${categoryId}`;
type Client = ReturnType<typeof createClient>;

const g = globalThis as typeof globalThis & {
  __negareshContent?: Map<string, ContentResult[]>;
  __negareshKv?: Promise<Client | null>;
  __negareshKvLoaded?: boolean;
};
const results: Map<string, ContentResult[]> = (g.__negareshContent ??= new Map());

function kv(): Promise<Client | null> {
  const url = process.env.REDIS_URL?.trim() || process.env.KV_URL?.trim();
  if (!url) return Promise.resolve(null);
  g.__negareshKv ??= (async () => {
    try {
      const client = createClient({ url, socket: { connectTimeout: 5000, reconnectStrategy: n => Math.min(n * 500, 5000) } });
      client.on('error', err => console.error('[content-store] kv error:', err.message));
      await client.connect();
      return client;
    } catch (error) {
      console.error('[content-store] kv unavailable:', error);
      g.__negareshKv = undefined;
      return null;
    }
  })();
  return g.__negareshKv;
}

function remember(result: ContentResult) {
  const list = (results.get(result.category.id) ?? []).filter(r => r.resultId !== result.resultId);
  list.unshift(result);
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  results.set(result.category.id, list.slice(0, KEEP_PER_CATEGORY));
}

/** Load everything from KV into memory once per process. */
async function ensureLoaded(): Promise<void> {
  if (g.__negareshKvLoaded) return;
  const client = await kv();
  if (!client) return;
  try {
    const ids = await client.zRange('content:results', 0, -1);
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100).map(id => `content:result:${id}`);
      const values = batch.length ? await client.mGet(batch) : [];
      for (const v of values) {
        if (!v) continue;
        const r = JSON.parse(v) as ContentResult;
        remember(r);
        await client.zAdd(catKey(r.category.id), { score: Date.parse(r.createdAt), value: r.resultId });
      }
    }
    g.__negareshKvLoaded = true;
  } catch (error) {
    console.error('[content-store] load failed:', error);
  }
}

export async function saveResult(result: ContentResult): Promise<void> {
  // Load first: trimming must see the results already stored, not just this process's memory
  // (a fresh process after a deploy would otherwise delete every older result of the category).
  await ensureLoaded();
  remember(result);
  const client = await kv();
  if (!client) return;
  try {
    const score = Date.parse(result.createdAt);
    await client
      .multi()
      .set(`content:result:${result.resultId}`, JSON.stringify(result))
      .zAdd('content:results', { score, value: result.resultId })
      .zAdd(catKey(result.category.id), { score, value: result.resultId })
      .exec();
    // keep the newest KEEP_PER_CATEGORY of this category (per-category index, no full scan)
    const drop = await client.zRange(catKey(result.category.id), 0, -(KEEP_PER_CATEGORY + 1));
    if (drop.length) {
      await client
        .multi()
        .del(drop.map(id => `content:result:${id}`))
        .zRem('content:results', drop)
        .zRem(catKey(result.category.id), drop)
        .exec();
    }
  } catch (error) {
    console.error('[content-store] save failed:', error);
  }
}

export async function listResults(): Promise<ContentResult[]> {
  await ensureLoaded();
  return [...results.values()].flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getResult(resultId: string): Promise<ContentResult | undefined> {
  await ensureLoaded();
  for (const list of results.values()) {
    const hit = list.find(r => r.resultId === resultId);
    if (hit) return hit;
  }
  const client = await kv();
  const raw = client ? await client.get(`content:result:${resultId}`).catch(() => null) : null;
  return raw ? (JSON.parse(raw) as ContentResult) : undefined;
}

/** Re-import previously exported results (e.g. after a restart without KV). */
export async function importResults(items: ContentResult[]): Promise<number> {
  await ensureLoaded();
  let n = 0;
  for (const r of items) {
    if (!r?.resultId || !r.category?.id || (await getResult(r.resultId))) continue;
    await saveResult(r);
    n += 1;
  }
  return n;
}

export async function storeInfo() {
  const client = await kv();
  return { persistent: !!client };
}
