// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const { compileFunction } = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const owner = path.join(root, "packages/features/package.json");
const load = createRequire(owner);
const sdk = load("@trigger.dev/sdk");
const coreLoad = createRequire(load.resolve("@trigger.dev/sdk"));
const core = coreLoad("@trigger.dev/core/v3");

test("the SDK, core and CLI resolve the qualified stable family", async () => {
  const manifest = JSON.parse(fs.readFileSync(owner, "utf8"));
  assert.equal(manifest.dependencies["@trigger.dev/sdk"], "4.7.4");
  assert.equal(manifest.devDependencies["trigger.dev"], "4.7.4");
  assert.equal(load("@trigger.dev/sdk/package.json").version, "4.7.4");
  assert.equal(coreLoad("@trigger.dev/core/package.json").version, "4.7.4");
  assert.equal(load("trigger.dev/package.json").version, "4.7.4");
  const cliLoad = createRequire(load.resolve("trigger.dev/package.json"));
  assert.equal(cliLoad("systeminformation/package.json").version, "5.33.15");
  const esm = await import("@trigger.dev/sdk");
  for (const name of ["schemaTask", "queue", "defineConfig", "configure"]) {
    assert.equal(typeof sdk[name], "function");
    assert.equal(typeof esm[name], "function");
  }
});

function actualConfig(relative) {
  const file = path.join(root, "packages/features", relative);
  const result = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  assert.deepEqual(result.diagnostics, []);
  const module = { exports: {} };
  compileFunction(result.outputText, ["require", "module", "exports"], { filename: file })(
    (name) => {
      assert.equal(name, "@trigger.dev/sdk");
      return sdk;
    },
    module,
    module.exports
  );
  return module.exports;
}

for (const [file, exported, queueName, concurrency] of [
  ["webhooks/lib/tasker/trigger/config.ts", "webhookDeliveryTaskConfig", "webhook-delivery", 25],
  ["calendars/lib/tasker/trigger/config.ts", "calendarsTaskConfig", "calendars", 10],
  [
    "bookings/lib/tasker/trigger/notifications/config.ts",
    "bookingNotificationsTaskConfig",
    "booking-notifications",
    20,
  ],
]) {
  test(`the actual ${queueName} configuration works with the native SDK`, () => {
    const config = actualConfig(file)[exported];
    assert.equal(config.queue.name, queueName);
    assert.equal(config.queue.concurrencyLimit, concurrency);
    assert.equal(config.retry.maxAttempts, 3);
    const task = sdk.schemaTask({
      id: `compatibility.${queueName}`,
      ...config,
      schema: load("zod").z.object({ operationId: load("zod").z.string() }),
      run: async (payload) => payload.operationId,
    });
    assert.equal(typeof task.trigger, "function");
    assert.equal(typeof task.batchTrigger, "function");
  });
}

test("valid native metadata operations preserve nested updates and clone the input", () => {
  const original = { state: { count: 2 }, labels: ["first"] };
  const result = core.applyMetadataOperations(original, [
    { type: "set", key: "$.state.status", value: "ready" },
    { type: "increment", key: "$.state.count", value: 3 },
    { type: "append", key: "labels", value: "second" },
    { type: "remove", key: "labels", value: "first" },
  ]);
  assert.deepEqual(result.unappliedOperations, []);
  assert.deepEqual(result.newMetadata, { state: { count: 5, status: "ready" }, labels: ["second"] });
  assert.deepEqual(original, { state: { count: 2 }, labels: ["first"] });
});

for (const key of [
  "__proto__",
  "$.__proto__.calTriggerCompatProbe",
  "$.constructor.prototype.calTriggerCompatProbe",
  "$.safe['__proto__'].calTriggerCompatProbe",
]) {
  for (const type of ["set", "append", "remove", "increment", "delete"]) {
    test(`native metadata rejects unsafe ${type} key ${key}`, () => {
      const operation =
        type === "delete"
          ? { type, key }
          : { type, key, value: type === "increment" ? 1 : { calTriggerCompatProbe: true } };
      try {
        assert.equal(Object.hasOwn(Object.prototype, "calTriggerCompatProbe"), false);
        assert.equal(core.RunMetadataChangeOperation.safeParse(operation).success, false);
        const result = core.applyMetadataOperations({ safe: {} }, operation);
        assert.deepEqual(result.unappliedOperations, [operation]);
        assert.deepEqual(result.newMetadata, { safe: {} });
        assert.equal(Object.getPrototypeOf(result.newMetadata), Object.prototype);
        assert.equal(Object.hasOwn(Object.prototype, "calTriggerCompatProbe"), false);
      } finally {
        // Bound a regression in an older native dependency to this test process.
        delete Object.prototype.calTriggerCompatProbe;
      }
    });
  }
}
