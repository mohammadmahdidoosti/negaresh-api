import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tryNative: false, alias: { "@": new URL("../src", import.meta.url).pathname } });
const { excerptText, descriptionHtml } = await jiti.import("../src/lib/content/publish.ts");
const { findCategory } = await jiti.import("../src/lib/content/taxonomy.ts");

test("the text above the list becomes plain paragraphs", () => {
  assert.equal(excerptText("**زانو** برای تغییر مسیر\nلوله است.\n\nدر [کاروان صنعت](https://x) موجود است."), "زانو برای تغییر مسیر لوله است.\n\nدر کاروان صنعت موجود است.");
});

test("the guide becomes safe HTML with internal links and a related list", () => {
  const cat = findCategory("زانو");
  const result = { category: { id: cat.id, name: "زانو" }, content: { below: "## انواع زانو\n\nزانو کنار سه راهی و تبدیل در لوله‌کشی به کار می‌رود.\n\n| جنس | سایز |\n|---|---|\n| پلیکا | 110 |\n\n<script>alert(1)</script>" } };
  const { html, links } = descriptionHtml(result);
  assert.match(html, /<h2>انواع زانو<\/h2>/);
  assert.match(html, /<table>/);
  assert.match(html, /<a href="https:\/\/caravansanat\.com\/product-category\/[^"]+">سه راهی<\/a>/);
  assert.match(html, /<h3>دسته‌های مرتبط<\/h3>/);
  assert.doesNotMatch(html, /<script/);
  assert.ok(links.length >= 1);
});
