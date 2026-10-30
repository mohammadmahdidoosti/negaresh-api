import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tryNative: false, alias: { "@": new URL("../src", import.meta.url).pathname } });
const { planLinks, applyLinks, structuralLinks, duplicateNames } = await jiti.import("../src/lib/content/links.ts");
const { findCategory } = await jiti.import("../src/lib/content/taxonomy.ts");

const zanu = findCategory("زانو");

test("links the first mention of other categories, never the page itself, headings or tables", () => {
  const md = [
    "## زانو و سه راهی",
    "زانو برای تغییر مسیر است و کنار سه راهی و تبدیل در لوله‌کشی به کار می‌رود.",
    "| سه راهی | جدول |",
    "دوباره سه راهی را می‌گوییم.",
  ].join("\n");
  const links = planLinks(md, zanu.id, 5);
  const targets = links.map(l => l.target.name);
  assert.ok(targets.includes("سه راهی"), JSON.stringify(targets));
  assert.ok(!targets.includes("زانو"));
  assert.ok(links.every(l => l.line === 1), "only the prose line");
  const out = applyLinks(md, links);
  assert.match(out.split("\n")[1], /\[سه راهی\]\(https:\/\/caravansanat\.com\/product-category\//);
  assert.equal(out.split("\n")[0], "## زانو و سه راهی");
  assert.equal(out.split("\n")[3], "دوباره سه راهی را می‌گوییم.");
});

test("structural links: parent, children and siblings of a category", () => {
  const s = structuralLinks(zanu.id);
  assert.ok(s.parent);
  assert.ok(s.siblings.length > 0);
  assert.ok(s.siblings.every(x => x.id !== zanu.id));
});

test("duplicate names are reported with their paths", () => {
  const d = duplicateNames();
  assert.ok(Array.isArray(d));
  for (const g of d.slice(0, 3)) assert.ok(g.categories.length >= 2 && g.categories[0].path.includes(">"));
});
