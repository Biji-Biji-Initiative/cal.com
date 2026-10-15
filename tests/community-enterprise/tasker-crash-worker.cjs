// SPDX-License-Identifier: MIT
// Only spawned by the disposable Tasker tests. It cannot relay to an external
// provider or use a configured application database.
const assert = require("node:assert/strict");
const { connectFixture, sourceModules } = require("./tasker-fixture.cjs");
(async () => {
  const endpoint = new URL(process.env.CAL_TASKER_TEST_EFFECT_URL);
  assert.equal(endpoint.protocol, "http:");
  assert.equal(endpoint.hostname, "127.0.0.1");
  const db = await connectFixture(1);
  const m = sourceModules(db);
  const processor = new m.TaskProcessor({
    repository: new m.TaskRepository({ prismaClient: db }),
    concurrency: 1,
    maxTasks: 1,
    leaseMs: 20000,
    heartbeatMs: 500,
    taskTimeoutMs: 15000,
    handlers: {
      sendWebhook: async () => async (_payload, taskId) => {
        const response = await fetch(endpoint, { method: "POST", signal: AbortSignal.timeout(5000) });
        assert.equal(response.status, 204);
        process.send?.({ phase: "effect-recorded", taskId });
        // The parent terminates this owned worker after the effect but before a
        // local acknowledgement, reproducing the uncertain crash boundary.
        await new Promise(() => {});
      },
    },
  });
  try {
    await processor.processQueue();
  } finally {
    await db.$disconnect();
  }
})().catch(() => {
  process.send?.({ phase: "fixture-failed" });
  process.exitCode = 1;
});
