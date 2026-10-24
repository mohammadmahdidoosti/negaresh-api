import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.LLM_USAGE_DB = join(mkdtempSync(join(tmpdir(), "humanizer-test-")), "usage.sqlite");
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tryNative: false,
  alias: { "@": new URL("../src", import.meta.url).pathname },
});
const { runWritingLoop } = await jiti.import("../src/lib/refinement.ts");
const { judgeLocally } = await jiti.import("../src/lib/quality.ts");
const { applyPostPass } = await jiti.import("../src/lib/postprocess.ts");
const { normalizePersianText } = await jiti.import("../src/lib/text.ts");
const { validateCriticResult, validateEeatAnalysis } = await jiti.import("../src/lib/analysis.ts");
const {
  buildGenerationSystemPrompt,
  buildAnalysisSystemPrompt,
  buildAnalysisUserPrompt,
  buildCriticSystemPrompt,
  buildContext,
  buildRefineSystemPrompt,
} = await jiti.import("../src/lib/prompt.ts");
const { getPerspectiveSkill } = await jiti.import("../src/lib/skills/perspective.ts");
const { getLlmConfig, rewriteText } = await jiti.import("../src/lib/humanizer.ts");
const { POST } = await jiti.import("../src/app/api/humanize/route.ts");
const {
  extractAutomaticAnchors,
  extractDirectionalMetrics,
  extractProtectedSpans,
  maskProtectedText,
  restoreProtectedText,
  normalizePersian,
  verifyInvariants,
} = await jiti.import("../src/lib/validator.ts");
const {
  assessPublicationReadiness,
  reconcileAnalysisWithText,
} = await jiti.import("../src/lib/publication.ts");

const short = "این کتاب برای شما مناسب است. آن را با دقت بخوانید.";
const req = (overrides = {}) => ({
  text: short,
  voice: "standard",
  contentType: "general",
  quality: "readable",
  ...overrides,
});
const sentence = (count) => Array(count).fill("واژه").join(" ") + ".";
const flowing = [6, 24, 8, 23, 6, 21].map((count, index) => {
  const openings = ["امروز", "بعد", "کاربر", "اینجا", "نتیجه", "هشدار"];
  return `${openings[index]} ${Array(count - 1).fill("واژه").join(" ")}.`;
}).join(" ");
const longFlowing = `${flowing} ${flowing}`;
const depthNotes = "اگر تنظیم اشتباه باشد، نتیجه قابل اتکا نیست. این محدودیت مهم است زیرا خطا به مرحله بعد منتقل می شود.";
const longStructured = `# راهنمای روشن\n\n${flowing}\n\n## جزئیات اجرا\n\n${flowing}\n\n## خطا و محدودیت\n\n${depthNotes}`;
const stiff = sentence(88);
const neutralLong = `${sentence(100)} ${sentence(100)}`;
const pass = JSON.stringify({ verdict: "pass", issues: [], keep: ["معنا"] });
const refine = (code = "too_smooth") => JSON.stringify({
  verdict: "refine",
  issues: [{ code, fix: "فقط همین شکست را اصلاح کن" }],
  keep: ["معنا و داده ها"],
});
const emptyAnalysis = JSON.stringify({ gaps: [], unsourcedClaims: [], placeholders: [] });

function scripted(responses) {
  const calls = [];
  const llm = async (messages, options) => {
    calls.push({ messages, options });
    assert.ok(calls.length <= responses.length, "Unexpected extra LLM pass");
    const response = responses[calls.length - 1];
    if (response instanceof Error) throw response;
    return response;
  };
  return { llm, calls };
}

function parseSseFrames(body) {
  const frames = [];
  for (const block of body.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    const dataLines = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) continue;
    frames.push({ event, data: JSON.parse(dataLines.join("\n")) });
  }
  return frames;
}

async function readRoute(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return { status: response.status, data: await response.json(), frames: [] };
  }
  const frames = parseSseFrames(await response.text());
  const complete = frames.find((frame) => frame.event === "complete");
  const error = frames.find((frame) => frame.event === "error");
  return { status: response.status, data: complete?.data ?? error?.data ?? null, frames };
}

test("single-flow contract exposes four voices, three perspectives, eight types and four quality stops", async () => {
  const { VOICES, PERSPECTIVES, CONTENT_TYPES, QUALITY_LEVELS } = await jiti.import("../src/lib/types.ts");
  assert.deepEqual([...VOICES], ["formal", "standard", "casual", "roughcut"]);
  assert.deepEqual([...PERSPECTIVES], ["third_person", "first_person_singular", "first_person_plural"]);
  assert.equal(CONTENT_TYPES.length, 8);
  assert.deepEqual([...QUALITY_LEVELS], ["simple", "readable", "precise", "strict"]);
});

test("generation prompt composes Humanizer and E-E-A-T before voice, type and quality", () => {
  const prompt = buildGenerationSystemPrompt(req({ voice: "roughcut", contentType: "howto" }));
  const positions = [
    prompt.indexOf("You are an expert, meticulous Persian editor"),
    prompt.indexOf("Humanizer checklist"),
    prompt.indexOf("E-E-A-T & Practical Trust"),
    prompt.indexOf("Search Intent & Information Gain"),
    prompt.indexOf("Voice Profile: Roughcut"),
    prompt.indexOf("Content Type: Step-by-Step Technical Guide"),
    prompt.indexOf("Quality Tier: Readable"),
    prompt.indexOf("Return ONLY the final transformed Persian Markdown"),
  ];
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.doesNotMatch(prompt, /searchqualityevaluatorguidelines|General Guidelines Overview/);
  assert.match(prompt, /4-step mental review internally/);
  assert.match(prompt, /35\. Real Trade-offs/);
  assert.match(prompt, /Output ONLY the final Persian Markdown document/);
});

test("critic and refine use the same Humanizer checklist with a bounded issue code", () => {
  const critic = buildCriticSystemPrompt(req());
  const refinePrompt = buildRefineSystemPrompt(req());
  assert.match(critic, /Humanizer checklist/);
  assert.match(critic, /stock_pattern/);
  assert.match(critic, /Never suggest adding fabricated facts/);
  assert.match(refinePrompt, /fixing identified Humanizer checklist failures/);
  assert.match(refinePrompt, /em-dash rule/);
});

test("perspective prompts cover singular, plural and the backward-compatible default", () => {
  for (const perspective of ["first_person_singular", "first_person_plural"]) {
    const request = req({ perspective });
    const skill = getPerspectiveSkill(perspective);
    assert.ok(skill.length > 0);
    assert.ok(buildGenerationSystemPrompt(request).includes(skill));
    assert.ok(buildRefineSystemPrompt(request).includes(skill));
    assert.equal(JSON.parse(buildContext(request)).perspective, perspective);
    assert.equal(JSON.parse(buildAnalysisUserPrompt(request, short)).perspective, perspective);
    assert.match(buildCriticSystemPrompt(request), /Flag fabricated personal anecdotes under code 'fabricated_detail'/);
  }
  assert.match(getPerspectiveSkill("first_person_singular"), /FIRST-PERSON PRACTITIONER/);
  assert.match(getPerspectiveSkill("first_person_plural"), /FIRST-PERSON PLURAL TEAM/);
  for (const perspective of [undefined, "third_person"]) {
    assert.equal(getPerspectiveSkill(perspective), "");
    assert.equal(JSON.parse(buildContext(req({ perspective }))).perspective, "third_person");
    for (const build of [buildGenerationSystemPrompt, buildRefineSystemPrompt]) {
      assert.equal(build(req({ perspective })), build(req()));
      assert.doesNotMatch(build(req({ perspective })), /NARRATIVE PERSPECTIVE/);
    }
  }
});

