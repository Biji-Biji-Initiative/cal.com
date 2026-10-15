// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const { before, beforeEach, after, test } = require("node:test");
const { randomUUID } = require("node:crypto");
const { once } = require("node:events");
const { createServer } = require("node:http");
const { fork } = require("node:child_process");
const path = require("node:path");
const { sourceModules, connectFixture } = require("./tasker-fixture.cjs");
let db, modules, repository;
before(async () => {
  db = await connectFixture();
  modules = sourceModules(db);
  repository = new modules.TaskRepository({ prismaClient: db });
});
beforeEach(async () => {
  await db.task.deleteMany();
});
after(async () => {
  if (db) await db.$disconnect();
});
const create = (payload = "fixture", options = {}, type = "sendWebhook") =>
  repository.create(type, payload, { scheduledAt: new Date(0), ...options });
const row = (id) => db.task.findUniqueOrThrow({ where: { id } });
const expire = (id) =>
  db.$executeRaw`UPDATE "Task" SET "scheduledAt"=(clock_timestamp() AT TIME ZONE 'UTC') - interval '1 millisecond' WHERE id=${id}`;
function processor(handler = async () => {}, options = {}) {
  return new modules.TaskProcessor({
    repository,
    handlers: { sendWebhook: async () => handler },
    concurrency: 2,
    maxTasks: 20,
    leaseMs: 10000,
    heartbeatMs: 500,
    taskTimeoutMs: 8000,
    ...options,
  });
}
function gate() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function withLease(claim, operation, signal = new AbortController().signal) {
  return modules.taskExecution.run({ claim, signal }, operation);
}

