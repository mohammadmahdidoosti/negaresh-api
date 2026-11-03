/**
 * GET  /api/v1/blog/drafts?clusters=1[&min=3] — posts grouped by topic (consolidation candidates). Read-only.
 * POST /api/v1/blog/drafts { action: "consolidate", postIds, title? } — one guide from a group, saved as a DRAFT.
 * POST /api/v1/blog/drafts { action: "strengthen", postId, searches? } — the post with table/FAQ/links, as a DRAFT copy.
 * Nothing is published here.
 */
import { requireApiKey } from '@/lib/api/auth';
import { clusters, consolidate, strengthen } from '@/lib/content/blogDrafts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const fail = (status: number, code: string, message: string) => Response.json({ ok: false, error: { code, message } }, { status });

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const url = new URL(request.url);
  if (!url.searchParams.get('clusters')) return fail(400, 'bad_request', 'clusters=1 لازم است.');
  return Response.json({ ok: true, clusters: await clusters(Number(url.searchParams.get('min')) || 3) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { action?: string; postIds?: unknown; postId?: number; title?: string; searches?: unknown };
  try {
    if (body.action === 'consolidate') {
      const ids = Array.isArray(body.postIds) ? body.postIds.map(Number).filter(n => n > 0).slice(0, 25) : [];
      return Response.json({ ok: true, ...(await consolidate(ids, { title: typeof body.title === 'string' ? body.title : undefined })) });
    }
    if (body.action === 'strengthen') {
      const searches = Array.isArray(body.searches) ? body.searches.map(String).slice(0, 12) : [];
      return Response.json({ ok: true, ...(await strengthen(Number(body.postId), searches)) });
    }
    return fail(400, 'unknown_action', 'action باید consolidate یا strengthen باشد.');
  } catch (error) {
    return fail(502, 'draft_failed', error instanceof Error ? error.message : String(error));
  }
}
