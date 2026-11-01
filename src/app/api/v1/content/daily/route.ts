/**
 * GET  /api/v1/content/daily — last daily run (sync numbers, missing categories, the campaign it queued).
 * POST /api/v1/content/daily { action: "sync" } — refresh the taxonomy from the store only (writes nothing to the store).
 * POST /api/v1/content/daily { action: "run", confirm: true, maxUsd? } — the daily rule now: sync, then queue missing
 *   categories with automatic publishing.
 */
import { requireApiKey } from '@/lib/api/auth';
import { dailyStatus, missingCategories, runDaily, syncTaxonomy } from '@/lib/content/daily';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const fail = (status: number, code: string, message: string) => Response.json({ ok: false, error: { code, message } }, { status });

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  return Response.json({ ok: true, ...(await dailyStatus()) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { action?: string; confirm?: boolean; maxUsd?: number };
  try {
    if (body.action === 'sync') {
      const sync = await syncTaxonomy();
      return Response.json({ ok: true, sync, missing: (await missingCategories()).length });
    }
    if (body.action === 'run') {
      if (body.confirm !== true) return fail(400, 'confirm_required', 'برای صف کردن تولید و انتشار confirm: true لازم است.');
      return Response.json({ ok: true, ...(await runDaily({ maxUsd: typeof body.maxUsd === 'number' ? body.maxUsd : undefined })) });
    }
    return fail(400, 'unknown_action', 'action باید sync یا run باشد.');
  } catch (error) {
    return fail(502, 'daily_failed', error instanceof Error ? error.message : String(error));
  }
}
