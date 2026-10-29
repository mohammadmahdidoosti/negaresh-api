import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tryNative: false, alias: { "@": new URL("../src", import.meta.url).pathname } });
const { chooseMeta, titleProblems, descProblems, fallbackTitle, fallbackDescription, withSuffix, parseMetaCandidates } = await jiti.import("../src/lib/content/meta.ts");

test("title rules: ≤60, starts with the exact name; «خرید/قیمت» allowed, superlatives not", () => {
  assert.deepEqual(titleProblems("سه راهی | خرید و قیمت روز پلی رود و تکاب اتصال", "سه راهی"), []);
  assert.deepEqual(titleProblems("لوله، شیلنگ و اتصالات | لیست قیمت و راهنمای خرید", "لوله، شیلنگ و اتصالات"), []);
  assert.ok(titleProblems("خرید لوله، شیلنگ و اتصالات | لیست قیمت", "لوله، شیلنگ و اتصالات").includes("با نام دسته شروع نمی‌شود"));
  assert.ok(titleProblems("زانو | بهترین برندها با تخفیف ویژه", "زانو").includes("کلمهٔ ممنوع"));
  assert.ok(titleProblems("پروژکتور نما یکتا افروز | راهنمای انتخاب توان و رنگ نور | کاروان صنعت", "پروژکتور نما").some(p => p.includes("بیش از")));
  // «250» in the name and «۲۵۰» in the title are the same
  assert.deepEqual(titleProblems("کلید فیوز ۲۵۰ آمپر پیچاز | سه مدل | کاروان صنعت", "کلید فیوز 250 آمپر پیچاز"), []);
});

test("the site name is off by default and, when turned on, added only when it fits", () => {
  const prev = process.env.CONTENT_META_SITE_SUFFIX;
  delete process.env.CONTENT_META_SITE_SUFFIX;
  assert.equal(withSuffix("زانو | پلی رود و تکاب اتصال"), "زانو | پلی رود و تکاب اتصال");
  process.env.CONTENT_META_SITE_SUFFIX = "on";
  assert.equal(withSuffix("زانو | پلی رود و تکاب اتصال"), "زانو | پلی رود و تکاب اتصال | کاروان صنعت");
  const long = "زانو | " + "ب".repeat(45);
  assert.equal(withSuffix(long), long);
  if (prev === undefined) delete process.env.CONTENT_META_SITE_SUFFIX; else process.env.CONTENT_META_SITE_SUFFIX = prev;
});

test("chooseMeta prefers a buyer word and the page's terms; hub titles use product types; else the pattern", () => {
  const desc = "زانو از برندهای پلی رود و تکاب اتصال در سایزهای ۲۰ تا ۲۵۰ میلی‌متر و زاویه ۴۵ و ۹۰ درجه؛ راهنمای انتخاب جنس و اتصال، مشاورهٔ فنی و خرید از کاروان صنعت.";
  assert.ok(desc.length >= 120 && desc.length <= 155, String(desc.length));
  const c = chooseMeta({
    titles: ["زانو | بهترین زانوها", "زانو | پلی رود و تکاب اتصال", "زانو | خرید و قیمت روز پلی رود و تکاب اتصال"],
    descriptions: ["کوتاه", desc],
    name: "زانو",
    brands: ["پلی رود", "تکاب اتصال"],
  });
  assert.equal(c.title, "زانو | خرید و قیمت روز پلی رود و تکاب اتصال");
  assert.equal(c.description, desc);
  assert.deepEqual(c.source, { title: "model", description: "model" });
  const hub = chooseMeta({
    titles: ["تجهیزات تابلو برق | رله حرارتی و فیوز اتصال", "تجهیزات تابلو برق | خرید کلید، کنتاکتور، فیوز و خازن"],
    descriptions: [desc],
    name: "تجهیزات تابلو برق",
    brands: ["اتصال", "هیمل"],
    titleTerms: ["کلید", "کنتاکتور", "فیوز", "خازن"],
  });
  assert.equal(hub.title, "تجهیزات تابلو برق | خرید کلید، کنتاکتور، فیوز و خازن");
  const f = chooseMeta({ titles: ["بد"], descriptions: ["بد"], name: "کلید دوبل", brands: ["پارس فانال", "هیمل"], fact: "جریان ۱۶ تا ۶۳ آمپر" });
  assert.equal(f.source.title, "fallback");
  assert.equal(f.title, "کلید دوبل | خرید و قیمت روز پارس فانال و هیمل");
  assert.deepEqual(titleProblems(f.title, "کلید دوبل"), []);
  assert.deepEqual(descProblems(f.description, "کلید دوبل"), []);
});

test("fallbacks always respect the limits, even for long names", () => {
  const name = "شیر برقی مینیاتوری Black ایر کنترل سری پنوماتیک";
  const t = fallbackTitle(name, ["ایر کنترل", "آلفا مک"]);
  assert.ok(t.length <= 60);
  const d = fallbackDescription(name, ["ایر کنترل"]);
  assert.ok(d.length >= 120 && d.length <= 155, String(d.length));
});

test("candidate JSON is parsed defensively", () => {
  assert.deepEqual(parseMetaCandidates('{"titles":["a",1],"descriptions":["b"]}'), { titles: ["a"], descriptions: ["b"] });
  assert.deepEqual(parseMetaCandidates("nope"), { titles: [], descriptions: [] });
});

test("the fallback description never ends mid-phrase", () => {
  const d = fallbackDescription("لوله، شیلنگ و اتصالات", ["تکاب اتصال", "پلی رود"]);
  assert.ok(d.length >= 120 && d.length <= 155, `${d.length}: ${d}`);
  assert.ok(d.endsWith("."));
  assert.ok(!d.endsWith("در همین."));
});

test("the site name a model adds is removed, and a bare name is not a title", () => {
  const c = chooseMeta({
    titles: ["تجهیزات تابلو برق و برق صنعتی | کاروان صنعت", "تجهیزات تابلو برق و برق صنعتی | خرید کلید، کنتاکتور و فیوز - کاروان صنعت"],
    descriptions: [],
    name: "تجهیزات تابلو برق و برق صنعتی",
    brands: ["اتصال"],
  });
  assert.equal(c.title, "تجهیزات تابلو برق و برق صنعتی | خرید کلید، کنتاکتور و فیوز");
  assert.ok(titleProblems("زانو", "زانو").includes("فقط نام دسته"));
});