test("claim is durable before execution and success consumes exactly one attempt", async () => {
  const id = await create("marker", { maxAttempts: 1 });
  const claim = await repository.claimNext(10000);
  assert.equal(claim.id, id);
  assert.equal(claim.payload, "marker");
  assert.equal((await row(id)).attempts, 1);
  assert.match((await row(id)).lastError, /^tasker:v1:running:/);
  assert.equal(await repository.claimNext(10000), null);
  assert.equal(await repository.settle(claim, "succeeded"), true);
  assert.ok((await row(id)).succeededAt);
  assert.equal((await row(id)).attempts, 1);
  assert.equal(await repository.countFailed(), 0);
  assert.equal(await repository.countSucceeded(), 1);
});
test("future, succeeded and exhausted tasks are not claimed", async () => {
  const future = await create("future", { scheduledAt: new Date(Date.now() + 60000) });
  const completed = await create();
  await db.task.update({ where: { id: completed }, data: { succeededAt: new Date() } });
  const exhausted = await create();
  await db.task.update({ where: { id: exhausted }, data: { attempts: 7, maxAttempts: 3 } });
  assert.equal(await repository.claimNext(10000), null);
  assert.equal(await repository.countUpcoming(), 0);
  assert.equal(await repository.countFailed(), 1);
  assert.equal((await row(future)).attempts, 0);
});
test("the due boundary uses the database clock, not caller Date", async () => {
  const id = await create();
  await db.$executeRaw`UPDATE "Task" SET "scheduledAt"=(clock_timestamp() AT TIME ZONE 'UTC') WHERE id=${id}`;
  assert.equal((await repository.claimNext(10000)).id, id);
});
test("parallel claimers cannot claim the same work or exceed four active leases", async () => {
  for (let i = 0; i < 10; i++) await create();
  const claims = (await Promise.all(Array.from({ length: 10 }, () => repository.claimNext(10000)))).filter(
    Boolean
  );
  assert.equal(claims.length, 4);
  assert.equal(new Set(claims.map((c) => c.id)).size, 4);
  assert.equal(await repository.claimNext(10000), null);
  await repository.settle(claims[0], "succeeded");
  assert.ok(await repository.claimNext(10000));
});
test("two real processors execute each queued task once under overlap", async () => {
  for (let i = 0; i < 12; i++) await create(String(i));
  const seen = new Map();
  let active = 0,
    peak = 0;
  const handler = async (payload, id) => {
    active++;
    peak = Math.max(peak, active);
    seen.set(id, (seen.get(id) || 0) + 1);
    await new Promise((r) => setTimeout(r, 30));
    active--;
  };
  await Promise.all([processor(handler).processQueue(), processor(handler).processQueue()]);
  assert.equal(seen.size, 12);
  assert.ok(Array.from(seen.values()).every((n) => n === 1));
  assert.ok(peak <= 4);
  assert.equal(await repository.countSucceeded(), 12);
});
test("explicit ordinary handler failure keeps bounded scheduled retry semantics", async () => {
  const id = await create("private-marker", { maxAttempts: 2 });
  const fail = processor(
    async () => {
      throw new Error("fixture-sensitive-error");
    },
    { config: { sendWebhook: { minRetryIntervalMins: 0.01 } } }
  );
  const first = await fail.processQueue();
  assert.equal(first.retryScheduled, 1);
  const pending = await row(id);
  assert.equal(pending.attempts, 1);
  assert.equal(pending.lastError, modules.RETRY_ERROR);
  assert.equal(await repository.countUpcoming(), 0);
  await expire(id);
  const second = await processor().processQueue();
  assert.equal(second.succeeded, 1);
  assert.equal((await row(id)).attempts, 2);
  assert.equal(await repository.countFailed(), 0);
});
test("terminal failure is not retried beyond maxAttempts", async () => {
  const id = await create("fixture", { maxAttempts: 1 });
  const result = await processor(async () => {
    throw new Error("synthetic");
  }).processQueue();
  assert.equal(result.exhausted, 1);
  await expire(id);
  assert.equal(await repository.claimNext(10000), null);
  assert.equal(await repository.countFailed(), 1);
  assert.equal((await repository.getFailed())[0].id, id);
});
test("an explicit unconfirmed provider outcome pauses instead of repeating", async () => {
  const id = await create();
  let writes = 0;
  const work = processor(async () => {
    writes++;
    throw new modules.TaskOutcomeUnknownError();
  });
  const result = await work.processQueue();
  assert.equal(result.unconfirmed, 1);
  assert.match((await row(id)).lastError, /^tasker:v1:unconfirmed:/);
  await expire(id);
  assert.equal((await work.processQueue()).claimed, 0);
  assert.equal(writes, 1);
});
test("an expired worker is quarantined and late acknowledgements are fenced", async () => {
  const id = await create();
  const claim = await repository.claimNext(10000);
  await expire(id);
  assert.equal(await repository.renew(claim, 10000), false);
  assert.equal(await repository.settle(claim, "succeeded"), false);
  assert.equal(await repository.recoverExpired(), 1);
  assert.equal(await repository.recoverExpired(), 0);
  assert.equal(await repository.settle(claim, "retry"), false);
  assert.equal(await repository.claimNext(10000), null);
  assert.equal(await repository.countUnconfirmed(), 1);
  assert.equal(await repository.countFailed(), 1);
  assert.equal((await row(id)).attempts, 1);
});
test("old attempt, invented token and a reused task ID cannot complete another claim", async () => {
  const id = await create();
  const claim = await repository.claimNext(10000);
  assert.equal(await repository.settle({ ...claim, token: randomUUID() }, "succeeded"), false);
  assert.equal(await repository.renew({ ...claim, attempt: claim.attempt + 1 }, 10000), false);
  await repository.settle(claim, "retry", 1);
  await expire(id);
  const next = await repository.claimNext(10000);
  assert.equal(await repository.settle(claim, "succeeded"), false);
  assert.equal(next.attempt, 2);
  assert.equal(await repository.settle(next, "succeeded"), true);
});

