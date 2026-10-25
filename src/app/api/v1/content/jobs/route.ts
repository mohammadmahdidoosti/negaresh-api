/**
 * POST /api/v1/content/jobs — queue category content generation (one job per category).
 *   body: { category?: string, categories?: string[], draftModel?, briefModel?, humanize?: boolean, force?: boolean, label?, lengthScale?: 0.4–1.5, humanizerWriter? }
 * GET  /api/v1/content/jobs — status of recent content jobs (without full results).
 * Poll each job at GET /api/v1/jobs/{id}.
 */
import { apiError, requireApiKey } from '@/lib/api/auth';
import { publicOrigin } from '@/lib/api/http';
import { createTask, listJobs, QueueFullError, serializeJob } from '@/lib/api/jobs';
import { readBoundedJson } from '@/lib/request-body';
import { DRAFT_MODELS, runCategoryContent, type ContentRequest } from '@/lib/content/pipeline';
import { findCategory } from '@/lib/content/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await readBoundedJson(request)) as Record<string, unknown>;
  } catch {
    return apiError(400, 'invalid_json', 'بدنهٔ درخواست JSON معتبر نیست.');
  }
  const refs = [
    ...(typeof body.category === 'string' ? [body.category] : []),
    ...(Array.isArray(body.categories) ? body.categories.filter((x): x is string => typeof x === 'string') : []),
  ].map(s => s.trim()).filter(Boolean);
  if (refs.length === 0) return apiError(400, 'invalid_category', 'فیلد category یا categories لازم است.');
  if (refs.length > 50) return apiError(400, 'too_many', 'حداکثر ۵۰ دسته در هر درخواست.');

  const unknown = refs.filter(r => !findCategory(r));
  if (unknown.length) return apiError(404, 'category_not_found', `این دسته‌ها در تاکسونومی پیدا نشدند: ${unknown.join('، ')}`);

  const base: Omit<ContentRequest, 'category'> = {
    ...(typeof body.draftModel === 'string' && body.draftModel ? { draftModel: body.draftModel } : {}),
    ...(typeof body.briefModel === 'string' && body.briefModel ? { briefModel: body.briefModel } : {}),
    humanize: body.humanize !== false,
    force: body.force === true,
    ...(typeof body.label === 'string' && body.label ? { label: body.label.slice(0, 80) } : {}),
    // allowed humanizer writers: the configured draft models (same price caps), e.g. DeepSeek
    ...(typeof body.humanizerWriter === 'string' && DRAFT_MODELS().includes(body.humanizerWriter) ? { humanizerWriter: body.humanizerWriter } : {}),
    ...(typeof body.reuseDraftFrom === 'string' && body.reuseDraftFrom ? { reuseDraftFrom: body.reuseDraftFrom.slice(0, 80) } : {}),
    ...(body.humanizerGuards === 'light' || body.humanizerGuards === 'strict' ? { humanizerGuards: body.humanizerGuards } : {}),
    ...(typeof body.lengthScale === 'number' && body.lengthScale >= 0.3 && body.lengthScale <= 1.5 ? { lengthScale: body.lengthScale } : {}),
  };
  const origin = publicOrigin(request);
  const created = [];
  try {
    for (const ref of refs) {
      const cat = findCategory(ref)!;
      const job = createTask(
        'content',
        ({ signal, onStep }) => runCategoryContent({ ...base, category: cat.id }, { signal, onStep }),
        { categoryId: cat.id, categoryName: cat.name, draftModel: base.draftModel ?? null, humanize: base.humanize, label: base.label ?? null },
      );
      created.push(serializeJob(job, origin));
    }
  } catch (error) {
    if (error instanceof QueueFullError) return apiError(429, 'queue_full', error.message, { 'Retry-After': '60' });
    throw error;
  }
  return Response.json({ ok: true, jobs: created }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const jobs = listJobs('content').slice(0, 200).map(j => {
    const r = j.result as { resultId?: string; qa?: { level?: string }; cost?: { usd?: number | null } } | undefined;
    return {
      id: j.id,
      status: j.status,
      meta: j.meta,
      currentStep: j.steps.at(-1) ?? null,
      createdAt: new Date(j.createdAt).toISOString(),
      ...(j.finishedAt ? { finishedAt: new Date(j.finishedAt).toISOString() } : {}),
      ...(r?.resultId ? { resultId: r.resultId, qa: r.qa?.level, costUsd: r.cost?.usd ?? null } : {}),
      ...(j.error ? { error: j.error.message } : {}),
    };
  });
  return Response.json({ ok: true, jobs }, { headers: { 'Cache-Control': 'no-store' } });
}
