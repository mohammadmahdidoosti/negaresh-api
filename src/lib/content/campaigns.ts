/**
 * Bulk generation ("campaigns"): a persistent queue of categories in Redis, worked through by this
 * server process with the shared pipeline slots. Survives restarts and redeploys: a category whose worker
 * stopped sending heartbeats (process killed) goes back to the front of the queue. Heartbeats, not "process
 * start", decide this, because a rolling update runs the old and the new container side by side for a while.
 *
 * Keys (per campaign id):
 *   content:campaigns              zset of campaign ids by creation time
 *   content:campaign:<id>          JSON {id,label,createdAt,status,options,total,maxUsd,...}
 *   content:campaign:<id>:queue    list of category ids still to do (left = next)
 *   content:campaign:<id>:inflight hash category id -> {instance, at}: being generated now, with a heartbeat
 *   content:campaign:<id>:stats    hash done/failed/skipped/microUsd
 *   content:campaign:<id>:log      list of recent outcomes (newest first, capped)
 */
import { randomUUID } from 'node:crypto';

/** This process. Inflight entries carry it, so another container never steals live work. */
const INSTANCE = randomUUID();
const HEARTBEAT_MS = 30_000;
/** No heartbeat for this long = the worker is gone (a category takes ~1–3 minutes). */
const STALE_MS = 3 * 60_000;
import { acquireSlot, PipelineError } from '@/lib/api/runner';
import { runCategoryContent, type ContentRequest } from './pipeline';
import { PROMPT_VERSION } from './prompts';
import { kv, listResults } from './store';
import { findCategory, searchCategories } from './taxonomy';
import type { QualityLevel } from '@/lib/types';

export type CampaignStatus = 'running' | 'paused' | 'done' | 'canceled';

export interface CampaignOptions {
  draftModel?: string;
  briefModel?: string;
  humanizerWriter?: string;
  humanize?: boolean;
  humanizerQuality?: QualityLevel;
  naturalDraft?: boolean;
}

export interface Campaign {
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  status: CampaignStatus;
  /** Why it stopped (budget reached, canceled, …). */
  note?: string;
  options: CampaignOptions;
  total: number;
  maxUsd?: number;
  promptVersion: string;
}

export interface CampaignView extends Campaign {
  queued: number;
  inflight: string[];
  done: number;
  failed: number;
  skipped: number;
  spentUsd: number;
}

export interface CampaignLogEntry {
  at: string;
  categoryId: string;
  name: string;
  outcome: 'done' | 'failed' | 'skipped';
  resultId?: string;
  qa?: string;
  usd?: number | null;
  error?: string;
}

const K = {
  index: 'content:campaigns',
  meta: (id: string) => `content:campaign:${id}`,
  queue: (id: string) => `content:campaign:${id}:queue`,
  inflight: (id: string) => `content:campaign:${id}:inflight`,
  stats: (id: string) => `content:campaign:${id}:stats`,
  log: (id: string) => `content:campaign:${id}:log`,
};
const LOG_KEEP = 300;

/** Campaign jobs use at most this many of the shared pipeline slots, leaving room for the panel. */
const concurrency = () => {
  const n = Number(process.env.CONTENT_CAMPAIGN_CONCURRENCY ?? 2);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 2;
};

export class CampaignError extends Error {
  constructor(message: string, public status = 400, public code = 'campaign_error') {
    super(message);
  }
}

async function client() {
  const c = await kv();
  if (!c) throw new CampaignError('برای تولید انبوه، ذخیره‌ساز Redis (REDIS_URL) لازم است.', 503, 'store_unavailable');
  return c;
}

type Kv = NonNullable<Awaited<ReturnType<typeof kv>>>;
/** Inflight ids, also from the first version's plain set (until recover() migrates it). */
async function inflightIds(r: Kv, id: string): Promise<string[]> {
  return (await r.type(K.inflight(id))) === 'set' ? r.sMembers(K.inflight(id)) : r.hKeys(K.inflight(id));
}

async function readMeta(id: string): Promise<Campaign | null> {
  const raw = await (await client()).get(K.meta(id));
  return raw ? (JSON.parse(raw) as Campaign) : null;
}

