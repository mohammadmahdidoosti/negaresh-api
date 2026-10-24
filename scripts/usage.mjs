/** CLI-only private ledger inspection and reconciliation. */
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { usageSummary, unsettledGenerations, recordMetadata } = await jiti.import('../src/lib/usage-ledger.ts');
if (process.argv.includes('--reconcile')) {
  const base = process.env.LLM_BASE_URL?.replace(/\/$/, '');
  if (!base || new URL(base).hostname !== 'openrouter.ai' || !process.env.API_KEY) throw new Error('OpenRouter configuration required');
  for (const row of unsettledGenerations()) {
    const response = await fetch(`${base}/generation?id=${encodeURIComponent(row.generation_id)}`, {
      headers: { Authorization: `Bearer ${process.env.API_KEY.trim()}` }, signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) { console.error('Reconciliation deferred, HTTP', response.status); continue; }
    const { data } = await response.json();
    if (typeof data?.total_cost === 'number' && Number.isFinite(data.total_cost) && data.total_cost >= 0) {
      recordMetadata(row.id, { cost: data.total_cost, generationId: row.generation_id,
        model: data.model, provider: data.provider_name, promptTokens: data.native_tokens_prompt,
        completionTokens: data.native_tokens_completion, reasoningTokens: data.native_tokens_reasoning });
    }
  }
}
console.log(JSON.stringify(usageSummary(), null, 2));
