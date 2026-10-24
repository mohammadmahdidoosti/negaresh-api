import { countWords } from './text';
import { MAX_TARGET_WORDS, MIN_TARGET_WORDS, type HumanizeRequest } from './types';

export function validateLengthOptions(target: unknown, tolerance: unknown): string | null {
  if (target !== undefined && (!Number.isInteger(target) || Number(target) < MIN_TARGET_WORDS || Number(target) > MAX_TARGET_WORDS)) {
    return `تعداد کلمات هدف باید عددی بین ${MIN_TARGET_WORDS} و ${MAX_TARGET_WORDS} باشد.`;
  }
  if (tolerance !== undefined && (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0.05 || tolerance > 0.25)) {
    return 'تلورانس طول باید بین ۵ تا ۲۵ درصد باشد.';
  }
  if (target === undefined && tolerance !== undefined) return 'برای تعیین تلورانس، تعداد کلمات هدف را مشخص کنید.';
  return null;
}

export function lengthAssessment(req: Pick<HumanizeRequest, 'targetWords' | 'wordTolerance'>, text: string) {
  if (req.targetWords === undefined) return null;
  const tolerance = req.wordTolerance ?? 0.1;
  const min = Math.ceil(req.targetWords * (1 - tolerance));
  const max = Math.floor(req.targetWords * (1 + tolerance));
  const actual = countWords(text);
  return { target: req.targetWords, min, max, actual, passed: actual >= min && actual <= max };
}

export function lengthInstruction(req: HumanizeRequest): string {
  const bounds = lengthAssessment(req, '');
  return bounds ? `طول هدف ${bounds.target} کلمه و بازه قابل قبول ${bounds.min} تا ${bounds.max} کلمه است. برای حاشیه امن در شمارش فارسی، بودجه نگارش را ${Math.round((bounds.min + bounds.target) / 2)} کلمه با احتساب عنوان‌ها بگیر. این بازه بر توصیه‌های کلی بسط متن و افزودن عمق مقدم است. نشانه‌های Markdown و نیم‌فاصله کلمه جدا نیستند. پیش از نوشتن، کلمات را میان بخش‌ها تقسیم کن. اگر متن از سقف بلندتر است، آن را کوتاه کن؛ توضیح تازه اضافه نکن. برای پرکردن متن واقعیت یا تجربه نساز و تکرار نکن. اگر منبع کافی نیست، صحت بر طول مقدم است.` : '';
}

export function lengthPlan(req: HumanizeRequest, candidate = req.text) {
  const bounds = lengthAssessment(req, candidate);
  if (!bounds) return undefined;
  const sections = Math.max(1, [...req.text.matchAll(/^##\s/gm)].length);
  const draftingAim = Math.round((bounds.min + bounds.target) / 2);
  return { ...bounds, sourceWords: countWords(req.text), sourceSections: sections,
    draftingAim,
    suggestedWordsPerSection: Math.max(25, Math.floor((draftingAim - 80) / sections)),
    wordsToRemove: Math.max(0, bounds.actual - draftingAim),
    wordsToAdd: Math.max(0, draftingAim - bounds.actual),
    desiredLengthRatio: Number((draftingAim / Math.max(1, bounds.actual)).toFixed(2)),
    action: bounds.actual > bounds.max ? 'shorten' : bounds.actual < bounds.min ? 'expand-only-supported-explanations' : 'preserve-length',
    instruction: 'Use this word budget while retaining source meaning. Do not print the budget or add filler.' };
}

export function outputTokenLimit(req: HumanizeRequest): number {
  // Conservative Persian allowance, calibrated further by the live benchmark's native usage.
  const words = req.targetWords ? Math.ceil(req.targetWords * (1 + (req.wordTolerance ?? .1))) : countWords(req.text);
  return Math.min(32_768, Math.max(2_048, words * 8 + 1_024));
}
