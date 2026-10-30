/**
 * GET /api/v1/content/links?resultId=…  — planned in-text links and related categories for a stored result (preview).
 * GET /api/v1/content/links?duplicates=1 — category names shared by several categories with products.
 * Read-only: nothing is written to the store or the site.
 */
import { requireApiKey } from '@/lib/api/auth';
import { applyLinks, duplicateNames, planLinks, structuralLinks } from '@/lib/content/links';
import { getResult } from '@/lib/content/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const url = new URL(request.url);
  if (url.searchParams.get('duplicates')) return Response.json({ ok: true, duplicates: duplicateNames() });
  const id = url.searchParams.get('resultId') ?? '';
  const r = await getResult(id);
  if (!r) return Response.json({ ok: false, error: { code: 'not_found', message: 'نتیجه پیدا نشد.' } }, { status: 404 });
  const max = Math.min(10, Math.max(1, Number(url.searchParams.get('max')) || 5));
  const links = planLinks(r.content.below, r.category.id, max);
  return Response.json({
    ok: true,
    category: r.category.name,
    links: links.map(l => ({ anchor: l.anchor, target: l.target.name, url: l.target.url, line: l.line })),
    related: structuralLinks(r.category.id),
    preview: applyLinks(r.content.below, links),
  });
}
