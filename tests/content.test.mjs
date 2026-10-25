import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tryNative: false, alias: { "@": new URL("../src", import.meta.url).pathname } });
const { extractFacts } = await jiti.import("../src/lib/content/site.ts");
const { runQa } = await jiti.import("../src/lib/content/qa.ts");
const { parseDraft, parseBrief } = await jiti.import("../src/lib/content/prompts.ts");
const { findCategory, tierFor, norm } = await jiti.import("../src/lib/content/taxonomy.ts");

test("extracts brands and spec ranges from product names", () => {
  const f = extractFacts(
    ["کنتاکتور 9 آمپر بوبین 220 ولت پارس فانال", "کنتاکتور ۳۲ آمپر برند پارس فانال", "کنتاکتور خازنی 60 کیلووار برند اتصال"],
    ["پارس فانال"],
  );
  assert.deepEqual(f.specs["آمپر"], ["9", "32"]);
  assert.deepEqual(f.specs["کیلووار"], ["60"]);
  assert.equal(f.brands.find(b => b.brand === "پارس فانال").count, 2);
  assert.ok(f.brands.some(b => b.brand === "اتصال"));
});

test("category lookup accepts id, slug, URL and name; names are normalized", () => {
  const byName = findCategory("کنتاکتور");
  assert.ok(byName);
  assert.equal(findCategory(byName.id).id, byName.id);
  assert.equal(findCategory(`https://caravansanat.com/product-category/${encodeURIComponent(byName.slug)}/`).id, byName.id);
  assert.equal(norm("ليميت سوئيچ"), norm("لیمیت سوئیچ"));
});

test("tiers scale with level and product count; empty categories are skipped", () => {
  const c = findCategory("کنتاکتور");
  assert.equal(tierFor(c, 233), "hub");
  assert.equal(tierFor(c, 0), "skip");
  assert.equal(tierFor({ ...c, level: 4, id: "x" }, 3), "small");
});

test("draft parser splits the four sections", () => {
  const d = parseDraft("===ABOVE===\nبالا\n===BELOW===\n## تیتر\nمتن\n===META_TITLE===\nعنوان\n===META_DESCRIPTION===\nتوضیح\n===END===");
  assert.deepEqual(d, { above: "بالا", below: "## تیتر\nمتن", metaTitle: "عنوان", metaDescription: "توضیح" });
});

test("brief parser tolerates fences and fills defaults", () => {
  const b = parseBrief('```json\n{"angle":"a","audience":"B2C","headings":[{"h2":"x","covers":"y","format":"bullets"}]}\n```');
  assert.equal(b.audience, "B2C");
  assert.equal(b.headings.length, 1);
  assert.deepEqual(b.facts, []);
});

const base = {
  name: "کنتاکتور", tier: "small", metaTitle: "کنتاکتور | کاروان صنعت خرید و راهنمای انتخاب",
  metaDescription: "راهنمای انتخاب کنتاکتور بر اساس جریان نامی و ولتاژ بوبین؛ انواع کنتاکتور پارس فانال در فروشگاه کاروان صنعت با مشاوره فنی رایگان.",
  evidence: "کنتاکتور 9 آمپر پارس فانال", allowedBrands: ["پارس فانال"], knownBrands: ["پارس فانال", "وال", "اشنایدر"], siteDataAvailable: true,
};
const words = n => Array.from({ length: n }, () => "کلمه").join(" ");

test("QA flags H1, prices, foreign brands and unsupported numbers", () => {
  const r = runQa({ ...base, above: `کنتاکتور ${words(70)}`, below: `# تیتر\nکنتاکتور 4000 ساعت عمر دارد. قیمت 1200 تومان. اشنایدر\n## سوالات متداول\n${words(300)}` });
  const lvl = id => r.checks.find(c => c.id === id).level;
  assert.equal(lvl("no-h1"), "fail");
  assert.equal(lvl("no-price"), "fail");
  assert.equal(lvl("brands"), "fail");
  assert.notEqual(lvl("numbers"), "pass");
  assert.equal(r.level, "fail");
});

test("QA does not match a brand inside another word", () => {
  const r = runQa({ ...base, above: `کنتاکتور ${words(70)}`, below: `## الف\nکنتاکتور 9 آمپر\n## ب\n## سوالات متداول\n${words(300)}` });
  assert.equal(r.checks.find(c => c.id === "brands").level, "pass");
  assert.equal(r.checks.find(c => c.id === "numbers").level, "pass");
});

