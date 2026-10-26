import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tryNative: false, alias: { "@": new URL("../src", import.meta.url).pathname } });
const { newClaims, runWritingLoop } = await jiti.import("../src/lib/refinement.ts");
const { judgeLocally } = await jiti.import("../src/lib/quality.ts");
const { buildGenerationSystemPrompt, buildRefineSystemPrompt } = await jiti.import("../src/lib/prompt.ts");

const base = { voice: "standard", contentType: "commercial", quality: "precise", perspective: "third_person" };
const section = `## کاربرد کنتاکتور\n\n${"کنتاکتور برای قطع و وصل مدار قدرت به کار می‌رود و بوبین آن با ولتاژ فرمان کار می‌کند. ".repeat(12)}\n\n## انتخاب\n\nجریان نامی را با مصرف‌کننده بسنجید.`;

test("newClaims finds numbers and guarantees that the source did not have", () => {
  const src = "کنتاکتور ۹ آمپر برای موتورهای کوچک مناسب است.";
  assert.deepEqual(newClaims("کنتاکتور 9 آمپر برای موتورهای کوچک مناسب است.", src), []);
  assert.deepEqual(newClaims("کنتاکتور ۹ آمپر تا ۴ کیلووات با تضمین کیفیت.", src), ["4", "تضمین"]);
  // list numbering and ZWNJ/space variants are not claims
  assert.deepEqual(newClaims("1. کنتاکتور ۹ آمپر\n2. بهترین", "کنتاکتور ۹ آمپر، بهترین"), []);
});

test("embedded guard: no H1 is fine, an H1 is a markdown issue", () => {
  const plain = judgeLocally({ ...base, text: section }, section);
  assert.ok(plain.issues.some(i => i.code === "invalid_markdown"), "default tool still wants one # title");
  const embedded = judgeLocally({ ...base, text: section, guards: { embedded: true } }, section);
  assert.ok(!embedded.issues.some(i => i.code === "invalid_markdown"));
  const withH1 = judgeLocally({ ...base, text: section, guards: { embedded: true } }, `# کنتاکتور\n\n${section}`);
  assert.ok(withH1.issues.some(i => i.code === "invalid_markdown"));
});

test("prompts switch contract only when guards are on", () => {
  const req = { ...base, text: section };
  assert.match(buildGenerationSystemPrompt(req), /exactly one # heading/);
  const guarded = { ...req, guards: { embedded: true, noNewClaims: true, holdLength: true } };
  for (const p of [buildGenerationSystemPrompt(guarded), buildRefineSystemPrompt(guarded)]) {
    assert.doesNotMatch(p, /exactly one # heading/);
    assert.match(p, /Do NOT add any # heading/);
    assert.match(p, /No New Claims/);
  }
});

test("with guards, a rewrite that adds a guarantee is not returned", async () => {
  const req = { ...base, text: section, guards: { embedded: true, noNewClaims: true, holdLength: true } };
  const bad = section.replace("به کار می‌رود", "با تضمین ۱۰ ساله به کار می‌رود");
  const llm = async (_m, o) => (o.stage === "critic" ? JSON.stringify({ verdict: "pass", issues: [], keep: [] }) : bad);
  const out = await runWritingLoop(req, llm);
  assert.equal(newClaims(out.text, section).length, 0);
  assert.equal(out.quality.sourceKept, true);
});

test("surgical repair: the refiner gets the missing item and its sentence, not the whole original", async () => {
  const src = "## هد\nمدل ۲ اسب با هد ۷۲ متر برای ساختمان بلندتر مناسب است و نصب ساده‌ای دارد.\n\n" + "پمپ جتی برای منبع زمینی مناسب است و آب را با فشار می‌رساند. ".repeat(12);
  const req = { ...base, text: src, guards: { embedded: true, surgicalRepair: true } };
  const rewrite = src.replace("۷۲ متر", "هد بالا");
  let refineUser = "";
  const llm = async (messages, o) => {
    if (o.stage === "critic") return JSON.stringify({ verdict: "pass", issues: [], keep: [] });
    if (o.stage === "refine") { refineUser = messages[1].content; return rewrite.replace("هد بالا", "هد ۷۲ متر"); }
    return rewrite;
  };
  const out = await runWritingLoop(req, llm);
  assert.ok(refineUser.includes("missingFacts"));
  assert.ok(refineUser.includes("۷۲"));
  assert.ok(!refineUser.includes('"original"'));
  assert.ok(out.text.includes("۷۲ متر"));
});
