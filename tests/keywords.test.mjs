import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tryNative: false, alias: { "@": new URL("../src", import.meta.url).pathname } });
const { intentOf, gapOf } = await jiti.import("../src/lib/content/keywords.ts");

test("intent rules in priority order", () => {
  assert.equal(intentOf("قیمت زانو پلی اتیلن"), "قیمت و خرید");
  assert.equal(intentOf("فرق زانو پرسی و کوپلی"), "مقایسه");
  assert.equal(intentOf("علت نشتی زانو"), "علت و عیب‌یابی");
  assert.equal(intentOf("نحوه نصب زانو"), "آموزش و نصب");
  assert.equal(intentOf("زانو 110 پلیکا"), "مشخصات و سایز");
  assert.equal(intentOf("زانو پلی رود"), "عمومی");
  assert.equal(intentOf("دانلود فیلم زانو"), "نامرتبط");
});

test("gap: uncovered queries, and whether the product data supports them", () => {
  const rows = [
    { q: "زانو 110 پلیکا", intent: "مشخصات و سایز", seed: "زانو" },
    { q: "قیمت زانو", intent: "قیمت و خرید", seed: "زانو" },
    { q: "زانو پلی رود", intent: "عمومی", seed: "زانو" },
    { q: "زانو مسی", intent: "عمومی", seed: "زانو" },
  ];
  const out = gapOf(rows, "زانو", "زانو پلیکا در سایزهای 40 تا 250. قیمت زانو.", "زانو پلیکا 110 برند پلی رود");
  const by = Object.fromEntries(out.map(r => [r.q, r]));
  assert.equal(by["قیمت زانو"].covered, true);
  assert.equal(by["زانو 110 پلیکا"].covered, false);
  assert.equal(by["زانو 110 پلیکا"].supported, true);
  assert.equal(by["زانو پلی رود"].supported, true);
  assert.equal(by["زانو مسی"].supported, false);
});

test("unrelated meanings are dropped; one-word names get a context seed", async () => {
  const { seedsFor } = await jiti.import("../src/lib/content/keywords.ts");
  assert.deepEqual(seedsFor("زانو", "لوله، شیلنگ و اتصالات", []), ["زانو", "زانو لوله"]);
  assert.deepEqual(seedsFor("سه راهی", "لوله، شیلنگ و اتصالات", []), ["سه راهی"]);
  const out = gapOf([{ q: "زانو بند طبی", intent: "عمومی", seed: "زانو" }, { q: "زانو لوله سفید", intent: "عمومی", seed: "زانو" }], "زانو", "زانو", "زانو پلیکا", "لوله، شیلنگ و اتصالات > زانو");
  assert.equal(out[0].relevant, false);
  assert.equal(out[0].intent, "نامرتبط");
  assert.equal(out[1].relevant, true);
});

test("numbers in the data make a size query relevant; «آتل دار» does not", () => {
  const out = gapOf([{ q: "زانو سایز 32", intent: "مشخصات و سایز", seed: "زانو" }, { q: "زانو بند آتل دار", intent: "عمومی", seed: "زانو" }], "زانو", "زانو", "زانو 32 فلنج دار", "لوله > زانو");
  assert.equal(out[0].relevant, true);
  assert.equal(out[1].relevant, false);
});
