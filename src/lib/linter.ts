/**
 * ESLint-style static heuristic linter for Persian editorial output.
 * Emits structured diagnostics — never mutates text.
 */
import { countWords, splitSentences } from "./text";
import { isYmyl } from "./skills/content-types";
import type {
  ContentType,
  CriticCode,
  HumanizeRequest,
  QualityIssue,
  QualityLevel,
  Voice,
} from "./types";

export type LintCategory =
  | "filler"
  | "bureaucratic_verb"
  | "false_certainty"
  | "structural";

export type LintSeverity = "error" | "warn";

export interface LintContext {
  voice: Voice;
  contentType: ContentType;
  quality: QualityLevel;
}

export interface LintRuleDef {
  id: string;
  category: LintCategory;
  /** Raw pattern source; word-boundary wrapping is applied at compile time. */
  source: string;
  suggestion: string;
  /** null = rule does not apply in this context. */
  severity: (ctx: LintContext) => LintSeverity | null;
}

export interface LintViolation {
  id: string;
  category: LintCategory;
  severity: LintSeverity;
  match: string;
  index: number;
  suggestion: string;
  location: {
    sentenceIndex: number;
    excerpt: string;
  };
}

export interface LintReport {
  violations: LintViolation[];
  fluffDensity: number;
  /** Coefficient of variation of sentence lengths; low values flag monotone AI rhythm. */
  burstiness: number;
  errorWeight: number;
  warnWeight: number;
  sentenceCount: number;
  wordCount: number;
  /** Density below the soft tolerance. */
  passesBudget: boolean;
  /** Blocking errors or density above the refine threshold. */
  needsRefinement: boolean;
  blocking: boolean;
}

/** Soft pass when weighted fluff per sentence (or per ~100 words) stays under this. */
export const FLUFF_PASS_THRESHOLD = 0.05;
/** Trigger a bounded refine when density exceeds this. */
export const FLUFF_REFINE_THRESHOLD = 0.1;
/** Sentence-length CV below this on enough sentences signals monotone output. */
export const LOW_BURSTINESS_THRESHOLD = 0.18;

const WORD = String.raw`[\p{L}\p{N}\u200c]`;

function compilePattern(source: string): RegExp {
  const normalized = source
    .replace(/\u200c/g, "[ \\t\\u200c]?")
    .replace(/\\s\?/g, "[ \\t\\u200c]?")
    .replace(/\\s/g, "[ \\t]");
  return new RegExp(`(?<!${WORD})(?:${normalized})(?!${WORD})`, "gu");
}

/** Temporal / SEO openers — blocking in spoken/howto/readable modes. */
function temporalOpenerSeverity(ctx: LintContext): LintSeverity | null {
  if (
    ctx.voice === "roughcut"
    || ctx.contentType === "howto"
    || ctx.quality === "readable"
    || ctx.quality === "simple"
  ) {
    return "error";
  }
  return "warn";
}

/**
 * Bureaucratic verbs: warn/ignore under formal or strict; blocking under
 * roughcut, howto, or readable-oriented modes.
 */
function bureaucraticSeverity(ctx: LintContext): LintSeverity | null {
  if (ctx.voice === "formal" || ctx.quality === "strict") return "warn";
  if (
    ctx.voice === "roughcut"
    || ctx.contentType === "howto"
    || ctx.quality === "readable"
    || ctx.quality === "simple"
  ) {
    return "error";
  }
  return "warn";
}

/** Absolute certainty is an error on YMYL health/money/legal; warn elsewhere. */
function falseCertaintySeverity(ctx: LintContext): LintSeverity | null {
  if (ctx.contentType === "ymyl_health" || isYmyl(ctx.contentType)) return "error";
  return "warn";
}

function fillerSeverity(): LintSeverity {
  return "warn";
}

