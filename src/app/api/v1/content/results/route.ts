/** GET /api/v1/content/results — summaries; ?full=1 returns every stored result (export). */
import { requireApiKey } from '@/lib/api/auth';
import { listResults } from '@/lib/content/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const full = new URL(request.url).searchParams.get('full') === '1';
  const items = await listResults();
  const body = full
    ? { ok: true, exportedAt: new Date().toISOString(), items }
    : {
        ok: true,
        items: items.map(r => ({
          resultId: r.resultId,
          createdAt: r.createdAt,
          label: r.label ?? null,
          category: { id: r.category.id, name: r.category.name, tier: r.category.tier, productCount: r.category.productCount },
          models: r.models,
          qa: r.qa.level,
          words: r.qa.words,
          costUsd: r.cost.usd,
          durationMs: r.durationMs,
        })),
      };
  return Response.json(body, {
    headers: { 'Cache-Control': 'no-store', ...(full ? { 'Content-Disposition': 'attachment; filename="negaresh-content-export.json"' } : {}) },
  });
}
