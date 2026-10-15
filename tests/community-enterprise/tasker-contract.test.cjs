// SPDX-License-Identifier: MIT
// Actual cron route functions and Node crypto; only queue work is replaced.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomBytes } = require("node:crypto");
const { sourceModules } = require("./tasker-fixture.cjs");
let summary = { claimed: 0, pendingReconciliation: 2, exhaustedTotal: 0 };
let processed = 0,
  cleaned = 0;
const f = sourceModules(
  {},
  {},
  {},
  {
    "../task-processor": {
      TaskProcessor: class {
        async processQueue() {
          processed++;
          return summary;
        }
      },
    },
    "..": {
      __esModule: true,
      default: {
        cleanup: async () => {
          cleaned++;
        },
      },
    },
  }
);
const cron = f.load("packages/features/tasker/api/cron.ts");
const cleanup = f.load("packages/features/tasker/api/cleanup.ts");
const { isTaskCronAuthorized } = f.load("packages/features/tasker/api/authorization.ts");
const invoke = (route, method, header) =>
  route[method](
    new Request("http://127.0.0.1/api/tasks/cron", {
      method,
      headers: header ? { Authorization: header } : {},
    })
  );
const withSecret = async (secret, run) => {
  const before = process.env.CRON_SECRET;
  if (secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = secret;
  try {
    await run();
  } finally {
    if (before === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before;
  }
};
for (const [secret, header] of [
  [undefined, "Bearer undefined"],
  ["", "Bearer "],
  ["  ", "Bearer   "],
  ["present-fixture", null],
  ["present-fixture", "Bearer wrong-fixture"],
]) {
  test(`cron and cleanup refuse absent or incorrect configuration ${JSON.stringify([secret, header])}`, async () =>
    withSecret(secret, async () => {
      const prior = [processed, cleaned];
      for (const method of ["GET", "POST"]) assert.equal((await invoke(cron, method, header)).status, 401);
      assert.equal((await invoke(cleanup, "GET", header)).status, 401);
      assert.deepEqual([processed, cleaned], prior);
    }));
}
test("valid configured credential admits both cron methods and cleanup without echoing it", async () => {
  const secret = randomBytes(32).toString("hex");
  await withSecret(secret, async () => {
    for (const method of ["GET", "POST"]) {
      const response = await invoke(cron, method, `Bearer ${secret}`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.success, true);
      assert.equal(body.processing.pendingReconciliation, 2);
      assert.ok(!JSON.stringify(body).includes(secret));
    }
    assert.equal((await invoke(cleanup, "GET", `Bearer ${secret}`)).status, 200);
  });
});
test("authorization follows current configuration rather than retaining a previous secret", async () => {
  await withSecret("fixture-before", async () => {
    assert.equal((await invoke(cron, "GET", "Bearer fixture-before")).status, 200);
    process.env.CRON_SECRET = "fixture-after";
    assert.equal((await invoke(cron, "GET", "Bearer fixture-before")).status, 401);
    assert.equal((await invoke(cron, "GET", "Bearer fixture-after")).status, 200);
  });
});
test("constant-size comparison rejects length, Unicode and oversized-header differences", () => {
  assert.equal(isTaskCronAuthorized("Bearer same", "same"), true);
  for (const value of [
    "Bearer sam",
    "Bearer same-longer",
    "bearer same",
    "Bearer sáme",
    "Bearer " + "x".repeat(9000),
  ])
    assert.equal(isTaskCronAuthorized(value, "same"), false);
});

test("cron keeps attention active for exhausted work from an earlier invocation", async () => {
  const previous = summary;
  summary = { claimed: 0, pendingReconciliation: 0, exhaustedTotal: 1, exhausted: 0 };
  try {
    await withSecret("fixture", async () => {
      const body = await (await invoke(cron, "GET", "Bearer fixture")).json();
      assert.equal(body.attentionRequired, true);
      assert.equal(body.processing.exhaustedTotal, 1);
    });
  } finally {
    summary = previous;
  }
});