async function writeMeta(c: Campaign): Promise<void> {
  c.updatedAt = new Date().toISOString();
  await (await client()).set(K.meta(c.id), JSON.stringify(c));
}

export async function getCampaign(id: string): Promise<CampaignView | null> {
  const c = await readMeta(id);
  if (!c) return null;
  const r = await client();
  const [queued, inflight, stats] = await Promise.all([r.lLen(K.queue(id)), inflightIds(r, id), r.hGetAll(K.stats(id))]);
  return {
    ...c,
    queued,
    inflight,
    done: Number(stats.done ?? 0),
    failed: Number(stats.failed ?? 0),
    skipped: Number(stats.skipped ?? 0),
    spentUsd: Number(stats.microUsd ?? 0) / 1e6,
  };
}

export async function listCampaigns(): Promise<CampaignView[]> {
  const ids = await (await client()).zRange(K.index, 0, -1, { REV: true });
  const out: CampaignView[] = [];
  for (const id of ids) {
    const v = await getCampaign(id);
    if (v) out.push(v);
  }
  return out;
}

export async function campaignLog(id: string, limit = 100): Promise<CampaignLogEntry[]> {
  const rows = await (await client()).lRange(K.log(id), 0, Math.max(0, limit - 1));
  return rows.map(r => JSON.parse(r) as CampaignLogEntry);
}

/** Categories with products, most products first (the most important pages first). */
export function plannedCategories(opts: { categories?: string[]; limit?: number; skip?: Set<string> }): string[] {
  const ids = opts.categories?.length
    ? opts.categories.map(ref => findCategory(ref)?.id).filter((x): x is string => !!x)
    : searchCategories('', { hasProducts: true, limit: 100_000 })
        .sort((a, b) => b.products - a.products)
        .map(c => c.id);
  const unique = [...new Set(ids)].filter(id => !opts.skip?.has(id));
  return opts.limit && opts.limit > 0 ? unique.slice(0, opts.limit) : unique;
}

/** Category ids that already have a result of the current prompt version made with live product data. */
export async function categoriesWithCurrentResult(): Promise<Set<string>> {
  const done = new Set<string>();
  for (const r of await listResults()) {
    const siteOk = r.qa?.checks?.find(c => c.id === 'site-data')?.level === 'pass';
    if (r.promptVersion === PROMPT_VERSION && siteOk) done.add(r.category.id);
  }
  return done;
}

export async function createCampaign(input: {
  label: string;
  categories?: string[];
  limit?: number;
  onlyMissing?: boolean;
  maxUsd?: number;
  options?: CampaignOptions;
}): Promise<CampaignView> {
  const skip = input.onlyMissing === false ? undefined : await categoriesWithCurrentResult();
  const ids = plannedCategories({ categories: input.categories, limit: input.limit, skip });
  if (!ids.length) throw new CampaignError('دسته‌ای برای تولید نماند (همه نتیجهٔ نسخهٔ فعلی را دارند یا فهرست خالی است).', 400, 'nothing_to_do');
  const now = new Date().toISOString();
  const c: Campaign = {
    id: randomUUID(),
    label: input.label.slice(0, 80) || `تولید انبوه ${now.slice(0, 10)}`,
    createdAt: now,
    updatedAt: now,
    status: 'running',
    options: input.options ?? {},
    total: ids.length,
    ...(input.maxUsd && input.maxUsd > 0 ? { maxUsd: input.maxUsd } : {}),
    promptVersion: PROMPT_VERSION,
  };
  const r = await client();
  await r.multi()
    .set(K.meta(c.id), JSON.stringify(c))
    .zAdd(K.index, { score: Date.parse(now), value: c.id })
    .rPush(K.queue(c.id), ids)
    .exec();
  startCampaignWorker();
  return (await getCampaign(c.id))!;
}

