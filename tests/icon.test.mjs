import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tryNative: false, alias: { "@": new URL("../src", import.meta.url).pathname } });
const { cleanSvg, iconMessages } = await jiti.import("../src/lib/content/icon.ts");

test("a model answer is cut to its svg and cleaned of anything active", () => {
  const raw = 'Here:\n```svg\n<svg viewBox="0 0 64 64" onload="x()"><script>alert(1)</script><g stroke="#000"><path d="M1 1L5 5" onclick="y()"/><text>hi</text><a href="//e"><circle cx="3" cy="3" r="2"/></a></g></svg>\n```';
  const svg = cleanSvg(raw);
  assert.ok(svg.startsWith("<svg"));
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<path d="M1 1L5 5"/);
  assert.doesNotMatch(svg, /script|onload|onclick|<text|href/);
});

test("no drawing means no icon", () => {
  assert.equal(cleanSvg("sorry"), null);
  assert.equal(cleanSvg('<svg viewBox="0 0 64 64"><g></g></svg>'), null);
});

test("the prompt names the category and the house style", () => {
  const [sys, user] = iconMessages("پمپ");
  assert.match(sys.content, /#e8792b/);
  assert.match(user.content, /پمپ/);
});