test("post-humanize fixes: H1 demoted and standard ZWNJ restored", async () => {
  const { demoteH1, restoreZwnj } = await jiti.import("../src/lib/content/pipeline.ts");
  assert.equal(demoteH1("# عنوان\n## بخش"), "## عنوان\n## بخش");
  const out = restoreZwnj("کنتاکتور ها می شود و نمی تواند بزرگ تر و بهترین ترین IP 65 کنتاکتور های پارس");
  assert.ok(out.includes("کنتاکتور‌ها"));
  assert.ok(out.includes("می‌شود"));
  assert.ok(out.includes("نمی‌تواند"));
  assert.ok(out.includes("بزرگ‌تر"));
  assert.ok(out.includes("IP 65"));
});

test("QA: no false alarms for «متریال» or everyday-word brands like «هدف»", () => {
  const r = runQa({ ...base, knownBrands: ["هدف", "پارس فانال"], above: `کنتاکتور ${words(70)}`, below: `## الف\nکنتاکتور با متریال مقاوم؛ هدف انتخاب درست است.\n## سوالات متداول\n${words(300)}` });
  assert.equal(r.checks.find(c => c.id === "no-price").level, "pass");
  assert.equal(r.checks.find(c => c.id === "brands").level, "pass");
});

test("draft parser tolerates decorated markers; headings nested under one H2 are lifted", async () => {
  const { normalizeHeadings } = await jiti.import("../src/lib/content/prompts.ts");
  const d = parseDraft("**=== ABOVE ===**\nبالا\n=== BELOW ===\n## الف\nمتن\n===META_TITLE===\nعنوان\n**===META_DESCRIPTION===**\nتوضیح\n===END===");
  assert.equal(d.above, "بالا");
  assert.equal(d.metaTitle, "عنوان");
  assert.equal(d.metaDescription, "توضیح");
  const nested = "## راهنما\nمتن\n### یک\n### دو\n### سه\n#### سؤال";
  assert.equal(normalizeHeadings(nested), "## راهنما\nمتن\n## یک\n## دو\n## سه\n### سؤال");
  const fine = "## یک\n### الف\n## دو\n### ب\n### ج\n### د";
  assert.equal(normalizeHeadings(fine), fine);
});

test("repair asks to shorten, drop hype/unsupported numbers, never to lengthen", async () => {
  const { repairProblems } = await jiti.import("../src/lib/content/pipeline.ts");
  const checks = [
    { id: "hype", level: "warn", label: "", detail: "تضمین" },
    { id: "numbers", level: "fail", label: "", detail: "بدون پشتوانه: 24، 220" },
    { id: "meta-title", level: "warn", label: "", detail: "67 نویسه" },
  ];
  const long = repairProblems({ checks, words: 1170 }, "standard", "PU");
  assert.equal(long.length, 4);
  assert.ok(long.some(p => p.includes("24، 220")));
  assert.ok(long.some(p => p.includes("1170 کلمه")));
  const short = repairProblems({ checks: [], words: 200 }, "standard", "PU");
  assert.deepEqual(short, []);
});

test("text with every ZWNJ dropped is detected", async () => {
  const { zwnjHealthy } = await jiti.import("../src/lib/content/pipeline.ts");
  const good = "این کلید در تابلوهای توزیع به‌کار می‌رود و قطع‌کننده‌ای مطمئن است. ".repeat(10);
  assert.equal(zwnjHealthy(good), true);
  assert.equal(zwnjHealthy(good.replace(/‌/g, "")), false);
});

test("humanized text keeps the draft's headings", async () => {
  const { keepDraftHeadings } = await jiti.import("../src/lib/content/pipeline.ts");
  const draft = "## الف\nمتن\n## خرید از کاروان صنعت\nمتن";
  assert.equal(keepDraftHeadings("## الف تازه\nمتن نو\n## جمع بندی\nمتن نو", draft), "## الف\nمتن نو\n## خرید از کاروان صنعت\nمتن نو");
  assert.equal(keepDraftHeadings("## الف\nمتن\n## ب\n## جمع‌بندی\nمتن", draft), "## الف\nمتن\n## ب\n## خرید از کاروان صنعت\nمتن");
});
