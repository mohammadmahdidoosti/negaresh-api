/**
 * GET /api/panel/connection — connection details for the logged-in panel user.
 * Protected by the web login cookie (middleware), so only the owner can read the API key here.
 */
import { configuredApiKeys } from '@/lib/api/auth';
import { getLlmConfig } from '@/lib/humanizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const llm = getLlmConfig();
  return Response.json(
    {
      apiKey: configuredApiKeys()[0] ?? null,
      apiKeyCount: configuredApiKeys().length,
      llmConfigured: llm !== null,
      baseUrl: llm?.baseUrl ?? null,
      models: llm
        ? { writer: llm.writerModel, critic: llm.criticModel, refiner: llm.refinerModel, fallback: llm.fallbackModel }
        : null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