export async function setCampaignStatus(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<CampaignView> {
  const c = await readMeta(id);
  if (!c) throw new CampaignError('این تولید انبوه پیدا نشد.', 404, 'not_found');
  if (c.status === 'done' || c.status === 'canceled') throw new CampaignError('این تولید انبوه تمام شده است.', 409, 'finished');
  if (action === 'pause') c.status = 'paused';
  if (action === 'resume') {
    c.status = 'running';
    delete c.note;
  }
  if (action === 'cancel') {
    c.status = 'canceled';
    c.note = 'لغو شد';
    await (await client()).del(K.queue(id));
  }
  await writeMeta(c);
  if (c.status === 'running') startCampaignWorker();
  return (await getCampaign(id))!;
}

// ---------------------------------------------------------------- worker

type Runner = (req: ContentRequest) => Promise<{ resultId: string; qa: { level: string }; cost: { usd: number | null } }>;
let runner: Runner = runCategoryContent;
/** Tests only: replace the pipeline. */
export function setCampaignRunnerForTests(fn: Runner | null): void {
  runner = fn ?? runCategoryContent;
}

interface WorkerState {
  started: boolean;
  active: number;
  ticking: boolean;
  again?: boolean;
  /** "campaignId|categoryId" being generated by this process */
  mine: Set<string>;
}
const g = globalThis as typeof globalThis & { __negareshCampaignWorker?: WorkerState };
const worker: WorkerState = (g.__negareshCampaignWorker ??= { started: false, active: 0, ticking: false, mine: new Set() });

/** Categories whose worker stopped sending heartbeats go back to the front of their queue. */
async function recover(): Promise<void> {
  const r = await kv();
  if (!r) return;
  const now = Date.now();
  for (const id of await r.zRange(K.index, 0, -1)) {
    if ((await r.type(K.inflight(id))) === 'set') {
      // first version kept a plain set: hand those back to the queue once
      const old = await r.sMembers(K.inflight(id));
      await r.multi().del(K.inflight(id)).lPush(K.queue(id), old.length ? old : ['']).exec();
      if (!old.length) await r.lRem(K.queue(id), 1, '');
      continue;
    }
    const entries = await r.hGetAll(K.inflight(id));
    const stale = Object.entries(entries)
      .filter(([, v]) => {
        try {
          const e = JSON.parse(v) as { instance: string; at: number };
          return e.instance !== INSTANCE && now - e.at > STALE_MS;
        } catch {
          return true; // unreadable entry (older format): treat as abandoned
        }
      })
      .map(([catId]) => catId);
    if (stale.length) {
      await r.multi().lPush(K.queue(id), stale).hDel(K.inflight(id), stale).exec();
      console.log(`[campaigns] ${id}: ${stale.length} abandoned categories re-queued`);
    }
  }
}

/** Keep this process's inflight entries fresh. */
async function heartbeat(): Promise<void> {
  const r = await kv();
  if (!r || worker.mine.size === 0) return;
  const at = Date.now();
  for (const key of worker.mine) {
    const [id, catId] = key.split('|');
    await r.hSet(K.inflight(id), catId, JSON.stringify({ instance: INSTANCE, at }));
  }
}

/** Oldest running campaign that still has queued categories. */
async function nextCampaign(): Promise<Campaign | null> {
  const r = await kv();
  if (!r) return null;
  for (const id of await r.zRange(K.index, 0, -1)) {
    const c = await readMeta(id);
    if (c?.status !== 'running') continue;
    if ((await r.lLen(K.queue(id))) > 0) return c;
    await finishIfEmpty(c);
  }
  return null;
}

async function finishIfEmpty(c: Campaign): Promise<void> {
  const r = await client();
  if ((await r.lLen(K.queue(c.id))) === 0 && (await inflightIds(r, c.id)).length === 0) {
    const fresh = await readMeta(c.id);
    if (fresh?.status === 'running') {
      fresh.status = 'done';
      fresh.note = 'همهٔ دسته‌ها انجام شد';
      await writeMeta(fresh);
    }
  }
}

async function tick(): Promise<void> {
  if (worker.ticking) {
    // a tick is running and may already have looked at the queues: make it look again
    worker.again = true;
    return;
  }
  worker.ticking = true;
  worker.again = false;
  try {
    await recover();
    while (worker.active < concurrency()) {
      const c = await nextCampaign();
      if (!c) break;
      const r = await client();
      const categoryId = await r.lPop(K.queue(c.id));
      if (!categoryId) continue;
      await r.hSet(K.inflight(c.id), categoryId, JSON.stringify({ instance: INSTANCE, at: Date.now() }));
      worker.mine.add(`${c.id}|${categoryId}`);
      worker.active += 1;
      void runOne(c, categoryId).finally(() => {
        worker.active -= 1;
        void tick();
      });
    }
  } catch (error) {
    console.error('[campaigns] tick failed:', error);
  } finally {
    worker.ticking = false;
    if (worker.again) void tick();
  }
}

async function runOne(c: Campaign, categoryId: string): Promise<void> {
  const r = await client();
  const name = findCategory(categoryId)?.name ?? categoryId;
  const entry: CampaignLogEntry = { at: '', categoryId, name, outcome: 'done' };
  let release: (() => void) | undefined;
  try {
    release = await acquireSlot();
    const req: ContentRequest = {
      category: categoryId,
      label: c.label,
      ...(c.options.draftModel ? { draftModel: c.options.draftModel } : {}),
      ...(c.options.briefModel ? { briefModel: c.options.briefModel } : {}),
      ...(c.options.humanizerWriter ? { humanizerWriter: c.options.humanizerWriter } : {}),
      ...(c.options.humanizerQuality ? { humanizerQuality: c.options.humanizerQuality } : {}),
      ...(typeof c.options.naturalDraft === 'boolean' ? { naturalDraft: c.options.naturalDraft } : {}),
      humanize: c.options.humanize !== false,
    };
    const result = await runner(req);
    entry.resultId = result.resultId;
    entry.qa = result.qa.level;
    entry.usd = result.cost.usd;
    await r.hIncrBy(K.stats(c.id), 'done', 1);
    if (result.cost.usd) await r.hIncrBy(K.stats(c.id), 'microUsd', Math.round(result.cost.usd * 1e6));
  } catch (error) {
    const noProducts = error instanceof PipelineError && error.code === 'no_products';
    entry.outcome = noProducts ? 'skipped' : 'failed';
    entry.error = error instanceof Error ? error.message.slice(0, 300) : String(error);
    await r.hIncrBy(K.stats(c.id), noProducts ? 'skipped' : 'failed', 1);
    if (!noProducts) console.error(`[campaigns] ${c.id} ${categoryId} failed:`, error);
  } finally {
    release?.();
    entry.at = new Date().toISOString();
    worker.mine.delete(`${c.id}|${categoryId}`);
    await r.multi().hDel(K.inflight(c.id), categoryId).lPush(K.log(c.id), JSON.stringify(entry)).lTrim(K.log(c.id), 0, LOG_KEEP - 1).exec();
    await afterOne(c.id);
  }
}

/** Budget check and completion after each category. */
async function afterOne(id: string): Promise<void> {
  const c = await readMeta(id);
  if (!c || c.status !== 'running') return;
  const stats = await (await client()).hGetAll(K.stats(id));
  const spent = Number(stats.microUsd ?? 0) / 1e6;
  if (c.maxUsd && spent >= c.maxUsd) {
    c.status = 'paused';
    c.note = `سقف هزینه (${c.maxUsd} دلار) رسید؛ برای ادامه سقف را بالا ببرید یا ادامه بدهید.`;
    await writeMeta(c);
    return;
  }
  await finishIfEmpty(c);
}

/** Start (or nudge) the background worker. Safe to call often. */
export function startCampaignWorker(): void {
  if (!worker.started) {
    worker.started = true;
    // keep looking for work: a resume, a new campaign or a free slot
    setInterval(() => void tick(), 15_000).unref?.();
    setInterval(() => void heartbeat(), HEARTBEAT_MS).unref?.();
  }
  void tick();
}

/** For /api/v1/health: is bulk work running right now? */
export function campaignActivity() {
  return { active: worker.active };
}

/** Raise the budget of a paused/running campaign. */
export async function setCampaignBudget(id: string, maxUsd: number | null): Promise<CampaignView> {
  const c = await readMeta(id);
  if (!c) throw new CampaignError('این تولید انبوه پیدا نشد.', 404, 'not_found');
  if (maxUsd && maxUsd > 0) c.maxUsd = maxUsd;
  else delete c.maxUsd;
  await writeMeta(c);
  return (await getCampaign(id))!;
}