test("heartbeat retains a live lease without consuming attempts", async () => {
  const id = await create();
  const claim = await repository.claimNext(10000);
  const before = await row(id);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(await repository.renew(claim, 10000), true);
  const after = await row(id);
  assert.equal(after.attempts, 1);
  assert.ok(after.scheduledAt.getTime() > before.scheduledAt.getTime());
});
test("current handler payload migration is fenced without changing its claim", async () => {
  const id = await create();
  const claim = await repository.claimNext(10000);
  await withLease(claim, () => repository.updatePayload(id, "migrated"));
  assert.equal((await row(id)).payload, "migrated");
  assert.equal(await repository.renew(claim, 10000), true);
  await assert.rejects(repository.updatePayload(id, "outside-handler"), /cannot be overwritten/);
  const other = await create();
  await assert.rejects(
    withLease(claim, () => repository.updatePayload(other, "foreign")),
    /no longer owns/
  );
  await expire(id);
  await repository.recoverExpired();
  await assert.rejects(
    withLease(claim, () => repository.updatePayload(id, "late")),
    /cannot be overwritten/
  );
  assert.equal((await row(id)).payload, "migrated");
});
test("aborted execution cannot mutate payload even before lease expiry", async () => {
  const id = await create();
  const claim = await repository.claimNext(10000);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    withLease(claim, () => repository.updatePayload(id, "late"), controller.signal),
    /no longer owns/
  );
  await assert.rejects(repository.succeed(id), /no longer owns/);
  await assert.rejects(repository.retry({ taskId: id }), /no longer owns/);
  assert.equal((await row(id)).payload, "fixture");
});
test("pending updates and cancellation remain compatible, active/uncertain records are preserved", async () => {
  const pending = await create();
  await repository.updatePayload(pending, "changed");
  assert.equal((await repository.cancel(pending)).id, pending);
  assert.equal(await repository.cancelWithReference("missing", "sendWebhook"), null);
  const id = await create("active", { referenceUid: "retained" });
  const claim = await repository.claimNext(10000);
  await assert.rejects(repository.cancel(id), /cannot be overwritten/);
  await assert.rejects(repository.cancelWithReference("retained", "sendWebhook"), /cannot be overwritten/);
  await repository.settle(claim, "unconfirmed");
  await assert.rejects(repository.cancel(id), /cannot be overwritten/);
  assert.equal((await row(id)).payload, "active");
});
test("cancelling after execution completed cannot delete its receipt", async () => {
  const id = await create();
  await processor().processQueue();
  assert.deepEqual(await repository.cancel(id), { id });
  assert.ok((await row(id)).succeededAt);
});
test("missing and malformed handlers become visible unconfirmed work instead of an endless hot loop", async () => {
  const id = await create("fixture", {}, "constructor");
  const result = await processor().processQueue();
  assert.equal(result.unconfirmed, 1);
  assert.equal((await row(id)).attempts, 1);
  await expire(id);
  assert.equal((await processor().processQueue()).claimed, 0);
  const malformed = await create();
  const second = await processor(() => undefined).processQueue();
  assert.equal(second.unconfirmed, 1);
  assert.equal((await row(malformed)).succeededAt, null);
});
test("synchronous handler errors are recorded as one failure rather than escaping accounting", async () => {
  const id = await create();
  await processor(() => {
    throw new Error("synchronous fixture error");
  }).processQueue();
  assert.equal((await row(id)).attempts, 1);
  assert.equal((await row(id)).lastError, modules.RETRY_ERROR);
});
test("a failed completion write cannot schedule the already-run side effect again", async () => {
  const id = await create();
  let effects = 0;
  class RefusedAcknowledgement extends modules.TaskRepository {
    async settle(claim, outcome, delay) {
      if (outcome === "succeeded") throw new Error("synthetic database refusal");
      return super.settle(claim, outcome, delay);
    }
  }
  const bad = new RefusedAcknowledgement({ prismaClient: db });
  await assert.rejects(
    processor(
      async () => {
        effects++;
      },
      { repository: bad }
    ).processQueue(),
    /state could not be confirmed/
  );
  assert.equal((await row(id)).succeededAt, null);
  assert.match((await row(id)).lastError, /^tasker:v1:unconfirmed:/);
  assert.equal(
    (
      await processor(async () => {
        effects++;
      }).processQueue()
    ).claimed,
    0
  );
  assert.equal(effects, 1);
});
test("task timeout signals the handler and keeps its unconfirmed effect out of retry", async () => {
  const id = await create();
  let sawAbort = false,
    effects = 0;
  const handler = async (_payload, _id, execution) => {
    effects++;
    await new Promise((resolve) =>
      execution.signal.addEventListener(
        "abort",
        () => {
          sawAbort = true;
          resolve();
        },
        { once: true }
      )
    );
  };
  const result = await processor(handler, {
    taskTimeoutMs: 100,
    heartbeatMs: 20,
    leaseMs: 1000,
  }).processQueue();
  assert.equal(result.unconfirmed, 1);
  assert.equal(sawAbort, true);
  assert.match((await row(id)).lastError, /^tasker:v1:unconfirmed:/);
  await expire(id);
  assert.equal((await processor(handler).processQueue()).claimed, 0);
  assert.equal(effects, 1);
});
test("lease loss signals unfinished work and rejects its stale continuation", async () => {
  const id = await create();
  let continuation;
  const result = await processor(
    async (_payload, taskId, execution) => {
      await expire(taskId);
      await new Promise((resolve) => execution.signal.addEventListener("abort", resolve, { once: true }));
      continuation = repository.updatePayload(taskId, "forbidden-late-write").then(
        () => false,
        () => true
      );
    },
    { heartbeatMs: 20, taskTimeoutMs: 2000, leaseMs: 5000 }
  ).processQueue();
  assert.equal(result.unconfirmed, 1);
  await new Promise(setImmediate);
  assert.equal(await continuation, true);
  assert.equal((await row(id)).payload, "fixture");
});
test("database heartbeat refusal does not become a second handler execution", async () => {
  const id = await create();
  let effects = 0;
  class LostConnection extends modules.TaskRepository {
    async renew() {
      throw new Error("fixture lost heartbeat");
    }
  }
  const result = await processor(
    async (_p, _id, context) => {
      effects++;
      await new Promise((r) => context.signal.addEventListener("abort", r, { once: true }));
    },
    { repository: new LostConnection({ prismaClient: db }), heartbeatMs: 20 }
  ).processQueue();
  assert.equal(result.unconfirmed, 1);
  assert.equal(effects, 1);
  assert.equal((await row(id)).attempts, 1);
});
test("queue and task errors do not log payload or exception secret markers", async (t) => {
  const marker = "private-fixture-" + randomUUID();
  const messages = [];
  const original = console.info;
  console.info = (...parts) => messages.push(parts);
  t.after(() => {
    console.info = original;
  });
  const id = await create(marker);
  await processor(async () => {
    throw new Error(marker);
  }).processQueue();
  assert.ok(!JSON.stringify(messages).includes(marker));
  assert.ok(!(await row(id)).lastError.includes(marker));
});
for (const options of [
  { concurrency: 5 },
  { maxTasks: 0 },
  { leaseMs: 0 },
  { heartbeatMs: 5000, leaseMs: 1000 },
  { taskTimeoutMs: Infinity },
]) {
  test(`invalid worker limits are rejected ${JSON.stringify(options)}`, () =>
    assert.throws(() => processor(undefined, options), /Invalid task processor limits/));
}

