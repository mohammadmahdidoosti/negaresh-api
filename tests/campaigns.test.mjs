import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createJiti } from "jiti";

// A throwaway Redis on a free port; skipped when redis-server is not installed.
const port = 6300 + Math.floor(Math.random() * 600);
let redis;
try {
  redis = spawn("redis-server", ["--port", String(port), "--save", "", "--appendonly", "no"], { stdio: "ignore" });
  await new Promise((resolve, reject) => { redis.once("error", reject); setTimeout(resolve, 400); });
} catch {
  redis = null;
}
process.env.REDIS_URL = `redis://127.0.0.1:${port}`;
process.env.CONTENT_CAMPAIGN_CONCURRENCY = "2";
const jiti = createJiti(import.meta.url, { tryNative: false, alias: { "@": new URL("../src", import.meta.url).pathname } });
const c = redis ? await jiti.import("../src/lib/content/campaigns.ts") : null;
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(50); } return false; };

test.after(async () => {
  const kv = globalThis.__negareshKv && (await globalThis.__negareshKv);
  await kv?.quit().catch(() => {});
  redis?.kill();
});

test("campaign works through its categories, most products first, and counts cost", { skip: !redis }, async () => {
  const seen = [];
  c.setCampaignRunnerForTests(async req => { seen.push(req.category); await wait(20); return { resultId: `r-${req.category}`, qa: { level: "pass" }, cost: { usd: 0.005 } }; });
  const created = await c.createCampaign({ label: "t1", limit: 6, onlyMissing: false });
  assert.equal(created.total, 6);
  assert.ok(await until(async () => (await c.getCampaign(created.id)).status === "done"));
  const v = await c.getCampaign(created.id);
  assert.equal(v.done, 6);
  assert.ok(Math.abs(v.spentUsd - 0.03) < 1e-9);
  assert.deepEqual(seen.slice().sort(), c.plannedCategories({ limit: 6 }).slice().sort());
  const log = await c.campaignLog(created.id);
  assert.equal(log.length, 6);
});

test("no-products is skipped, errors are counted, budget pauses the campaign", { skip: !redis }, async () => {
  const { PipelineError } = await jiti.import("../src/lib/api/runner.ts");
  let n = 0;
  c.setCampaignRunnerForTests(async () => {
    n += 1;
    if (n === 1) throw new PipelineError("no products", 422, "no_products");
    if (n === 2) throw new Error("boom");
    return { resultId: `r${n}`, qa: { level: "warn" }, cost: { usd: 0.01 } };
  });
  const created = await c.createCampaign({ label: "t2", limit: 10, onlyMissing: false, maxUsd: 0.02 });
  assert.ok(await until(async () => (await c.getCampaign(created.id)).status === "paused"));
  await wait(150);
  const v = await c.getCampaign(created.id);
  assert.equal(v.skipped, 1);
  assert.equal(v.failed, 1);
  assert.ok(v.spentUsd >= 0.02);
  assert.ok(v.queued > 0, "work left after the budget stop");
  await c.setCampaignStatus(created.id, "cancel");
  assert.equal((await c.getCampaign(created.id)).queued, 0);
});

test("pause stops new work; resume continues", { skip: !redis }, async () => {
  c.setCampaignRunnerForTests(async () => { await wait(30); return { resultId: "x", qa: { level: "pass" }, cost: { usd: 0 } }; });
  const created = await c.createCampaign({ label: "t3", limit: 8, onlyMissing: false });
  await c.setCampaignStatus(created.id, "pause");
  await wait(200);
  const paused = await c.getCampaign(created.id);
  assert.equal(paused.status, "paused");
  assert.ok(paused.done < 8);
  await c.setCampaignStatus(created.id, "resume");
  assert.ok(await until(async () => (await c.getCampaign(created.id)).status === "done"));
  assert.equal((await c.getCampaign(created.id)).done, 8);
});

test("a category without heartbeat goes back to the queue; a live one from another container does not", { skip: !redis }, async () => {
  const seen = [];
  c.setCampaignRunnerForTests(async req => { seen.push(req.category); return { resultId: "x", qa: { level: "pass" }, cost: { usd: 0 } }; });
  const created = await c.createCampaign({ label: "t4", limit: 3, onlyMissing: false });
  await c.setCampaignStatus(created.id, "pause");
  assert.ok(await until(async () => (await c.getCampaign(created.id)).inflight.length === 0));
  const kv = await globalThis.__negareshKv;
  const key = `content:campaign:${created.id}:inflight`;
  await kv.hSet(key, "abandoned-id", JSON.stringify({ instance: "dead-container", at: Date.now() - 10 * 60_000 }));
  await kv.hSet(key, "live-id", JSON.stringify({ instance: "other-container", at: Date.now() }));
  seen.length = 0;
  await c.setCampaignStatus(created.id, "resume");
  assert.ok(await until(async () => seen.includes("abandoned-id")));
  await wait(200);
  assert.ok(!seen.includes("live-id"), "live work of another container is left alone");
  assert.deepEqual((await c.getCampaign(created.id)).inflight, ["live-id"]);
  await kv.hDel(key, "live-id");
});

test("inflight kept as a plain set (first version) is migrated back to the queue", { skip: !redis }, async () => {
  const seen = [];
  c.setCampaignRunnerForTests(async req => { seen.push(req.category); return { resultId: "x", qa: { level: "pass" }, cost: { usd: 0 } }; });
  const created = await c.createCampaign({ label: "t5", limit: 1, onlyMissing: false });
  await c.setCampaignStatus(created.id, "pause");
  assert.ok(await until(async () => (await c.getCampaign(created.id)).inflight.length === 0));
  const kv = await globalThis.__negareshKv;
  const key = `content:campaign:${created.id}:inflight`;
  await kv.del(key);
  await kv.sAdd(key, "old-format-id");
  seen.length = 0;
  await c.setCampaignStatus(created.id, "resume");
  assert.ok(await until(async () => (await c.getCampaign(created.id)).status === "done"));
  assert.ok(seen.includes("old-format-id"));
});
