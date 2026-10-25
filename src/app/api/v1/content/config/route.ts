/** GET /api/v1/content/config — models, defaults and data stats for the content panel. */
import { requireApiKey } from '@/lib/api/auth';
import { DEFAULT_BRIEF_MODEL, DEFAULT_DRAFT_MODEL, DRAFT_MODELS } from '@/lib/content/pipeline';
import { PROMPT_VERSION } from '@/lib/content/prompts';
import { storeInfo } from '@/lib/content/store';
import { taxonomyStats, TIER_WORDS } from '@/lib/content/taxonomy';

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
  });
}
