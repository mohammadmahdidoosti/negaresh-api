/**
 * Runs the unchanged humanization pipeline (rewrite → critic/refine → E-E-A-T → publication check)
 * for API callers, and returns a plain JSON-friendly result instead of an SSE stream.
 */
import { analyzeEeat, createExecutionContext, HumanizerError, rewriteText } from '@/lib/humanizer';
import type { LintReport } from '@/lib/linter';
import { assessPublicationReadiness } from '@/lib/publication';
import { computeStyleMetrics } from '@/lib/stylometry';
import type { HumanizeRequest, LintSignalSummary, WritingStage } from '@/lib/types';

export interface StepEvent {
  stage: WritingStage | string;
  message: string;
  at: string;
}

export interface ApiHumanizeResult {
  text: string;
  publication: ReturnType<typeof assessPublicationReadiness>;
  humanReviewRequired: boolean;
  warning?: string;
  details: {
    metrics: { before: ReturnType<typeof computeStyleMetrics>; after: ReturnType<typeof computeStyleMetrics> };
    analysis: Awaited<ReturnType<typeof analyzeEeat>>;
    quality: Awaited<ReturnType<typeof rewriteText>>['quality'];
    validation: Awaited<ReturnType<typeof rewriteText>>['validation'];
    lint: LintSignalSummary;
  };
  durationMs: number;
}

export class PipelineError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'PipelineError';
  }
}

function lintSummary(report: LintReport): LintSignalSummary {
  return {
    fluffDensity: report.fluffDensity,
    burstiness: report.burstiness,
    errorWeight: report.errorWeight,
    warnWeight: report.warnWeight,
    needsRefinement: report.needsRefinement,
    blocking: report.blocking,
    passesBudget: report.passesBudget,
    violationCount: report.violations.length,
  };
}

/** Hard ceiling per run, same as the web route. */
const RUN_DEADLINE_MS = 570_000;

export async function runHumanize(
  payload: HumanizeRequest,
  options: { signal?: AbortSignal; onStep?: (step: StepEvent) => void } = {},
): Promise<ApiHumanizeResult> {
  const startedAt = Date.now();
  const deadline = AbortSignal.timeout(RUN_DEADLINE_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const execution = createExecutionContext(signal);

  try {
    const {
      analysis: reviewedAnalysis,
      text: rewritten,
      quality: qualityReport,
      validation,
      lint,
      surfaceFixes,
    } = await rewriteText(
      payload,
      (stage, message) => options.onStep?.({ stage, message, at: new Date().toISOString() }),
      execution,
    );

    const warnings: string[] = [...qualityReport.warnings];
    const writingReviewRequired = qualityReport.humanReviewRequired;

    const analysis = reviewedAnalysis ?? (await analyzeEeat(rewritten, payload, execution));
    if (!analysis) warnings.push('بازنویسی انجام شد، اما تحلیل E-E-A-T در دسترس نبود.');

    const publication = assessPublicationReadiness({ text: rewritten, analysis, writingReviewRequired });
    qualityReport.humanReviewRequired = writingReviewRequired || publication.status === 'needs-work';

    if (qualityReport.refineRan && (qualityReport.initial.lint?.violationCount ?? 0) > 0) {
      warnings.push(
        `اصلاح هدفمند: ${qualityReport.initial.lint!.violationCount.toLocaleString('fa-IR')} مورد تشخیصی بازبینی شد.`,
      );
    } else if (surfaceFixes > 0) {
      warnings.push(`نرمال‌سازی سطحی: ${surfaceFixes.toLocaleString('fa-IR')} اصلاح فاصله یا علائم نگارشی اعمال شد.`);
    }

    return {
      text: rewritten,
      publication,
      humanReviewRequired: qualityReport.humanReviewRequired,
      ...(warnings.length > 0 && { warning: warnings.join(' ') }),
      details: {
        metrics: { before: computeStyleMetrics(payload.text), after: qualityReport.final.metrics },
        analysis,
        quality: qualityReport,
        validation,
        lint: lintSummary(lint),
      },
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (options.signal?.aborted) throw new PipelineError('درخواست لغو شد.', 499, 'canceled');
    if (deadline.aborted) throw new PipelineError('زمان پردازش از سقف مجاز گذشت.', 504, 'timeout');
    if (error instanceof HumanizerError) {
      console.error('[api/v1] humanizer error:', JSON.stringify({ status: error.status, message: error.message }));
      // 4xx from validation/provider keep their status; any upstream 5xx except 503/504 becomes 502 Bad Gateway.
      const status =
        error.status >= 400 && error.status < 500 ? error.status : [503, 504].includes(error.status) ? error.status : 502;
      const code = status === 400 ? 'invalid_input' : status === 503 ? 'not_configured' : 'provider_error';
      throw new PipelineError(error.message, status, code);
    }
    console.error('[api/v1] unexpected error:', error);
    throw new PipelineError('پردازش با خطای غیرمنتظره متوقف شد.', 500, 'internal_error');
  }
}

/* ---------- concurrency limiter shared by sync calls and jobs ---------- */

interface Limiter {
  active: number;
  waiters: Array<() => void>;
}

const globalStore = globalThis as typeof globalThis & { __negareshLimiter?: Limiter };
const limiter: Limiter = (globalStore.__negareshLimiter ??= { active: 0, waiters: [] });

export function maxConcurrency(): number {
  const value = Number(process.env.API_MAX_CONCURRENT ?? 2);
  return Number.isInteger(value) && value > 0 ? value : 2;
}

export function limiterState() {
  return { active: limiter.active, waiting: limiter.waiters.length, max: maxConcurrency() };
}

/** Wait for a free pipeline slot; returns a release function. */
export async function acquireSlot(signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted();
  if (limiter.active < maxConcurrency()) {
    limiter.active += 1;
  } else {
    await new Promise<void>((resolve, reject) => {
      const wake = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        const index = limiter.waiters.indexOf(wake);
        if (index >= 0) limiter.waiters.splice(index, 1);
        reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      limiter.waiters.push(wake);
    });
    // The releasing caller handed its slot to us, so `active` is unchanged.
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = limiter.waiters.shift();
    if (next) next();
    else limiter.active -= 1;
  };
}