test("first-person singular reaches drafting and repair while preserving extracted anchors", async () => {
  const source = "در Target تنظیمات را بررسی کنید. سپس Confirm را بزنید. تأخیر 15% کم شد. راهنما در https://example.com/help است.";
  const output = "در Target تنظیمات را بررسی کردم. سپس Confirm را زدم. دیدم تأخیر 15% کم شد. راهنما را در https://example.com/help دیدم.";
  const request = req({ text: source, notes: output, quality: "simple", perspective: "first_person_singular" });
  const anchors = extractAutomaticAnchors(source);
  assert.deepEqual(anchors, ["https://example.com/help", "15%", "Target", "Confirm"]);

  for (const draft of [output, output.replace("15%", "")]) {
    const mock = scripted(draft === output ? [output] : [draft, output]);
    const result = await runWritingLoop(request, mock.llm);
    for (const call of mock.calls) {
      assert.ok(call.messages[0].content.includes(getPerspectiveSkill(request.perspective)));
    }
    assert.equal(result.quality.refineRan, draft !== output);
    if (draft !== output) {
      assert.equal(mock.calls[1].options.model, "refiner");
      assert.ok(result.quality.refinedIssueCodes.includes("meaning_drift"));
      assert.match(mock.calls[1].messages[1].content, /15%/);
    }
    assert.equal(result.text, output);
    assert.equal(result.validation.passed, true);
    assert.deepEqual(result.validation.missingAnchors, []);
    assert.deepEqual(extractAutomaticAnchors(result.text), anchors);
  }

  const broken = scripted([output.replace("15%", ""), output.replace("15%", "")]);
  const fallback = await runWritingLoop(request, broken.llm);
  assert.ok(fallback.text);
  assert.equal(fallback.validation.status, 'review-recommended');
});

test("howto + Roughcut + Readable preserves UI labels and forbids invented experience", async () => {
  const source = "در Target مخاطب را انتخاب کنید. بعد Create a new ad را بزنید. پیش از Confirm تنظیمات را بررسی کنید.";
  const output = "اول Target رو انتخاب کنید. بعد Create a new ad رو بزنید. پیش از Confirm هم تنظیمات رو ببینید. دقت کنید.";
  const request = req({ text: source, voice: "roughcut", contentType: "howto", keywords: ["Target", "Create a new ad", "Confirm"] });
  const mock = scripted([output]);
  const result = await runWritingLoop(request, mock.llm);
  const prompt = mock.calls[0].messages[0].content;
  assert.match(prompt, /busy, hands-on practitioner/);
  assert.match(prompt, /authorNotes/);
  assert.match(prompt, /English UI labels, button names/);
  assert.equal(result.text, output);
  assert.equal(result.quality.voice, "roughcut");
});

test("trusted facts and style reference are isolated and only included when filled", () => {
  const empty = JSON.parse(buildContext(req()));
  assert.deepEqual(empty.trustedContext, {});
  assert.equal(empty.styleReference, undefined);
  const filled = JSON.parse(buildContext(req({
    articleGoal: "آموزش ساخت کمپین",
    audience: "مدیر فروشگاه تازه کار",
    sources: "https://example.com/source راهنمای رسمی",
    notes: "تجربه واقعی من",
    authorProfile: "ویراستار محصول",
    writerSample: "من معمولاً کوتاه می نویسم. همین.",
  })));
  assert.equal(filled.trustedContext.articleGoal, "آموزش ساخت کمپین");
  assert.equal(filled.trustedContext.audience, "مدیر فروشگاه تازه کار");
  assert.match(filled.trustedContext.suppliedSources, /example\.com/);
  assert.equal(filled.trustedContext.authorNotes, "تجربه واقعی من");
  assert.equal(filled.trustedContext.authorProfile, "ویراستار محصول");
  assert.equal(filled.trustedContext.writerSample, undefined);
  assert.equal(filled.styleReference.writerSample, "من معمولاً کوتاه می نویسم. همین.");
});

test("writer sample controls style without becoming factual evidence", () => {
  const withoutSample = judgeLocally(req(), "این کتاب — برای شما مناسب است.");
  assert.ok(withoutSample.issues.some((issue) => issue.code === "stock_pattern"));

  const withSample = judgeLocally(
    req({ writerSample: "این همان ریتم من است — کوتاه و روشن." }),
    "این کتاب — برای شما مناسب است.",
  );
  assert.ok(!withSample.issues.some((issue) => issue.code === "stock_pattern"));

  const quoted = judgeLocally(req(), "او گفت «این کتاب — مناسب است» و رفت.");
  assert.ok(!quoted.issues.some((issue) => issue.code === "stock_pattern"));

  const leaked = judgeLocally(
    req({ writerSample: "Acme در سال ۱۴۰۳ منتشر شد." }),
    "این کتاب Acme در سال ۱۴۰۳ مناسب است.",
  );
  assert.ok(leaked.issues.some((issue) => issue.code === "fabricated_detail"));
});

test("YMYL health + Formal + Strict requires caution and zero invented clinic detail", () => {
  const prompt = buildGenerationSystemPrompt(req({ voice: "formal", contentType: "ymyl_health", quality: "strict" }));
  assert.match(prompt, /Voice Profile: Formal/);
  assert.match(prompt, /NEVER invent dosages, clinical outcomes, patient testimonials, physicians, clinics/);
  assert.match(prompt, /\[\[نیاز به منبع\]\]/);
  assert.match(prompt, /Zero intentional typos/);
});

test("Simple local pass uses one writing call", async () => {
  const mock = scripted([short]);
  const result = await runWritingLoop(req({ quality: "simple" }), mock.llm);
  assert.equal(mock.calls.length, 1);
  assert.equal(result.quality.llmCalls, 1);
});

test("local soft failure can run critic and at most one refine", async () => {
  const mock = scripted([stiff, refine("too_broken"), flowing]);
  const result = await runWritingLoop(req({ text: stiff }), mock.llm);
  assert.equal(mock.calls.length, 3);
  assert.equal(result.quality.criticRan, true);
  assert.equal(result.quality.refineRan, true);
  assert.equal(mock.calls[0].options.model, "writer");
  assert.equal(mock.calls[1].options.model, "critic");
  assert.equal(mock.calls[1].options.temperature, 0.1);
  assert.equal(mock.calls[2].options.model, "refiner");
  assert.equal(mock.calls[2].options.temperature, 0.25);
});

test("Precise critiques a passing piece longer than 600 characters", async () => {
  assert.ok(longStructured.length > 600);
  const mock = scripted([longStructured, pass]);
  const result = await runWritingLoop(req({ text: longStructured, quality: "precise", notes: "روش واقعی نویسنده ثبت شده است" }), mock.llm);
  assert.equal(result.quality.initial.verdict, "pass");
  assert.equal(mock.calls.length, 2);
  assert.equal(result.quality.refineRan, false);
});

test("Precise repairs a local soft failure even when the critic gives a generic pass", async () => {
  const overSmooth = `# راهنما\n\n${neutralLong} ${neutralLong}`;
  assert.ok(overSmooth.length > 600);
  const mock = scripted([overSmooth, pass, overSmooth]);
  const result = await runWritingLoop(req({
    text: overSmooth,
    quality: "precise",
    notes: depthNotes,
  }), mock.llm);
  assert.equal(result.quality.initial.verdict, "soft-fail");
  assert.equal(result.quality.criticVerdict, "pass");
  assert.equal(result.quality.refineRan, true);
  assert.equal(mock.calls.length, 3);
  assert.ok(result.quality.refinedIssueCodes.includes("invalid_markdown"));
  assert.ok(result.quality.refinedIssueCodes.length <= 4);
});

test("long YMYL text runs critic even at Simple", async () => {
  const mock = scripted([longFlowing, pass, longFlowing]);
  const result = await runWritingLoop(req({ text: longFlowing, quality: "simple", contentType: "ymyl_health" }), mock.llm);
  assert.equal(result.quality.criticRan, true);
  assert.equal(result.quality.refineRan, true);
  assert.equal(mock.calls.length, 3);
});

test("failed one-time repair returns a draft with review status", async () => {
  const source = "تعداد ۱۲ است.";
  const mock = scripted(["تعداد ۱۳ است.", "تعداد ۱۴ است."]);
  const fallback = await runWritingLoop(req({ text: source, quality: 'simple' }), mock.llm);
  assert.ok(fallback.text);
  assert.equal(fallback.validation.passed, false);
  assert.equal(fallback.quality.humanReviewRequired, true);
  assert.equal(mock.calls.length, 2);
});

test("local scorecard catches meaning drift, fabrication and YMYL certainty", () => {
  const source = "شرکت Acme در سال ۱۴۰۳ تعداد ۱۲ کتاب فروخت. https://example.com/a";
  const score = judgeLocally(req({ text: source, keywords: ["Acme"] }), "شرکت Acme در سال ۱۴۰۴ تعداد ۱۳ کتاب فروخت. https://example.com/b");
  assert.equal(score.verdict, "hard-fail");
  assert.ok(score.issues.some((issue) => issue.code === "meaning_drift"));
  assert.ok(score.issues.some((issue) => issue.code === "fabricated_detail"));
  const ymyl = judgeLocally(req({ text: "این روش حتما درمان می کند.", contentType: "ymyl_health", quality: "strict" }), "این روش حتما درمان می کند.");
  assert.ok(ymyl.issues.some((issue) => issue.code === "ymyl_overconfident"));
  assert.ok(ymyl.issues.some((issue) => issue.code === "unsourced_claim"));
});

