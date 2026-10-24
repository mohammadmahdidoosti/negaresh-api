/**
 * GET /api/panel/check — live OpenRouter diagnostics: is the key valid, how much credit is left,
 * and does every configured model exist within the configured price caps.
 */
import { getLlmConfig } from '@/lib/humanizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CatalogModel {
  id: string;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
}

function cap(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return process.env[name]?.trim() && Number.isFinite(value) ? value : fallback;
}

export async function GET() {
  const llm = getLlmConfig();
  if (!llm) {
    return Response.json({ ok: false, error: 'API_KEY یا LLM_BASE_URL روی سرور تنظیم نشده است.' }, { status: 503 });
  }
  const isOpenRouter = new URL(llm.baseUrl).hostname === 'openrouter.ai';
  const root = llm.baseUrl.replace(/\/$/, '');
  const signal = AbortSignal.timeout(20_000);

  // 1) key validity + credit
  let key: Record<string, unknown> = { checked: false };
  if (isOpenRouter) {
    try {
      const res = await fetch(`${root}/key`, { headers: { Authorization: `Bearer ${llm.apiKey}` }, signal });
      if (res.ok) {
        const data = ((await res.json()) as { data?: Record<string, unknown> }).data ?? {};
        key = {
          checked: true,
          valid: true,
          usage: data.usage ?? null,
          limit: data.limit ?? null,
          limitRemaining: data.limit_remaining ?? null,
          isFreeTier: data.is_free_tier ?? null,
        };
      } else {
        key = { checked: true, valid: false, status: res.status };
      }
    } catch (error) {
      key = { checked: true, valid: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // 2) model availability + price caps (OpenRouter prices are USD per token)
  const maxIn = cap('LLM_MAX_INPUT_PRICE', 1);
  const maxOut = cap('LLM_MAX_OUTPUT_PRICE', 5);
  const roles = { writer: llm.writerModel, critic: llm.criticModel, refiner: llm.refinerModel, fallback: llm.fallbackModel };
  let models: Array<Record<string, unknown>> = [];
  let catalogError: string | null = null;
  if (isOpenRouter) {
    try {
      const res = await fetch(`${root}/models`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const catalog = ((await res.json()) as { data?: CatalogModel[] }).data ?? [];
      models = Object.entries(roles).map(([role, id]) => {
        const found = catalog.find(model => model.id === id);
        if (!found) return { role, id, found: false };
        const input = Number(found.pricing?.prompt ?? NaN) * 1_000_000;
        const output = Number(found.pricing?.completion ?? NaN) * 1_000_000;
        return {
          role,
          id,
          found: true,
          inputPerM: Number.isFinite(input) ? Number(input.toFixed(4)) : null,
          outputPerM: Number.isFinite(output) ? Number(output.toFixed(4)) : null,
          withinCap: Number.isFinite(input) && Number.isFinite(output) ? input <= maxIn && output <= maxOut : null,
          contextLength: found.context_length ?? null,
        };
      });
    } catch (error) {
      catalogError = error instanceof Error ? error.message : String(error);
    }
  }

  const ready =
    !isOpenRouter ||
    (key.valid === true && !catalogError && models.every(model => model.found && model.withinCap !== false));
  return Response.json(
    { ok: true, ready, provider: isOpenRouter ? 'openrouter' : root, key, models, caps: { input: maxIn, output: maxOut }, catalogError },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
