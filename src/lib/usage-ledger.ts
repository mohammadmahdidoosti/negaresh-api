/** Server-only accounting. No prompts, article text, keys, or public API are stored here. */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface UsageMetadata {
  generationId?: string;
  model?: string;
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  cost?: number;
  finishReason?: string | null;
}

export class BudgetError extends Error {}

function database() {
  const path = resolve(process.env.LLM_USAGE_DB || '.local/usage.sqlite');
  const publicRelative = relative(resolve('public'), path);
  if (publicRelative !== '..' && !publicRelative.startsWith(`..${sep}`) && !isAbsolute(publicRelative)) {
    throw new Error('LLM_USAGE_DB must be outside public/');
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, stage TEXT NOT NULL, attempt INTEGER NOT NULL,
      requested_model TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT,
      state TEXT NOT NULL, reserved_usd REAL NOT NULL, cost_usd REAL,
      generation_id TEXT, actual_model TEXT, provider TEXT, prompt_tokens INTEGER,
      completion_tokens INTEGER, reasoning_tokens INTEGER, finish_reason TEXT,
      http_status INTEGER, duration_ms INTEGER
    );`);
  return db;
}

export function reserveAttempt(runId: string, stage: string, attempt: number, model: string, reserve: number) {
  if (!Number.isFinite(reserve) || reserve < 0) throw new BudgetError('Invalid usage reservation');
  const db = database();
  try {
    db.exec('BEGIN IMMEDIATE');
    const configured = process.env.LLM_BUDGET_USD?.trim();
    const limit = configured ? Number(configured) : null;
    if (limit !== null && (!Number.isFinite(limit) || limit < 0)) throw new BudgetError('Invalid LLM_BUDGET_USD');
    const row = db.prepare('SELECT COALESCE(SUM(COALESCE(cost_usd, reserved_usd)),0) AS committed FROM attempts').get() as { committed: number };
    if (limit !== null && row.committed + reserve > limit) {
      throw new BudgetError('بودجه داخلی درخواست‌ها کافی نیست؛ ثبت هزینه‌ها را در سرور بررسی کنید.');
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO attempts (id,run_id,stage,attempt,requested_model,started_at,state,reserved_usd)
      VALUES (?,?,?,?,?,?,'pending',?)`).run(id, runId, stage, attempt, model, new Date().toISOString(), reserve);
    db.exec('COMMIT');
    return id;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally { db.close(); }
}

export function recordMetadata(id: string, metadata: UsageMetadata) {
  const db = database();
  try {
    db.prepare(`UPDATE attempts SET generation_id=COALESCE(?,generation_id), actual_model=COALESCE(?,actual_model),
      provider=COALESCE(?,provider), prompt_tokens=COALESCE(?,prompt_tokens), completion_tokens=COALESCE(?,completion_tokens),
      reasoning_tokens=COALESCE(?,reasoning_tokens), cost_usd=COALESCE(?,cost_usd), finish_reason=COALESCE(?,finish_reason) WHERE id=?`)
      .run(metadata.generationId ?? null, metadata.model ?? null, metadata.provider ?? null, metadata.promptTokens ?? null,
        metadata.completionTokens ?? null, metadata.reasoningTokens ?? null, metadata.cost ?? null, metadata.finishReason ?? null, id);
  } finally { db.close(); }
}

export function finishAttempt(id: string, outcome: string, duration: number, status?: number) {
  const db = database();
  try {
    // HTTP rejections without a generation are unbilled. Interrupted generations retain their reservation.
    db.prepare(`UPDATE attempts SET state=?,ended_at=?,duration_ms=?,http_status=?,
      cost_usd=CASE WHEN ? IN (400,401,402,403,404,413,422,429) AND generation_id IS NULL THEN COALESCE(cost_usd,0) ELSE cost_usd END WHERE id=?`)
      .run(outcome, new Date().toISOString(), duration, status ?? null, status ?? null, id);
  } finally { db.close(); }
}

export function usageSummary(runId?: string) {
  const db = database();
  try {
    return db.prepare(`SELECT COUNT(*) AS attempts, COALESCE(SUM(cost_usd),0) AS knownCostUsd,
      COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN reserved_usd ELSE 0 END),0) AS unsettledReserveUsd,
      COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END),0) AS unsettledAttempts,
      COALESCE(SUM(prompt_tokens),0) AS promptTokens, COALESCE(SUM(completion_tokens),0) AS completionTokens,
      COALESCE(SUM(reasoning_tokens),0) AS reasoningTokens FROM attempts ${runId ? 'WHERE run_id=?' : ''}`)
      .get(...(runId ? [runId] : []));
  } finally { db.close(); }
}

/** Cost per stage and model for one run (content pipeline reporting). */
export function usageByStage(runId: string) {
  const db = database();
  try {
    return db.prepare(`SELECT stage, COALESCE(actual_model, requested_model) AS model, COUNT(*) AS calls,
      COALESCE(SUM(cost_usd),0) AS usd, COALESCE(SUM(prompt_tokens),0) AS promptTokens,
      COALESCE(SUM(completion_tokens),0) AS completionTokens FROM attempts WHERE run_id=? GROUP BY stage, model ORDER BY usd DESC`)
      .all(runId) as Array<{ stage: string; model: string; calls: number; usd: number; promptTokens: number; completionTokens: number }>;
  } finally { db.close(); }
}

export function unsettledGenerations() {
  const db = database();
  try { return db.prepare('SELECT id,generation_id FROM attempts WHERE cost_usd IS NULL AND generation_id IS NOT NULL').all() as Array<{ id: string; generation_id: string }>; }
  finally { db.close(); }
}
