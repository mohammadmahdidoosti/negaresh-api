/**
 * Minimal word-level diff (LCS-based) used by the output panel to highlight
 * what changed between the original and the rewritten text.
 */

export type DiffPartType = "same" | "add" | "remove";

export interface DiffPart {
  type: DiffPartType;
  value: string;
}

/** Split text into words (keeping whitespace attached for faithful rendering). */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token.length > 0);
}

/**
 * Compute a word-level diff between `original` and `rewritten`.
 * Uses the LCS dynamic-programming algorithm — fine for inputs up to the
 * 10k-character limit (a few thousand words).
 */
export function diffWords(original: string, rewritten: string): DiffPart[] {
  const a = tokenize(original);
  const b = tokenize(rewritten);

  // LCS length table.
  const m = a.length;
  const n = b.length;
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  // Walk the table and emit diff parts.
  const parts: DiffPart[] = [];
  const push = (type: DiffPartType, value: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.value += value;
    else parts.push({ type, value });
  };

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("remove", a[i]);
      i++;
    } else {
      push("add", b[j]);
      j++;
    }
  }
  while (i < m) push("remove", a[i++]);
  while (j < n) push("add", b[j++]);

  return parts;
}