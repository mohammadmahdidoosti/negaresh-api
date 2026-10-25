/** GET /api/v1/content/results/{resultId} — one full result. */
import { apiError, requireApiKey } from '@/lib/api/auth';
import { getResult } from '@/lib/content/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const { id } = await params;
  const result = getResult(id);
  if (!result) return apiError(404, 'result_not_found', 'نتیجه پیدا نشد (ممکن است سرور ری‌استارت شده باشد).');
  return Response.json({ ok: true, result }, { headers: { 'Cache-Control': 'no-store' } });
}