test("E-E-A-T does not require a biography for ordinary prose but retains YMYL review", () => {
  const text = "این توضیح برای خواننده مفید است. ".repeat(30);
  const score = judgeLocally(req({ text }), text);
  assert.ok(!score.issues.some((issue) => issue.code === "missing_who_how_why"));
  assert.ok(!score.issues.some((issue) => issue.code === "thin_information_gain"));
  for (const contentType of ["ymyl_health", "ymyl_money", "ymyl_legal_civic"]) {
    const sensitive = judgeLocally(req({ text, contentType }), text);
    assert.ok(sensitive.issues.some((issue) => issue.code === "missing_who_how_why"));
    assert.equal(sensitive.editorialSignals.requiredDepthPoints, 2);
  }
});

test("local scorecard catches repeated openings and symmetric template paragraphs", () => {
  const repeated = [
    "این روش برای شروع مناسب است.", "این روش مرحله دوم را توضیح می دهد.",
    "این روش هشدار اصلی را نگه می دارد.", "این روش نتیجه را روشن می کند.",
    "این روش برای تیم قابل اجرا است.", "این روش پایان کار را نشان می دهد.",
  ].join(" ");
  const repeatedScore = judgeLocally(req({ text: repeated, notes: "روش واقعی ثبت شده" }), repeated);
  assert.ok(repeatedScore.issues.some((issue) => issue.code === "too_smooth" && issue.fix.includes("این روش")));

  const paragraph = "این بند دوازده واژه دارد و یک نکته مشخص را برای خواننده توضیح می دهد.";
  const symmetric = Array(5).fill(paragraph).join("\n\n");
  const symmetricScore = judgeLocally(req({ text: symmetric, notes: "روش واقعی ثبت شده" }), symmetric);
  assert.ok(symmetricScore.issues.some((issue) => issue.code === "scaled_template"));
});

test("long transformed documents require a sound Markdown hierarchy", () => {
  const plain = judgeLocally(req({ text: longFlowing, notes: "روش واقعی ثبت شده" }), longFlowing);
  assert.ok(plain.issues.some((issue) => issue.code === "invalid_markdown"));

  const structured = judgeLocally(
    req({ text: longStructured, notes: "روش واقعی ثبت شده" }),
    longStructured,
  );
  assert.ok(!structured.issues.some((issue) => issue.code === "invalid_markdown"));

  const jumped = judgeLocally(req({ text: "متن کوتاه" }), "# عنوان\n\n### بخش اشتباه\n\nمتن");
  assert.ok(jumped.issues.some((issue) => issue.code === "invalid_markdown"));
});

test("editorial signals catch delayed answers, vague attribution and thin depth", () => {
  const delayedText = `# عنوان\n\nدر این مقاله قصد داریم به بررسی موضوع بپردازیم. ${neutralLong}\n\n## ادامه\n\nگفته می شود خروجی مناسب است.`;
  const delayed = judgeLocally(req({ text: delayedText, contentType: "howto" }), delayedText);
  assert.equal(delayed.editorialSignals.answerFirst, "delayed");
  assert.equal(delayed.editorialSignals.vagueAttributionHits, 1);
  assert.ok(delayed.issues.some((issue) => issue.code === "intent_delay"));
  assert.ok(delayed.issues.some((issue) => issue.code === "vague_attribution"));
  assert.ok(delayed.issues.some((issue) => issue.code === "thin_information_gain"));

  const grounded = judgeLocally(
    req({ text: longStructured, notes: depthNotes }),
    longStructured,
  );
  assert.equal(grounded.editorialSignals.answerFirst, "direct");
  assert.ok(grounded.editorialSignals.groundedDepthPoints >= 2);
  assert.ok(!grounded.issues.some((issue) => issue.code === "thin_information_gain"));
});

test("two explicit human placeholders satisfy missing long-form depth without fabrication", () => {
  const generic = `# راهنمای اولیه\n\n${neutralLong}\n\n## داده مورد نیاز\n\n[[مثال واقعی]]\n\n[[نیاز به منبع]]`;
  const score = judgeLocally(req({ text: generic }), generic);
  assert.equal(score.editorialSignals.groundedDepthPoints, 2);
  assert.ok(!score.issues.some((issue) => issue.code === "thin_information_gain"));
});

test("repeating one condition does not fake two independent depth points", () => {
  const repetitive = `# راهنما\n\n${Array(18).fill("اگر مقدار درست باشد، مرحله بعد را انجام دهید.").join(" ")}`;
  const score = judgeLocally(req({ text: repetitive, contentType: "howto" }), repetitive);
  assert.equal(score.editorialSignals.requiredDepthPoints, 2);
  assert.equal(score.editorialSignals.groundedDepthPoints, 1);
  assert.ok(score.issues.some((issue) => issue.code === "thin_information_gain"));
});

test("local scorecard catches long symmetric bullet farms outside how-to", () => {
  const bullets = Array(6).fill("- این گزینه یک توضیح کوتاه و مشابه دارد").join("\n");
  const score = judgeLocally(req({ text: bullets }), bullets);
  assert.equal(score.editorialSignals.symmetricList, true);
  assert.ok(score.issues.some((issue) => issue.code === "scaled_template"));
});

test("structured analysis validator caps fields and accepts only safe markers", () => {
  const result = validateEeatAnalysis({
    gaps: [{ type: "who", title: "نویسنده", detail: "هویت روشن نیست" }],
    unsourcedClaims: [{ quote: "ادعای مهم", reason: "منبع ندارد" }],
    placeholders: [
      { marker: "[[مثال واقعی]]", label: "مثال", guidance: "نمونه واقعی را اضافه کنید" },
      { marker: "[[داستان ساختگی]]", label: "بد", guidance: "نباید بماند" },
    ],
  });
  assert.equal(result.gaps.length, 1);
  assert.equal(result.unsourcedClaims.length, 1);
  assert.deepEqual(result.placeholders.map((item) => item.marker), ["[[مثال واقعی]]"]);
});

test("editable publication gate clears text-bound flags after a real edit", () => {
  const analysis = {
    gaps: [],
    unsourcedClaims: [{ quote: "این ادعا قطعی است", reason: "منبع ندارد" }],
    placeholders: [{
      marker: "[[نیاز به منبع]]",
      label: "منبع",
      guidance: "منبع واقعی را اضافه کنید",
    }],
  };
  const before = assessPublicationReadiness({
    text: "این ادعا قطعی است [[نیاز به منبع]]",
    analysis,
    writingReviewRequired: false,
  });
  assert.deepEqual(before.blockers, ["unsourced_claim", "unresolved_placeholder"]);

  const edited = "بر اساس گزارش رسمی پیوست، این ادعا تایید شده است.";
  const currentAnalysis = reconcileAnalysisWithText(analysis, edited);
  assert.deepEqual(currentAnalysis.unsourcedClaims, []);
  assert.deepEqual(currentAnalysis.placeholders, []);
  const after = assessPublicationReadiness({
    text: edited,
    analysis: currentAnalysis,
    writingReviewRequired: false,
  });
  assert.equal(after.status, "ready-for-human-review");
  assert.deepEqual(after.blockers, []);
});

test("publication gate keeps non-text E-E-A-T gaps and analysis failure visible", () => {
  const gap = assessPublicationReadiness({
    text: short,
    analysis: {
      gaps: [{ type: "who", title: "نویسنده", detail: "هویت روشن نیست" }],
      unsourcedClaims: [],
      placeholders: [],
    },
    writingReviewRequired: false,
  });
  assert.deepEqual(gap.blockers, ["eeat_gap"]);
  const unavailable = assessPublicationReadiness({
    text: short,
    analysis: null,
    writingReviewRequired: false,
  });
  assert.deepEqual(unavailable.blockers, ["analysis_unavailable"]);
});

test("critic validator accepts only compact quality codes", () => {
  const value = validateCriticResult({ verdict: "refine", issues: [{ code: "filler", fix: "حذفش کن" }], keep: [] });
  assert.equal(value.issues[0].code, "filler");
  const intent = validateCriticResult({ verdict: "refine", issues: [{ code: "intent_delay", fix: "پاسخ را جلو بیاور" }], keep: [] });
  assert.equal(intent.issues[0].code, "intent_delay");
  const stock = validateCriticResult({ verdict: "refine", issues: [{ code: "stock_pattern", fix: "پایان چت باتی را حذف کن" }], keep: [] });
  assert.equal(stock.issues[0].code, "stock_pattern");
  assert.throws(() => validateCriticResult({ verdict: "refine", issues: [{ code: "cliche", fix: "اصلاح" }], keep: [] }));
});

