import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, cpus, platform } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { WebSocket } from "ws";
import { createApp } from "../../apps/server/app.ts";
import { creatureStepMs } from "../../packages/shared/creatures.ts";

async function measure(worlds) {
  const directory = mkdtempSync(join(tmpdir(), "ure-creature-bench-"));
  const sockets = [];
  const samples = [];
  let messages = 0;
  const app = createApp(join(directory, "bench.sqlite"), {
    onCreatureTick: (sample) =>
      samples.push({ ...sample, at: performance.now() }),
  });
  try {
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    let cookie = "";
    const post = async (path, payload) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/" + path,
        headers: { cookie },
        payload,
      });
      assert.equal(response.statusCode, 200, path);
      return response;
    };
    for (let i = 0; i < worlds; i++) {
      if (i % 12 === 0) {
        // Register a separate owner without revoking the first owner's socket session.
        cookie = "";
        const identity = await post("auth/register", {
          name: "benchmark" + i,
          email: "bench" + i + "@example.test",
          display: "Проба",
          password: "Шалфей глина вёсла мозаика",
          confirmation: "Шалфей глина вёсла мозаика",
          avatar: "leaf",
          accepted: true,
        });
        cookie = String(identity.headers["set-cookie"]).split(";")[0];
      }
      const { id } = (
        await post("worlds", {
          name: "Замер " + i,
          description: "",
          seed: "bench" + i,
          land: "Лес",
          access: "invite",
          ai: false,
        })
      ).json();
      await post("worlds/" + id + "/room", {});
      await post("worlds/" + id + "/character", {
        name: "Проба",
        race: "R-001",
        profession: "C-001",
        flaw: "Утомляемость",
        mode: "manual",
      });
      const ws = new WebSocket(
        origin.replace(/^http/, "ws") + "/live?world=" + id,
        { headers: { cookie } },
      );
      sockets.push(ws);
      await once(ws, "open");
      ws.on("message", (message) => {
        if (String(message) === "changed") messages++;
      });
    }
    samples.length = 0;
    messages = 0;
    const clock = performance.now(),
      cpu = process.cpuUsage();
    let peakRss = 0,
      peakHeap = 0;
    while (samples.length < 6) {
      assert.ok(performance.now() - clock < 20000, "Scheduler stalled");
      const memory = process.memoryUsage();
      peakRss = Math.max(peakRss, memory.rss);
      peakHeap = Math.max(peakHeap, memory.heapUsed);
      await setTimeout(100);
    }
    const elapsed = performance.now() - clock;
    const used = process.cpuUsage(cpu);
    const active = samples.splice(0);
    assert.ok(
      active.every(
        (sample) =>
          sample.active === worlds &&
          sample.sceneWrites <= 8 &&
          sample.notifications <= 8 &&
          new Set(sample.updated).size === sample.updated.length,
      ),
      JSON.stringify(
        active.map(({ active, sceneWrites, notifications, updated }) => ({
          active,
          sceneWrites,
          notifications,
          processed: updated.length,
        })),
      ),
    );
    assert.equal(
      new Set(active.flatMap((sample) => sample.updated)).size,
      worlds,
    );
    const observedMessages = messages;
    await Promise.all(
      sockets.map(async (ws) => {
        const closed = once(ws, "close");
        ws.close();
        await closed;
      }),
    );
    const cleanupDeadline = performance.now() + creatureStepMs * 3;
    while (samples.filter((sample) => sample.active === 0).length < 2) {
      assert.ok(
        performance.now() < cleanupDeadline,
        "Inactive worlds were not released",
      );
      await setTimeout(100);
    }
    const inactive = samples.filter((sample) => sample.active === 0);
    assert.ok(
      inactive.every(
        (sample) =>
          !sample.sceneWrites &&
          !sample.characterWrites &&
          !sample.notifications &&
          !sample.updated.length,
      ),
    );
    const visits = new Map(),
      gaps = [];
    for (const sample of active)
      for (const id of sample.updated) {
        if (visits.has(id)) gaps.push(sample.at - visits.get(id));
        visits.set(id, sample.at);
      }
    const durations = active
      .map((sample) => sample.durationMs)
      .sort((a, b) => a - b);
    const mean = (field) =>
      active.reduce((sum, sample) => sum + sample[field], 0) / active.length;
    return {
      worlds,
      fieldCreaturesPerWorld: 3,
      ticks: active.length,
      meanTickMs: mean("durationMs"),
      maxTickMs: durations.at(-1),
      delayedOver100Ms: active.filter((sample) => sample.delayMs > 100).length,
      maxDelayMs: Math.max(...active.map((sample) => sample.delayMs)),
      cpuPercentOneCore: (used.user + used.system) / elapsed / 10,
      peakRssMiB: peakRss / 1048576,
      peakHeapMiB: peakHeap / 1048576,
      sceneWritesPerTick: mean("sceneWrites"),
      characterRowWritesPerTick: mean("characterWrites"),
      notificationsPerTick: mean("notifications"),
      observedMessages,
      maxWorldRevisitMs: Math.max(...gaps),
      inactiveTicksWithNoWrites: inactive.length,
    };
  } finally {
    for (const ws of sockets) ws.terminate();
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
const result = {
  node: process.version,
  platform: platform(),
  cpu: cpus()[0]?.model,
  logicalCpus: cpus().length,
  results: [],
};
for (const worlds of [1, 5, 20]) {
  const row = await measure(worlds);
  result.results.push(row);
  console.log(JSON.stringify(row));
}
mkdirSync("test-results/toolchain", { recursive: true });
writeFileSync(
  "test-results/toolchain/creatures-benchmark.json",
  JSON.stringify(result, null, 2),
);
