/**
 * Persian text utilities: counting and validation shared by the API route and UI.
 */

import { MAX_INPUT_CHARS } from "./types";

/** Count lexical words, excluding Markdown markers. Half-space and common affix spacing are equivalent. */
export function countWords(text: string): number {
  const plain = text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[[^\]]*\]\]/g, '')
    .replace(/([\u0600-\u06ff])\u200c(?=[\u0600-\u06ff])/g, '$1')
    .replace(/(^|\s)(ن?می)[ \t]+(?=[\u0600-\u06ff])/g, '$1$2')
    .replace(/([\u0600-\u06ff])[ \t]+(ها(?:یی|ی)?)(?=[\s،.!؟؛:]|$)/g, '$1$2');
  return plain.split(/\s+/u).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
}

/** Split text into sentences on Persian/Latin sentence enders. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/^#{1,6}[ \t]+.*$/gm, "")
    .split(/(?<=[.!؟?…])\s+|\n[ \t]*\n/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** Count characters as the user would see them. */
export function countChars(text: string): number {
  return text.length;
}

export function validateInput(text: string): string | null {
  if (!text.trim()) {
    return "لطفاً متنی برای پردازش وارد کنید.";
  }
  if (text.length > MAX_INPUT_CHARS) {
    return `متن واردشده بیش از حد مجاز است. حداکثر ${MAX_INPUT_CHARS.toLocaleString(
      "fa-IR",
    )} کاراکتر مجاز است (شما ${text.length.toLocaleString("fa-IR")} کاراکتر وارد کرده‌اید).`;
  }
  return null;
}

export const ZWNJ = "\u200c"; // نیم‌فاصله (Zero Width Non-Joiner)

/** Apply edits only outside exact keywords, quoted text, URLs, numbers and Latin terms. */
export function transformUnprotected(
  text: string,
  transform: (part: string) => string,
  keywords: readonly string[] = [],
): string {
  const escaped = keywords.filter(Boolean).sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const patterns = [
    ...escaped,
    String.raw`https?://[^\s<>«»"،]+`,
    String.raw`«[^»\n]+»|"[^"\n]+"`,
    String.raw`[A-Za-z][A-Za-z0-9_@.+:/?#%=&~\-]*`,
    String.raw`[0-9۰-۹٠-٩]+(?:[.,٬٫/:\-][0-9۰-۹٠-٩]+)*(?:[%٪])?`,
  ];
  const protectedPattern = new RegExp(patterns.join("|"), "g");
  let result = "";
  let cursor = 0;
  for (const match of text.matchAll(protectedPattern)) {
    const index = match.index ?? 0;
    result += transform(text.slice(cursor, index)) + match[0];
    cursor = index + match[0].length;
  }
  return result + transform(text.slice(cursor));
}

/** Prefer ordinary spaces; never insert ZWNJ or intentional typing errors. */
export function normalizePersianText(text: string, keywords: readonly string[] = []): string {
  return transformUnprotected(text, (part) => part
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/ة/g, "ه")
    .replace(/\u200c/g, " ")
    .replace(/[ \t]{2,}/g, " "), keywords);
}
