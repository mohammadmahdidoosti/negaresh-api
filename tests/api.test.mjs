import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

process.env.LLM_USAGE_DB = join(mkdtempSync(join(tmpdir(), "negaresh-api-test-")), "usage.sqlite");
process.env.NEGARESH_API_KEY = "key-a, key-b";
process.env.API_KEY = "provider-key";
process.env.LLM_BASE_URL = "http://mock.local/v1";

const jiti = createJiti(import.meta.url, { tryNative: false, alias: { "@": new URL("../src", import.meta.url).pathname } });
const { requireApiKey } = await jiti.import("../src/lib/api/auth.ts");
const { parseHumanizeBody } = await jiti.import("../src/lib/api/payload.ts");
const { POST: humanize } = await jiti.import("../src/app/api/v1/humanize/route.ts");
const { POST: createJob } = await jiti.import("../src/app/api/v1/jobs/route.ts");
const { GET: getJob } = await jiti.import("../src/app/api/v1/jobs/[id]/route.ts");

const text = "این کتاب برای شما مناسب است. آن را با دقت بخوانید.";
const authed = (body, key = "key-b") =>
  new Request("http://localhost/api/v1/humanize", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });

function sse(content) {
  const frames = [
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  return new Response(frames.join(""), { headers: { "Content-Type": "text/event-stream" } });
}

function mockProvider(t, contentFor) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    return sse(contentFor(body));
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

const reply = (body) => {
  const system = body.messages[0].content;
  if (/"verdict"/.test(system)) return JSON.stringify({ verdict: "pass", issues: [], keep: [], analysis: { gaps: [], unsourcedClaims: [], placeholders: [] } });
  if (/"gaps"/.test(system)) return JSON.stringify({ gaps: [], unsourcedClaims: [], placeholders: [] });
  return text;
};

test("auth accepts any configured key and rejects others", () => {
  assert.equal(requireApiKey(authed({}, "key-a")), null);
  assert.equal(requireApiKey(authed({}, "key-b")), null);
  assert.equal(requireApiKey(authed({}, "key-c")).status, 401);
  assert.equal(requireApiKey(new Request("http://localhost", { headers: { "X-API-Key": "key-a" } })), null);
  assert.equal(requireApiKey(new Request("http://localhost")).status, 401);
});

test("payload rejects unknown options instead of silently defaulting", () => {
  assert.equal(parseHumanizeBody({ text, voice: "loud" }).ok, false);
  assert.equal(parseHumanizeBody({ text: "" }).ok, false);
  assert.equal(parseHumanizeBody({ text, targetWords: 50 }).ok, false);
  const parsed = parseHumanizeBody({ text, keywords: "کتاب، مطالعه" });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.payload.keywords, ["کتاب", "مطالعه"]);
  assert.equal(parsed.payload.voice, "standard");
});

test("sync endpoint returns the final text as JSON", async (t) => {
  mockProvider(t, reply);
  const response = await humanize(authed({ text, voice: "casual" }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.text, text);
  assert.equal(data.details.quality.voice, "casual");
  assert.ok(data.publication.status);
});

test("sync endpoint requires a key", async () => {
  const response = await humanize(new Request("http://localhost/api/v1/humanize", { method: "POST", body: JSON.stringify({ text }) }));
  assert.equal(response.status, 401);
});

test("job endpoint queues work and exposes the result", async (t) => {
  mockProvider(t, reply);
  const created = await createJob(new Request("http://localhost/api/v1/jobs", {
    method: "POST", headers: { Authorization: "Bearer key-a" }, body: JSON.stringify({ text }),
  }));
  assert.equal(created.status, 202);
  const { id } = await created.json();
  let state;
  for (let i = 0; i < 50; i++) {
    const res = await getJob(new Request(`http://localhost/api/v1/jobs/${id}`, { headers: { Authorization: "Bearer key-a" } }), { params: Promise.resolve({ id }) });
    state = await res.json();
    if (state.status === "succeeded" || state.status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(state.status, "succeeded");
  assert.equal(state.result.text, text);
});

test("panel check reports key, missing models and price caps", async (t) => {
  const { GET: check } = await jiti.import("../src/app/api/panel/check/route.ts");
  const saved = { base: process.env.LLM_BASE_URL, writer: process.env.LLM_WRITER_MODEL };
  process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";
  process.env.LLM_WRITER_MODEL = "vendor/cheap";
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/key")) {
      assert.equal(init.headers.Authorization, "Bearer provider-key");
      return Response.json({ data: { usage: 1.5, limit: 10, limit_remaining: 8.5 } });
    }
    return Response.json({ data: [
      { id: "vendor/cheap", pricing: { prompt: "0.0000002", completion: "0.000001" } },
      { id: "openai/gpt-5.6-luna", pricing: { prompt: "0.000003", completion: "0.000015" } },
    ] });
  };
  t.after(() => {
    globalThis.fetch = original;
    process.env.LLM_BASE_URL = saved.base;
    if (saved.writer === undefined) delete process.env.LLM_WRITER_MODEL; else process.env.LLM_WRITER_MODEL = saved.writer;
  });
  const data = await (await check()).json();
  assert.equal(data.key.valid, true);
  assert.equal(data.key.limitRemaining, 8.5);
  const byRole = Object.fromEntries(data.models.map((m) => [m.role, m]));
  assert.equal(byRole.writer.found, true);
  assert.equal(byRole.writer.withinCap, true);
  assert.equal(byRole.writer.inputPerM, 0.2);
  assert.equal(byRole.critic.withinCap, false); // $15/M output exceeds the default $5 cap
  assert.equal(byRole.refiner.found, false);
  assert.equal(data.ready, false);
});
