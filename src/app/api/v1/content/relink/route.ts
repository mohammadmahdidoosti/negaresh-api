/**
 * GET  /api/v1/content/relink — progress of the internal links refresh.
 * POST /api/v1/content/relink { confirm: true } — start it (rebuilds descriptions of published categories in the background).
 */
import { requireApiKey } from '@/lib/api/auth';
import { relinkStatus, startRelink } from '@/lib/content/relink';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  return Response.json({ ok: true, ...(await relinkStatus()) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { confirm?: boolean };
  if (body.confirm !== true) return Response.json({ ok: false, error: { code: 'confirm_required', message: 'confirm: true لازم است.' } }, { status: 400 });
  const started = await startRelink();
  return Response.json({ ok: true, started, ...(await relinkStatus()) });
}
