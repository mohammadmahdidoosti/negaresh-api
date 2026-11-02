/**
 * Runs the internal links refresh over every category with content (newest result per category), in the
 * background, two at a time. Status in Redis («relink:state»); weekly from the daily schedule.
 */
import { relinkCategory } from './publish';
import { getResult, kv, listResults } from './store';

const STATE = 'relink:state';
const LOCK = 'relink:lock';
export const RELINK_LAST = 'relink:last';
const g = globalThis as { __negareshRelink?: { running: boolean } };
const flag = (g.__negareshRelink ??= { running: false });

export async function relinkStatus() {
  const client = await kv();
  const raw = client ? await client.get(STATE) : null;
  const locked = client ? !!(await client.get(LOCK)) : false;
  return { running: flag.running || locked, ...(raw ? JSON.parse(raw) : {}) };
}

/** One run at a time across route bundles and instances (Redis lock, renewed while running). */
export async function startRelink(): Promise<boolean> {
  if (flag.running) return false;
  const client = await kv();
  if (!client || !(await client.set(LOCK, '1', { NX: true, EX: 600 }))) return false;
  flag.running = true;
  const renew = setInterval(() => void client.expire(LOCK, 600).catch(() => undefined), 120_000);
  void runRelink().finally(() => {
    clearInterval(renew);
    flag.running = false;
    void client.del(LOCK).catch(() => undefined);
  });
  return true;
}

async function runRelink() {
  const client = await kv();
  if (!client) return;
  const newest = new Map<string, { resultId: string; createdAt: string }>();
  for (const r of await listResults()) {
    const prev = newest.get(r.category.id);
    if (!prev || r.createdAt > prev.createdAt) newest.set(r.category.id, { resultId: r.resultId, createdAt: r.createdAt });
  }
  const queue = [...newest.values()].map(v => v.resultId);
  const state = { startedAt: new Date().toISOString(), total: queue.length, done: 0, updated: 0, same: 0, unpublished: 0, missing: 0, errors: 0, lastErrors: [] as string[] };
  const save = () => client.set(STATE, JSON.stringify(state)).catch(() => undefined);
  await save();
  await Promise.all(
    [0, 1].map(async () => {
      while (queue.length) {
        const id = queue.shift()!;
        try {
          const r = await getResult(id);
          if (r) state[await relinkCategory(r)] += 1;
        } catch (error) {
          state.errors += 1;
          state.lastErrors = [String(error instanceof Error ? error.message : error).slice(0, 160), ...state.lastErrors].slice(0, 5);
        }
        state.done += 1;
        if (state.done % 25 === 0) await save();
      }
    }),
  );
  await save();
  await client.set(RELINK_LAST, new Date().toISOString());
}
