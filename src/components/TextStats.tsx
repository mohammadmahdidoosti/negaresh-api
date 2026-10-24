/** Live word/character counter with the hard limit indicator. */

"use client";

import { useMounted } from "@/hooks/useMounted";
import { MAX_INPUT_CHARS } from "@/lib/types";
import { countChars, countWords } from "@/lib/text";

interface TextStatsProps {
  text: string;
  /** Highlight the character count against the input limit. */
  showLimit?: boolean;
  /** Show the delta between two texts (used on the output panel). */
  compareWith?: string;
}

export default function TextStats({ text, showLimit = false, compareWith }: TextStatsProps) {
  const mounted = useMounted();
  const formatNumber = (value: number) => (mounted ? value.toLocaleString("fa-IR") : String(value));

  const words = countWords(text);
  const chars = countChars(text);
  const nearLimit = showLimit && chars > MAX_INPUT_CHARS * 0.9;
  const overLimit = showLimit && chars > MAX_INPUT_CHARS;

  let delta: number | null = null;
  if (compareWith !== undefined) {
    const originalWords = countWords(compareWith);
    delta = originalWords > 0 ? Math.round(((words - originalWords) / originalWords) * 100) : 0;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-smoke">
      <span>{formatNumber(words)} واژه</span>
      <span aria-hidden="true">·</span>
      {showLimit ? (
        <span className={overLimit ? "font-medium text-error-ink" : nearLimit ? "font-medium text-crimson" : ""}>
          {formatNumber(chars)} / {formatNumber(MAX_INPUT_CHARS)} کاراکتر
        </span>
      ) : (
        <span>{formatNumber(chars)} کاراکتر</span>
      )}
      {delta !== null && (
        <span className={Math.abs(delta) <= 15 ? "text-graphite" : "text-error-ink"}>
          طول خروجی: {delta > 0 ? "+" : "−"}
          {formatNumber(Math.abs(delta))}٪ نسبت به اصل متن
        </span>
      )}
    </div>
  );
}