/** Rule catalogue — pattern sources only; no destructive replacements. */
export const LINT_RULES: LintRuleDef[] = [
  // Temporal / structural openers
  { id: "temporal-donya-emrooz", category: "structural", source: String.raw`در دنیای امروز[،,]?[ \t]*`, suggestion: "عبارت قالبی را حذف کن و با پاسخ مستقیم به نیت مقاله شروع کن.", severity: temporalOpenerSeverity },
  { id: "temporal-donya-emroozi", category: "structural", source: String.raw`در دنیای امروزی[،,]?[ \t]*`, suggestion: "عبارت قالبی را حذف کن و با پاسخ مستقیم به نیت مقاله شروع کن.", severity: temporalOpenerSeverity },
  { id: "temporal-asr-hazer", category: "structural", source: String.raw`در عصر حاضر[،,]?[ \t]*`, suggestion: "شروع قالبی را با نکته عملی یا ادعای اصلی عوض کن.", severity: temporalOpenerSeverity },
  { id: "temporal-asr-fanavari", category: "structural", source: String.raw`در عصر فناوری[،,]?[ \t]*`, suggestion: "شروع قالبی را با نکته عملی یا ادعای اصلی عوض کن.", severity: temporalOpenerSeverity },
  { id: "temporal-jahan-emrooz", category: "structural", source: String.raw`در جهان امروز[،,]?[ \t]*`, suggestion: "شروع قالبی را با نکته عملی یا ادعای اصلی عوض کن.", severity: temporalOpenerSeverity },
  { id: "temporal-pishraft", category: "structural", source: String.raw`با پیشرفت فناوری[،,]?[ \t]*`, suggestion: "مقدمه فناوری‌محور را حذف کن و مستقیم سراغ موضوع برو.", severity: temporalOpenerSeverity },
  { id: "temporal-gosturesh", category: "structural", source: String.raw`با گسترش فناوری[،,]?[ \t]*`, suggestion: "مقدمه فناوری‌محور را حذف کن و مستقیم سراغ موضوع برو.", severity: temporalOpenerSeverity },

  // Filler / bureaucratic glue
  { id: "filler-hamantor-midanid", category: "filler", source: String.raw`همان\s?طور که می‌دانید[،,]?\s*`, suggestion: "چسب مخاطب‌محور را حذف و جمله را طبیعی بازنویسی کن.", severity: fillerSeverity },
  { id: "filler-hamangune-midanid", category: "filler", source: String.raw`همان\s?گونه که می‌دانید[،,]?\s*`, suggestion: "چسب مخاطب‌محور را حذف و جمله را طبیعی بازنویسی کن.", severity: fillerSeverity },
  { id: "filler-hamantor-moshakhas", category: "filler", source: String.raw`همان\s?طور که مشخص است[،,]?\s*`, suggestion: "عبارت بدیهی‌ساز را حذف کن.", severity: fillerSeverity },
  { id: "filler-lazem-be-zekr", category: "filler", source: String.raw`لازم به ذکر است که\s*`, suggestion: "بدون این چسب اداری، همان مطلب را بگو.", severity: fillerSeverity },
  { id: "filler-lazem-be-zekr-comma", category: "filler", source: String.raw`لازم به ذکر است،\s*`, suggestion: "بدون این چسب اداری، همان مطلب را بگو.", severity: fillerSeverity },
  { id: "filler-shayan-zekr", category: "filler", source: String.raw`شایان ذکر است که\s*`, suggestion: "بدون این چسب اداری، همان مطلب را بگو.", severity: fillerSeverity },
  { id: "filler-goftani", category: "filler", source: String.raw`گفتنی است که\s*`, suggestion: "بدون این چسب اداری، همان مطلب را بگو.", severity: fillerSeverity },
  { id: "filler-goftani-comma", category: "filler", source: String.raw`گفتنی است،\s*`, suggestion: "بدون این چسب اداری، همان مطلب را بگو.", severity: fillerSeverity },
  { id: "filler-noghte-ghabel", category: "filler", source: String.raw`نکته قابل توجه این\s?که\s*`, suggestion: "مستقیم نکته را بیان کن.", severity: fillerSeverity },
  { id: "filler-noghte-ghabel-inke", category: "filler", source: String.raw`نکته قابل توجه اینکه\s*`, suggestion: "مستقیم نکته را بیان کن.", severity: fillerSeverity },
  { id: "filler-noghte-haez", category: "filler", source: String.raw`نکته حائز اهمیت این\s?که\s*`, suggestion: "مستقیم نکته را بیان کن.", severity: fillerSeverity },
  { id: "filler-be-toor-kolli", category: "filler", source: String.raw`به طور کلی[،,]?\s*`, suggestion: "تعمیم مبهم را حذف یا با محدودیت مشخص عوض کن.", severity: fillerSeverity },
  { id: "filler-betoor-kolli", category: "filler", source: String.raw`بطور کلی[،,]?\s*`, suggestion: "تعمیم مبهم را حذف یا با محدودیت مشخص عوض کن.", severity: fillerSeverity },
  { id: "filler-dar-vaghe", category: "filler", source: String.raw`در واقع[،,]?\s*`, suggestion: "اگر ارزش معنایی ندارد حذفش کن.", severity: fillerSeverity },
  { id: "filler-dar-in-rasta", category: "filler", source: String.raw`در این راستا[،,]?\s*`, suggestion: "اتصال قالبی را با پیوند معنایی روشن عوض کن.", severity: fillerSeverity },
  { id: "filler-dar-in-zamine", category: "filler", source: String.raw`در این زمینه[،,]?\s*`, suggestion: "اتصال قالبی را با پیوند معنایی روشن عوض کن.", severity: fillerSeverity },
  { id: "filler-dar-in-mian", category: "filler", source: String.raw`در این میان[،,]?\s*`, suggestion: "اتصال قالبی را با پیوند معنایی روشن عوض کن.", severity: fillerSeverity },
  { id: "filler-be-ebarat", category: "filler", source: String.raw`به عبارت دیگر[،,]?\s*`, suggestion: "اگر بازنویسی لازم نیست، عبارت را حذف کن.", severity: fillerSeverity },
  { id: "filler-az-soye", category: "filler", source: String.raw`از سوی دیگر[،,]?\s*`, suggestion: "تقابل را بدون کلیشه بیان کن.", severity: fillerSeverity },
  { id: "filler-alave", category: "filler", source: String.raw`علاوه بر این[،,]?\s*`, suggestion: "افزودن را بدون کلیشه بیان کن.", severity: fillerSeverity },
  { id: "filler-dar-nahayat", category: "filler", source: String.raw`در نهایت[،,]?[ \t]*`, suggestion: "جمع‌بندی قالبی را حذف و نکته پایانی واقعی را نگه دار.", severity: fillerSeverity },
  { id: "filler-ba-tavajoh", category: "filler", source: String.raw`با توجه به مطالب گفته ?شده[،,]?\s*`, suggestion: "ارجاع قالبی به مطالب بالا را حذف کن.", severity: fillerSeverity },
  { id: "filler-dar-payan", category: "filler", source: String.raw`در پایان باید گفت که\s*`, suggestion: "جمع‌بندی قالبی را حذف کن.", severity: fillerSeverity },
  { id: "filler-dar-payan-natije", category: "filler", source: String.raw`در پایان می‌توان نتیجه گرفت که\s*`, suggestion: "جمع‌بندی قالبی را حذف کن.", severity: fillerSeverity },
  { id: "filler-ghabel-zekr", category: "filler", source: String.raw`قابل ذکر است که`, suggestion: "بدون چسب اداری بنویس.", severity: fillerSeverity },
  { id: "filler-naghshe-besza", category: "filler", source: String.raw`نقش بسزایی\s*`, suggestion: "به «نقش مهمی» یا توصیف مشخص‌تر تبدیل کن.", severity: fillerSeverity },
  { id: "filler-ahamiat-vizhe", category: "filler", source: String.raw`از اهمیت ویژه‌ای برخوردار است`, suggestion: "به «مهم است» یا دلیل مشخص تبدیل کن.", severity: fillerSeverity },
  { id: "filler-ahamiat-bala", category: "filler", source: String.raw`از اهمیت بالایی برخوردار است`, suggestion: "به «بسیار مهم است» یا دلیل مشخص تبدیل کن.", severity: fillerSeverity },
  { id: "filler-in-amr", category: "filler", source: String.raw`این امر موجب می‌شود که\s*`, suggestion: "به پیوند علّی کوتاه مثل «به همین دلیل» تبدیل کن.", severity: fillerSeverity },

  // False certainty
  { id: "certainty-bedoon-shak", category: "false_certainty", source: String.raw`بدون شک[،,]?\s*`, suggestion: "قطعیت را حذف یا با قید احتیاط و [[نیاز به منبع]] جایگزین کن.", severity: falseCertaintySeverity },
  { id: "certainty-bishak", category: "false_certainty", source: String.raw`بی‌شک[،,]?\s*`, suggestion: "قطعیت را حذف یا با قید احتیاط و [[نیاز به منبع]] جایگزین کن.", severity: falseCertaintySeverity },
  { id: "certainty-ghat-an", category: "false_certainty", source: String.raw`قطعا[ًٌ]?\s*`, suggestion: "قطعیت را حذف، ادعا را محدود کن، و در نبود منبع [[نیاز به منبع]] بگذار.", severity: falseCertaintySeverity },
  { id: "certainty-be-jorat", category: "false_certainty", source: String.raw`به جرات می‌توان گفت که\s*`, suggestion: "ادعای قطعی را به گزاره محتاطانه تبدیل کن.", severity: falseCertaintySeverity },
  { id: "certainty-be-jorat-hamza", category: "false_certainty", source: String.raw`به جرأت می‌توان گفت که\s*`, suggestion: "ادعای قطعی را به گزاره محتاطانه تبدیل کن.", severity: falseCertaintySeverity },
  { id: "certainty-be-jorat-short", category: "false_certainty", source: String.raw`به جرات می‌توان گفت\s*`, suggestion: "ادعای قطعی را به گزاره محتاطانه تبدیل کن.", severity: falseCertaintySeverity },

  // Bureaucratic verbs
  { id: "bureau-mibashad", category: "bureaucratic_verb", source: String.raw`می‌باشد`, suggestion: "با «است» یا فعل طبیعی‌تر بازنویسی کن؛ انسجام جمله را حفظ کن.", severity: bureaucraticSeverity },
  { id: "bureau-mibashand", category: "bureaucratic_verb", source: String.raw`می‌باشند`, suggestion: "با «هستند» یا فعل طبیعی‌تر بازنویسی کن.", severity: bureaucraticSeverity },
  { id: "bureau-mibasham", category: "bureaucratic_verb", source: String.raw`می‌باشم`, suggestion: "با «هستم» بازنویسی کن.", severity: bureaucraticSeverity },
  { id: "bureau-mibashim", category: "bureaucratic_verb", source: String.raw`می‌باشیم`, suggestion: "با «هستیم» بازنویسی کن.", severity: bureaucraticSeverity },
  { id: "bureau-mibashid", category: "bureaucratic_verb", source: String.raw`می‌باشید`, suggestion: "با «هستید» بازنویسی کن.", severity: bureaucraticSeverity },
  { id: "bureau-migardad", category: "bureaucratic_verb", source: String.raw`می‌گردد`, suggestion: "با «می‌شود» بازنویسی کن.", severity: bureaucraticSeverity },
  { id: "bureau-migardand", category: "bureaucratic_verb", source: String.raw`می‌گردند`, suggestion: "با «می‌شوند» بازنویسی کن.", severity: bureaucraticSeverity },
  { id: "bureau-minamayad", category: "bureaucratic_verb", source: String.raw`می‌نماید`, suggestion: "با «می‌کند» بازنویسی کن.", severity: bureaucraticSeverity },
  { id: "bureau-minamayand", category: "bureaucratic_verb", source: String.raw`می‌نمایند`, suggestion: "با «می‌کنند» بازنویسی کن.", severity: bureaucraticSeverity },
  { id: "bureau-minamayam", category: "bureaucratic_verb", source: String.raw`می‌نمایم`, suggestion: "با «می‌کنم» بازنویسی کن.", severity: bureaucraticSeverity },
  { id: "bureau-minamayim", category: "bureaucratic_verb", source: String.raw`می‌نماییم`, suggestion: "با «می‌کنیم» بازنویسی کن.", severity: bureaucraticSeverity },
  { id: "bureau-be-anjam", category: "bureaucratic_verb", source: String.raw`به انجام می‌رسد`, suggestion: "با «انجام می‌شود» بازنویسی کن.", severity: bureaucraticSeverity },
  { id: "bureau-morede-estefade", category: "bureaucratic_verb", source: String.raw`مورد استفاده قرار می‌گیرد`, suggestion: "با «استفاده می‌شود» بازنویسی کن.", severity: bureaucraticSeverity },
  { id: "bureau-morede-barrasi", category: "bureaucratic_verb", source: String.raw`مورد بررسی قرار می‌گیرد`, suggestion: "با «بررسی می‌شود» بازنویسی کن.", severity: bureaucraticSeverity },
  { id: "bureau-morede-tavajoh", category: "bureaucratic_verb", source: String.raw`مورد توجه قرار می‌گیرد`, suggestion: "با «دیده می‌شود» یا فعل طبیعی‌تر بازنویسی کن.", severity: bureaucraticSeverity },
  { id: "bureau-mibayest", category: "bureaucratic_verb", source: String.raw`می‌بایست`, suggestion: "با «باید» بازنویسی کن.", severity: bureaucraticSeverity },
];

