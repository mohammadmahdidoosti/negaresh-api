/**
 * POST /api/v1/blog/link { postIds: number[], dry?: boolean, confirm?: true } — category links in blog posts and a
 *   related-products box at the end (backup first). dry: show what would change, write nothing.
 * POST /api/v1/blog/link { action: "rollback", postId, confirm: true } — put the previous content back.
 */
import { requireApiKey } from '@/lib/api/auth';
import { linkBlogPost, rollbackBlogPost } from '@/lib/content/blog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const fail = (status: number, code: string, message: string) => Response.json({ ok: false, error: { code, message } }, { status });

export async function POST(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { postIds?: unknown; dry?: boolean; confirm?: boolean; action?: string; postId?: number };
  if (body.action === 'rollback') {
    if (body.confirm !== true || !body.postId) return fail(400, 'confirm_required', 'postId و confirm: true لازم است.');
    try {
      return Response.json({ ok: true, ...(await rollbackBlogPost(Number(body.postId))) });
    } catch (error) {
      return fail(502, 'rollback_failed', error instanceof Error ? error.message : String(error));
    }
  }
  const ids = Array.isArray(body.postIds) ? body.postIds.map(Number).filter(n => n > 0).slice(0, 25) : [];
  if (!ids.length) return fail(400, 'post_ids_required', 'postIds لازم است.');
  if (!body.dry && body.confirm !== true) return fail(400, 'confirm_required', 'برای نوشتن در سایت confirm: true لازم است (یا dry: true).');
  const results = [];
  for (const id of ids) {
    try {
      results.push({ ok: true, ...(await linkBlogPost(id, { dry: !!body.dry })) });
    } catch (error) {
      results.push({ ok: false, postId: id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return Response.json({ ok: true, results });
}
