import { modelCapabilities, supportedSampling, validateModelCapacity } from "./openrouter";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { reserveAttempt, recordMetadata, finishAttempt, BudgetError, type UsageMetadata } from "./usage-ledger";
import { validateLengthOptions } from "./length";
import { validateInput } from "./text";

export interface ExecutionContext { runId: string; signal?: AbortSignal; }
export function createExecutionContext(signal?: AbortSignal): ExecutionContext { return { runId: randomUUID(), signal }; }
function numericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}`);
  return value;
}

/** Provider-agnostic streaming transport and single-flow entry points. */
import { buildAnalysisSystemPrompt, buildAnalysisUserPrompt } from "./prompt";
import { extractJson, validateEeatAnalysis } from "./analysis";
import { runWritingLoop, type LlmOptions, type WritingStepHandler } from "./refinement";
import type { EeatAnalysis, HumanizeRequest } from "./types";

/** Keep streaming until the provider completes; allow one retry for transient failures. */
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1_500;
const MAX_RETRY_AFTER_MS = 30_000;

const DEFAULT_WRITER_MODEL = "google/gemini-3.8-flash";
const DEFAULT_CRITIC_MODEL = "openai/gpt-5.6-luna";
const DEFAULT_REFINER_MODEL = "deepseek/deepseek-v4-flash-0731";
const DEFAULT_FALLBACK_MODEL = "deepseek/deepseek-v4-flash-0731";

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  writerModel: string;
  criticModel: string;
  refinerModel: string;
  fallbackModel: string;
}

export class HumanizerError extends Error {
  constructor(
    message: string,
    readonly status: number = 502,
  ) {
    super(message);
    this.name = "HumanizerError";
  }
}

class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs: number | null = null,
    readonly provider?: string,
    readonly upstreamThrottled = false,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

function resolveRoleModel(roleValue: string | undefined, shared: string | undefined, fallback: string): string {
  return roleValue?.trim() || shared?.trim() || fallback;
}

/** Read provider config from the environment; null when API_KEY or LLM_BASE_URL is missing. */
export function getLlmConfig(): LlmConfig | null {
  const apiKey = process.env.API_KEY?.trim();
  const baseUrl = process.env.LLM_BASE_URL?.trim();
  if (!apiKey || !baseUrl) return null;
  const shared = process.env.LLM_MODEL?.trim();
  return {
    apiKey,
    baseUrl,
    writerModel: resolveRoleModel(process.env.LLM_WRITER_MODEL, shared, DEFAULT_WRITER_MODEL),
    criticModel: resolveRoleModel(process.env.LLM_CRITIC_MODEL, shared, DEFAULT_CRITIC_MODEL),
    refinerModel: resolveRoleModel(process.env.LLM_REFINER_MODEL, shared, DEFAULT_REFINER_MODEL),
    fallbackModel: resolveRoleModel(process.env.LLM_FALLBACK_MODEL, shared, DEFAULT_FALLBACK_MODEL),
  };
}

function openRouterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const referer = process.env.OPENROUTER_HTTP_REFERER?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const title = process.env.OPENROUTER_APP_TITLE?.trim() || "Persian Humanizer";
  if (referer) headers["HTTP-Referer"] = referer;
  if (title) headers["X-OpenRouter-Title"] = title;
  return headers;
}

function resolveAttemptModel(config: LlmConfig, requested: string, attempt: number, useFallback = true): string {
  if (useFallback && attempt > 1 && config.fallbackModel && config.fallbackModel !== requested) {
    return config.fallbackModel;
  }
  return requested;
}

/** Short structured log line so failures are diagnosable, not a generic crash. */
function logLlmFailure(scope: string, fields: Record<string, unknown>): void {
  console.error(`[humanizer] ${scope}:`, JSON.stringify(fields));
}

/** Pull the real undici cause out of a wrapped fetch error. */
function extractCause(error: unknown): string {
  if (error instanceof Error && error.cause) {
    const cause = error.cause as { code?: string; message?: string };
    return cause.code ?? cause.message ?? String(error.cause);
  }
  return "";
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = extractCause(error);
  return cause ? `${message} (cause: ${cause})` : message;
}

const RETRYABLE_PATTERN =
  /socket|closed|terminated|other side closed|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|UND_ERR|fetch failed|network/i;

/** Retry a dropped stream or a temporary upstream gateway/availability response. */
function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderHttpError) return [429, 502, 503, 504].includes(error.status) && (error.retryAfterMs === null || error.retryAfterMs <= MAX_RETRY_AFTER_MS);
  if (error instanceof HumanizerError) return false;
  return RETRYABLE_PATTERN.test(describeError(error));
}

function retryDelay(error: unknown): number {
  if (error instanceof ProviderHttpError && error.retryAfterMs !== null) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(RETRY_DELAY_MS, error.retryAfterMs));
  }
  return RETRY_DELAY_MS;
}

/** Map LLM/network failures to a short Persian message for the UI. */
export function formatLlmError(error: unknown): string {
  const message = describeError(error);

  if (/socket|closed|terminated|ECONNRESET|EPIPE|UND_ERR|fetch failed|network|ECONNREFUSED|ENOTFOUND/i.test(message)) {
    return "اتصال به سرور مدل در میانه پاسخ قطع شد. یک بار تلاش مجدد انجام شد اما ناموفق بود — لطفاً دوباره تلاش کنید.";
  }
  if (message.includes("401") || message.includes("403")) {
    return "کلید API نامعتبر است. لطفاً `API_KEY` در `.env.local` را بررسی کنید.";
  }
  if (error instanceof BudgetError) return error.message;
  if (error instanceof ProviderHttpError && error.status === 404) return "مدل انتخاب‌شده یا endpoint سازگار با تنظیمات آن در دسترس نیست؛ تنظیم مدل، پارامترها و محدودیت قیمت را بررسی کنید.";
  if (error instanceof ProviderHttpError && error.status === 402) return "اعتبار قابل استفاده یا سقف هزینه کلید API کافی نیست؛ موجودی حساب و محدودیت همین کلید را بررسی کنید.";
  if (error instanceof ProviderHttpError && error.status === 429) {
    const seconds = Math.ceil((error.retryAfterMs ?? 30_000) / 1000);
    return `سرویس مدل محدودیت درخواست یا سهمیه اعمال کرده است. موجودی حساب این محدودیت را رفع نمی‌کند. حدود ${seconds} ثانیه بعد دوباره امتحان کنید؛ جزئیات محدودیت در گزارش سرور ثبت شده است.`;
  }
  if (error instanceof ProviderHttpError && [502, 503, 504].includes(error.status)) {
    return "سرویس مدل موقتاً شلوغ یا در دسترس نبود. یک بار تلاش مجدد انجام شد؛ لطفاً کمی بعد دوباره امتحان کنید.";
  }
  if (message.includes("empty response")) {
    return "مدل پاسخ خالی برگرداند. لطفاً دوباره تلاش کنید.";
  }

  return "خطا در ارتباط با سرویس مدل. لطفاً دوباره تلاش کنید.";
}

function parseApiErrorBody(detail: string): string | null {
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } };
    return parsed.error?.message?.trim() || null;
  } catch {
    return null;
  }
}

function providerErrorDetails(detail: string, key: string): { provider?: string; upstream?: string } {
  try {
    const parsed = JSON.parse(detail) as { error?: { metadata?: { provider_name?: string; raw?: unknown } } };
    const metadata = parsed.error?.metadata;
    const raw = metadata?.raw;
    let message: unknown;
    if (typeof raw === 'string') {
      try { const value = JSON.parse(raw); message = value?.error?.message ?? value?.message; }
      catch { message = raw; }
    }
    // Only the diagnostic message, never entire provider bodies or request payloads.
    const clean = typeof message === 'string' ? message.split(key).join('[redacted]').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 400) : undefined;
    return { provider: metadata?.provider_name, upstream: clean };
  } catch { return {}; }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

interface StreamResult {
  content: string;
  finishReason: string | null;
}

/** Accumulate streamed content, including a final SSE line without a newline. */
export async function readSseStream(body: ReadableStream<Uint8Array>, onMetadata: (value: UsageMetadata) => void = () => {}, signal?: AbortSignal): Promise<StreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let seenId: string | undefined;
  let buffer = "";
  let content = "";
  let finishReason: string | null = null;
  let completed = false;
  const consume = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") { completed = true; return; }
    let parsed: { id?: string; model?: string; provider?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; completion_tokens_details?: { reasoning_tokens?: number } }; error?: { message?: string; code?: number }; choices?: Array<{ finish_reason?: string | null; delta?: { content?: string } }> };
    try { parsed = JSON.parse(payload); } catch { return; }
    const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
    if ((parsed.id && parsed.id !== seenId) || parsed.usage || parsed.choices?.[0]?.finish_reason) {
      seenId = parsed.id ?? seenId;
      onMetadata({ generationId: parsed.id, model: parsed.model, provider: parsed.provider,
        promptTokens: finite(parsed.usage?.prompt_tokens), completionTokens: finite(parsed.usage?.completion_tokens),
        reasoningTokens: finite(parsed.usage?.completion_tokens_details?.reasoning_tokens), cost: finite(parsed.usage?.cost),
        finishReason: parsed.choices?.[0]?.finish_reason });
    }
    if (parsed.error) throw new ProviderHttpError(parsed.error.code ?? 502, `LLM stream error: ${parsed.error.message ?? "unknown"}`);
    const choice = parsed.choices?.[0];
    if (typeof choice?.delta?.content === "string") content += choice.delta.content;
    if (choice?.finish_reason) finishReason = choice.finish_reason;
  };
  try {
    while (!completed) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) {
        consume(buffer + decoder.decode());
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) consume(line);
    }
    signal?.throwIfAborted();
    if (!completed && !finishReason) throw new Error("network stream terminated before completion");
    return { content, finishReason };
  } finally {
    signal?.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** One streaming attempt. The caller owns its deadline and cancellation signal. */
async function callLlmOnce(
  messages: Array<{ role: "system" | "user"; content: string }>,
  config: LlmConfig,
  options: LlmOptions,
  model: string,
  context: ExecutionContext,
  attempt: number,
): Promise<string> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const startedAt = Date.now();
  context.signal?.throwIfAborted();
  const openRouter = new URL(config.baseUrl).hostname === 'openrouter.ai';
  const capabilities = openRouter ? await modelCapabilities(model, context.signal) : null;
  const sampling = capabilities ? supportedSampling(capabilities, options.temperature, process.env.LLM_REASONING === 'default') : { temperature: options.temperature };
  const maxInput = options.maxInputPrice ?? numericEnv('LLM_MAX_INPUT_PRICE', 1);
  const maxOutput = options.maxOutputPrice ?? numericEnv('LLM_MAX_OUTPUT_PRICE', 5);
  const inputBytes = Buffer.byteLength(JSON.stringify(messages), 'utf8') + 1024;
  if (capabilities) validateModelCapacity(capabilities, inputBytes, options.maxTokens);
  const reservation = (inputBytes * maxInput + options.maxTokens * maxOutput) / 1_000_000;
  const ledgerId = reserveAttempt(context.runId, options.stage ?? 'writing', attempt, model, reservation);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: context.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        ...openRouterHeaders(),
      },
      body: JSON.stringify({
        model, ...sampling, max_tokens: options.maxTokens,
        stream: true, messages,
        ...(openRouter ? {
          provider: { max_price: { prompt: maxInput, completion: maxOutput }, require_parameters: true },
        } : {}),
      }),
    });
    if (!response.ok || !response.body) {
      const detail = (await response.text().catch(() => "")).split(config.apiKey).join("[redacted]").replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
      const apiMessage = parseApiErrorBody(detail);
      const diagnostic = providerErrorDetails(detail, config.apiKey);
      if (diagnostic.provider) recordMetadata(ledgerId, { provider: diagnostic.provider });
      logLlmFailure("http error", { status: response.status, durationMs: Date.now() - startedAt, ...diagnostic });
      throw new ProviderHttpError(
        response.status,
        `LLM API responded ${response.status}: ${(apiMessage ?? detail).slice(0, 300)}`,
        parseRetryAfter(response.headers.get("retry-after")),
        diagnostic.provider,
        /temporarily rate-limited upstream/i.test(diagnostic.upstream ?? ""),
      );
    }
    const { content, finishReason } = await readSseStream(response.body, metadata => recordMetadata(ledgerId, metadata), context.signal);
    if (finishReason === "length") throw new HumanizerError("پاسخ مدل به سقف طول رسید و کامل نشد. لطفاً متن را کوتاه تر کنید.");
    if (!content.trim() && !options.allowEmpty) throw new Error("LLM API returned an empty response");
    // Do not normalize JSON or strip quotes in the transport layer.
    finishAttempt(ledgerId, "completed", Date.now() - startedAt);
    return content.trim();
  } catch (error) {
    finishAttempt(ledgerId, context.signal?.aborted ? "canceled" : "failed", Date.now() - startedAt, error instanceof ProviderHttpError ? error.status : undefined);
    context.signal?.throwIfAborted();
    logLlmFailure("fetch failure", { model, durationMs: Date.now() - startedAt, error: describeError(error) });
    throw error;
  }
}

/** One retry for transient failures or short 429 backoff; never retry cancellation. */
async function callLlm(
  messages: Array<{ role: "system" | "user"; content: string }>,
  config: LlmConfig,
  options: LlmOptions,
  context: ExecutionContext,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    context.signal?.throwIfAborted();
    const model = lastError instanceof ProviderHttpError && lastError.status === 429 && !lastError.upstreamThrottled ? options.model : resolveAttemptModel(config, options.model, attempt, options.useFallback !== false);
    try {
      return await callLlmOnce(messages, config, options, model, context, attempt);
    } catch (error) {
      context.signal?.throwIfAborted();
      lastError = error;
      const willRetry = attempt < MAX_ATTEMPTS && isRetryableProviderError(error);
      const nextModel = error instanceof ProviderHttpError && error.status === 429 && !error.upstreamThrottled
        ? options.model : resolveAttemptModel(config, options.model, attempt + 1, options.useFallback !== false);
      logLlmFailure(willRetry ? "retrying" : "giving up", {
        attempt,
        url: `${config.baseUrl.replace(/\/$/, "")}/chat/completions`,
        model,
        ...(willRetry && nextModel !== model ? { nextModel } : {}),
        error: describeError(error),
      });
      if (!willRetry) break;
      await delay(retryDelay(error), undefined, { signal: context.signal });
    }
  }
  throw lastError;
}

/** Single LLM completion for other pipelines (e.g. category content), with the same retries, ledger and caps. */
export async function generateText(
  messages: Array<{ role: "system" | "user"; content: string }>,
  options: LlmOptions,
  context = createExecutionContext(),
): Promise<string> {
  const config = getLlmConfig();
  if (!config) throw new HumanizerError("پیکربندی مدل ناقص است. API_KEY و LLM_BASE_URL را تنظیم کنید.", 503);
  try {
    return await callLlm(messages, config, options, context);
  } catch (error) {
    context.signal?.throwIfAborted();
    if (error instanceof HumanizerError) throw error;
    throw new HumanizerError(formatLlmError(error), error instanceof ProviderHttpError ? error.status : 502);
  }
}

/** Shared writing loop: generate + optional critic + at most one refine. */
/** Optional per-call model overrides (content pipeline experiments); the web tool never passes them. */
export interface RoleModelOverrides {
  writerModel?: string;
  criticModel?: string;
  refinerModel?: string;
}

export async function rewriteText(
  req: HumanizeRequest,
  onStep?: WritingStepHandler,
  context = createExecutionContext(),
  models: RoleModelOverrides = {},
) {
  const invalid = validateInput(req.text) || validateLengthOptions(req.targetWords, req.wordTolerance);
  if (invalid) throw new HumanizerError(invalid, 400);
  const config = getLlmConfig();
  if (!config) {
    throw new HumanizerError(
      "پیکربندی مدل ناقص است. API_KEY و LLM_BASE_URL را در .env.local وارد کنید.",
      503,
    );
  }
  try {
    return await runWritingLoop(
      req,
      (messages, options) => callLlm(messages, config, options, context),
      {
        writerModel: models.writerModel || config.writerModel,
        criticModel: models.criticModel || config.criticModel,
        refinerModel: models.refinerModel || config.refinerModel,
        onStep,
        combinedReview: process.env.LLM_COMBINED_REVIEW !== "false",
        signal: context.signal,
      },
    );
  } catch (error) {
    context.signal?.throwIfAborted();
    if (error instanceof HumanizerError) throw error;
    throw new HumanizerError(formatLlmError(error), error instanceof ProviderHttpError ? error.status : 502);
  }
}

/**
 * Separate structured call: analyze the rewritten text for E-E-A-T gaps,
 * unsourced claims and placeholders. Best-effort: on failure returns null
 * and the rewrite itself is still delivered with a warning.
 */
export async function analyzeEeat(
  rewritten: string,
  req: HumanizeRequest,
  context = createExecutionContext(),
): Promise<EeatAnalysis | null> {
  const config = getLlmConfig();
  if (!config) return null;

  try {
    const raw = await callLlm(
      [
        { role: "system", content: buildAnalysisSystemPrompt(req) },
        {
          role: "user",
          content: buildAnalysisUserPrompt(req, rewritten),
        },
      ],
      config,
      { temperature: 0.2, maxTokens: 2_048, model: config.criticModel, stage: "analysis" },
      context,
    );
    const parsed = extractJson(raw) as Record<string, unknown>;
    if (!parsed || !['gaps', 'unsourcedClaims', 'placeholders'].every(key => Array.isArray(parsed[key]))) throw new Error('Invalid E-E-A-T schema');
    const analysis = validateEeatAnalysis(parsed);
    analysis.unsourcedClaims = analysis.unsourcedClaims.filter((claim) =>
      rewritten.includes(claim.quote),
    );
    analysis.placeholders = analysis.placeholders.filter((placeholder) =>
      rewritten.includes(placeholder.marker),
    );
    return analysis;
  } catch (error) {
    context.signal?.throwIfAborted();
    console.error(
      "[humanizer] E-E-A-T analysis failed:",
      JSON.stringify({ error: describeError(error) }),
    );
    return null;
  }
}