interface CompiledRule {
  def: LintRuleDef;
  pattern: RegExp;
}

const COMPILED_RULES: CompiledRule[] = LINT_RULES.map((def) => ({
  def,
  pattern: compilePattern(def.source),
}));

function sentenceIndexAt(sentences: string[], absoluteIndex: number, fullText: string): number {
  let cursor = 0;
  for (let i = 0; i < sentences.length; i++) {
    const found = fullText.indexOf(sentences[i], cursor);
    if (found === -1) continue;
    const end = found + sentences[i].length;
    if (absoluteIndex >= found && absoluteIndex < end) return i;
    cursor = end;
  }
  return Math.max(0, sentences.length - 1);
}

function excerptAround(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + matchLength + 24);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function computeBurstiness(lengths: number[]): number {
  if (lengths.length < 2) return 0;
  const mean = lengths.reduce((sum, n) => sum + n, 0) / lengths.length;
  if (mean <= 0) return 0;
  const variance = lengths.reduce((sum, n) => sum + (n - mean) ** 2, 0) / lengths.length;
  return Math.round((Math.sqrt(variance) / mean) * 1000) / 1000;
}

function categoryToCriticCode(category: LintCategory, contentType: ContentType): CriticCode {
  switch (category) {
    case "false_certainty":
      return isYmyl(contentType) ? "ymyl_overconfident" : "filler";
    case "structural":
      return "intent_delay";
    case "bureaucratic_verb":
    case "filler":
    default:
      return "filler";
  }
}

