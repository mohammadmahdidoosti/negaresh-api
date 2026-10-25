import { lengthAssessment } from './length';
/** Cheap editorial signals. These are review triggers, not semantic proof. */
import { lintRequest, lintToQualityIssues } from "./linter";
import { computeStyleMetrics } from "./stylometry";
import { countWords, splitSentences, transformUnprotected } from "./text";
import { isYmyl } from "./skills/content-types";
import type { HumanizeRequest, LocalScorecard, QualityIssue } from "./types";
import { containsAnchorTerm, isSensitiveIdentifier, convertDigits, extractUrls, extractAutomaticAnchors, extractProtectedSpans, stripEnumeratedSteps, verifyInvariants } from "./validator";

const numberPattern = /[0-9]+(?:[.,٬٫/:\-][0-9]+)*(?:[%٪])?/g;

function numbers(text: string): Set<string> {
  const prose = stripEnumeratedSteps(convertDigits(text));
  return new Set(prose.match(numberPattern) ?? []);
}

function urls(text: string): string[] {
  return extractUrls(text).map((url) =>
    url.replace(/[.!?؟؛)\]]+$/, "").replace(/\/+$/, "").toLowerCase(),
  );
}

function stepLabels(text: string): string[] {
  return [...text.matchAll(/^[ \t]*(?:#{1,6}[ \t]+)?([0-9۰-۹٠-٩]+)[.)][ \t]+/gm)]
    .map((match) => match[1]);
}

function repeatedSentenceOpening(sentences: string[]): string | null {
  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    const words = sentence
      .replace(/^[\s#*\-–—0-9۰-۹٠-٩.)]+/u, "")
      .replace(/[«»"'()[\]{}،؛:!?؟.,]/g, " ")
      .split(/\s+/).filter(Boolean).slice(0, 2);
    if (words.length < 2) continue;
    const key = words.join(" ").toLocaleLowerCase("fa");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const repeated = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return repeated && repeated[1] >= 3 ? repeated[0] : null;
}

function hasTemplateParagraphSymmetry(text: string): boolean {
  const lengths = text.split(/\n{2,}/).map((paragraph) => countWords(paragraph))
    .filter((length) => length >= 12);
  if (lengths.length < 5) return false;
  const mean = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
  const variance = lengths.reduce((sum, length) => sum + (length - mean) ** 2, 0) / lengths.length;
  return mean > 0 && Math.sqrt(variance) / mean < 0.1;
}

const META_INTRO_PATTERN = /(?:در این (?:مقاله|مطلب)|در ادامه|قصد داریم|می خواهیم به|به بررسی .{0,60} می پردازیم|موضوع .{0,50} یکی از|از دیرباز|امروزه[،,])/;
const VAGUE_ATTRIBUTION_PATTERN = /(?:گفته می شود|اعتقاد بر این است|برخی (?:معتقدند|می گویند)|کارشناسان می گویند|پژوهش ها نشان می دهند|تحقیقات نشان می دهد|مطالعات نشان می دهد|طبق بررسی ها|مشخص شده است|روی (?:جعبه|بسته بندی|محصول) (?:درج|نوشته) شده)/g;
const CAUSAL_PATTERN = /(?:زیرا|چون|به دلیل|در نتیجه|بنابراین|باعث|موجب)/;
const CONDITION_PATTERN = /(?:اگر|در صورتی که|به شرط|مگر)/;
const LIMITATION_PATTERN = /(?:خطا|اشتباه|استثنا|محدودیت|هشدار|ریسک|عیب یابی|مشکل)/;
const MEASUREMENT_PATTERN = /(?:[0-9۰-۹٠-٩]+(?:[.,٬٫/:-][0-9۰-۹٠-٩]+)*(?:[%٪])?\s*(?:درجه|ثانیه|دقیقه|ساعت|روز|گرم|کیلوگرم|میلی گرم|لیتر|میلی لیتر|متر|سانتی متر|درصد|واحد|ولت|وات|آمپر|هرتز|نسبت|مرحله|بار))/;

function firstProseBlock(text: string): string {
  return text.split(/\n{2,}/).map((block) => block.trim()).find((block) =>
    block && !/^#{1,6}[ \t]/.test(block) && !/^\|.*\|$/m.test(block)
  ) ?? "";
}

function depthPointCount(text: string): number {
  const kinds = new Set<string>();
  for (const sentence of splitSentences(text)) {
    if (CAUSAL_PATTERN.test(sentence)) kinds.add("causal");
    if (CONDITION_PATTERN.test(sentence)) kinds.add("condition");
    if (LIMITATION_PATTERN.test(sentence)) kinds.add("limitation");
    if (MEASUREMENT_PATTERN.test(sentence)) kinds.add("measurement");
  }
  return kinds.size;
}

function placeholderCount(text: string): number {
  return (text.match(/\[\[(?:مثال واقعی|تجربه نویسنده|نیاز به منبع)\]\]/g) ?? []).length;
}

function hasSymmetricList(text: string): boolean {
  const lines = text.split("\n");
  let run: number[] = [];
  const runs: number[][] = [];
  for (const line of lines) {
    if (/^\s*(?:[-*+]\s+|[0-9۰-۹٠-٩]+[.)]\s+)/.test(line)) {
      run.push(countWords(line.replace(/^\s*(?:[-*+]\s+|[0-9۰-۹٠-٩]+[.)]\s+)/, "")));
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs.some((lengths) => {
    if (lengths.length < 6 || lengths.some((length) => length < 5)) return false;
    const mean = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
    const variance = lengths.reduce((sum, length) => sum + (length - mean) ** 2, 0) / lengths.length;
    return mean > 0 && Math.sqrt(variance) / mean < 0.12;
  });
}

function markdownProblem(text: string, source: string, embedded = false): string | null {
  for (const span of extractProtectedSpans(source)) {
    if (span.kind === "code") text = text.replace(span.value, "");
  }
  if (/```|~~~/.test(text)) return "حصار کد را حذف کن و خود سند Markdown را مستقیم برگردان.";
  const headings = [...text.matchAll(/^\s*(#{1,6})[ \t]+\S.*$/gm)]
    .map((match) => match[1].length);
  if (embedded) {
    // Embedded section: the host page owns the title, so a # heading is the problem, not its absence.
    if (headings.includes(1)) return "این متن بخشی از یک صفحه است و عنوان صفحه جداست؛ عنوان # را حذف کن و فقط ## و ### نگه دار.";
  } else if (text.length >= 600) {
    const h1Count = headings.filter((level) => level === 1).length;
    if (h1Count !== 1 || !headings.includes(2)) {
      return "برای مقاله بلند یک عنوان # و دست کم یک بخش منطقی ## بساز؛ بخش نمایشی نساز.";
    }
  }
  for (let index = 1; index < headings.length; index++) {
    if (headings[index] > headings[index - 1] + 1) {
      return "سطح عنوان های Markdown را نپر؛ زیرعنوان باید سلسله مراتب پیوسته داشته باشد.";
    }
  }
  return null;
}

function hasUnprotectedLongDash(text: string, keywords: readonly string[] = []): boolean {
  let found = false;
  transformUnprotected(text, (part) => {
    found ||= /[—–]/.test(part);
    return part;
  }, keywords);
  return found;
}

export function judgeLocally(req: HumanizeRequest, text: string): LocalScorecard {
  const metrics = computeStyleMetrics(text);
  const issues: QualityIssue[] = [];
  const add = (code: QualityIssue["code"], fix: string) => {
    if (!issues.some((issue) => issue.code === code)) issues.push({ code, fix });
  };

  if (!text.trim()) add("low_effort_mc", "خروجی خالی است؛ متن را با حفظ کامل اصل تولید کن.");
  const validation = verifyInvariants(text, extractAutomaticAnchors(req.text), req.text);
  if (!validation.passed) {
    add("meaning_drift", `داده، جهت عدد یا بخش محافظت‌شده اصل را برگردان: ${validation.missingAnchors.slice(0, 8).join("، ")}`);
  }

  const available = [
    req.text, req.articleGoal ?? "", req.audience ?? "", req.sources ?? "",
    req.notes ?? "", req.authorProfile ?? "", ...(req.keywords ?? []),
  ].join("\n");
  const evidenceContext = [req.text, req.sources ?? "", req.notes ?? ""].join("\n");
  const sourceNumbers = numbers(req.text);
  const allowedNumbers = numbers(available);
  const outputNumbers = numbers(text);
  const missingNumbers = [...sourceNumbers].filter((value) => !outputNumbers.has(value));
  const addedNumbers = [...outputNumbers].filter((value) => !allowedNumbers.has(value));
  const sourceUrls = urls(req.text);
  const allowedUrls = new Set(urls(available));
  const outputUrls = new Set(urls(text));
  const missingUrls = sourceUrls.filter((url) => !outputUrls.has(url));
  const addedUrls = [...outputUrls].filter((url) => !allowedUrls.has(url));
  const sourceLatin = (req.text.match(/[A-Za-z][A-Za-z0-9_-]*/g) ?? []).filter(isSensitiveIdentifier);
  const outputLatin = (text.match(/[A-Za-z][A-Za-z0-9_-]*/g) ?? []).filter(isSensitiveIdentifier);
  const missingTerms = [
    ...(req.keywords ?? []).filter(term => !containsAnchorTerm(text, term)),
    ...sourceLatin.filter(term => !containsAnchorTerm(text, term)),
  ];
  const addedTerms = outputLatin.filter(term => !containsAnchorTerm(available, term));

  if (missingNumbers.length || missingUrls.length || missingTerms.length) {
    add("meaning_drift", `داده های اصل را برگردان؛ موارد حذف یا تغییر یافته: ${[
      ...missingNumbers, ...missingUrls, ...missingTerms,
    ].slice(0, 8).join("، ")}`);
  }
  if (addedNumbers.length || addedUrls.length || addedTerms.length) {
    add("fabricated_detail", `جزئیات بی پشتوانه را حذف یا با جای گذار عوض کن: ${[
      ...addedNumbers, ...addedUrls, ...addedTerms,
    ].slice(0, 8).join("، ")}`);
  }
  const sourceSteps = stepLabels(req.text);
  if (sourceSteps.length >= 2 && JSON.stringify(sourceSteps) !== JSON.stringify(stepLabels(text))) {
    add("meaning_drift", "شناسه و ترتیب قدم های شماره دار را مطابق اصل نگه دار.");
  }

  const wordTarget = lengthAssessment(req, text);
  if (wordTarget && !wordTarget.passed) add("length_target", `متن ${wordTarget.actual} کلمه است؛ با حفظ معنا و بدون جعل یا تکرار به بازه ${wordTarget.min} تا ${wordTarget.max} برسان.`);

  const lengthDelta = req.text.length
    ? Math.round(((text.length - req.text.length) / req.text.length) * 1000) / 1000
    : null;
  if (!req.targetWords && req.text.length >= 400 && lengthDelta !== null && lengthDelta < -0.35) {
    add("low_effort_mc", "بخش زیادی از محتوای اصلی افتاده است؛ نکته های مفید اصل را برگردان.");
  }
  if (!req.targetWords && req.text.length >= 400 && lengthDelta !== null && lengthDelta > 0.4) {
    add("filler", "رشد متن را بررسی کن و جمله های بدون ارزش تازه را حذف کن.");
  }
  const lint = lintRequest(text, req);
  // Density budgeting: under the soft threshold, warn-only fluff stays silent.
  if (lint.blocking || lint.fluffDensity >= 0.05) {
    for (const issue of lintToQualityIssues(lint, req.contentType)) {
      add(issue.code, issue.fix);
    }
  }
  if (lint.needsRefinement && !issues.some((issue) =>
    issue.code === "filler" || issue.code === "intent_delay" || issue.code === "ymyl_overconfident"
  )) {
    add("filler", "تراکم عبارت‌های قالبی از بودجه تحریریه بالاتر است؛ جمله‌های مشخص‌شده را طبیعی بازنویسی کن.");
  }
  if (
    !/[—–]/.test(req.writerSample ?? "")
    && hasUnprotectedLongDash(text, req.keywords)
  ) {
    add("stock_pattern", "خط تیره بلند را با نقطه، ویرگول، دونقطه یا بازنویسی جمله جایگزین کن؛ نمونه نویسنده از آن استفاده نکرده است.");
  }

  const markdownIssue = markdownProblem(text, req.text, req.guards?.embedded === true);
  if (markdownIssue) add("invalid_markdown", markdownIssue);

  const opening = firstProseBlock(text);
  const answerFirst = text.trim().length < 180
    ? "not-assessed" as const
    : META_INTRO_PATTERN.test(opening.slice(0, 320)) ? "delayed" as const : "direct" as const;
  if (answerFirst === "delayed") {
    add("intent_delay", "مقدمه درباره خود مقاله را حذف کن و پاسخ یا اقدام اصلی موجود را در بند نخست بگذار.");
  }

  const vagueAttributionHits = (text.match(VAGUE_ATTRIBUTION_PATTERN) ?? []).length;
  if (vagueAttributionHits > 0) {
    add("vague_attribution", "نسبت دادن مبهم را با فاعل یا منبع موجود دقیق کن؛ در نبود پشتوانه [[نیاز به منبع]] بگذار.");
  }

  const sourceDepthPoints = depthPointCount(req.text);
  const requiredDepthPoints = Math.max(req.text.length, text.length) >= 600
    ? (isYmyl(req.contentType) || req.contentType === "howto" ? 2 : Math.min(2, sourceDepthPoints))
    : 0;
  const groundedDepthPoints = Math.min(depthPointCount(evidenceContext), depthPointCount(text))
    + placeholderCount(text);
  if (groundedDepthPoints < requiredDepthPoints) {
    add("thin_information_gain", `${requiredDepthPoints} نکته فنی یا تحلیلی را فقط از اصل، منبع یا یادداشت واقعی حفظ کن؛ داده تازه نساز.`);
  }

  const symmetricList = req.contentType !== "howto" && hasSymmetricList(text);
  if (symmetricList) {
    add("scaled_template", "فهرست بلند و هم اندازه را بر اساس اهمیت واقعی ادغام یا بازچینش کن؛ داده تازه نساز.");
  }

  const templateHits = (text.match(/(?:^|\n)\s*(?:مقدمه|نتیجه گیری|جمع بندی)\s*(?:$|[:：])/gm) ?? []).length
    + (text.match(/(?:در دنیای امروز|در عصر حاضر|در نهایت[،,])/g) ?? []).length;
  if (templateHits >= 2) {
    add("scaled_template", "مقدمه، پایان و بخش بندی قالبی را حذف کن و نکته اصلی را جلو بیاور.");
  }

  const sentences = splitSentences(text);
  const repeatedOpening = sentences.length >= 6 ? repeatedSentenceOpening(sentences) : null;
  if (repeatedOpening) {
    add("too_smooth", `شروع تکراری «${repeatedOpening}» را در جمله های پیاپی تغییر بده؛ معنا و کلیدواژه ها بماند.`);
  }
  if (hasTemplateParagraphSymmetry(text)) {
    add("scaled_template", "بندهای هم اندازه و قالبی را بر اساس اهمیت واقعی مطالب بازساز؛ اطلاعات تازه نساز.");
  }
  const maxWords = req.contentType === "howto" || req.voice === "roughcut"
    ? { simple: 70, readable: 60, precise: 50, strict: 42 }[req.quality]
    : { simple: 55, readable: 42, precise: 34, strict: 30 }[req.quality];
  if (sentences.some((sentence) => countWords(sentence) > maxWords)) {
    add("too_broken", `جمله های بسیار بلند و دشوار را در مرز معنایی روشن بشکن؛ سقف راهنما ${maxWords} واژه است.`);
  }
  if (metrics.sentenceCount >= 4 && metrics.wordCount >= 60) {
    const baseShortTarget = { simple: 0.15, readable: 0.15, precise: 0.2, strict: 0.25 }[req.quality];
    const shortTarget = req.voice === "roughcut" ? Math.max(0.2, baseShortTarget) : baseShortTarget;
    const baseDeviationTarget = { simple: 3, readable: 4, precise: 5, strict: 6 }[req.quality];
    const deviationTarget = req.voice === "roughcut" ? Math.max(5, baseDeviationTarget) : baseDeviationTarget;
    if (metrics.shortSentenceShare < shortTarget || metrics.stdDevSentenceWords < deviationTarget) {
      add("too_smooth", `شروع و طول جمله ها را متنوع کن و حدود ${shortTarget * 100}٪ جمله کوتاه بساز، بدون افزودن اطلاعات.`);
    }
    const fragmentShare = sentences.filter((sentence) => countWords(sentence) <= 3).length / sentences.length;
    if (fragmentShare > 0.55) {
      add("too_broken", "تکه های بیش از حد کوتاه را به جمله های قابل فهم وصل کن.");
    }
  }

  const hasPlaceholder = /\[\[(?:مثال واقعی|تجربه نویسنده|نیاز به منبع)\]\]/.test(text);
  if (
    isYmyl(req.contentType) && text.length >= 500 && !req.notes?.trim() &&
    !req.authorProfile?.trim() && !hasPlaceholder
  ) {
    add("missing_who_how_why", "نبود اطلاعات نویسنده، روش یا پشتوانه را با جای گذار روشن کن؛ چیزی نساز.");
  }

  if (isYmyl(req.contentType)) {
    const overconfident = /(?:قطعا|حتما|بدون شک|تضمین(?:ی| شده)?|درمان می کند|کاملا بی خطر|هیچ خطری ندارد|سود قطعی|حتماً)/g;
    if (overconfident.test(text) || lint.violations.some((v) => v.category === "false_certainty" && v.severity === "error")) {
      add("ymyl_overconfident", "قطعیت حساس بی پشتوانه را محدود کن؛ هشدار و مرز عدم قطعیت را روشن نگه دار.");
      if (!text.includes("[[نیاز به منبع]]")) {
        add("unsourced_claim", "برای ادعای حساس و قابل بررسی [[نیاز به منبع]] بگذار؛ منبع نساز.");
      }
    }
  }

  const hardCodes = new Set<QualityIssue["code"]>(["meaning_drift", "fabricated_detail"]);
  const empty = !text.trim();
  const softFromLint = lint.needsRefinement && !empty;
  return {
    verdict: empty || issues.some((issue) => hardCodes.has(issue.code))
      ? "hard-fail"
      : issues.length || softFromLint ? "soft-fail" : "pass",
    metrics,
    lengthDelta,
    ...(wordTarget ? { wordTarget } : {}),
    issues,
    typoEstimate: null,
    meaningCheck: "anchors-and-direction",
    lint: {
      fluffDensity: lint.fluffDensity,
      burstiness: lint.burstiness,
      errorWeight: lint.errorWeight,
      warnWeight: lint.warnWeight,
      needsRefinement: lint.needsRefinement,
      blocking: lint.blocking,
      passesBudget: lint.passesBudget,
      violationCount: lint.violations.length,
    },
    editorialSignals: {
      answerFirst,
      vagueAttributionHits,
      groundedDepthPoints,
      requiredDepthPoints,
      symmetricList,
    },
  };
}

export function shouldRunCritic(
  req: HumanizeRequest,
  score: LocalScorecard,
  text: string,
): boolean {
  if (score.lint?.needsRefinement) return true;
  if (score.verdict === "soft-fail") return true;
  const long = Math.max(req.text.length, text.length) > 600;
  if (!long) return false;
  if (isYmyl(req.contentType)) return true;
  if (req.quality === "simple" || req.quality === "readable") return false;
  return req.quality === "precise" || req.quality === "strict";
}
