/** GET /api/v1/wp/check?term=<WordPress product_cat id> — read-only check of the WordPress connection. */
import { requireApiKey } from '@/lib/api/auth';
import { wpCheck } from '@/lib/content/wp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const term = Number(new URL(request.url).searchParams.get('term')) || undefined;
  return Response.json(await wpCheck(term), { headers: { 'Cache-Control': 'no-store' } });
}
