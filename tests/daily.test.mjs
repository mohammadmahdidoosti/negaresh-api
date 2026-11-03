import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tryNative: false, alias: { "@": new URL("../src", import.meta.url).pathname } });
const { buildOverlay } = await jiti.import("../src/lib/content/daily.ts");

test("store categories become counts for known ones and new categories under their parent", () => {
  const known = { "پمپ": { id: "1634", level: 1 }, "پمپ-آب": { id: "2072x", level: 2 } };
  const terms = [
    { id: 10, name: "پمپ و الکتروپمپ", slug: encodeURIComponent("پمپ"), parent: 0, count: 5 },
    { id: 11, name: "پمپ آب", slug: "پمپ-آب", parent: 10, count: 210 },
    { id: 12, name: "پمپ آب &amp; خانگی", slug: "پمپ-آب-خانگی", parent: 11, count: 7 },
    { id: 13, name: "زیرِ جدید", slug: "زیر-جدید", parent: 12, count: 0 },
  ];
  const o = buildOverlay(terms, s => known[s]);
  assert.deepEqual(o.counts, { "1634": 5, "2072x": 210 });
  assert.deepEqual(o.wpIds, { "1634": 10, "2072x": 11 });
  assert.equal(o.added.length, 2);
  assert.deepEqual(o.added[0], { id: "w12", name: "پمپ آب & خانگی", level: 3, parent: "2072x", slug: "پمپ-آب-خانگی", products: 7 });
  assert.equal(o.added[1].parent, "w12");
  assert.equal(o.added[1].level, 4);
});

test("an OpenRouter 402 pauses the queue instead of failing it", async () => {
  const { outOfCredit } = await jiti.import("../src/lib/content/campaigns.ts");
  assert.equal(outOfCredit(new Error("LLM API responded 402: Insufficient credits")), true);
  assert.equal(outOfCredit(Object.assign(new Error("x"), { status: 402 })), true);
  assert.equal(outOfCredit(new Error("LLM API responded 429: rate limited")), false);
});
