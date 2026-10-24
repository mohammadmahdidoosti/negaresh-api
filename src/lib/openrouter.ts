/** Resolve current model capabilities before sending strict provider-routing filters. */
export interface ModelCapabilities {
  id: string;
  supported_parameters: string[];
  context_length?: number;
  top_provider?: { max_completion_tokens?: number | null };
  reasoning?: { mandatory?: boolean; supported_efforts?: string[] };
}
let catalog: { expires: number; models: ModelCapabilities[] } | undefined;

export async function modelCapabilities(model: string, signal?: AbortSignal): Promise<ModelCapabilities> {
  if (!catalog || Date.now() >= catalog.expires) {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`OpenRouter model catalog unavailable (${response.status})`);
    const body = await response.json() as { data?: ModelCapabilities[] };
    if (!Array.isArray(body.data)) throw new Error('Invalid OpenRouter model catalog');
    catalog = { expires: Date.now() + 300_000, models: body.data };
  }
  const found = catalog.models.find(item => item.id === model);
  if (!found || !Array.isArray(found.supported_parameters)) throw new Error(`Configured OpenRouter model unavailable: ${model}`);
  return found;
}

export function supportedSampling(capabilities: ModelCapabilities, temperature: number, reasoningDefault = false) {
  const supports = new Set(capabilities.supported_parameters);
  return {
    ...(supports.has('temperature') ? { temperature } : {}),
    ...(supports.has('reasoning') && !reasoningDefault ? {
      reasoning: capabilities.reasoning?.mandatory
        ? (capabilities.reasoning.supported_efforts?.includes('low') ? { effort: 'low' } : { enabled: true })
        : { enabled: false },
    } : {}),
  };
}

/** UTF-8 bytes are a conservative admission estimate, not a model tokenizer. */
export function validateModelCapacity(capabilities: ModelCapabilities, inputBytes: number, outputTokens: number) {
  const outputLimit = capabilities.top_provider?.max_completion_tokens;
  if (typeof outputLimit === 'number' && outputLimit > 0 && outputTokens > outputLimit) {
    throw new Error('سقف خروجی مدل برای این طول مقاله کافی نیست؛ مدل با ظرفیت خروجی بیشتر انتخاب کنید.');
  }
  if (typeof capabilities.context_length === 'number' && capabilities.context_length > 0 && inputBytes + outputTokens > capabilities.context_length) {
    throw new Error('متن و زمینه از ظرفیت محافظه‌کارانه مدل بیشتر است؛ ورودی را کوتاه کنید یا مدل بزرگ‌تری انتخاب کنید.');
  }
}