test("spacing cleanup preserves paragraphs, numbers, URLs and exact keywords", () => {
  const source = "می‌شود کتاب‌ها را دید.\n\nمهم‌ترین شرکت‌ها؛ دیجی‌کالا ۱۴۰۳ https://example.com/a";
  const output = applyPostPass(source, "readable", ["دیجی‌کالا"]).text;
  assert.match(output, /می شود کتاب ها/);
  assert.ok(output.includes("\n\n"));
  assert.ok(output.includes("دیجی‌کالا"));
  assert.ok(output.includes("۱۴۰۳ https://example.com/a"));
  assert.equal(normalizePersianText("می شود نمی دانم کتاب ها"), "می شود نمی دانم کتاب ها");
});

test("typography pass does not mechanically delete editorial phrases", () => {
  const source = "در دنیای امروز، Acme مهم است و می‌باشد قابل اتکا.";
  const output = applyPostPass(source, "readable", ["Acme"]).text;
  assert.match(output, /در دنیای امروز/);
  assert.match(output, /می باشد|می‌باشد/);
  assert.ok(output.includes("Acme"));
});

test("diagnostic linter is voice-aware and uses density budgeting", async () => {
  const { lintText } = await jiti.import("../src/lib/linter.ts");
  const stiff = "در دنیای امروز، سرویس Acme از اهمیت بسزایی برخوردار می‌باشد. شایان ذکر است که عدد ۱۲ مهم است.";
  const rough = lintText(stiff, { voice: "roughcut", contentType: "howto", quality: "readable" });
  assert.ok(rough.blocking);
  assert.ok(rough.violations.some((v) => v.category === "bureaucratic_verb" && v.severity === "error"));
  assert.ok(rough.violations.some((v) => v.id.startsWith("temporal-") && v.severity === "error"));

  const formal = lintText(stiff, { voice: "formal", contentType: "general", quality: "strict" });
  assert.ok(formal.violations.some((v) => v.category === "bureaucratic_verb" && v.severity === "warn"));

  const ymyl = lintText("مصرف ویتامین D قطعا فشار خون را درمان می کند.", {
    voice: "formal",
    contentType: "ymyl_health",
    quality: "strict",
  });
  assert.ok(ymyl.blocking);
  assert.ok(ymyl.violations.some((v) => v.category === "false_certainty" && v.severity === "error"));

  const clean = lintText("Target را باز کنید. سپس Confirm را بزنید.", {
    voice: "roughcut",
    contentType: "howto",
    quality: "readable",
  });
  assert.equal(clean.blocking, false);
  assert.ok(clean.passesBudget);
});

test("lint violations are injected into the refine prompt instead of destructive slicing", async () => {
  const source = "در دنیای امروز، سرویس Acme می‌باشد گزینه مناسبی و عدد ۱۲ دارد.";
  const draft = "در دنیای امروز، سرویس Acme می‌باشد گزینه مناسبی و عدد ۱۲ دارد.";
  const fixed = "سرویس Acme گزینه مناسبی است و عدد ۱۲ دارد.";
  const request = req({
    text: source,
    voice: "roughcut",
    contentType: "howto",
    quality: "readable",
    keywords: ["Acme"],
  });
  const mock = scripted([draft, refine("filler"), fixed]);
  const result = await runWritingLoop(request, mock.llm);
  assert.ok(mock.calls.length >= 2);
  const refineCall = mock.calls.find((call) =>
    call.messages.some((message) => message.content.includes("lintViolations"))
  );
  assert.ok(refineCall, "expected lintViolations in critic or refine payload");
  assert.equal(result.clichesRemoved, 0);
  assert.ok(result.text.includes("Acme"));
  assert.ok(result.text.includes("۱۲"));
});

function sse(content, { newline = true, complete = true } = {}) {
  const data = `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: complete ? "stop" : null }] })}`;
  return new Response(newline ? data + "\n\ndata: [DONE]\n\n" : data, { headers: { "Content-Type": "text/event-stream" } });
}

function useProvider(t, responses) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.stream, true);
    calls.push(body);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, "Unexpected provider call");
    return next;
  });
  process.env.API_KEY = "test-key";
  process.env.LLM_BASE_URL = "https://provider.invalid/v1";
  process.env.LLM_MODEL ??= "test-model";
  return calls;
}

test("provider consumes a final SSE line without newline", async (t) => {
  const calls = useProvider(t, [sse(short, { newline: false })]);
  const result = await rewriteText(req());
  assert.equal(result.text, short);
  assert.equal(calls.length, 1);
});

test("one dropped socket gets one transport retry without adding a writing pass", async (t) => {
  const calls = useProvider(t, [new Error("socket closed"), sse(short)]);
  const result = await rewriteText(req());
  assert.equal(calls.length, 2);
  assert.equal(result.quality.llmCalls, 1);
});

test("authentication failures are not retried", async (t) => {
  const calls = useProvider(t, [new Response(JSON.stringify({ error: { message: "invalid key" } }), { status: 401 })]);
  await assert.rejects(rewriteText(req()));
  assert.equal(calls.length, 1);
});

test("one transient provider 503 gets the bounded retry", async (t) => {
  const calls = useProvider(t, [
    new Response(JSON.stringify({ error: { message: "temporarily busy" } }), { status: 503 }),
    sse(short),
  ]);
  const result = await rewriteText(req());
  assert.equal(result.text, short);
  assert.equal(calls.length, 2);
  assert.equal(result.quality.llmCalls, 1);
});

test("configured fallback model is used only for the one transient retry", async (t) => {
  process.env.LLM_MODEL = "primary-model";
  process.env.LLM_FALLBACK_MODEL = "fallback-model";
  t.after(() => {
    delete process.env.LLM_MODEL;
    delete process.env.LLM_FALLBACK_MODEL;
  });
  const calls = useProvider(t, [new Error("socket closed"), sse(short)]);
  const result = await rewriteText(req());
  assert.equal(result.text, short);
  assert.deepEqual(calls.map((call) => call.model), ["primary-model", "fallback-model"]);
  assert.equal(calls.length, 2);
});

test("provider may delay headers and stream chunks without an application timeout", async (t) => {
  process.env.API_KEY = "test-key";
  process.env.LLM_BASE_URL = "https://provider.invalid/v1";
  process.env.LLM_MODEL = "test-model";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls++;
    assert.equal(options.signal, undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: short }, finish_reason: "stop" }] })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }, 10);
      },
    }), { headers: { "Content-Type": "text/event-stream" } });
  });
  const result = await rewriteText(req());
  assert.equal(result.text, short);
  assert.equal(calls, 1);
});

test("partial SSE completion is retried instead of accepted", async (t) => {
  const calls = useProvider(t, [sse(short, { newline: false, complete: false }), sse(short)]);
  const result = await rewriteText(req());
  assert.equal(calls.length, 2);
  assert.equal(result.quality.llmCalls, 1);
});

