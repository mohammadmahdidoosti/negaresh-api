/**
 * Validation for the public API body. Mirrors the rules of the web route
 * (src/app/api/humanize/route.ts) so both entry points accept the same input.
 */
import { validateLengthOptions } from '@/lib/length';
import { validateInput } from '@/lib/text';
import {
  CONTENT_TYPES,
  MAX_CONTEXT_CHARS,
  MAX_INPUT_CHARS,
  MAX_TOTAL_CONTEXT_CHARS,
  PERSPECTIVES,
  QUALITY_LEVELS,
  VOICES,
  type HumanizeRequest,
} from '@/lib/types';

export type PayloadResult =
  | { ok: true; payload: HumanizeRequest }
  | { ok: false; status: number; code: string; message: string };

const CONTEXT_FIELDS = ['articleGoal', 'audience', 'sources', 'notes', 'authorProfile', 'writerSample'] as const;

function fail(status: number, code: string, message: string): PayloadResult {
  return { ok: false, status, code, message };
}

/** Unlike the web UI, the API rejects unknown option values instead of silently falling back. */
function parseEnum<T extends string>(
  name: string,
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): { value: T } | { error: string } {
  if (value === undefined || value === null || value === '') return { value: fallback };
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return { value: value as T };
  return { error: `مقدار «${name}» نامعتبر است. مقادیر مجاز: ${allowed.join(', ')}` };
}

function parseContext(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function parseHumanizeBody(body: unknown): PayloadResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(400, 'invalid_body', 'بدنهٔ درخواست باید یک شیء JSON باشد.');
  }
  const input = body as Record<string, unknown>;
  const { text, targetWords, wordTolerance } = input;

  if (typeof text !== 'string') return fail(400, 'invalid_text', 'فیلد «text» الزامی است و باید رشته باشد.');
  if (text.length > MAX_INPUT_CHARS * 2) return fail(413, 'text_too_long', 'متن ارسال‌شده بیش از حد مجاز است.');

  const textError = validateInput(text);
  if (textError) return fail(text.trim() ? 413 : 400, text.trim() ? 'text_too_long' : 'empty_text', textError);
  const lengthError = validateLengthOptions(targetWords, wordTolerance);
  if (lengthError) return fail(400, 'invalid_length', lengthError);

  const voice = parseEnum('voice', input.voice, VOICES, 'standard');
  const contentType = parseEnum('contentType', input.contentType, CONTENT_TYPES, 'general');
  const perspective = parseEnum('perspective', input.perspective, PERSPECTIVES, 'third_person');
  const quality = parseEnum('quality', input.quality, QUALITY_LEVELS, 'readable');
  for (const parsed of [voice, contentType, perspective, quality]) {
    if ('error' in parsed) return fail(400, 'invalid_option', parsed.error);
  }

  for (const field of CONTEXT_FIELDS) {
    const value = input[field];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return fail(400, 'invalid_context', `فیلد «${field}» باید رشته باشد.`);
    }
    if (typeof value === 'string' && value.length > MAX_CONTEXT_CHARS) {
      return fail(400, 'context_too_long', `طول «${field}» نباید از ${MAX_CONTEXT_CHARS} نویسه بیشتر باشد.`);
    }
  }
  const context = Object.fromEntries(CONTEXT_FIELDS.map(field => [field, parseContext(input[field])])) as Record<
    (typeof CONTEXT_FIELDS)[number],
    string | undefined
  >;
  const contextTotal = Object.values(context).reduce((sum, value) => sum + (value?.length ?? 0), 0);
  if (contextTotal > MAX_TOTAL_CONTEXT_CHARS) {
    return fail(400, 'context_too_long', `مجموع فیلدهای زمینه نباید از ${MAX_TOTAL_CONTEXT_CHARS} نویسه بیشتر باشد.`);
  }

  let keywords = input.keywords;
  if (typeof keywords === 'string') keywords = keywords.split(/[,،\n]/).filter(term => term.trim());
  if (
    keywords !== undefined &&
    keywords !== null &&
    (!Array.isArray(keywords) ||
      keywords.length > 30 ||
      keywords.some(term => typeof term !== 'string' || !term.trim() || term.length > 120))
  ) {
    return fail(400, 'invalid_keywords', 'حداکثر ۳۰ کلیدواژه، هر کدام بین ۱ تا ۱۲۰ نویسه، مجاز است.');
  }

  const payload: HumanizeRequest = {
    text,
    ...(targetWords !== undefined
      ? { targetWords: targetWords as number, wordTolerance: (wordTolerance as number | undefined) ?? 0.1 }
      : {}),
    voice: (voice as { value: HumanizeRequest['voice'] }).value,
    contentType: (contentType as { value: HumanizeRequest['contentType'] }).value,
    perspective: (perspective as { value: NonNullable<HumanizeRequest['perspective']> }).value,
    quality: (quality as { value: HumanizeRequest['quality'] }).value,
    ...context,
    keywords: (keywords as string[] | undefined | null)?.map(term => term.trim()),
  };
  return { ok: true, payload };
}
