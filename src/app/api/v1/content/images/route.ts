/**
 * POST /api/v1/content/images { action: "level1-icons", confirm: true, only?: string[], replace?: boolean }
 *   — upload the drawn level-1 icons and set them as category images (backup first).
 * POST /api/v1/content/images { action: "rollback", termId, confirm: true } — put back the previous image.
 */
import { requireApiKey } from '@/lib/api/auth';
import { applyLevel1Icons, rollbackImage } from '@/lib/content/images';
import { wpConfigured } from '@/lib/content/wp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const fail = (status: number, code: string, message: string) => Response.json({ ok: false, error: { code, message } }, { status });

export async function POST(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  if (!wpConfigured()) return fail(400, 'wp_not_configured', 'اتصال وردپرس تنظیم نشده است.');
  const body = (await request.json().catch(() => ({}))) as { action?: string; confirm?: boolean; only?: unknown; replace?: boolean; termId?: number };
  if (body.confirm !== true) return fail(400, 'confirm_required', 'برای نوشتن در سایت confirm: true لازم است.');
  try {
    if (body.action === 'level1-icons') {
      const only = Array.isArray(body.only) ? body.only.map(String) : undefined;
      const results = await applyLevel1Icons({ only, replace: body.replace === true });
      return Response.json({ ok: true, results });
    }
    if (body.action === 'rollback') {
      if (!body.termId) return fail(400, 'term_required', 'termId لازم است.');
      return Response.json({ ok: true, ...(await rollbackImage(Number(body.termId))) });
    }
    return fail(400, 'unknown_action', 'action نامعتبر است.');
  } catch (error) {
    return fail(502, 'images_failed', error instanceof Error ? error.message : String(error));
  }
}
