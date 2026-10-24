/** GET /api/v1/options — accepted values and limits for the humanize body. */
import { requireApiKey } from '@/lib/api/auth';
import {
  CONTENT_TYPES,
  MAX_CONTEXT_CHARS,
  MAX_INPUT_CHARS,
  MAX_TARGET_WORDS,
  MAX_TOTAL_CONTEXT_CHARS,
  MIN_TARGET_WORDS,
  PERSPECTIVES,
  QUALITY_LEVELS,
  VOICES,
} from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  return Response.json({
    ok: true,
    fields: {
      text: { required: true, type: 'string', maxChars: MAX_INPUT_CHARS },
      voice: { values: VOICES, default: 'standard' },
      contentType: { values: CONTENT_TYPES, default: 'general' },
      perspective: { values: PERSPECTIVES, default: 'third_person' },
      quality: { values: QUALITY_LEVELS, default: 'readable' },
      targetWords: { type: 'integer', min: MIN_TARGET_WORDS, max: MAX_TARGET_WORDS, optional: true },
      wordTolerance: { type: 'number', min: 0.05, max: 0.25, default: 0.1, requires: 'targetWords' },
      keywords: { type: 'string[] | comma-separated string', maxItems: 30, maxItemChars: 120 },
      articleGoal: { type: 'string', maxChars: MAX_CONTEXT_CHARS },
      audience: { type: 'string', maxChars: MAX_CONTEXT_CHARS },
      sources: { type: 'string', maxChars: MAX_CONTEXT_CHARS },
      notes: { type: 'string', maxChars: MAX_CONTEXT_CHARS },
      authorProfile: { type: 'string', maxChars: MAX_CONTEXT_CHARS },
      writerSample: { type: 'string', maxChars: MAX_CONTEXT_CHARS },
    },
    limits: { maxTotalContextChars: MAX_TOTAL_CONTEXT_CHARS },
  });
}
