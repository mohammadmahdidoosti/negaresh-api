/** GET /api/v1/content/config — models, defaults and data stats for the content panel. */
import { requireApiKey } from '@/lib/api/auth';
import { DEFAULT_BRIEF_MODEL, DEFAULT_DRAFT_MODEL, DRAFT_MODELS } from '@/lib/content/pipeline';
import { PROMPT_VERSION } from '@/lib/content/prompts';
import { storeInfo } from '@/lib/content/store';
import { taxonomyStats, TIER_WORDS } from '@/lib/content/taxonomy';
import { getLlmConfig } from '@/lib/humanizer';

/** OpenRouter balance (credits bought minus used), when the provider is OpenRouter; never the key. */
async function credits(): Promise<{ total: number; used: number; left: number } | null> {
  const cfg = getLlmConfig();
  if (!cfg || !/openrouter\.ai/.test(cfg.baseUrl)) return null;
  try {
    const r = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/credits`, { headers: { Authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(10_000) });
    const d = (await r.json()) as { data?: { total_credits?: number; total_usage?: number } };
    const total = Number(d.data?.total_credits ?? NaN);
    const used = Number(d.data?.total_usage ?? NaN);
    return Number.isFinite(total) && Number.isFinite(used) ? { total, used, left: Math.round((total - used) * 100) / 100 } : null;
  } catch {
    return null;
  }
}

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  return Response.json({
    ok: true,
    promptVersion: PROMPT_VERSION,
    models: { brief: DEFAULT_BRIEF_MODEL(), draft: DEFAULT_DRAFT_MODEL(), draftOptions: DRAFT_MODELS() },
    tiers: TIER_WORDS,
    stats: taxonomyStats(),
    store: await storeInfo(),
    credits: await credits(),
  });
}
