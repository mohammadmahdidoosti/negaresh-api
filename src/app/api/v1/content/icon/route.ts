/**
 * POST /api/v1/content/icon { names: string[] (≤ 10), hint?: string, model?: string }
 * Draws a line SVG icon per category name with a text model (experiment). Writes nothing to the store.
 */
import { requireApiKey } from '@/lib/api/auth';
import { drawIcon } from '@/lib/content/icon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { names?: unknown; hint?: string; model?: string };
  const names = Array.isArray(body.names) ? body.names.map(String).map(s => s.trim()).filter(Boolean).slice(0, 10) : [];
  if (!names.length) return Response.json({ ok: false, error: { code: 'names_required', message: 'names لازم است.' } }, { status: 400 });
  const icons = await Promise.all(names.map(async name => {
    try {
      return { name, ...(await drawIcon(name, { hint: body.hint, model: body.model, signal: request.signal })) };
    } catch (error) {
      return { name, svg: null, error: error instanceof Error ? error.message : String(error) };
    }
  }));
  return Response.json({ ok: true, icons }, { headers: { 'Cache-Control': 'no-store' } });
}
