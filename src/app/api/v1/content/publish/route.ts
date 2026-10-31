/**
 * GET  /api/v1/content/publish?resultId=…  — preview: exactly what would go into each field, next to what is there now.
 *                                            Writes nothing.
 * GET  /api/v1/content/publish?log=1        — recent publishes and rollbacks.
 * POST /api/v1/content/publish { resultId, confirm: true }              — publish one category (backup first).
 * POST /api/v1/content/publish { categoryId, action: "rollback", confirm: true } — put back the last backup.
 */
import { requireApiKey } from '@/lib/api/auth';
import { buildPayload, currentState, publishCategory, publishLog, rollbackCategory } from '@/lib/content/publish';
import { getResult } from '@/lib/content/store';
import { wpConfigured } from '@/lib/content/wp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (status: number, code: string, message: string) => Response.json({ ok: false, error: { code, message } }, { status });

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const url = new URL(request.url);
  if (url.searchParams.get('log')) return Response.json({ ok: true, log: await publishLog() });
  if (!wpConfigured()) return fail(400, 'wp_not_configured', 'اتصال وردپرس تنظیم نشده است.');
  const r = await getResult(url.searchParams.get('resultId') ?? '');
  if (!r) return fail(404, 'not_found', 'نتیجه پیدا نشد.');
  try {
    const payload = await buildPayload(r);
    const now = await currentState(payload.termId, r.category.url ?? undefined);
    return Response.json({ ok: true, category: r.category.name, payload, current: now });
  } catch (error) {
    return fail(502, 'preview_failed', error instanceof Error ? error.message : String(error));
  }
}

export async function POST(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  if (!wpConfigured()) return fail(400, 'wp_not_configured', 'اتصال وردپرس تنظیم نشده است.');
  const body = (await request.json().catch(() => ({}))) as { resultId?: string; categoryId?: string; action?: string; confirm?: boolean; allowWithoutExcerpt?: boolean };
  if (body.confirm !== true) return fail(400, 'confirm_required', 'برای نوشتن در سایت confirm: true لازم است.');
  try {
    if (body.action === 'rollback') {
      if (!body.categoryId) return fail(400, 'category_required', 'categoryId لازم است.');
      return Response.json({ ok: true, ...(await rollbackCategory(String(body.categoryId))) });
    }
    const r = await getResult(String(body.resultId ?? ''));
    if (!r) return fail(404, 'not_found', 'نتیجه پیدا نشد.');
    return Response.json({ ok: true, ...(await publishCategory(r, { allowWithoutExcerpt: body.allowWithoutExcerpt === true })) });
  } catch (error) {
    return fail(502, 'publish_failed', error instanceof Error ? error.message : String(error));
  }
}
