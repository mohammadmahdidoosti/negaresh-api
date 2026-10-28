/**
 * GET  /api/v1/content/campaigns/{id}?log=100 — progress and recent outcomes.
 * POST /api/v1/content/campaigns/{id} — body: { action: 'pause' | 'resume' | 'cancel' } and/or { maxUsd: number | null }
 */
import { apiError, requireApiKey } from '@/lib/api/auth';
import { readBoundedJson } from '@/lib/request-body';
import { CampaignError, campaignLog, getCampaign, setCampaignBudget, setCampaignStatus } from '@/lib/content/campaigns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (error: unknown) => {
  if (error instanceof CampaignError) return apiError(error.status, error.code, error.message);
  throw error;
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const { id } = await params;
  try {
    const campaign = await getCampaign(id);
    if (!campaign) return apiError(404, 'not_found', 'این تولید انبوه پیدا نشد.');
    const limit = Math.min(300, Math.max(0, Number(new URL(request.url).searchParams.get('log') ?? 100) || 0));
    return Response.json({ ok: true, campaign, log: limit ? await campaignLog(id, limit) : [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await readBoundedJson(request)) as Record<string, unknown>;
  } catch {
    return apiError(400, 'invalid_json', 'بدنهٔ درخواست JSON معتبر نیست.');
  }
  try {
    let campaign = null;
    if ('maxUsd' in body) campaign = await setCampaignBudget(id, typeof body.maxUsd === 'number' ? body.maxUsd : null);
    if (body.action === 'pause' || body.action === 'resume' || body.action === 'cancel') campaign = await setCampaignStatus(id, body.action);
    if (!campaign) return apiError(400, 'invalid_action', 'action باید pause، resume یا cancel باشد (یا maxUsd بفرستید).');
    return Response.json({ ok: true, campaign }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return fail(error);
  }
}
