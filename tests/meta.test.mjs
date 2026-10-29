import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tryNative: false, alias: { "@": new URL("../src", import.meta.url).pathname } });
const { chooseMeta, titleProblems, descProblems, fallbackTitle, fallbackDescription, withSuffix, parseMetaCandidates } = await jiti.import("../src/lib/content/meta.ts");

test("title rules: ≤60, starts with the exact name, no price words", () => {
  assert.deepEqual(titleProblems("سه راهی | پلی رود و تکاب اتصال | کاروان صنعت", "سه راهی"), []);
  assert.ok(titleProblems("خرید لوله، شیلنگ و اتصالات | لیست قیمت", "لوله، شیلنگ و اتصالات").length >= 2);
  assert.ok(titleProblems("پروژکتور نما یکتا افروز | راهنمای انتخاب توان و رنگ نور | کاروان صنعت", "پروژکتور نما").some(p => p.includes("بیش از")));
  // «250» in the name and «۲۵۰» in the title are the same
  assert.deepEqual(titleProblems("کلید فیوز ۲۵۰ آمپر پیچاز | سه مدل | کاروان صنعت", "کلید فیوز 250 آمپر پیچاز"), []);
});

test("the site name is added only when it fits", () => {
  assert.equal(withSuffix("زانو | پلی رود و تکاب اتصال"), "زانو | پلی رود و تکاب اتصال | کاروان صنعت");
  const long = "زانو | " + "ب".repeat(45);
  assert.equal(withSuffix(long), long);
});

test("chooseMeta picks a valid candidate with a brand, else falls back to the pattern", () => {
  const desc = "زانو از برندهای پلی رود و تکاب اتصال در سایزهای ۲۰ تا ۲۵۰ میلی‌متر و زاویه ۴۵ و ۹۰ درجه؛ راهنمای انتخاب جنس و اتصال، مشاورهٔ فنی و خرید از کاروان صنعت.";
  assert.ok(desc.length >= 120 && desc.length <= 155, String(desc.length));
  const c = chooseMeta({
    titles: ["زانو | لیست قیمت انواع", "زانو | انواع زانو", "زانو | پلی رود و تکاب اتصال"],
    descriptions: ["کوتاه", desc],
    name: "زانو",
    brands: ["پلی رود", "تکاب اتصال"],
  });
  assert.equal(c.title, "زانو | پلی رود و تکاب اتصال | کاروان صنعت");
  assert.equal(c.description, desc);
  assert.deepEqual(c.source, { title: "model", description: "model" });
  const f = chooseMeta({ titles: ["بد"], descriptions: ["بد"], name: "کلید دوبل", brands: ["پارس فانال", "هیمل"], fact: "جریان ۱۶ تا ۶۳ آمپر" });
  assert.equal(f.source.title, "fallback");
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
