/** GET /api/v1/gsc/check — is the Search Console service account set up and which sites can it read. */
import { requireApiKey } from '@/lib/api/auth';
import { gscCheck } from '@/lib/content/gsc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  return Response.json(await gscCheck(), { headers: { 'Cache-Control': 'no-store' } });
}
