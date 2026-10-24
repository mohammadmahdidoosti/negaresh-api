/** GET /api/v1/health — public liveness check (no secrets, no auth). */
import { configuredApiKeys } from '@/lib/api/auth';
import { pendingCount } from '@/lib/api/jobs';
import { limiterState } from '@/lib/api/runner';
import { getLlmConfig } from '@/lib/humanizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const llm = getLlmConfig();
  return Response.json(
    {
      ok: true,
      apiEnabled: configuredApiKeys().length > 0,
      llmConfigured: llm !== null,
      pendingJobs: pendingCount(),
      slots: limiterState(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
