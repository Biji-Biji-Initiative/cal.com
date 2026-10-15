// SPDX-License-Identifier: MIT
// Actual retained task handler; delivery outcomes are controlled here. The
// built-application fixture separately exercises real local HTTP delivery.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { sourceModules } = require("./tasker-fixture.cjs");
const payload = JSON.stringify({
  secretKey: "synthetic-signing-marker",
  triggerEvent: "BOOKING_CREATED",
  createdAt: "2030-01-01T00:00:00Z",
  webhook: {
    subscriberUrl: "http://127.0.0.1:1/never-called",
    appId: null,
    payloadTemplate: null,
    version: "2021-10-20",
  },
  data: { message: "Synthetic fixture", bookingUid: "fixture-booking" },
});
function fixture(deliver) {
  const m = sourceModules(
    {},
    {},
    {},
    {
      "@calcom/features/webhooks/lib/interface/IWebhookRepository": {
        WebhookVersion: { V_2021_10_20: "2021-10-20" },
      },
      "@calcom/features/webhooks/lib/sendPayload": { __esModule: true, default: deliver },
    }
  );
  return { ...m, ...m.load("packages/features/tasker/tasks/sendWebook.ts") };
}
for (const outcome of [
  { ok: false, status: 500 },
  { ok: false, status: 429 },
  { ok: false, status: 302 },
  undefined,
  { ok: true, status: 0 },
]) {
  test(`the task cannot acknowledge unaccepted delivery ${JSON.stringify(outcome)}`, async () => {
    const m = fixture(async () => outcome);
    await assert.rejects(m.sendWebhook(payload), (error) => error instanceof m.TaskOutcomeUnknownError);
  });
}
test("a transport exception becomes unconfirmed without raw exception or payload logging", async (t) => {
  const messages = [];
  const previous = console.error;
  console.error = (...parts) => messages.push(parts);
  t.after(() => {
    console.error = previous;
  });
  const m = fixture(async () => {
    throw new Error("synthetic-secret-error-marker");
  });
  await assert.rejects(
    m.sendWebhook(payload),
    (error) =>
      error instanceof m.TaskOutcomeUnknownError && !String(error).includes("synthetic-secret-error-marker")
  );
  assert.deepEqual(messages, []);
});
test("successful delivery forwards the active execution cancellation signal", async () => {
  const controller = new AbortController();
  let forwarded;
  const m = fixture(async (...args) => {
    forwarded = args[5];
    return { ok: true, status: 204 };
  });
  await m.sendWebhook(payload, "fixture-task", {
    signal: controller.signal,
    claim: { id: "fixture-task", token: "fixture", attempt: 1 },
  });
  assert.equal(forwarded, controller.signal);
});
test("malformed input never enters delivery and is not a claimed remote effect", async () => {
  let sends = 0;
  const m = fixture(async () => {
    sends++;
    return { ok: true, status: 204 };
  });
  await assert.rejects(m.sendWebhook("not-json"));
  assert.equal(sends, 0);
});
