import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tryNative: false, alias: { "@": new URL("../src", import.meta.url).pathname } });
const { compareFingerprints } = await jiti.import("../src/lib/content/watch.ts");

const fp = (total, brands, families = {}) => ({ total, brands, families, at: "x" });

test("no change, small noise: nothing flagged", () => {
  assert.deepEqual(compareFingerprints(fp(100, { "پلی رود": 50, "تکاب اتصال": 48 }), fp(104, { "پلی رود": 52, "تکاب اتصال": 50, "نوپا": 2 })), []);
});

test("a new brand with real stock, a vanished brand, a big jump in products", () => {
  const ch = compareFingerprints(fp(100, { "پلی رود": 50, "زاکو": 20 }), fp(160, { "پلی رود": 60, "پیمتاش": 40 }));
  assert.deepEqual(ch.map(c => c.kind).sort(), ["brand-gone", "brand-new", "total"]);
  assert.ok(ch.find(c => c.kind === "brand-new").detail.includes("پیمتاش"));
});

test("families: a new family big enough to be listed counts; spelling variants do not", () => {
  const before = fp(300, {}, { "زانو پلی اتیلن برند پلی رود": 80, "زانو چسبی UPVC برند پیمتاش": 30 });
  const after = fp(320, {}, { "زانو پلی‌اتیلن برند پلی رود": 82, "زانو چسبی UPVC برند پیمتاش": 30, "زانو پوشفیت برند نیوفلکس": 40 });
  const ch = compareFingerprints(before, after);
  assert.deepEqual(ch.map(c => c.kind), ["family-new"]);
});

test("results written before fingerprints compare brands and total only", () => {
  const ch = compareFingerprints(fp(100, { "a": 60 }), fp(100, { "a": 60 }, { "خانوادهٔ تازه": 50 }));
  assert.deepEqual(ch, []);
});

test("a brand slipping out of the top-15 list is not «gone»", () => {
  const top = n => Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`b${i}`, n - i]));
  const before = fp(1000, { ...top(100), "تله کرین": 15 });
  const after = fp(1000, { ...top(100), "ETI": 20 });
  // تله کرین (15) is below the smallest listed brand after (20): it may still be there, just not listed.
  // ETI (20) is above the smallest brand listed before (15): it would have been listed, so it is new.
  assert.deepEqual(compareFingerprints(before, after).map(c => c.kind), ["brand-new"]);
});

test("sampled huge categories: brands shifting in the sample are not flagged", () => {
  const before = { ...fp(9491, { "تکاب اتصال": 645, "پلی رود": 470, "دیناپلیمر": 161 }), sampled: true, counted: 3995 };
  const after = { ...fp(9500, { "تکاب اتصال": 640, "پلی رود": 480, "آبراهه گستر": 181 }), sampled: true, counted: 3998 };
  assert.deepEqual(compareFingerprints(before, after), []);
});
