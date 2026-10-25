/**
 * In-memory job store for the two-step API (submit → poll).
 * Jobs live in this server process only: they are lost on restart and are not shared between
 * multiple instances. Run a single instance, or put a shared store in front for scale-out.
 */
import { randomUUID } from 'node:crypto';
import type { HumanizeRequest } from '@/lib/types';
import { acquireSlot, PipelineError, runHumanize, type StepEvent } from './runner';

export type TaskRunner = (ctx: { signal: AbortSignal; onStep: (step: StepEvent) => void }) => Promise<unknown>;

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

interface Job {
  id: string;
  kind: string;
  meta?: Record<string, unknown>;
  status: JobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  steps: StepEvent[];
  result?: unknown;
  error?: { code: string; message: string; status: number };
  controller: AbortController;
}

const globalStore = globalThis as typeof globalThis & { __negareshJobs?: Map<string, Job> };
const jobs: Map<string, Job> = (globalStore.__negareshJobs ??= new Map());

function ttlMs(): number {
  const minutes = Number(process.env.API_JOB_TTL_MINUTES ?? 60);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60_000;
}

function maxPending(): number {
  const value = Number(process.env.API_MAX_PENDING_JOBS ?? 50);
  return Number.isInteger(value) && value > 0 ? value : 50;
}

function sweep(): void {
  const cutoff = Date.now() - ttlMs();
  for (const [id, job] of jobs) {
    if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
  }
}

export function pendingCount(): number {
  let count = 0;
  for (const job of jobs.values()) if (job.status === 'queued' || job.status === 'running') count += 1;
  return count;
}

export class QueueFullError extends Error {}

export function createTask(kind: string, run: TaskRunner, meta?: Record<string, unknown>): Job {
  sweep();
  if (pendingCount() >= maxPending()) throw new QueueFullError('صف پردازش پر است؛ کمی بعد دوباره تلاش کنید.');
  const job: Job = {
    id: randomUUID(),
    kind,
    meta,
    status: 'queued',
    createdAt: Date.now(),
    steps: [],
    controller: new AbortController(),
  };
  jobs.set(job.id, job);
  void execute(job, run);
  return job;
}

export function createJob(payload: HumanizeRequest): Job {
  return createTask('humanize', ({ signal, onStep }) => runHumanize(payload, { signal, onStep }));
}

async function execute(job: Job, run: TaskRunner): Promise<void> {
  let release: (() => void) | undefined;
  try {
    release = await acquireSlot(job.controller.signal);
    job.status = 'running';
    job.startedAt = Date.now();
    job.result = await run({
      signal: job.controller.signal,
      onStep: step => {
        job.steps.push(step);
        if (job.steps.length > 50) job.steps.shift();
      },
    });
    job.status = 'succeeded';
  } catch (error) {
    if (job.controller.signal.aborted) {
      job.status = 'canceled';
    } else {
      job.status = 'failed';
      job.error =
        error instanceof PipelineError
          ? { code: error.code, message: error.message, status: error.status }
          : { code: 'internal_error', message: 'پردازش با خطای غیرمنتظره متوقف شد.', status: 500 };
      if (!(error instanceof PipelineError)) console.error(`[jobs] ${job.kind} failed:`, error);
    }
  } finally {
    release?.();
    job.finishedAt = Date.now();
  }
}

export function listJobs(kind?: string) {
  sweep();
  return [...jobs.values()].filter(j => !kind || j.kind === kind).sort((a, b) => b.createdAt - a.createdAt);
}

export function getJob(id: string): Job | undefined {
  sweep();
  return jobs.get(id);
}

export function cancelJob(id: string): Job | undefined {
  const job = jobs.get(id);
  if (job && (job.status === 'queued' || job.status === 'running')) {
    job.controller.abort(new DOMException('Canceled by API client', 'AbortError'));
  }
  return job;
}

/** Public JSON view of a job. */
export function serializeJob(job: Job, baseUrl?: string) {
  return {
    ok: true,
    id: job.id,
    kind: job.kind,
    ...(job.meta && { meta: job.meta }),
    status: job.status,
    createdAt: new Date(job.createdAt).toISOString(),
    ...(job.startedAt && { startedAt: new Date(job.startedAt).toISOString() }),
    ...(job.finishedAt && { finishedAt: new Date(job.finishedAt).toISOString() }),
    ...(job.steps.length > 0 && { currentStep: job.steps[job.steps.length - 1] }),
    steps: job.steps,
    ...(job.result !== undefined ? { result: job.result } : {}),
    ...(job.error && { error: { code: job.error.code, message: job.error.message } }),
    ...(baseUrl && { url: `${baseUrl}/api/v1/jobs/${job.id}` }),
  };
}
