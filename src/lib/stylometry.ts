/**
 * Lightweight Persian stylometry — measurable style targets instead of vibes.
 * Pure functions, no LLM. Used for the before/after panel and by the
 * quality gates to decide whether sentence-length variance needs a push.
 */

import { countClicheHits } from "./cliches";
import { countChars, countWords, splitSentences, ZWNJ } from "./text";
import type { StyleMetrics } from "./types";

/** Persian function words (prepositions, conjunctions, auxiliaries, clitics). */
const FUNCTION_WORDS = new Set([
  "و", "در", "به", "از", "که", "را", "با", "برای", "این", "آن", "است", "هست",
  "می", "نیز", "یا", "اما", "اگر", "تا", "بر", "هم", "شد", "شده", "بود",
  "کرد", "کند", "کنیم", "می‌شود", "می‌کند", "باید", "های", "هایی", "هر",
  "چون", "چرا", "چه", "همچنین", "ولی", "پس", "نه", "بین", "روی", "درباره",
]);

/** Words with punctuation stripped — used for token statistics. */
function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) => word.replace(/^[،؛,.:!?«»"()\[\]…-]+|[،؛,.:!?«»"()\[\]…-]+$/g, ""))
    .filter((word) => word.length > 0);
}

/** Compute all style metrics for a Persian text. */
export function computeStyleMetrics(text: string): StyleMetrics {
  const sentences = splitSentences(text.replace(/\[\[.*?\]\]/g, ""));
  const lengths = sentences.map((sentence) => countWords(sentence));

  const sentenceCount = lengths.length;
  const meanSentenceWords =
    sentenceCount > 0
      ? lengths.reduce((sum, length) => sum + length, 0) / sentenceCount
      : 0;
  const variance =
    sentenceCount > 0
      ? lengths.reduce((sum, length) => sum + (length - meanSentenceWords) ** 2, 0) /
        sentenceCount
      : 0;

  const words = tokenize(text);
  const wordCount = countWords(text);
  const uniqueWords = new Set(words).size;
  const functionWords = words.filter((word) => FUNCTION_WORDS.has(word)).length;

  return {
    sentenceCount,
    meanSentenceWords: Math.round(meanSentenceWords * 10) / 10,
    stdDevSentenceWords: Math.round(Math.sqrt(variance) * 10) / 10,
    shortSentenceShare: share(lengths, (length) => length >= 4 && length <= 9),
    long25Share: share(lengths, (length) => length >= 25),
    long41Share: share(lengths, (length) => length >= 41),
    functionWordRatio: words.length > 0 ? round2(functionWords / words.length) : 0,
    typeTokenRatio: words.length > 0 ? round2(uniqueWords / words.length) : 0,
    clicheHits: countClicheHits(text),
    zwnjDensity: text.length > 0 ? round2((text.match(/\u200c/g) ?? []).length / text.length * 1000) : 0,
    wordCount,
    charCount: countChars(text),
  };
}

function share(lengths: number[], predicate: (length: number) => boolean): number {
  if (lengths.length === 0) return 0;
  return round2(lengths.filter(predicate).length / lengths.length);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Re-export so existing imports keep working.
export { splitSentences, ZWNJ };
