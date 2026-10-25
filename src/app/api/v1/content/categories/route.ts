/** GET /api/v1/content/categories?q=&limit=&all=1 — search the taxonomy (categories with products by default). */
import { requireApiKey } from '@/lib/api/auth';
import { breadcrumb, profilesFor, searchCategories, tierFor } from '@/lib/content/taxonomy';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const q = url.searchParams.get('q') ?? '';
  const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 200);
  const items = searchCategories(q, { hasProducts: url.searchParams.get('all') !== '1', limit }).map(c => {
    const p = profilesFor(c);
    return {
      id: c.id,
      name: c.name,
      level: c.level,
      products: c.products,
      tier: tierFor(c, c.products),
      path: breadcrumb(c),
      profiles: { l1: !!p.l1, l2: !!p.l2 },
      flags: c.flags || null,
    };
  });
  return Response.json({ ok: true, items }, { headers: { 'Cache-Control': 'no-store' } });
}
