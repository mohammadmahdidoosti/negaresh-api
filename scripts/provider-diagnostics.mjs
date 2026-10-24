/** Read-only OpenRouter diagnostics; never prints credentials, user IDs, or raw responses. */
export async function diagnoseProvider() {
  const base = process.env.LLM_BASE_URL?.replace(/\/$/, '');
  if (!base || !process.env.API_KEY) throw new Error('API_KEY and LLM_BASE_URL are required');
  const origin = new URL(base);
  if (origin.hostname !== 'openrouter.ai' || origin.protocol !== 'https:') {
    return { provider: origin.hostname, note: 'OpenRouter account diagnostics skipped for this provider.' };
  }
  const read = async path => {
    const response = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${process.env.API_KEY.trim()}` }, signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, data: response.ok ? body.data : undefined };
  };
  const key = await read('/key');
  const credits = await read('/credits');
  return {
    provider: origin.hostname,
    keyStatus: key.status,
    key: key.data ? {
      limit: key.data.limit, limitRemaining: key.data.limit_remaining, usage: key.data.usage,
      isFreeTier: key.data.is_free_tier, rateLimit: key.data.rate_limit,
    } : undefined,
    creditsStatus: credits.status,
    accountRemaining: credits.data ? credits.data.total_credits - credits.data.total_usage : undefined,
    note: 'A positive balance does not remove provider throttling, key limits, or routing restrictions.',
  };
}
