/** GET /api/v1/health — public liveness check (no secrets, no auth). */
import { configuredApiKeys } from '@/lib/api/auth';
import { pendingCount } from '@/lib/api/jobs';
import { limiterState } from '@/lib/api/runner';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROMPT_VERSION } from '@/lib/content/prompts';
import { campaignActivity } from '@/lib/content/campaigns';
import { getLlmConfig } from '@/lib/humanizer';

const stamp = (file: string) => {
  try {
    return readFileSync(join(process.cwd(), file), 'utf8').trim() || null;
  } catch {
    return null;
  }
};
// read once per process: a new deploy = a new process
const commit = () => {
  const fromFile = stamp('.source-commit');
  // Coolify "source commit: runtime only" exposes SOURCE_COMMIT to the running container
  return fromFile && fromFile !== 'unknown' ? fromFile : process.env.SOURCE_COMMIT?.trim() || null;
};
const BUILD = { builtAt: stamp('.build-time'), commit: commit(), contentVersion: PROMPT_VERSION };

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
      // categories of bulk generation being written right now (a redeploy re-queues them)
      campaignJobs: campaignActivity().active,
      slots: limiterState(),
      build: BUILD,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