/** Count pattern hits for stylometry (`clicheHits`) without mutating text. */
export function countLintHits(text: string): number {
  let hits = 0;
  for (const { pattern } of COMPILED_RULES) {
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches) hits += matches.length;
  }
  return hits;
}

/** Run all applicable rules and compute density / burstiness budgets. */
export function lintText(text: string, ctx: LintContext): LintReport {
  const sentences = splitSentences(text.replace(/\[\[.*?\]\]/g, ""));
  const lengths = sentences.map((sentence) => countWords(sentence));
  const wordCount = countWords(text);
  const sentenceCount = sentences.length;
  const violations: LintViolation[] = [];
  const seen = new Set<string>();

  for (const { def, pattern } of COMPILED_RULES) {
    const severity = def.severity(ctx);
    if (!severity) continue;
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      const index = match.index ?? 0;
      const key = `${def.id}:${index}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sentenceIndex = sentenceIndexAt(sentences, index, text);
      violations.push({
        id: def.id,
        category: def.category,
        severity,
        match: value.trim(),
        index,
        suggestion: def.suggestion,
        location: {
          sentenceIndex,
          excerpt: excerptAround(text, index, value.length),
        },
      });
    }
  }

  // Monotone rhythm: low sentence-length variance on enough prose.
  const burstiness = computeBurstiness(lengths);
  if (
    sentenceCount >= 4
    && wordCount >= 60
    && burstiness < LOW_BURSTINESS_THRESHOLD
  ) {
    violations.push({
      id: "structural-low-burstiness",
      category: "structural",
      severity: "warn",
      match: "",
      index: 0,
      suggestion: "طول و شروع جمله‌ها را متنوع کن تا ریتم یکنواخت ماشینی شکسته شود؛ داده تازه نساز.",
      location: { sentenceIndex: 0, excerpt: sentences[0]?.slice(0, 80) ?? "" },
    });
  }

  const errorWeight = violations.filter((v) => v.severity === "error").length;
  const warnWeight = violations.filter((v) => v.severity === "warn").length;
  const denominator = sentenceCount || Math.max(1, wordCount / 100);
  const fluffDensity = Math.round(((errorWeight * 2 + warnWeight) / denominator) * 1000) / 1000;
  const blocking = errorWeight > 0;
  const needsRefinement = blocking || fluffDensity > FLUFF_REFINE_THRESHOLD;
  const passesBudget = !blocking && fluffDensity < FLUFF_PASS_THRESHOLD;

  return {
    violations,
    fluffDensity,
    burstiness,
    errorWeight,
    warnWeight,
    sentenceCount,
    wordCount,
    passesBudget,
    needsRefinement,
    blocking,
  };
}

export function lintRequest(text: string, req: Pick<HumanizeRequest, "voice" | "contentType" | "quality">): LintReport {
  return lintText(text, {
    voice: req.voice,
    contentType: req.contentType,
    quality: req.quality,
  });
}

/** Map lint findings into critic-compatible quality issues (capped). */
export function lintToQualityIssues(report: LintReport, contentType: ContentType, limit = 4): QualityIssue[] {
  const ranked = [...report.violations].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    return a.index - b.index;
  });
  const issues: QualityIssue[] = [];
  const usedCodes = new Set<string>();
  for (const violation of ranked) {
    const code = categoryToCriticCode(violation.category, contentType);
    if (usedCodes.has(code) && issues.length >= 2) continue;
    usedCodes.add(code);
    const matchHint = violation.match ? ` («${violation.match}»)` : "";
    const fix = `${violation.suggestion}${matchHint} — محل: ${violation.location.excerpt || "متن"}`;
    if (!issues.some((issue) => issue.code === code && issue.fix === fix)) {
      issues.push({ code, fix: fix.slice(0, 400) });
    }
    if (issues.length >= limit) break;
  }
  return issues;
}

/** Compact payload for critic / refine prompts. */
export function formatLintViolationsForPrompt(report: LintReport, limit = 8) {
  return report.violations
    .filter((v) => v.severity === "error" || report.needsRefinement)
    .slice(0, limit)
    .map((v) => ({
      id: v.id,
      category: v.category,
      severity: v.severity,
      match: v.match,
      location: v.location.excerpt,
      suggestion: v.suggestion,
    }));
}
