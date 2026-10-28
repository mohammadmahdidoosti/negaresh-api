/** GET /api/v1/health — public liveness check (no secrets, no auth). */
import { configuredApiKeys } from '@/lib/api/auth';
import { pendingCount } from '@/lib/api/jobs';
import { limiterState } from '@/lib/api/runner';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROMPT_VERSION } from '@/lib/content/prompts';
import { getLlmConfig } from '@/lib/humanizer';

const stamp = (file: string) => {
  try {
    return readFileSync(join(process.cwd(), file), 'utf8').trim() || null;
  } catch {
    return null;
  }
};
// read once per process: a new deploy = a new process
const BUILD = { builtAt: stamp('.build-time'), commit: stamp('.source-commit'), contentVersion: PROMPT_VERSION };

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
      build: BUILD,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
