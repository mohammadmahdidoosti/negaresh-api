/**
 * GET  /api/v1/content/watch — pages whose product range changed since their text was written (last check).
 * POST /api/v1/content/watch { categories?: string[] } — check now (all categories with a result, or the given ids);
 *      runs in the background, progress in GET.state. Reads the store only; changes nothing.
 */
import { requireApiKey } from '@/lib/api/auth';
import { runWatch, watchReport, watchState } from '@/lib/content/watch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  return Response.json({ ok: true, state: watchState(), ...(await watchReport()) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { categories?: unknown };
  const categories = Array.isArray(body.categories) ? body.categories.map(String).slice(0, 5000) : undefined;
  if (watchState().running) return Response.json({ ok: false, error: { code: 'busy', message: 'بررسی در حال اجراست.' } }, { status: 409 });
  void runWatch({ categories, delayMs: 500 }).catch(error => console.error('[content-watch]', error));
  return Response.json({ ok: true, started: true, state: watchState() }, { status: 202 });
}
