/**
 * POST /api/v1/humanize — synchronous: waits for the full pipeline and returns the final text as JSON.
 * Typical runs take one to several minutes, so give the HTTP client a generous timeout (≥ 10 min).
 */
import { apiError, requireApiKey } from '@/lib/api/auth';
import { readPayload } from '@/lib/api/http';
import { acquireSlot, PipelineError, runHumanize } from '@/lib/api/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const read = await readPayload(request);
  if ('response' in read) return read.response;

  let release: (() => void) | undefined;
  try {
    release = await acquireSlot(request.signal);
    const result = await runHumanize(read.payload, { signal: request.signal });
    return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof PipelineError) return apiError(error.status, error.code, error.message);
    if (request.signal.aborted) return apiError(499, 'canceled', 'درخواست لغو شد.');
    console.error('[api/v1/humanize] unexpected error:', error);
    return apiError(500, 'internal_error', 'پردازش با خطای غیرمنتظره متوقف شد.');
  } finally {
    release?.();
  }
}