async function effectEndpoint(t, respond = true) {
  let effects = 0;
  const server = createServer((request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/effect");
    request.resume();
    effects++;
    if (respond) {
      response.writeHead(204);
      response.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { url: `http://127.0.0.1:${server.address().port}/effect`, count: () => effects };
}
test("an actual worker killed after its HTTP effect is not automatically replayed by a new worker", async (t) => {
  const endpoint = await effectEndpoint(t);
  const id = await create("synthetic-effect");
  const env = Object.fromEntries(
    ["PATH", "HOME", "USER", "LANG", "CAL_ENTERPRISE_TEST_SOCKET", "CAL_ENTERPRISE_TEST_PGDATA"]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]])
  );
  env.CAL_TASKER_TEST_EFFECT_URL = endpoint.url;
  const child = fork(path.join(__dirname, "tasker-crash-worker.cjs"), [], {
    env,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, "exit");
      child.kill("SIGKILL");
      await ended;
    }
  });
  const message = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Owned worker did not reach the effect boundary")),
      8000
    );
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("message", (message) => {
      clearTimeout(timeout);
      resolve(message);
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Owned worker exited before the effect boundary"));
    });
  });
  assert.deepEqual(message, { phase: "effect-recorded", taskId: id });
  assert.equal(endpoint.count(), 1);
  const ended = once(child, "exit");
  child.kill("SIGKILL");
  await ended;
  assert.match((await row(id)).lastError, /^tasker:v1:running:/);
  assert.equal((await row(id)).succeededAt, null);
  await expire(id);
  const next = await processor(async () => {
    await fetch(endpoint.url, { method: "POST" });
  }).processQueue();
  assert.equal(next.recoveredInterruptions, 1);
  assert.equal(next.claimed, 0);
  assert.equal(next.pendingReconciliation, 1);
  assert.equal(endpoint.count(), 1);
  assert.equal((await row(id)).attempts, 1);
});
test("HTTP request accepted remotely but never acknowledged is preserved as unconfirmed", async (t) => {
  const endpoint = await effectEndpoint(t, false);
  const id = await create();
  const task = processor(
    async (_payload, _id, context) => {
      await fetch(endpoint.url, { method: "POST", signal: context.signal });
    },
    { taskTimeoutMs: 1500, heartbeatMs: 100, leaseMs: 5000 }
  );
  const result = await task.processQueue();
  assert.equal(result.unconfirmed, 1);
  assert.equal(endpoint.count(), 1);
  await expire(id);
  assert.equal((await task.processQueue()).claimed, 0);
  assert.equal(endpoint.count(), 1);
});
test("locked queue rows are skipped without losing other available work", async () => {
  const lockedId = await create();
  const otherId = await create();
  const entered = gate(),
    release = gate();
  const holding = db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Task" WHERE id=${lockedId} FOR UPDATE`;
      entered.resolve();
      await release.promise;
    },
    { timeout: 10000 }
  );
  await entered.promise;
  try {
    assert.equal((await repository.claimNext(10000)).id, otherId);
  } finally {
    release.resolve();
    await holding;
  }
  assert.equal((await repository.claimNext(10000)).id, lockedId);
});
test("caller-controlled creation extras cannot forge task result or execution state", async () => {
  const id = await create("intended", {
    succeededAt: new Date(),
    lastError: modules.UNKNOWN_PREFIX + "forged",
    payload: "overridden",
    type: "unexpected",
  });
  const task = await row(id);
  assert.equal(task.payload, "intended");
  assert.equal(task.type, "sendWebhook");
  assert.equal(task.succeededAt, null);
  assert.equal(task.lastError, null);
});

