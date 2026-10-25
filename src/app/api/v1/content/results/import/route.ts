/** POST /api/v1/content/results/import — re-load an export (body: { items: ContentResult[] }). */
import { apiError, requireApiKey } from '@/lib/api/auth';
import { importResults } from '@/lib/content/store';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  let body: { items?: unknown };
  try {
    body = (await request.json()) as { items?: unknown };
  } catch {
    return apiError(400, 'invalid_json', 'بدنهٔ درخواست JSON معتبر نیست.');
  }
  if (!Array.isArray(body.items)) return apiError(400, 'invalid_body', 'فیلد items لازم است.');
  const imported = await importResults(body.items as never[]);
  return Response.json({ ok: true, imported });
}
