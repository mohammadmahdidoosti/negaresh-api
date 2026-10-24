/** GET /api/v1/jobs/{id} — job status and, once finished, the result. DELETE cancels a pending job. */
import { apiError, requireApiKey } from '@/lib/api/auth';
import { publicOrigin } from '@/lib/api/http';
import { cancelJob, getJob, serializeJob } from '@/lib/api/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const notFound = () =>
  apiError(404, 'job_not_found', 'کاری با این شناسه پیدا نشد (ممکن است منقضی شده یا سرور ری‌استارت شده باشد).');

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const { id } = await params;
  const job = getJob(id);
  if (!job) return notFound();
  const pending = job.status === 'queued' || job.status === 'running';
  return Response.json(serializeJob(job, publicOrigin(request)), {
    headers: { 'Cache-Control': 'no-store', ...(pending && { 'Retry-After': '10' }) },
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const { id } = await params;
  const job = cancelJob(id);
  if (!job) return notFound();
  return Response.json(serializeJob(job, publicOrigin(request)), { headers: { 'Cache-Control': 'no-store' } });
}
