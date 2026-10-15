// SPDX-License-Identifier: MIT
// Actual built Next route, default TaskProcessor/registry and real PostgreSQL.
// The sendSms registry entry intentionally rejects. A local HTTP sink exercises
// the real signed-webhook handler; no customer endpoint or provider is contacted.
const assert = require("node:assert/strict");
const { createHmac, randomBytes, randomUUID } = require("node:crypto");
const { createServer } = require("node:http");
const { once } = require("node:events");
const origin = "http://127.0.0.1:38917";
async function seedTaskerFixture(pool) {
  const secret = randomBytes(32).toString("hex");
  const marker = "fixture-private-" + randomUUID();
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  for (const [index, type, attempts, due, state] of [
    [0, "sendSms", 0, true, null],
    [1, "fixture-unsupported-handler", 0, true, null],
    [2, "sendSms", 1, true, "tasker:v1:running:" + randomUUID()],
    [3, "sendSms", 0, false, null],
  ]) {
    await pool.query(
      'INSERT INTO "Task" (id,type,payload,attempts,"maxAttempts","scheduledAt","lastError","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())',
      [
        ids[index],
        type,
        marker,
        attempts,
        index === 0 ? 1 : 3,
        new Date(Date.now() + (due ? -60000 : 3600000)),
        state,
      ]
    );
  }
  return { secret, marker, ids };
}
async function runTaskerJourney({ pool, fixture, t }) {
  const request = (path, credential) =>
    fetch(origin + path, {
      redirect: "manual",
      headers: credential ? { Authorization: credential } : {},
      signal: AbortSignal.timeout(30000),
    });
  const read = async () =>
    (await pool.query('SELECT id,attempts,"succeededAt","lastError" FROM "Task" ORDER BY id')).rows;
  const before = await read();
  for (const path of ["/api/tasks/cron", "/api/tasks/cleanup"]) {
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, "Bearer undefined")).status, 401);
  }
  assert.deepEqual(await read(), before);
  const response = await request("/api/tasks/cron", `Bearer ${fixture.secret}`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.attentionRequired, true);
  assert.deepEqual(result.processing, {
    claimed: 2,
    succeeded: 0,
    retryScheduled: 0,
    exhausted: 1,
    unconfirmed: 1,
    recoveredInterruptions: 1,
    pendingReconciliation: 2,
    exhaustedTotal: 1,
  });
  assert.ok(!JSON.stringify(result).includes(fixture.secret));
  assert.ok(!JSON.stringify(result).includes(fixture.marker));
  const rows = await read();
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.equal(byId.get(fixture.ids[0]).attempts, 1);
  assert.equal(byId.get(fixture.ids[0]).lastError, "tasker:v1:retry:handler_failed");
  assert.equal(byId.get(fixture.ids[1]).attempts, 1);
  assert.match(byId.get(fixture.ids[1]).lastError, /^tasker:v1:unconfirmed:/);
  assert.equal(byId.get(fixture.ids[2]).attempts, 1);
  assert.equal(byId.get(fixture.ids[2]).lastError, "tasker:v1:unconfirmed:interrupted");
  assert.equal(byId.get(fixture.ids[3]).attempts, 0);
  const repeated = await (await request("/api/tasks/cron", `Bearer ${fixture.secret}`)).json();
  assert.equal(repeated.processing.claimed, 0);
  assert.equal(repeated.processing.pendingReconciliation, 2);
  assert.equal(repeated.processing.exhaustedTotal, 1);
  assert.equal(repeated.attentionRequired, true);
  assert.equal((await request("/api/tasks/cleanup", `Bearer ${fixture.secret}`)).status, 200);
  assert.deepEqual(await read(), rows);
  // Only in this disposable fixture, remove the two uncertainty records so a
  // persistent terminal failure is tested independently of that alert source.
  await pool.query('DELETE FROM "Task" WHERE id = ANY($1::text[])', [[fixture.ids[1], fixture.ids[2]]]);
  const terminalOnly = await (await request("/api/tasks/cron", `Bearer ${fixture.secret}`)).json();
  assert.equal(terminalOnly.processing.claimed, 0);
  assert.equal(terminalOnly.processing.pendingReconciliation, 0);
  assert.equal(terminalOnly.processing.exhaustedTotal, 1);
  assert.equal(terminalOnly.attentionRequired, true);

  const deliveries = [],
    deliveryErrors = [];
  const receiver = createServer(async (request, response) => {
    try {
      assert.equal(request.method, "POST");
      assert.ok(["/accepted", "/unconfirmed"].includes(request.url));
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      assert.equal(
        request.headers["x-cal-signature-256"],
        createHmac("sha256", fixture.secret).update(raw).digest("hex")
      );
      assert.equal(request.headers["x-cal-webhook-version"], "2021-10-20");
      assert.equal(JSON.parse(raw).payload.bookingUid, fixture.marker);
      deliveries.push(request.url);
      response.writeHead(request.url === "/accepted" ? 204 : 503);
      response.end();
    } catch {
      deliveryErrors.push("Synthetic receiver contract failed");
      response.writeHead(500);
      response.end();
    }
  });
  receiver.listen(0, "127.0.0.1");
  await once(receiver, "listening");
  try {
    for (const target of ["accepted", "unconfirmed"]) {
      const id = randomUUID();
      const payload = JSON.stringify({
        secretKey: fixture.secret,
        triggerEvent: "BOOKING_CREATED",
        createdAt: new Date().toISOString(),
        webhook: {
          subscriberUrl: `http://127.0.0.1:${receiver.address().port}/${target}`,
          appId: null,
          payloadTemplate: null,
          version: "2021-10-20",
        },
        data: { message: "Synthetic acknowledgement", bookingUid: fixture.marker },
      });
      await pool.query(
        'INSERT INTO "Task" (id,type,payload,"scheduledAt","updatedAt") VALUES ($1,$2,$3,$4,NOW())',
        [id, "sendWebhook", payload, new Date(0)]
      );
      const requestResult = await fetch(origin + "/api/tasks/cron", {
        method: "POST",
        headers: { Authorization: `Bearer ${fixture.secret}` },
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(requestResult.status, 200);
      const result = await requestResult.json();
      assert.equal(result.processing.claimed, 1);
      assert.equal(result.processing.succeeded, target === "accepted" ? 1 : 0);
      assert.equal(result.processing.unconfirmed, target === "unconfirmed" ? 1 : 0);
      const persisted = (
        await pool.query('SELECT attempts,"succeededAt","lastError" FROM "Task" WHERE id=$1', [id])
      ).rows[0];
      assert.equal(persisted.attempts, 1);
      if (target === "accepted") assert.ok(persisted.succeededAt);
      else {
        assert.equal(persisted.succeededAt, null);
        assert.match(persisted.lastError, /^tasker:v1:unconfirmed:/);
      }
      assert.ok(!JSON.stringify(result).includes(fixture.marker));
      assert.ok(!JSON.stringify(result).includes(fixture.secret));
    }
    assert.deepEqual(deliveryErrors, []);
    assert.deepEqual(deliveries, ["/accepted", "/unconfirmed"]);
    const again = await (await request("/api/tasks/cron", `Bearer ${fixture.secret}`)).json();
    assert.equal(again.processing.claimed, 0);
    assert.equal(again.processing.pendingReconciliation, 1);
    assert.equal(again.attentionRequired, true);
    assert.equal(deliveries.length, 2);
  } finally {
    receiver.closeAllConnections();
    await new Promise((resolve) => receiver.close(resolve));
  }
  t.diagnostic(
    JSON.stringify({
      source: "built native Tasker GET routes",
      admittedTasks: 2,
      recoveredInterruptions: 1,
      replayedUnconfirmedTasks: 0,
      unauthorizedRequests: 4,
      futureTaskUntouched: true,
      cleanupPreservedEvidence: true,
      signedWebhookAcknowledged: true,
      signedWebhookNon2xxPreserved: true,
      laterCronReplayedDeliveries: 0,
      scope:
        "synthetic queue records and real current application/PostgreSQL; no customer notifications or external provider operations",
    })
  );
}
module.exports = { seedTaskerFixture, runTaskerJourney };
