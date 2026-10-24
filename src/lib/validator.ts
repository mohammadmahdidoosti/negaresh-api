/** Deterministic grounding checks: extract invariant tokens and verify they survive rewriting. */
import type { ValidationReport } from "./types";

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const URL_PATTERN = /https?:\/\/[^\s<>«»"،\[\]]+/gi;
const NUMBER_PATTERN = /[0-9۰-۹٠-٩]+(?:[.,٬٫/:\-][0-9۰-۹٠-٩]+)*(?:[%٪])?/g;
const IDENTIFIER_PATTERN = /[A-Za-z][A-Za-z0-9_-]{2,}/g;
const IDENTIFIER_STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "are", "was", "not", "but",
  "all", "any", "can", "has", "have", "you", "your", "new", "old", "http", "https", "www", "com",
]);

function trimUrl(url: string): string {
  return url.replace(/[.!?؟؛)\]]+$/, "");
}

/** Drop enumerated step markers so list indices are not treated as empirical data. */
export function stripEnumeratedSteps(text: string): string {
  return text.replace(/(?:^|[.\n!?؟])\s*[0-9۰-۹٠-٩]+[.)][ \t]+/g, " ");
}

function uniquePreserve(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

/** Convert Persian/Arabic digits, collapse ZWNJ/whitespace, and strip trailing slashes from URL tokens. */
export function convertDigits(text: string): string {
  return text
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
}

export function normalizePersian(text: string): string {
  return convertDigits(text)
    .replace(/[\u200c\s]+/g, " ")
    .replace(/https?:\/\/[^\s]+/gi, (url) => url.replace(/\/+$/, ""))
    .trim();
}

export function extractUrls(text: string): string[] {
  return (text.match(URL_PATTERN) ?? []).map(trimUrl);
}

export const ANCHOR_REVIEW_WARNING = 'متن آماده است. پیشنهاد می‌کنیم پیش از انتشار، اصطلاحات تخصصی، اسامی خاص و داده‌های متن را یک بار با متن اصلی بررسی کنید.';

export function normalizeEnglishTerm(term: string): string {
  return term.toLowerCase().replace(/ies$/, 'y').replace(/(ches|shes|xes|zes)$/, value => value.slice(0, -2)).replace(/(?<!s|u|i)s$/, '');
}

export function isSensitiveIdentifier(term: string): boolean {
  return /[a-z]/i.test(term) && /[0-9_-]/.test(term);
}

export function containsAnchorTerm(text: string, anchor: string): boolean {
  if (/^[A-Za-z]+$/.test(anchor)) {
    return (text.match(/[A-Za-z]+/g) ?? []).some(term => normalizeEnglishTerm(term) === normalizeEnglishTerm(anchor));
  }
  if (isSensitiveIdentifier(anchor)) {
    return (text.match(/[A-Za-z][A-Za-z0-9_-]*/g) ?? []).some(term => term.toLowerCase() === anchor.toLowerCase());
  }
  if (/^[0-9۰-۹٠-٩]/.test(anchor)) return (text.match(NUMBER_PATTERN) ?? []).some(value => convertDigits(value) === convertDigits(anchor));
  if (/^https?:/.test(anchor)) return extractUrls(text).some(url => url.replace(/\/+$/, '') === anchor.replace(/\/+$/, ''));
  return normalizePersian(text).toLowerCase().includes(normalizePersian(anchor).toLowerCase());
}

export function classifyAnchors(source: string) {
  const anchors = extractAutomaticAnchors(source);
  return { hard: anchors.filter(term => !/^[A-Za-z]+$/.test(term)), soft: anchors.filter(term => /^[A-Za-z]+$/.test(term)) };
}

/** Pull numbers, URLs, and English technical identifiers that must survive rewriting. */
export function extractAutomaticAnchors(sourceText: string): string[] {
  const urls = extractUrls(sourceText);
  const withoutUrls = sourceText.replace(URL_PATTERN, " ");
  const prose = stripEnumeratedSteps(withoutUrls);
  const numbers = prose.match(NUMBER_PATTERN) ?? [];
  const identifiers = (withoutUrls.match(IDENTIFIER_PATTERN) ?? []).filter(
    (token) => !IDENTIFIER_STOPWORDS.has(token.toLowerCase()),
  );
  return uniquePreserve([...urls, ...numbers, ...identifiers]);
}

/** Legacy anchor checks plus source-aware directional and exact-span verification. */
export function verifyInvariants(draft: string, requiredAnchors: string[], sourceText?: string): ValidationReport {
  const missing = requiredAnchors.filter(anchor => !containsAnchorTerm(draft, anchor));
  const softMissingAnchors = missing.filter(anchor => /^[A-Za-z]+$/.test(anchor));
  const hardMissingAnchors = missing.filter(anchor => !/^[A-Za-z]+$/.test(anchor));
  if (sourceText !== undefined) hardMissingAnchors.push(...semanticViolations(sourceText, draft), ...protectedViolations(sourceText, draft));
  const missingAnchors = uniquePreserve([...missing, ...hardMissingAnchors]);
  const total = requiredAnchors.length + (sourceText === undefined ? 0 : extractDirectionalMetrics(sourceText).length + extractProtectedSpans(sourceText).length);
  return { missingAnchors, hardMissingAnchors, softMissingAnchors, passed: hardMissingAnchors.length === 0,
    status: missingAnchors.length ? 'review-recommended' : 'verified',
    score: total ? Math.max(0, (total - missingAnchors.length) / total) : 1 };

}

export interface ProtectedSpan {
  start: number;
  value: string;
  kind: "code" | "inline" | "url" | "ui";
}

/** Prefer outer Markdown spans so nested URLs and code are restored byte-for-byte. */
export function extractProtectedSpans(text: string): ProtectedSpan[] {
  const candidates: ProtectedSpan[] = [];
  const collect = (pattern: RegExp, kind: ProtectedSpan["kind"]) => {
    for (const match of text.matchAll(pattern)) {
      const value = kind === "url" ? trimUrl(match[0]) : match[0];
      candidates.push({ start: match.index, value, kind });
    }
  };
  collect(/^[ \t]{0,3}(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?^[ \t]{0,3}\1[ \t]*(?=\r?$)/gm, "code");
  collect(/^(?:(?: {4}|\t)[^\r\n]*(?:\r?\n|$))+/gm, "code");
  collect(/(`+)(?!`)[^\n]*?\1(?!`)/g, "inline");
  for (const link of text.matchAll(/!?\[[^\]\n]*\]\(/g)) {
    let depth = 1;
    for (let index = link.index + link[0].length; index < text.length && text[index] !== "\n"; index++) {
      if (text[index] === "\\") { index++; continue; }
      if (text[index] === "(") depth++;
      if (text[index] === ")") depth--;
      if (depth === 0) {
        candidates.push({ start: link.index, value: text.slice(link.index, index + 1), kind: "inline" });
        break;
      }
    }
  }
  collect(/\*\*[^\n]+?\*\*|__[^\n]+?__|~~[^\n]+?~~|(?<![\w*])\*[^*\n]+\*(?!\*)|(?<![\w_])_[^_\n]+_(?!\w)/g, "inline");
  collect(URL_PATTERN, "url");
  collect(/\[[A-Za-z][A-Za-z0-9 \t_./:()+>&'!#%@-]*\]|«[A-Za-z][A-Za-z0-9 \t_./:()+>&'!#%@-]*»/g, "ui");
  candidates.sort((a, b) => a.start - b.start || b.value.length - a.value.length);
  const spans: ProtectedSpan[] = [];
  let end = 0;
  for (const span of candidates) {
    if (span.start < end) continue;
    spans.push(span);
    end = span.start + span.value.length;
  }
  return spans;
}

export interface ProtectedText {
  text: string;
  prefix: string;
  spans: Array<ProtectedSpan & { token: string }>;
}

/** Collision-free, request-local placeholders; the source itself is never mutated. */
export function maskProtectedText(text: string, collisionContext = text): ProtectedText {
  let prefix = "PHKEEP";
  while (collisionContext.includes(prefix)) prefix += "X";
  const spans = extractProtectedSpans(text).map((span, index) => ({
    ...span, token: `${prefix}_${index}_END`,
  }));
  let masked = "";
  let cursor = 0;
  for (const span of spans) {
    masked += text.slice(cursor, span.start) + span.token;
    cursor = span.start + span.value.length;
  }
  return { text: masked + text.slice(cursor), prefix, spans };
}

export function restoreProtectedText(text: string, protectedText: ProtectedText): string {
  const values = new Map(protectedText.spans.map((span) => [span.token, span.value]));
  return text.replace(new RegExp(`${protectedText.prefix}_[0-9]+_END`, "g"),
    (token) => values.get(token) ?? token);
}

function protectedViolations(source: string, draft: string): string[] {
  const expected = new Map<string, number>();
  const actual = new Map<string, number>();
  for (const span of extractProtectedSpans(source)) expected.set(span.value, (expected.get(span.value) ?? 0) + 1);
  for (const span of extractProtectedSpans(draft)) actual.set(span.value, (actual.get(span.value) ?? 0) + 1);
  // A bare source URL may become a Markdown link. Count its destination once,
  // while source Markdown remains protected byte-for-byte as an outer span.
  const destinations = draft.replace(/!?\[[^\]\n]*\]\((https?:\/\/[^\s]+?)\)/g, "$1");
  const urls = (destinations.match(URL_PATTERN) ?? []).map(trimUrl);
  for (const span of extractProtectedSpans(source)) {
    if (span.kind === "url") actual.set(span.value, urls.filter(url => url === span.value).length);
  }
  const failures = [...expected].filter(([value, count]) => actual.get(value) !== count)
    .map(([value]) => `بخش محافظت‌شده تغییر کرده، حذف یا تکرار شده: ${value}`);
  const polarities = (text: string, value: string) => extractProtectedSpans(text)
    .filter((span) => span.value === value && (span.kind === "ui" || span.kind === "inline"))
    .map((span) => {
      const before = text.slice(0, span.start).split(/[.\n؛;!?؟،]/).pop() ?? "";
      const after = text.slice(span.start + span.value.length).split(/[.\n؛;!?؟،]/)[0];
      const context = `${before.slice(-80)} ${after.slice(0, 80)}`;
      return /(?:^|[\s(])(?:نزن\S*|نکن\S*|نباید|نمی[\s\u200c]*\S+|نشود|ممنوع|هرگز)(?=\s|[.!؟،؛]|$)|\b(?:not|never|don't|cannot)\b/iu.test(context);
    }).sort();
  for (const [value, count] of expected) {
    if (actual.get(value) === count && JSON.stringify(polarities(source, value)) !== JSON.stringify(polarities(draft, value))) {
      failures.push(`نفی یا منع مرتبط با بخش محافظت‌شده تغییر کرده: ${value}`);
    }
  }
  return failures;
}

type Direction = "decrease" | "increase" | "equal" | "minimum" | "maximum";
export interface DirectionalMetric {
  value: string;
  directions: string[];
}

const DIRECTION_PATTERNS: ReadonlyArray<readonly [Direction, RegExp]> = [
  ["decrease", /کاهش|افت|کم\s+شد\S*|کم\s+می\s+شود|decreas\w*|reduc\w*|drop\w*|fall\w*|fell|declin\w*/giu],
  ["increase", /افزایش|رشد|زیاد\s+شد\S*|زیاد\s+می\s+شود|increas\w*|ris\w*|rose|surge\w*|grew|growth/giu],
  ["equal", /برابر|مساوی|equal\w*/giu],
  ["minimum", /حداقل|حد\s+اقل|دست\s+کم|کمینه|at\s+least|minimum|min\b/giu],
  ["maximum", /حداکثر|حد\s+اکثر|بیشینه|حد\s+بالا|at\s+most|maximum|max\b/giu],
];

/** Bounded clause-local matching, not a claim of full natural-language entailment. */
export function extractDirectionalMetrics(text: string): DirectionalMetric[] {
  let prose = text;
  for (const span of extractProtectedSpans(text).reverse()) {
    if (span.kind === "code" || (span.kind === "inline" && span.value.startsWith("`"))) {
      prose = prose.slice(0, span.start) + span.value.replace(/[^\r\n]/g, " ") + prose.slice(span.start + span.value.length);
    }
  }
  prose = prose.replace(URL_PATTERN, (url) => {
    const value = trimUrl(url);
    return " ".repeat(value.length) + url.slice(value.length);
  });
  prose = convertDigits(prose).replace(/\u200c/g, " ").replace(/٪/g, "%");
  const result: DirectionalMetric[] = [];
  for (const clause of prose.split(/[؛;\n!?؟،]|[.,](?!\d)/u)) {
    const metrics = [...clause.matchAll(/[0-9]+(?:[.,٬٫/:\-][0-9]+)*(?:\s*(?:%|درصد))?/g)]
      .map((match) => ({
        value: match[0].replace(/\s/g, "").replace(/درصد/g, "%"),
        start: match.index,
        end: match.index + match[0].length,
        directions: [] as string[],
      }));
    for (const [direction, pattern] of DIRECTION_PATTERNS) {
      for (const cue of clause.matchAll(pattern)) {
        // Avoid matching a cue inside a longer word (e.g. یافت contains افت).
        if (/[\p{L}\p{N}]/u.test(clause[cue.index - 1] ?? "")
          || /[\p{L}\p{N}]/u.test(clause[cue.index + cue[0].length] ?? "")) continue;
        const end = cue.index + cue[0].length;
        // A temporal/version adjunct identifies context, not the quantity modified by the cue.
        // "حداقل بودجه تعریف شده در نسخه ۱۴۰۳" must not become "minimum year 1403".
        // Direct bounds such as "حداقل نسخه ۱۴۰۳" remain eligible.
        const candidates = metrics.filter(metric => !/(?:در|برای|به)\s+(?:سال|نسخه)\s*$|\bin\s+(?:year\s+|version\s+)?$/iu.test(clause.slice(Math.max(0, metric.start - 32), metric.start)));
        const nearest = candidates.sort((a, b) =>
          Math.max(a.start - end, cue.index - a.end, 0) - Math.max(b.start - end, cue.index - b.end, 0))[0];
        if (!nearest) continue;
        const gap = clause.slice(Math.min(end, nearest.end), Math.max(cue.index, nearest.start));
        if (gap.length > 64 || gap.trim().split(/\s+/).length > 5) continue;
        const tail = clause.slice(end, end + 36);
        const head = clause.slice(Math.max(0, cue.index - 20), cue.index);
        const negated = /^(?:\s+\S+){0,2}\s+(?:نشد\S*|نداشت\S*|نکرد\S*|نیافت\S*|نمی\s*\S+|نیست)(?=\s|$)/u.test(tail)
          || /\b(?:not|never)\s*$/i.test(head);
        nearest.directions.push(`${direction}${negated ? ":negated" : ""}`);
      }
    }
    result.push(...metrics.map(({ value, directions }) => ({ value, directions: [...new Set(directions)].sort() })));
  }
  return result;
}

function semanticViolations(source: string, draft: string): string[] {
  const expected = extractDirectionalMetrics(source);
  const actual = extractDirectionalMetrics(draft);
  const values = new Set(expected.filter((metric) => metric.directions.length).map((metric) => metric.value));
  const signatures = (metrics: DirectionalMetric[], value: string) => metrics.filter((metric) => metric.value === value)
    .map((metric) => metric.directions.join("+")).sort();
  return [...values].filter((value) => JSON.stringify(signatures(expected, value)) !== JSON.stringify(signatures(actual, value)))
    .map((value) => `جهت، شرط یا قطبیت عدد ${value} باید مطابق اصل بماند: ${signatures(expected, value).join("، ")}`);
}