function retainedNoShowCancellation(bookings = []) {
  const fs = require("node:fs");
  const ts = require("typescript");
  const file = path.join(__dirname, "../../packages/features/webhooks/lib/scheduleTrigger.ts");
  const parsed = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const selected = parsed.statements.filter(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "cancelNoShowTasksForBooking"
  );
  assert.equal(selected.length, 1);
  const output = ts.transpileModule(selected[0].getText(parsed), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const events = { AFTER_HOSTS_CAL_VIDEO_NO_SHOW: "host", AFTER_GUESTS_CAL_VIDEO_NO_SHOW: "guest" };
  const exports = {};
  // Only the prior booking-list query is doubled; the exact cancellation
  // function and repository guards run against real PostgreSQL.
  new Function(
    "exports",
    "tasker",
    "prisma",
    "NO_SHOW_TRIGGERS",
    "WebhookTriggerEvents",
    "fetchBookingsFromWebhook",
    output
  )(exports, repository, db, ["host", "guest"], events, async () => bookings);
  return exports.cancelNoShowTasksForBooking;
}
test("no-show cancellation preserves unrelated tasks sharing the booking reference", async () => {
  const referenceUid = "synthetic-booking";
  await create("host", { referenceUid }, "triggerHostNoShowWebhook");
  await create("guest", { referenceUid }, "triggerGuestNoShowWebhook");
  const unrelated = await create("audit", { referenceUid }, "bookingAudit");
  await retainedNoShowCancellation()({ bookingUid: referenceUid });
  assert.equal(await db.task.count(), 1);
  assert.equal((await row(unrelated)).type, "bookingAudit");
});
test("bulk no-show cancellation cannot erase a running or interrupted task", async () => {
  const referenceUid = "synthetic-booking";
  const id = await create("host", { referenceUid }, "triggerHostNoShowWebhook");
  const claim = await repository.claimNext(10000);
  const cancel = retainedNoShowCancellation([{ uid: referenceUid }]);
  await assert.rejects(cancel({ webhook: { id: "synthetic" } }), /cannot be overwritten/);
  assert.match((await row(id)).lastError, /^tasker:v1:running:/);
  await repository.settle(claim, "unconfirmed");
  await assert.rejects(cancel({ webhook: { id: "synthetic" } }), /cannot be overwritten/);
  assert.match((await row(id)).lastError, /^tasker:v1:unconfirmed:/);
});
test("completed no-show cancellation is harmless without erasing completion evidence", async () => {
  const referenceUid = "synthetic-booking";
  const id = await create("host", { referenceUid }, "triggerHostNoShowWebhook");
  const claim = await repository.claimNext(10000);
  await repository.settle(claim, "succeeded");
  const before = await row(id);
  await retainedNoShowCancellation()({ bookingUid: referenceUid, triggerEvent: "host" });
  assert.deepEqual(await row(id), before);
});

test("failed attempts remain visible on later empty processing passes", async () => {
  const id = await create("fixture", { maxAttempts: 1 });
  const first = await processor(async () => {
    throw new Error("fixture failure");
  }).processQueue();
  assert.equal(first.exhausted, 1);
  const later = await processor().processQueue();
  assert.equal(later.claimed, 0);
  assert.equal(later.exhausted, 0);
  assert.equal(later.exhaustedTotal, 1);
  assert.equal(later.pendingReconciliation, 0);
  assert.equal((await row(id)).succeededAt, null);
});
test("attention counts separate retained exhaustion from active, completed and uncertain records", async () => {
  const exhausted = await create("exhausted", { maxAttempts: 1 });
  await db.task.update({ where: { id: exhausted }, data: { attempts: 2, lastError: modules.RETRY_ERROR } });
  const uncertain = await create("uncertain", { maxAttempts: 1 });
  await db.task.update({
    where: { id: uncertain },
    data: { attempts: 1, lastError: modules.UNKNOWN_PREFIX + "interrupted" },
  });
  const completed = await create("completed", { maxAttempts: 1 });
  await db.task.update({ where: { id: completed }, data: { attempts: 1, succeededAt: new Date() } });
  const active = await create("active", { maxAttempts: 1 });
  const claim = await repository.claimNext(10000);
  assert.equal(claim.id, active);
  assert.deepEqual(await repository.attentionCounts(), { pendingReconciliation: 1, exhaustedTotal: 1 });
  await repository.settle(claim, "succeeded");
});
test("a timed-out execution does not admit more work while an uncooperative handler is still alive", async () => {
  const blocked = await create("first", { scheduledAt: new Date(0) });
  const untouched = await create("next", { scheduledAt: new Date(1) });
  const release = gate();
  const calls = [];
  const run = processor(
    async (_payload, id) => {
      calls.push(id);
      await release.promise;
    },
    { concurrency: 1, maxTasks: 4, taskTimeoutMs: 70, heartbeatMs: 20, leaseMs: 1000 }
  );
  try {
    const result = await run.processQueue();
    assert.equal(result.claimed, 1);
    assert.equal(result.unconfirmed, 1);
    assert.equal((await row(untouched)).attempts, 0);
    assert.deepEqual(calls, [blocked]);
  } finally {
    release.resolve();
  }
  await new Promise(setImmediate);
  assert.equal((await row(blocked)).succeededAt, null);
  assert.match((await row(blocked)).lastError, /^tasker:v1:unconfirmed:/);
  // A later pass can handle unrelated work; this is not a global queue outage
  // or a claim that JavaScript can forcibly stop ignored AbortSignals.
  const next = await processor().processQueue();
  assert.equal(next.succeeded, 1);
  assert.equal(next.pendingReconciliation, 1);
});

test("lost acknowledgement after a committed success never reclassifies that receipt as runnable", async () => {
  const id = await create();
  let effects = 0;
  class LostReplyAfterCommit extends modules.TaskRepository {
    async settle(claim, outcome, delay) {
      const changed = await super.settle(claim, outcome, delay);
      if (outcome === "succeeded" && changed) throw new Error("Synthetic lost DB reply after commit");
      return changed;
    }
  }
  await assert.rejects(
    processor(
      async () => {
        effects++;
      },
      { repository: new LostReplyAfterCommit({ prismaClient: db }) }
    ).processQueue(),
    /state could not be confirmed/
  );
  assert.ok((await row(id)).succeededAt);
  assert.equal(
    (
      await processor(async () => {
        effects++;
      }).processQueue()
    ).claimed,
    0
  );
  assert.equal(effects, 1);
});
