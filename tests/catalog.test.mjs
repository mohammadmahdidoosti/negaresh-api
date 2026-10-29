import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tryNative: false, alias: { "@": new URL("../src", import.meta.url).pathname } });
const { splitName, buildCatalog, catalogText, unitValue } = await jiti.import("../src/lib/content/catalog.ts");
const { pagesToRead } = await jiti.import("../src/lib/content/site.ts");
const { wrongTermUses, termsFor } = await jiti.import("../src/lib/content/glossary.ts");
const { ABSOLUTE, runQa } = await jiti.import("../src/lib/content/qa.ts");
const { parseFactFindings, draftMessages } = await jiti.import("../src/lib/content/prompts.ts");

const P = (name, categories = [], inStock = true) => ({ name, inStock, categories });

test("splitName keeps series codes in the family and takes the size out", () => {
  const a = splitName("پمپ هیدرولیک پره ای دوبل T6EC سایز 66+3 طرح دنیسون سینری Scenery");
  assert.equal(a.family, "پمپ هیدرولیک پره ای دوبل T6EC طرح دنیسون سینری Scenery");
  assert.equal(a.size, "66+3");
  const b = splitName("سه راهی تبدیل پرسی سایز ۲۰ * ۱۶ * ۲۰ برند نیوپایپ");
  assert.equal(b.family, "سه راهی تبدیل پرسی برند نیوپایپ");
  assert.equal(b.size, "20*16*20");
  // long order codes are dropped, so one family holds all of them
  const c = splitName("کلید کامپکت غیر قابل تنظیم فریم 400، 400 آمپر مدل HDM3400F40033XXT برند هیمل (Himel)");
  assert.ok(!c.family.includes("HDM3400"));
  assert.ok(c.family.includes("برند هیمل (Himel)"));
});

test("series with different sizes stay apart; each family carries its own sizes", () => {
  const cat = buildCatalog(
    [
      P("پمپ هیدرولیک پره ای دوبل T6EC سایز 85+22 طرح دنیسون سینری Scenery", ["پمپ پره ای دوبل طرح دنیسون Scenery"]),
      P("پمپ هیدرولیک پره ای دوبل T6EC سایز 66+3 طرح دنیسون سینری Scenery", ["پمپ پره ای دوبل طرح دنیسون Scenery"]),
      P("پمپ هیدرولیک پره ای دوبل T6ED سایز 52+28 طرح دنیسون سینری Scenery", ["پمپ پره ای دوبل طرح دنیسون Scenery"]),
      P("پمپ پره ای دوبل یوکن سایز 53-19 Yuken", ["پمپ پره ای دوبل یوکن"], false),
    ],
    { categoryName: "پمپ هیدرولیک پره ای" },
  );
  const t6ec = cat.families.find(f => f.family.includes("T6EC"));
  const t6ed = cat.families.find(f => f.family.includes("T6ED"));
  assert.deepEqual(t6ec.sizes, ["66+3", "85+22"]);
  assert.deepEqual(t6ed.sizes, ["52+28"]);
  assert.equal(cat.subcategories[0].name, "پمپ پره ای دوبل طرح دنیسون Scenery");
  assert.equal(cat.subcategories[0].count, 3);
  const text = catalogText(cat);
  assert.match(text, /همهٔ ۴ محصول/);
  assert.match(text, /T6EC.*سایز: 66\+3، 85\+22/);
  assert.match(text, /یوکن/);
});

test("unit values: a falling dash pair is size + value, a rising one is a range", () => {
  assert.equal(unitValue("63-10"), "10");
  assert.equal(unitValue("1.6-2.5"), "1.6-2.5");
  assert.equal(unitValue("80تا100"), "80تا100");
  const cat = buildCatalog([P("سه راه تبدیل 63-10 بار پلی اتیلن برند پلی رود"), P("سه راه تبدیل 75-16 بار پلی اتیلن برند پلی رود")], { categoryName: "سه راهی" });
  assert.deepEqual(cat.families[0].values["بار"], ["10", "16"]);
});

test("large categories are read as an even spread of pages", () => {
  assert.deepEqual(pagesToRead(3, 40), [1, 2, 3]);
  const spread = pagesToRead(95, 40);
  assert.equal(spread.length, 40);
  assert.equal(spread[0], 1);
  assert.equal(spread.at(-1), 95);
});

test("confirmed terms: «کوپلی» described as welding is flagged, the right description is not", () => {
  assert.equal(termsFor("زانو دیواری کوپلی برند نیوپایپ").length, 1);
  assert.equal(wrongTermUses("- **کوپلی:** با حرارت و جوش به لوله پلی پروپیلن متصل می‌شود.").length, 1);
  assert.equal(wrongTermUses("| پلی اتیلن | پرسی، کوپلی (جوشی)، کلمپی |").length, 1);
  assert.equal(wrongTermUses("| پلی اتیلن | پرسی، کوپلی، جوشی، الکتروفیوژن |").length, 0);
  assert.equal(wrongTermUses("کوپلی با مهره و اورینگ روی لوله بسته می‌شود و بدون جوش و حرارت نصب می‌شود.").length, 0);
});