test("every successful route rewrite performs separate E-E-A-T analysis", async (t) => {
  const analysis = JSON.stringify({
    gaps: [{ type: "who", title: "نویسنده", detail: "هویت روشن نیست" }],
    unsourcedClaims: [], placeholders: [],
  });
  const calls = useProvider(t, [sse(short), sse(analysis)]);
  const response = await POST(new Request("http://localhost/api/humanize", { method: "POST", body: JSON.stringify(req()) }));
  const { data, frames } = await readRoute(response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.ok(frames.some((frame) => frame.event === "step" && frame.data.stage === "drafting"));
  assert.ok(frames.some((frame) => frame.event === "complete"));
  assert.equal(calls.length, 2);
  assert.equal(data.quality.llmCalls, 1);
  assert.equal(data.quality.voice, "standard");
  assert.equal(data.analysis.gaps[0].type, "who");
  assert.equal(data.publication.status, "needs-work");
  assert.ok(data.publication.blockers.includes("eeat_gap"));
  assert.equal(data.validation.passed, true);
  assert.ok(data.lint);
  assert.equal(JSON.parse(calls[1].messages[1].content).rewritten, short);
});

test("analysis failure still returns the rewrite with a warning", async (t) => {
  useProvider(t, [sse(short), new Response("broken", { status: 500 })]);
  const response = await POST(new Request("http://localhost/api/humanize", { method: "POST", body: JSON.stringify(req()) }));
  const { data } = await readRoute(response);
  assert.equal(response.status, 200);
  assert.equal(data.text, short);
  assert.equal(data.analysis, null);
  assert.ok(data.publication.blockers.includes("analysis_unavailable"));
  assert.match(data.warning, /تحلیل E-E-A-T در دسترس نبود/);
});

test("publication gate catches unresolved markers even when analysis misses them", async (t) => {
  const marked = `${short} [[نیاز به منبع]]`;
  useProvider(t, [sse(marked), sse(emptyAnalysis)]);
  const response = await POST(new Request("http://localhost/api/humanize", {
    method: "POST",
    body: JSON.stringify(req()),
  }));
  const { data } = await readRoute(response);
  assert.equal(response.status, 200);
  assert.equal(data.publication.status, "needs-work");
  assert.ok(data.publication.blockers.includes("unresolved_placeholder"));
  assert.equal(data.quality.humanReviewRequired, true);
});

test("route defaults legacy requests to Standard, General and Readable", async (t) => {
  useProvider(t, [sse(short), sse(emptyAnalysis)]);
  const response = await POST(new Request("http://localhost/api/humanize", {
    method: "POST",
    body: JSON.stringify({ text: short, mode: "eeat" }),
  }));
  const { data } = await readRoute(response);
  assert.equal(data.quality.voice, "standard");
  assert.equal(data.quality.contentType, "general");
  assert.equal(data.quality.qualityLevel, "readable");
  assert.equal(data.publication.status, "ready-for-human-review");
  assert.deepEqual(data.publication.blockers, []);
});

test("route rejects oversized keywords before provider calls", async () => {
  const invalid = await POST(new Request("http://localhost/api/humanize", {
    method: "POST",
    body: JSON.stringify(req({ keywords: ["x".repeat(121)] })),
  }));
  assert.equal(invalid.status, 400);
});

for (const perspective of [undefined, null, "invalid", 42, {}, "third_person", "first_person_singular", "first_person_plural"]) {
  test(`route sanitizes perspective ${JSON.stringify(perspective)} for writing and analysis`, async (t) => {
    const calls = useProvider(t, [sse(short), sse(emptyAnalysis)]);
    const response = await POST(new Request("http://localhost/api/humanize", {
      method: "POST",
      body: JSON.stringify(req({ perspective })),
    }));
    const { data, frames } = await readRoute(response);
    assert.ok(frames.some((frame) => frame.event === "complete"));
    assert.equal(data.validation.passed, true);
    assert.equal(calls.length, 2);
    const expected = ["first_person_singular", "first_person_plural"].includes(perspective)
      ? perspective : "third_person";
    assert.equal(JSON.parse(calls[0].messages[1].content).perspective, expected);
    assert.equal(JSON.parse(calls[1].messages[1].content).perspective, expected);
    if (expected === "third_person") {
      assert.doesNotMatch(calls[0].messages[0].content, /NARRATIVE PERSPECTIVE/);
    } else {
      assert.ok(calls[0].messages[0].content.includes(getPerspectiveSkill(expected)));
    }
  });
}

test("route caps writer samples before provider calls", async () => {
  const invalid = await POST(new Request("http://localhost/api/humanize", {
    method: "POST",
    body: JSON.stringify(req({ writerSample: "ن".repeat(6001) })),
  }));
  assert.equal(invalid.status, 400);
});

test("analysis prompt remains distilled and contains no guideline dump", () => {
  const prompt = buildAnalysisSystemPrompt(req());
  assert.doesNotMatch(prompt, /General Guidelines Overview|Page Quality Rating Guideline|searchqualityevaluatorguidelines/);
  assert.match(prompt, /Do NOT rewrite the text/);
  assert.match(prompt, /Pragmatic Tolerance/);
  assert.match(prompt, /فقط شکاف ها و ادعاهای قابل توضیح را گزارش کن/);
});

test("invariant extractor pulls numbers, URLs and English identifiers", () => {
  const anchors = extractAutomaticAnchors(
    "۱. Target را باز کنید و بودجه را روی ۲۰ تنظیم کنید. Confirm را بزنید. https://example.com/help/",
  );
  assert.ok(anchors.includes("https://example.com/help/"));
  assert.ok(anchors.includes("۲۰"));
  assert.ok(anchors.includes("Target"));
  assert.ok(anchors.includes("Confirm"));
  assert.ok(!anchors.includes("https"));
  assert.equal(normalizePersian("سال ۱۴۰۳  و لینک https://example.com/acme/"), "سال 1403 و لینک https://example.com/acme");
});

test("verifyInvariants is resilient to Persian digits, ZWNJ and trailing slashes", () => {
  const draft = "بودجه 20 است و راهنما در https://example.com/help قرار دارد. Target را بزنید.";
  const passed = verifyInvariants(draft, ["۲۰", "https://example.com/help/", "Target"]);
  assert.equal(passed.passed, true);
  assert.equal(passed.score, 1);
  const missing = verifyInvariants("متن بدون داده", ["Acme", "20"]);
  assert.equal(missing.passed, false);
  assert.deepEqual(missing.missingAnchors, ["Acme", "20"]);
  assert.equal(missing.score, 0);
});

test("missing automatic anchors enqueue a meaning_drift repair", async () => {
  const source = "عدد ۱۲ و برند Acme را نگه دارید.";
  const drifted = "عدد سیزده را نگه دارید.";
  const restored = "عدد ۱۲ و برند Acme را نگه دارید.";
  const mock = scripted([drifted, restored]);
  const result = await runWritingLoop(req({ text: source, quality: "simple" }), mock.llm);
  assert.equal(result.quality.refineRan, true);
  assert.ok(result.quality.refinedIssueCodes.includes("meaning_drift"));
  assert.equal(mock.calls[1].options.model, "refiner");
  assert.equal(result.validation.passed, true);
});

test("role-specific models are sent on writer and critic provider calls", async (t) => {
  process.env.LLM_WRITER_MODEL = "writer-model";
  process.env.LLM_CRITIC_MODEL = "critic-model";
  process.env.LLM_REFINER_MODEL = "refiner-model";
  process.env.LLM_FALLBACK_MODEL = "fallback-model";
  t.after(() => {
    delete process.env.LLM_WRITER_MODEL;
    delete process.env.LLM_CRITIC_MODEL;
    delete process.env.LLM_REFINER_MODEL;
    delete process.env.LLM_FALLBACK_MODEL;
  });
  const calls = useProvider(t, [sse(short), sse(emptyAnalysis)]);
  const response = await POST(new Request("http://localhost/api/humanize", {
    method: "POST",
    body: JSON.stringify(req()),
  }));
  const { data } = await readRoute(response);
  assert.equal(data.text, short);
  assert.deepEqual(calls.map((call) => call.model), ["writer-model", "critic-model"]);
  assert.ok(calls.every((call) => call.reasoning === undefined));
});

test("default OpenRouter role mix resolves writer critic refiner and fallback", () => {
  const names = [
    "API_KEY",
    "LLM_BASE_URL",
    "LLM_MODEL",
    "LLM_WRITER_MODEL",
    "LLM_CRITIC_MODEL",
    "LLM_REFINER_MODEL",
    "LLM_FALLBACK_MODEL",
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";
    const config = getLlmConfig();
    assert.ok(config);
    assert.deepEqual(
      {
        writerModel: config.writerModel,
        criticModel: config.criticModel,
        refinerModel: config.refinerModel,
        fallbackModel: config.fallbackModel,
      },
      {
        writerModel: "qwen/qwen3.8-flash",
        criticModel: "openai/gpt-5.6-luna",
        refinerModel: "qwen/qwen3.8-flash",
        fallbackModel: "deepseek/deepseek-v4-flash-0731",
      },
    );
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("general prose preserves available depth without demanding invented depth", () => {
  const generic = `# توضیح\n\n${neutralLong}\n\n## ادامه\n\nمتن روشن است.`;
  const source = `${generic}\n\nاگر تنظیم درست باشد، نتیجه ثبت می شود.`;
  const kept = judgeLocally(req({ text: source }), source);
  assert.equal(kept.editorialSignals.requiredDepthPoints, 1);
  assert.ok(!kept.issues.some((issue) => issue.code === "thin_information_gain"));
  const lost = judgeLocally(req({ text: source }), generic);
  assert.ok(lost.issues.some((issue) => issue.code === "thin_information_gain"));
  const plain = judgeLocally(req({ text: generic }), generic);
  assert.equal(plain.editorialSignals.requiredDepthPoints, 0);
  const tiny = judgeLocally(req({ text: short, contentType: "howto" }), short);
  assert.equal(tiny.editorialSignals.requiredDepthPoints, 0);
});

test("directional metrics preserve Persian and English changes, bounds and negation", () => {
  const cases = [
    ["تأخیر 15% کاهش یافت.", "تأخیر 15% افت داشت.", "تأخیر 15% افزایش یافت."],
    ["کاهش ۱۵٪ ثبت شد.", "افت ۱۵٪ ثبت شد.", "رشد ۱۵٪ ثبت شد."],
    ["Latency dropped by 15%.", "Latency decreased by 15%.", "Latency surged by 15%."],
    ["حداکثر بودجه ۲۰ است.", "حداکثر بودجه ۲۰ است.", "حداقل بودجه ۲۰ است."],
    ["حداقل بودجه ۲۰ است.", "دست کم بودجه ۲۰ است.", "حداکثر بودجه ۲۰ است."],
    ["مقدار برابر ۱۲ است.", "مقدار مساوی ۱۲ است.", "مقدار حداکثر ۱۲ است."],
    ["تأخیر 15% کاهش نیافت.", "تأخیر 15% کاهش نیافت.", "تأخیر 15% کاهش یافت."],
    ["Latency did not drop by 15%.", "Latency did not decrease by 15%.", "Latency dropped by 15%."],
    ["تأخیر 15.5% کاهش یافت.", "تأخیر 15.5% افت داشت.", "تأخیر 15.5% رشد داشت."],
  ];
  for (const [source, valid, flipped] of cases) {
    const anchors = extractAutomaticAnchors(source);
    // Direction matching accepts paraphrases independently of legacy Latin token checks.
    assert.equal(verifyInvariants(valid, [], source).passed, true, valid);
    const report = verifyInvariants(flipped, anchors, source);
    assert.equal(report.passed, false, flipped);
    assert.ok(report.missingAnchors.some((item) => item.includes("قطبیت")), flipped);
    assert.ok(judgeLocally(req({ text: source }), flipped).issues.some((issue) => issue.code === "meaning_drift"));
  }
  assert.deepEqual(extractDirectionalMetrics("تأخیر ۱۵٪ کم شد.")[0].directions, ["decrease"]);
  assert.deepEqual(extractDirectionalMetrics("مقدار ۱۵ ثبت شد.")[0].directions, []);
});

test("metric direction stays attached to its number and clause", () => {
  const source = "تأخیر 15% کاهش یافت و سرعت 20% افزایش یافت.";
  assert.equal(verifyInvariants(source, [], source).passed, true);
  assert.equal(verifyInvariants("تأخیر 15% افزایش یافت و سرعت 20% کاهش یافت.", [], source).passed, false);
  assert.equal(verifyInvariants("تأخیر 15% کاهش یافت. سرعت 15% افزایش یافت.", [], "تأخیر 15% کاهش یافت.").passed, false);
  assert.deepEqual(extractDirectionalMetrics("مقدار 15% ثبت شد. کاهش سرعت گزارش شد.")[0].directions, []);
});

test("protected Markdown, code, URLs and UI labels round-trip exactly", () => {
  const source = 'دستور:\n```js\nconst x = "ك  ي";\n  x += 15;\n```\nسپس `x  +=  1` و **گزینه‌ی اصلی** و _متن مهم_ و [راهنما](https://example.com/A?q=X) و [Create a new ad] را ببینید. https://example.com/B';
  const masked = maskProtectedText(source);
  assert.equal(masked.spans.length, 7);
  assert.ok(!masked.text.includes("const x"));
  assert.ok(!masked.text.includes("https://"));
  assert.equal(restoreProtectedText(masked.text, masked), source);
  assert.equal(verifyInvariants(source, extractAutomaticAnchors(source), source).passed, true);
  for (const [before, after] of [
    ['"ك  ي"', '"ک ی"'], ['`x  +=  1`', '`x += 1`'],
    ["**گزینه‌ی اصلی**", "گزینه‌ی اصلی"], ["[Create a new ad]", "[Create a New Ad]"],
    ["https://example.com/B", "https://example.com/b"],
  ]) {
    assert.equal(verifyInvariants(source.replace(before, after), [], source).passed, false, before);
  }
  assert.equal(verifyInvariants(`${source} [Create a new ad]`, [], source).passed, false);
  const colliding = maskProtectedText("PHKEEP_0_END و [Confirm]");
  assert.notEqual(colliding.prefix, "PHKEEP");
  assert.equal(restoreProtectedText(colliding.text, colliding), "PHKEEP_0_END و [Confirm]");
  assert.equal(extractProtectedSpans('~~~sh\necho  "keep"\n~~~')[0].kind, "code");
  for (const exact of [
    "[راهنما](https://example.com/help(v2))", "[Save & Continue]",
    "    const x =  15;\n    run(x);\n",
  ]) {
    const protectedText = maskProtectedText(exact);
    assert.equal(protectedText.spans[0].value, exact);
    assert.equal(restoreProtectedText(protectedText.text, protectedText), exact);
  }
});

test("protected UI action negation cannot silently reverse", () => {
  const source = "روی [Confirm] نزنید.";
  assert.equal(verifyInvariants(source, [], source).passed, true);
  assert.equal(verifyInvariants("روی [Confirm] بزنید.", [], source).passed, false);
});

test("drafting receives masked source and restores code without typography edits", async () => {
  const source = 'دستور را اجرا کنید.\n```js\nconst x = "ك  ي";\n```\nسپس [Confirm] را بزنید. راهنما: https://example.com/A';
  const result = await runWritingLoop(req({ text: source, quality: "simple" }), async (messages, options) => {
    assert.equal(options.model, "writer");
    const context = JSON.parse(messages[1].content);
    assert.ok(context.protectedContent.length >= 3);
    assert.ok(!context.original.includes("const x"));
    assert.ok(!context.original.includes("https://"));
    assert.match(messages[0].content, /Protected content/);
    return context.original;
  });
  assert.equal(result.text, source);
  assert.equal(result.validation.passed, true);
  assert.equal(result.quality.refineRan, false);
});

test("direction reversal forces one repair and remains visible if unresolved", async () => {
  const source = "تأخیر 15% کاهش یافت.";
  const flipped = "تأخیر 15% افزایش یافت.";
  const request = req({ text: source, quality: "simple" });
  const mock = scripted([flipped, source]);
  const result = await runWritingLoop(request, mock.llm);
  assert.equal(result.text, source);
  assert.equal(result.quality.refineRan, true);
  assert.ok(result.quality.refinedIssueCodes.includes("meaning_drift"));
  assert.match(mock.calls[1].messages[1].content, /قطبیت/);
  const broken = scripted([flipped, flipped]);
  const fallback = await runWritingLoop(request, broken.llm);
  assert.ok(fallback.text);
  assert.equal(fallback.validation.status, 'review-recommended');
});

test("protected span deletion is repaired and unknown placeholders never leak", async () => {
  const source = "روی [Confirm] بزنید.";
  const request = req({ text: source, quality: "simple" });
  const calls = [];
  const result = await runWritingLoop(request, async (messages, options) => {
    calls.push({ messages, options });
    if (options.model === "writer") return "روی Confirm بزنید.";
    assert.equal(options.model, "refiner");
    const original = JSON.parse(messages[1].content.split("\n")[0]).original;
    assert.match(original, /PHKEEP/);
    return original;
  });
  assert.equal(result.text, source);
  assert.equal(calls.length, 2);
  const missing = scripted(["روی Confirm بزنید.", "روی Confirm بزنید."]);
  assert.ok((await runWritingLoop(request, missing.llm)).text);
  const unknown = scripted(["روی PHKEEP_999_END بزنید.", "روی PHKEEP_999_END بزنید."]);
  assert.equal((await runWritingLoop(request, unknown.llm)).text, source);
});

test("first-person prompts require evidence of execution, not merely narrative preference", () => {
  for (const perspective of ["first_person_singular", "first_person_plural"]) {
    const skill = getPerspectiveSkill(perspective);
    assert.match(skill, /no personal experience cues and no authorNotes or authorProfile/);
    assert.match(skill, /keep takeaways objective/i);
    assert.match(skill, /A job title alone does not prove a test occurred/);
    assert.match(skill, /writerSample is only a style reference/);
    const critic = buildCriticSystemPrompt(req({ perspective }));
    assert.match(critic, /newly fabricated biographical claims under 'fabricated_detail'/);
    assert.match(critic, /another person's experience/);
    assert.ok(buildGenerationSystemPrompt(req({ perspective })).includes(skill));
    assert.ok(buildRefineSystemPrompt(req({ perspective })).includes(skill));
  }
});

test("combined review saves final analysis only when the reviewed candidate remains unchanged", async () => {
  const review = JSON.stringify({ ...JSON.parse(pass), analysis: JSON.parse(emptyAnalysis) });
  const mock = scripted([longStructured, review]);
  const result = await runWritingLoop(req({ text: longStructured, quality: 'precise', notes: 'روش واقعی نویسنده ثبت شده است' }), mock.llm,
    { writerModel: 'writer', criticModel: 'critic', refinerModel: 'refiner', combinedReview: true });
  assert.equal(mock.calls.length, 2);
  assert.deepEqual(result.analysis, JSON.parse(emptyAnalysis));
  assert.match(mock.calls[1].messages[0].content, /SAME critic JSON object/);
  const repair = scripted([longStructured, JSON.stringify({ ...JSON.parse(refine()), analysis: JSON.parse(emptyAnalysis) }), longStructured]);
  const changed = await runWritingLoop(req({ text: longStructured, quality: 'precise' }), repair.llm,
    { writerModel: 'writer', criticModel: 'critic', refinerModel: 'refiner', combinedReview: true });
  assert.equal(changed.quality.refineRan, true);
  assert.equal(changed.analysis, null, 'Never reuse findings after a repair');
});

test("invalid combined analysis is not mistaken for a clean review", async () => {
  const mock = scripted([longStructured, JSON.stringify({ ...JSON.parse(pass), analysis: {} })]);
  const result = await runWritingLoop(req({ text: longStructured, quality: 'precise' }), mock.llm,
    { writerModel: 'writer', criticModel: 'critic', refinerModel: 'refiner', combinedReview: true });
  assert.equal(result.analysis, null);
});

test("word counting ignores Markdown and treats common Persian half-space variants consistently", async () => {
  const { countWords } = await jiti.import('../src/lib/text.ts');
  assert.equal(countWords('کتاب‌ها منتشر می‌شوند'), countWords('کتاب ها منتشر می شوند'));
  assert.equal(countWords('# عنوان\n\n**متن** [پیوند](https://example.com/a)\n- مطلب'), 4);
});

test("target validation rejects malformed options before provider spending", async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Must not call provider'); });
  for (const target of [null, '1500', 99, 3001, 1500.5]) {
    const response = await POST(new Request('http://localhost/api/humanize', { method: 'POST', body: JSON.stringify(req({ targetWords: target })) }));
    assert.equal(response.status, 400);
  }
  for (const tolerance of [null, .01, .3, '10']) {
    const response = await POST(new Request('http://localhost/api/humanize', { method: 'POST', body: JSON.stringify(req({ targetWords: 1500, wordTolerance: tolerance })) }));
    assert.equal(response.status, 400);
  }
});

test("target failure receives one repair and remains visible if evidence cannot support expansion", async () => {
  const { lengthAssessment } = await jiti.import('../src/lib/length.ts');
  const request = req({ text: short, targetWords: 1500, wordTolerance: .1, quality: 'readable' });
  const mock = scripted([short, pass, short]);
  const result = await runWritingLoop(request, mock.llm);
  assert.equal(result.quality.refineRan, true);
  assert.equal(result.quality.humanReviewRequired, true);
  assert.equal(result.quality.final.wordTarget.passed, false);
  assert.ok(result.quality.warnings.some(value => value.includes('طول نهایی')));
  assert.deepEqual({ min: lengthAssessment(request, '').min, max: lengthAssessment(request, '').max }, { min: 1350, max: 1650 });
  assert.match(mock.calls[2].messages[0].content, /1350.*1650/);
});

test("bounded body reading rejects actual bytes even without content-length", async () => {
  const { readBoundedJson } = await jiti.import('../src/lib/request-body.ts');
  const { MAX_BODY_BYTES } = await jiti.import('../src/lib/types.ts');
  const request = new Request('http://localhost/api/humanize', { method: 'POST', body: JSON.stringify({ text: 'ن'.repeat(MAX_BODY_BYTES) }) });
  await assert.rejects(readBoundedJson(request), error => error.status === 413);
  const { validateInput } = await jiti.import('../src/lib/text.ts');
  assert.equal(validateInput('ن'.repeat(20_000)), null);
  assert.ok(validateInput('ن'.repeat(40_001)));
});

test("aggregate context cap rejects individually legal fields", async () => {
  const response = await POST(new Request('http://localhost/api/humanize', { method: 'POST', body: JSON.stringify(req({
    articleGoal: 'ن'.repeat(6000), audience: 'ن'.repeat(6000), sources: 'ن'.repeat(6000), notes: 'ن',
  })) }));
  assert.equal(response.status, 400);
});

test("429 retries once on the same model and respects a long Retry-After by stopping", async (t) => {
  const calls = useProvider(t, [new Response('{}', { status: 429, headers: { 'Retry-After': '0' } }), sse(short)]);
  await rewriteText(req());
  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, calls[1].model);
  t.mock.restoreAll();
  const deferred = useProvider(t, [new Response('{}', { status: 429, headers: { 'Retry-After': '120' } })]);
  await assert.rejects(rewriteText(req()), error => error.status === 429 && error.message.includes('120'));
  assert.equal(deferred.length, 1);
});

test("SSE final usage is durable and not exposed in rewritten content", async (t) => {
  const { createExecutionContext } = await jiti.import('../src/lib/humanizer.ts');
  const { usageSummary } = await jiti.import('../src/lib/usage-ledger.ts');
  const stream = `data: ${JSON.stringify({ id: 'gen-accounting-test', model: 'actual-model', choices: [{ delta: { content: short }, finish_reason: 'stop' }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 40, cost: .001, completion_tokens_details: { reasoning_tokens: 7 } } })}\n\ndata: [DONE]\n\n`;
  useProvider(t, [new Response(stream)]);
  const context = createExecutionContext();
  const result = await rewriteText(req(), undefined, context);
  const usage = usageSummary(context.runId);
  assert.equal(usage.knownCostUsd, .001);
  assert.equal(usage.reasoningTokens, 7);
  assert.equal(usage.unsettledAttempts, 0);
  assert.doesNotMatch(JSON.stringify(result), /gen-accounting-test|costUsd|actual-model/);
});

test("private ledger keeps uncertain costs reserved and enforces an optional cumulative budget", async () => {
  const { reserveAttempt, recordMetadata, finishAttempt, usageSummary } = await jiti.import('../src/lib/usage-ledger.ts');
  const previous = process.env.LLM_USAGE_DB;
  process.env.LLM_USAGE_DB = join(mkdtempSync(join(tmpdir(), 'humanizer-budget-')), 'usage.sqlite');
  process.env.LLM_BUDGET_USD = '.10';
  try {
    const id = reserveAttempt('budget-run', 'draft', 1, 'model', .08);
    finishAttempt(id, 'failed', 100);
    assert.throws(() => reserveAttempt('other', 'draft', 1, 'model', .03));
    assert.equal(usageSummary().unsettledReserveUsd, .08);
    recordMetadata(id, { cost: .02, generationId: 'generation-to-reconcile' });
    const next = reserveAttempt('budget-run', 'draft', 2, 'model', .07);
    finishAttempt(next, 'failed', 100, 429);
    assert.equal(usageSummary().knownCostUsd, .02);
    assert.equal(usageSummary().unsettledReserveUsd, 0);
  } finally {
    process.env.LLM_USAGE_DB = previous;
    delete process.env.LLM_BUDGET_USD;
  }
});

test("canceling upstream reading terminates promptly without a retry", async (t) => {
  const { createExecutionContext } = await jiti.import('../src/lib/humanizer.ts');
  let canceled = false;
  const body = new ReadableStream({ cancel() { canceled = true; } });
  const calls = useProvider(t, [new Response(body)]);
  const controller = new AbortController();
  const result = rewriteText(req(), undefined, createExecutionContext(controller.signal));
  setTimeout(() => controller.abort(new DOMException('Canceled', 'AbortError')), 20);
  await assert.rejects(result, error => error.name === 'AbortError');
  assert.equal(calls.length, 1);
  assert.equal(canceled, true);
});

test("canceling the route response aborts the provider request and emits no late frames", async (t) => {
  let providerSignal;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    providerSignal = options.signal;
    started();
    return new Response(new ReadableStream());
  });
  const response = await POST(new Request('http://localhost/api/humanize', { method: 'POST', body: JSON.stringify(req()) }));
  await ready;
  await response.body.cancel();
  assert.equal(providerSignal.aborted, true);
});

test("sampling parameters follow model capabilities instead of excluding Luna endpoints", async () => {
  const { supportedSampling } = await jiti.import('../src/lib/openrouter.ts');
  const luna = supportedSampling({ id: 'luna', supported_parameters: ['reasoning', 'max_tokens'], reasoning: { mandatory: false } }, .1);
  assert.deepEqual(luna, { reasoning: { enabled: false } });
  const writer = supportedSampling({ id: 'qwen', supported_parameters: ['temperature', 'reasoning'] }, .7);
  assert.deepEqual(writer, { temperature: .7, reasoning: { enabled: false } });
  const mandatory = supportedSampling({ id: 'mandatory', supported_parameters: ['reasoning'], reasoning: { mandatory: true, supported_efforts: ['low'] } }, .3);
  assert.deepEqual(mandatory, { reasoning: { effort: 'low' } });
});

test("a budget minimum is not attached to the year of the product version", () => {
  const source = 'این محدودیت به دلیل حداقل بودجه تعریف شده در نسخه ۱۴۰۳ پنل است.';
  assert.deepEqual(extractDirectionalMetrics(source)[0].directions, []);
  assert.equal(verifyInvariants('این محدودیت مربوط به بودجه نسخه ۱۴۰۳ پنل است.', [], source).passed, true);
  assert.deepEqual(extractDirectionalMetrics('در نسخه ۱۴۰۳ حداقل بودجه ۲۰ است.').find(item => item.value === '20').directions, ['minimum']);
  assert.deepEqual(extractDirectionalMetrics('حداقل نسخه ۱۴۰۳ لازم است.')[0].directions, ['minimum']);
});

test('bare URLs can become Markdown links without fabricated anchors or duplicate spans', () => {
  const source = 'راهنما: https://example.com/acme';
  const draft = 'راهنما: [https://example.com/acme](https://example.com/acme)';
  assert.deepEqual(extractAutomaticAnchors(draft), ['https://example.com/acme']);
  assert.equal(judgeLocally(req({ text: source }), draft).issues.some(issue => ['meaning_drift', 'fabricated_detail'].includes(issue.code)), false);
  assert.equal(verifyInvariants(draft, extractAutomaticAnchors(source), source).passed, true);
  assert.equal(verifyInvariants(draft + '\nhttps://example.com/acme', [], source).passed, false);
  assert.equal(verifyInvariants('[راهنما](https://example.com/other)', [], source).passed, false);
});

test('model capacity refuses oversized context or completion before paid calls', async () => {
  const { validateModelCapacity } = await jiti.import('../src/lib/openrouter.ts');
  const model = { id: 'test', supported_parameters: [], context_length: 10000, top_provider: { max_completion_tokens: 4000 } };
  assert.doesNotThrow(() => validateModelCapacity(model, 5000, 4000));
  assert.throws(() => validateModelCapacity(model, 7000, 4000), /ظرفیت/);
  assert.throws(() => validateModelCapacity(model, 1000, 5000), /سقف خروجی/);
});

test('explicit upstream throttling uses the bounded fallback after backoff', async (t) => {
  process.env.LLM_MODEL = 'primary-model';
  process.env.LLM_FALLBACK_MODEL = 'fallback-model';
  t.after(() => { delete process.env.LLM_MODEL; delete process.env.LLM_FALLBACK_MODEL; });
  const error = { error: { message: 'Provider returned error', metadata: { provider_name: 'Test', raw: 'primary-model is temporarily rate-limited upstream.' } } };
  const calls = useProvider(t, [new Response(JSON.stringify(error), { status: 429, headers: { 'Retry-After': '0' } }), sse(short)]);
  await rewriteText(req());
  assert.deepEqual(calls.map(call => call.model), ['primary-model', 'fallback-model']);
});

test('canceling a stalled request body releases its reader promptly', async () => {
  const { readBoundedJson } = await jiti.import('../src/lib/request-body.ts');
  const controller = new AbortController();
  let canceled = false;
  const body = new ReadableStream({ cancel() { canceled = true; } });
  const request = new Request('http://localhost/api/humanize', { method: 'POST', body, duplex: 'half', signal: controller.signal });
  const reading = readBoundedJson(request);
  controller.abort();
  await assert.rejects(reading, error => error.name === 'AbortError');
  assert.equal(canceled, true);
});

test('known length repair skips analysis of the soon-to-be-replaced draft', async () => {
  const mock = scripted([longStructured, pass, longStructured]);
  const result = await runWritingLoop(req({ text: longStructured, quality: 'precise', targetWords: 1500 }), mock.llm,
    { writerModel: 'writer', criticModel: 'critic', refinerModel: 'refiner', combinedReview: true });
  assert.equal(result.quality.refineRan, true);
  assert.doesNotMatch(mock.calls[1].messages[0].content, /SAME critic JSON object/);
  assert.equal(result.analysis, null);
});

test('English prose anchors are soft and accept case and common plural variants', async () => {
  const { classifyAnchors } = await jiti.import('../src/lib/validator.ts');
  const source = 'Straightedge و Dial Indicators با شناسه B-17 تعداد ۱۲ دارند.';
  assert.ok(classifyAnchors(source).hard.includes('B-17'));
  assert.ok(classifyAnchors(source).soft.includes('Indicators'));
  const normalized = verifyInvariants('straightedges و dial indicator با شناسه b-17 تعداد 12 دارند.', extractAutomaticAnchors(source), source);
  assert.deepEqual(normalized.missingAnchors, []);
  const missing = verifyInvariants('با شناسه B-17 تعداد ۱۲ دارند.', extractAutomaticAnchors(source), source);
  assert.equal(missing.passed, true);
  assert.ok(missing.softMissingAnchors.includes('Straightedge'));
  assert.equal(missing.status, 'review-recommended');
  assert.equal(judgeLocally(req({ text: source }), 'با شناسه B-17 تعداد ۱۲ دارند.').issues.some(issue => issue.code === 'meaning_drift'), false);
  assert.equal(verifyInvariants('B-170 تعداد ۱۲', ['B-17'], source).passed, false);
  assert.equal(verifyInvariants('عدد 120', ['12']).passed, false);
});

test('repair prompt names required anchors and failed refinement retains a visible draft', async () => {
  const source = 'با B-17 تعداد ۱۲ قطعه را بررسی کنید.';
  const draft = 'تعداد ۱۲ قطعه را بررسی کنید.';
  const calls = [];
  const result = await runWritingLoop(req({ text: source, quality: 'simple' }), async (messages) => {
    calls.push(messages);
    if (calls.length === 1) return draft;
    assert.match(messages[1].content, /requiredAnchorRepairs.*B-17/);
    throw new Error('private provider failure');
  });
  assert.equal(result.text, draft);
  assert.equal(result.validation.status, 'review-recommended');
  assert.ok(result.quality.warnings.some(warning => warning.includes('پیش از انتشار')));
  assert.ok(result.quality.warnings.every(warning => !warning.includes('private provider failure')));
});

test('a worse refined candidate does not replace a better initial draft', async () => {
  const mock = scripted(['تعداد ۱۲ قطعه است.', 'تعداد ۱۳ قطعه است.']);
  const result = await runWritingLoop(req({ text: 'با B-17 تعداد ۱۲ قطعه است.', quality: 'simple' }), mock.llm);
  assert.equal(result.text, 'تعداد ۱۲ قطعه است.');
});

test('route preserves source without a technical error when drafting provider fails', async (t) => {
  useProvider(t, [new Response('{}', { status: 401 })]);
  const response = await POST(new Request('http://localhost/api/humanize', { method: 'POST', body: JSON.stringify(req()) }));
  const { data, frames } = await readRoute(response);
  assert.equal(data.text, req().text);
  assert.equal(data.publication.status, 'needs-work');
  assert.match(data.warning, /متن اصلی/);
  assert.equal(frames.some(frame => frame.event === 'error'), false);
});

test('friendly anchor warning appears only when final anchor terms disagree', async () => {
  const { ANCHOR_REVIEW_WARNING } = await jiti.import('../src/lib/validator.ts');
  const source = 'برای بررسی از Straightedge استفاده کنید.';
  for (const [draft, expected] of [['برای بررسی از straightedges استفاده کنید.', false], ['برای بررسی از ابزار استفاده کنید.', true]]) {
    const mock = scripted([draft, draft, draft]);
    const result = await runWritingLoop(req({ text: source, quality: 'simple' }), mock.llm);
    assert.equal(result.quality.warnings.includes(ANCHOR_REVIEW_WARNING), expected);
    assert.ok(result.text);
  }
});
