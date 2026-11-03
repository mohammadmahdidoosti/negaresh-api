import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tryNative: false, alias: { "@": new URL("../src", import.meta.url).pathname } });
const { linkHtml, stripBox, relatedBox } = await jiti.import("../src/lib/content/blog.ts");

const T = (name, id) => ({ id, name, url: `https://caravansanat.com/product-category/${id}/`, products: 100, l1: "1" });

test("links go into paragraphs and list items only, once per category, whole words", () => {
  const html = "<h2>رگلاتور گاز</h2><p>رگلاتور گاز را ببندید. باز هم رگلاتور گاز.</p><p><a href='x'>شیر گازی</a> و شیر گازی‌ها</p><li>شیر گازی ساده</li>";
  const { html: out, linked } = linkHtml(html, [T("رگلاتور گاز", "a"), T("شیر گازی", "b")]);
  assert.match(out, /<h2>رگلاتور گاز<\/h2>/);
  assert.equal((out.match(/href="https:\/\/caravansanat.com\/product-category\/a\/"/g) || []).length, 1);
  assert.match(out, /<li><a href="https:\/\/caravansanat.com\/product-category\/b\/">شیر گازی<\/a> ساده<\/li>/);
  assert.equal(linked.length, 2);
});

test("the related box is replaced, not repeated", () => {
  const once = `<p>متن</p>\n\n${relatedBox([T("زانو", "z")])}`;
  assert.equal(stripBox(once), "<p>متن</p>");
});
