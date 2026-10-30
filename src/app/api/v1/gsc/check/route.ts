/** GET /api/v1/gsc/check — is the Search Console service account set up and which sites can it read. */
import { requireApiKey } from '@/lib/api/auth';
import { gscCheck, topPages } from '@/lib/content/gsc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const check = await gscCheck();
  const url = new URL(request.url);
  if (check.ok && url.searchParams.get('pages')) {
    try {
      return Response.json({ ...check, pages: await topPages(url.searchParams.get('pages') === '1' ? '/product-category/' : url.searchParams.get('pages')!) }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return Response.json({ ...check, pagesError: error instanceof Error ? error.message : String(error) });
    }
  }
  return Response.json(check, { headers: { 'Cache-Control': 'no-store' } });
}
