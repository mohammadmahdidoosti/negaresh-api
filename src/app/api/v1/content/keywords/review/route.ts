/**
 * Monthly keyword review.
 * GET  ?status=pending|approved|rejected|applied&bucket=blog|category[&format=csv] — the review list (CSV for the blog plan).
 * POST { action: "run", limit? }            — research more categories in the background (writes nothing to the store).
 * POST { action: "decide", items: [{catId, q, status?, bucket?}] } — the owner's decisions.
 * POST { action: "apply", confirm: true }   — regenerate and publish categories with approved phrases.
 */
import { requireApiKey } from '@/lib/api/auth';
import { applyApproved, decide, reviewRows, reviewState, startReview, toCsv } from '@/lib/content/review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (status: number, code: string, message: string) => Response.json({ ok: false, error: { code, message } }, { status });

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const rows = await reviewRows({ status: url.searchParams.get('status') ?? undefined, bucket: url.searchParams.get('bucket') ?? undefined });
  if (url.searchParams.get('format') === 'csv') {
    return new Response(toCsv(rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="keywords.csv"', 'Cache-Control': 'no-store' } });
  }
  return Response.json({ ok: true, state: await reviewState(), total: rows.length, rows }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { action?: string; limit?: number; items?: unknown; confirm?: boolean };
  try {
    if (body.action === 'run') return Response.json({ ok: true, started: await startReview(Math.min(Math.max(Number(body.limit) || 150, 1), 1000)) });
    if (body.action === 'decide') {
      const items = Array.isArray(body.items) ? (body.items as Array<{ catId: string; q: string; status?: never; bucket?: never }>).filter(i => i && typeof i.catId === 'string' && typeof i.q === 'string') : [];
      return Response.json({ ok: true, updated: await decide(items) });
    }
    if (body.action === 'apply') {
      if (body.confirm !== true) return fail(400, 'confirm_required', 'برای بازتولید و انتشار confirm: true لازم است.');
      return Response.json({ ok: true, ...(await applyApproved()) });
    }
    return fail(400, 'unknown_action', 'action باید run، decide یا apply باشد.');
  } catch (error) {
    return fail(502, 'review_failed', error instanceof Error ? error.message : String(error));
  }
}