test("absolute claims are caught, ordinary sentences are not", () => {
  const hits = s => (s.match(ABSOLUTE) ?? []).length;
  assert.equal(hits("زانو با جنس هماهنگ، نشتی و گرفتگی را حذف می‌کند."), 1);
  assert.equal(hits("این اتصال هرگز نشتی نمی‌کند."), 1);
  assert.equal(hits("این ساختار نیاز به نصب دو پمپ جداگانه را حذف می‌کند."), 0);
  assert.equal(hits("به کاهش احتمال نشتی کمک می‌کند."), 0);
  assert.equal(hits("سایز هر سه دهانه کاملاً متفاوت است."), 0);
});

test("fact-check output is parsed defensively", () => {
  assert.deepEqual(parseFactFindings("[]"), []);
  assert.deepEqual(parseFactFindings("نتیجه:\n[{\"quote\":\"T6EC برای دبی‌های کوچک‌تر\",\"problem\":\"بزرگ‌ترین سایز (۸۵) در T6EC است\"}]"), [
    { quote: "T6EC برای دبی‌های کوچک‌تر", problem: "بزرگ‌ترین سایز (۸۵) در T6EC است" },
  ]);
  assert.deepEqual(parseFactFindings("not json"), []);
  assert.deepEqual(parseFactFindings("[{\"quote\": 3}]"), []);
});

test("the draft prompt carries the catalog and its rules only when given", () => {
  const brief = { angle: "", audience: "mixed", search_intent: "", term_explanation: "", lsi: [], facts: [], brands: [], headings: [], table: null, check_before_order: [], common_mistakes: [], glossary: [], faq: [], cautions: [] };
  const base = {
    category: { name: "زانو", path: "x", level: 3, synonyms: "", productCount: 10, tier: "standard" },
    industry: "", brief, tone: "", audienceDesc: "", sectionRules: { include: [], exclude: [] }, profileCautions: [], words: { min: 300, max: 500 },
  };
  const without = draftMessages(base);
  assert.ok(!without[0].content.includes("دادهٔ کاتالوگ"));
  const withCat = draftMessages({ ...base, catalog: "شمارش از همهٔ ۱۰ محصول", terms: [{ term: "کوپلی", definition: "پیچی" }] });
  assert.ok(withCat[0].content.includes("دادهٔ کاتالوگ (مرجع اصلی)"));
  assert.ok(withCat[1].content.includes("شمارش از همهٔ ۱۰ محصول"));
  assert.ok(withCat[1].content.includes("کوپلی"));
});

test("QA warns on absolute claims and wrong term definitions", () => {
  const q = runQa({
    name: "زانو", tier: "small",
    above: "زانو برای تغییر مسیر لوله است.",
    below: "## زانو\n- **کوپلی:** با جوش حرارتی نصب می‌شود.\n\nزانو نشتی را حذف می‌کند.",
    metaTitle: "زانو | کاروان صنعت", metaDescription: "x", evidence: "", allowedBrands: [], knownBrands: [], siteDataAvailable: true,
  });
  assert.equal(q.checks.find(c => c.id === "absolute").level, "warn");
  assert.equal(q.checks.find(c => c.id === "terms").level, "warn");
});

test("«پرسی، کوپلی و جوشی» is a list of kinds, not a wrong definition", () => {
  assert.equal(wrongTermUses("- اتصالات پرسی، کوپلی و جوشی هر سیستم را فقط با لوله سازگار همان سیستم نصب کنید.").length, 0);
  assert.equal(wrongTermUses("کوپلی و جوش لب‌به‌لب هر دو رایج‌اند").length, 1);
});

test("confirmed glossary: electrofusion «کوپلر» is not «کوپلی»; «مغزی» with an inner thread is flagged", () => {
  assert.equal(wrongTermUses("سه راه الکتروفیوژن دوسرکوپلر با جوش برقی نصب می‌شود.").length, 0);
  assert.equal(wrongTermUses("سه راهی مغزی که رزوه داخلی دارد برای اتصال شیر است.").length, 1);
  assert.equal(wrongTermUses("مغزی دو سر روپیچ دارد.").length, 0);
  const names = termsFor("زانو دو سر کوپله پلیکا، بوشن فلزی، کوپلینگ").map(t => t.term);
  assert.ok(names.includes("کوپله (در اتصالات پلیکا)") && names.includes("پلیکا") && names.includes("بوشن فلزی"));
  assert.ok(!names.includes("کوپلی"));
});
