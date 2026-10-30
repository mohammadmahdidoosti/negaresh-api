/**
 * GET /api/v1/content/gsc?resultId=…[&days=90] — what the result's category page is found for in Google
 * (Search Console, read-only), and which of those queries the new text does not mention yet.
 */
import { requireApiKey } from '@/lib/api/auth';
import { pageQueries } from '@/lib/content/gsc';
import { categoryUrl } from '@/lib/content/links';
import { getResult } from '@/lib/content/store';
import { getCategory, norm } from '@/lib/content/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const r = await getResult(url.searchParams.get('resultId') ?? '');
  if (!r) return Response.json({ ok: false, error: { code: 'not_found', message: 'نتیجه پیدا نشد.' } }, { status: 404 });
  const cat = getCategory(r.category.id);
  const page = r.category.url ?? (cat ? categoryUrl(cat) : '');
  const days = Math.min(480, Math.max(7, Number(url.searchParams.get('days')) || 90));
  try {
    const data = await pageQueries(page, days);
    const text = norm([r.content.metaTitle, r.content.metaDescription, r.content.above, r.content.below].join(' ')).replace(/‌/g, ' ');
    const missing = data.rows
      .filter(q => q.impressions >= 10)
      .filter(q => norm(q.query).split(/\s+/).filter(w => w.length > 2).some(w => !text.includes(w)));
    return Response.json({ ok: true, category: r.category.name, page, ...data, notInText: missing.slice(0, 50) });
  } catch (error) {
    return Response.json({ ok: false, page, error: { code: 'gsc_error', message: error instanceof Error ? error.message : String(error) } }, { status: 502 });
  }
}
