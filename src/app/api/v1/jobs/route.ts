/**
 * POST /api/v1/jobs — two-step mode: queues a humanize job and returns its id immediately (202).
 * Poll GET /api/v1/jobs/{id} until status is "succeeded" or "failed".
 */
import { apiError, requireApiKey } from '@/lib/api/auth';
import { publicOrigin, readPayload } from '@/lib/api/http';
import { createJob, QueueFullError, serializeJob } from '@/lib/api/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;

  const read = await readPayload(request);
  if ('response' in read) return read.response;

  try {
    const job = createJob(read.payload);
    const body = serializeJob(job, publicOrigin(request));
    return Response.json(body, {
      status: 202,
      headers: { 'Cache-Control': 'no-store', Location: `/api/v1/jobs/${job.id}`, 'Retry-After': '10' },
    });
  } catch (error) {
    if (error instanceof QueueFullError) return apiError(429, 'queue_full', error.message, { 'Retry-After': '60' });
    throw error;
  }
}
