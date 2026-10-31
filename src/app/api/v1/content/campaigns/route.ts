/**
 * Bulk generation.
 * POST /api/v1/content/campaigns — body: { label?, categories?: string[], limit?: number, onlyMissing?: boolean (default true),
 *   maxUsd?: number, draftModel?, briefModel?, humanizerWriter?, humanize?: boolean, humanizerQuality? }
 *   Without `categories`: every category with products, most products first.
 * GET  /api/v1/content/campaigns — all campaigns with progress.
 */
import { apiError, requireApiKey } from '@/lib/api/auth';
import { readBoundedJson } from '@/lib/request-body';
import { CampaignError, createCampaign, listCampaigns, startCampaignWorker } from '@/lib/content/campaigns';
import { defaultHumanize, DRAFT_MODELS } from '@/lib/content/pipeline';
import { QUALITY_LEVELS, type QualityLevel } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (error: unknown) => {
  if (error instanceof CampaignError) return apiError(error.status, error.code, error.message);
  throw error;
};

export async function POST(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await readBoundedJson(request)) as Record<string, unknown>;
  } catch {
    return apiError(400, 'invalid_json', 'بدنهٔ درخواست JSON معتبر نیست.');
  }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const model = (v: unknown) => {
    const m = str(v);
    if (m && !DRAFT_MODELS().includes(m)) throw new CampaignError(`مدل مجاز نیست: ${m}`, 400, 'invalid_model');
    return m;
  };
  try {
    const campaign = await createCampaign({
      label: str(body.label) ?? '',
      categories: Array.isArray(body.categories) ? body.categories.filter((x): x is string => typeof x === 'string') : undefined,
      limit: typeof body.limit === 'number' ? Math.floor(body.limit) : undefined,
      onlyMissing: body.onlyMissing !== false,
      maxUsd: typeof body.maxUsd === 'number' ? body.maxUsd : undefined,
      options: {
        ...(model(body.draftModel) ? { draftModel: model(body.draftModel) } : {}),
        ...(str(body.briefModel) ? { briefModel: str(body.briefModel) } : {}),
        ...(model(body.humanizerWriter) ? { humanizerWriter: model(body.humanizerWriter) } : {}),
        humanize: typeof body.humanize === 'boolean' ? body.humanize : defaultHumanize(),
        ...(typeof body.naturalDraft === 'boolean' ? { naturalDraft: body.naturalDraft } : {}),
        ...(typeof body.catalogFacts === 'boolean' ? { catalogFacts: body.catalogFacts } : {}),
        ...(typeof body.freeLength === 'boolean' ? { freeLength: body.freeLength } : {}),
        ...(body.autoPublish === true ? { autoPublish: true } : {}),
        ...(typeof body.humanizerQuality === 'string' && (QUALITY_LEVELS as readonly string[]).includes(body.humanizerQuality)
          ? { humanizerQuality: body.humanizerQuality as QualityLevel }
          : {}),
      },
    });
    return Response.json({ ok: true, campaign }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  try {
    startCampaignWorker();
    return Response.json({ ok: true, campaigns: await listCampaigns() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return fail(error);
  }
}
