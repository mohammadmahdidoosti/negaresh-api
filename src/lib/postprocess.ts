/**
 * Deterministic surface / typography normalizer.
 * Semantic edits belong to the lint → critic → refine loop — not here.
 */
import { normalizePersianText, transformUnprotected } from "./text";
import type { QualityLevel } from "./types";

export interface PostPassResult {
  text: string;
  splits: number;
  /** Count of orthographic / punctuation cleanups applied. */
  surfaceFixes: number;
  /** Always 0 — mechanical cliché slicing was removed. */
  clichesRemoved: number;
}

/** Collapse duplicate punctuation and hanging commas left by edits. */
function sanitizePunctuation(part: string): { text: string; fixes: number } {
  const before = part;
  const text = part
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([،؛,.:!?؟»\)])/g, "$1")
    .replace(/([«\(])[ \t]+/g, "$1")
    .replace(/([،,؛;])\s*\1+/g, "$1")
    // Line-start / line-end comma rules run on the whole text (see stripHangingCommas): inside a
    // fragment between two protected numbers, "^" and "$" would match and delete the separator,
    // turning «۱۲، ۲۰، ۲۵» into «۱۲۲۰۲۵».
    .replace(/[ \t]+[،,؛;]+[ \t]*(?=[.!؟?\n])/g, "")
    .replace(/([.!؟?]){2,}/g, "$1")
    .replace(/\u200c{2,}/g, "\u200c")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return { text, fixes: text === before ? 0 : 1 };
}

/** Leading commas at a real line start, and hanging commas at a real line end. */
function stripHangingCommas(text: string): string {
  return text.replace(/^[ \t]*[،,؛;]+[ \t]*/gm, "").replace(/[ \t]+[،,؛;]+[ \t]*$/gm, "");
}

export function applyPostPass(
  text: string,
  _quality: QualityLevel,
  keywords: readonly string[] = [],
): PostPassResult {
  let surfaceFixes = 0;
  const normalized = normalizePersianText(text, keywords);
  const result = transformUnprotected(normalized, (part) => {
    const { text: cleaned, fixes } = sanitizePunctuation(part);
    surfaceFixes += fixes;
    return cleaned;
  }, keywords);
  return {
    text: normalizePersianText(stripHangingCommas(result), keywords).trim(),
    splits: 0,
    surfaceFixes,
    clichesRemoved: 0,
  };
}
