// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { AuditedIdentityLinkService } from "@calcom/features/community-enterprise/identity/AuditedIdentityLinkService";
import { authentikAccountId } from "@calcom/features/community-enterprise/identity/AuthentikConfig";
import {
  authorizeAuthentikSignIn,
  refreshAuthentikToken,
} from "@calcom/features/community-enterprise/identity/AuthentikIdentity";
import { PrismaClient } from "@calcom/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, test } from "vitest";

const root = path.resolve(__dirname, "../..");
const database = `cal_identity_link_${process.pid}`;
const target = {
  issuer: "https://identity.example.test/application/o/calendar",
  webOrigin: "https://calendar.example.test",
  databaseFingerprint: "a".repeat(64),
};
const uuids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
let admin: Pool, pool: Pool, prisma: PrismaClient, service: AuditedIdentityLinkService;
let created = false;
let clock = Date.now();
let connection: { host: string; port: number; user: string; database: string };

beforeAll(async () => {
  const socket = process.env.CAL_ENTERPRISE_TEST_SOCKET;
  const pgdata = process.env.CAL_ENTERPRISE_TEST_PGDATA;
  assert.ok(socket && pgdata, "Use the isolated runner, not a configured application database");
  assert.equal(path.dirname(socket), path.dirname(pgdata));
  assert.match(path.basename(path.dirname(socket)), /^cal-enterprise-/);
  admin = new Pool({ host: socket, port: 55439, user: "cal_enterprise_test", database: "postgres", max: 2 });
  const actual = (
    await admin.query("SELECT current_setting('data_directory') AS directory, current_user AS username")
  ).rows[0];
  assert.equal(actual.directory, pgdata);
  assert.equal(actual.username, "cal_enterprise_test");
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM "users"')).rows[0].count, 0);
  await admin.query("SET statement_timeout = '120s'");
  await admin.query(`CREATE DATABASE "${database}" TEMPLATE postgres`);
  created = true;
  connection = { host: socket, port: 55439, user: "cal_enterprise_test", database };
  pool = new Pool({ ...connection, max: 3 });
  prisma = new PrismaClient({ adapter: new PrismaPg({ ...connection, max: 6 }) });
  service = new AuditedIdentityLinkService(prisma, target, () => clock);
}, 180000);

beforeEach(async () => {
  await pool.query('DROP TRIGGER IF EXISTS refuse_identity_audit ON "EnterpriseAuditEvent"');
  await pool.query('TRUNCATE "users", "Team", "EnterpriseAuditEvent" RESTART IDENTITY CASCADE');
  for (let id = 1; id <= 4; id++)
    await pool.query('INSERT INTO "users" (id,uuid,email,name,username,role) VALUES ($1,$2,$3,$4,$5,$6)', [
      id,
      uuids[id - 1],
      `person${id}@example.test`,
      `Person ${id}`,
      `person-${id}`,
      id === 1 ? "ADMIN" : "USER",
    ]);
  await pool.query(`INSERT INTO "Team" (id,name,slug,"isOrganization") VALUES (100,'Organization','org',true),(200,'Foreign','foreign',true);
    INSERT INTO "Membership" ("userId","teamId",accepted,role) VALUES (1,100,true,'OWNER'),(2,100,true,'MEMBER'),(3,100,true,'MEMBER'),(4,200,true,'OWNER');`);
  clock = Date.now();
});

afterAll(async () => {
  if (prisma) await prisma.$disconnect();
  if (pool) await pool.end();
  if (created) await admin.query(`DROP DATABASE "${database}"`);
  if (admin) await admin.end();
}, 60000);

const request = () => ({
  operationId: randomUUID(),
  actorUserId: 1,
  actorUuid: uuids[0],
  organizationId: 100,
  organizationSlug: "org",
  links: [
    { userId: 2, userUuid: uuids[1], subject: "subject-two" },
    { userId: 3, userUuid: uuids[2], subject: "subject-three" },
  ],
});
const counts = async () => ({
  accounts: await prisma.account.count(),
  audit: await prisma.enterpriseAuditEvent.count(),
});

test("plan is read-only and excludes raw subjects, credentials and email", async () => {
  const input = request();
  const plan = await service.plan(input);
  assert.equal(plan.rows.length, 2);
  assert.deepEqual(await counts(), { accounts: 0, audit: 0 });
  const serialized = JSON.stringify(plan);
  for (const value of ["subject-two", "subject-three", "example.test", "clientSecret"])
    assert.ok(!serialized.includes(value));
});
test("apply links the complete batch and audit atomically without changing user or membership state", async () => {
  const input = request();
  const before = await prisma.user.findMany({
    select: { id: true, uuid: true, role: true, email: true, locked: true },
    orderBy: { id: "asc" },
  });
  const members = await prisma.membership.findMany({
    select: { id: true, role: true, userId: true, teamId: true, accepted: true },
    orderBy: { id: "asc" },
  });
  const result = await service.apply(input, await service.plan(input));
  assert.equal(result.status, "applied");
  assert.equal(result.bindings.length, 2);
  assert.deepEqual(await counts(), { accounts: 2, audit: 1 });
  assert.deepEqual(
    await prisma.user.findMany({
      select: { id: true, uuid: true, role: true, email: true, locked: true },
      orderBy: { id: "asc" },
    }),
    before
  );
  assert.deepEqual(
    await prisma.membership.findMany({
      select: { id: true, role: true, userId: true, teamId: true, accepted: true },
      orderBy: { id: "asc" },
    }),
    members
  );
});
test("the same operation is idempotent, including simultaneous requests", async () => {
  const input = request();
  const plan = await service.plan(input);
  const results = await Promise.all([service.apply(input, plan), service.apply(input, plan)]);
  assert.deepEqual(results.map((entry) => entry.status).sort(), ["applied", "replayed"]);
  assert.deepEqual(await counts(), { accounts: 2, audit: 1 });
});

for (const change of [
  "operator-role",
  "operator-lock",
  "operator-uuid",
  "target-lock",
  "target-uuid",
  "pending-member",
  "foreign-member",
  "wrong-org-slug",
]) {
  test(`refuse ${change} before any linkage`, async () => {
    const input = request();
    if (change === "operator-role") await pool.query('UPDATE "users" SET role=$1 WHERE id=1', ["USER"]);
    if (change === "operator-lock") await pool.query('UPDATE "users" SET locked=true WHERE id=1');
    if (change === "operator-uuid") input.actorUuid = randomUUID();
    if (change === "target-lock") await pool.query('UPDATE "users" SET locked=true WHERE id=2');
    if (change === "target-uuid") input.links[0].userUuid = randomUUID();
    if (change === "pending-member")
      await pool.query('UPDATE "Membership" SET accepted=false WHERE "userId"=2');
    if (change === "foreign-member") input.links[0] = { userId: 4, userUuid: uuids[3], subject: "foreign" };
    if (change === "wrong-org-slug") input.organizationSlug = "foreign";
    await assert.rejects(service.plan(input));
    assert.deepEqual(await counts(), { accounts: 0, audit: 0 });
  });
}
test("account state or membership changes after review refuse the old plan", async () => {
  const input = request();
  const plan = await service.plan(input);
  await pool.query('UPDATE "Membership" SET accepted=false WHERE "userId"=2');
  await assert.rejects(service.apply(input, plan));
  assert.deepEqual(await counts(), { accounts: 0, audit: 0 });
});
test("reviewed plan expires rather than silently refreshing its authorization", async () => {
  const input = request();
  const plan = await service.plan(input);
  clock = plan.expiresAt;
  await assert.rejects(service.apply(input, plan));
  assert.deepEqual(await counts(), { accounts: 0, audit: 0 });
});
test("modified inputs, modified plans and another deployment are refused", async () => {
  const input = request();
  const plan = await service.plan(input);
  await assert.rejects(service.apply({ ...input, operationId: randomUUID() }, plan));
  await assert.rejects(service.apply(input, { ...plan, expiresAt: plan.expiresAt + 1 }));
  for (const changed of [
    { ...target, databaseFingerprint: "b".repeat(64) },
    { ...target, issuer: "https://foreign.test/o/cal" },
    { ...target, webOrigin: "https://other.test" },
  ]) {
    await assert.rejects(new AuditedIdentityLinkService(prisma, changed, () => clock).apply(input, plan));
  }
  assert.deepEqual(await counts(), { accounts: 0, audit: 0 });
});
test("audit failure rolls back every newly linked account", async () => {
  const input = request();
  const plan = await service.plan(input);
  await pool.query(`CREATE OR REPLACE FUNCTION refuse_fixture_identity_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$;
    CREATE TRIGGER refuse_identity_audit BEFORE INSERT ON "EnterpriseAuditEvent" FOR EACH ROW EXECUTE FUNCTION refuse_fixture_identity_audit();`);
  await assert.rejects(service.apply(input, plan));
  assert.deepEqual(await counts(), { accounts: 0, audit: 0 });
});
test("concurrent different-user claims on one subject have exactly one winner", async () => {
  const first = request();
  first.links = [first.links[0]];
  const second = request();
  second.links = [{ ...second.links[1], subject: first.links[0].subject }];
  const plans = await Promise.all([service.plan(first), service.plan(second)]);
  const results = await Promise.allSettled([service.apply(first, plans[0]), service.apply(second, plans[1])]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.deepEqual(await counts(), { accounts: 1, audit: 1 });
});
test("a later unlink cannot be undone by replaying an old successful operation", async () => {
  const input = request();
  const plan = await service.plan(input);
  const applied = await service.apply(input, plan);
  await prisma.account.delete({ where: { id: applied.bindings[0].bindingId } });
  await assert.rejects(service.apply(input, plan));
  assert.deepEqual(await counts(), { accounts: 1, audit: 1 });
});
test("an existing matching account is preserved rather than rebound", async () => {
  const input = request();
  const key = authentikAccountId(target.issuer, input.links[0].subject);
  await prisma.account.create({
    data: { id: "existing-binding", userId: 2, type: "oauth", provider: "authentik", providerAccountId: key },
  });
  const result = await service.apply(input, await service.plan(input));
  assert.equal(result.bindings[0].bindingId, "existing-binding");
  assert.deepEqual(await counts(), { accounts: 2, audit: 1 });
});
test("duplicate users/subjects and unrelated request fields are rejected", async () => {
  const input = request();
  await assert.rejects(service.plan({ ...input, links: [input.links[0], input.links[0]] }));
  await assert.rejects(
    service.plan({
      ...input,
      links: [input.links[0], { ...input.links[1], subject: input.links[0].subject }],
    })
  );
  await assert.rejects(service.plan({ ...input, grantGlobalAdmin: true }));
});
test("audited linkage is accepted by the existing native Authentik sign-in and token functions", async () => {
  const input = request();
  await service.apply(input, await service.plan(input));
  const config = { issuer: target.issuer, clientId: "fixture", clientSecret: "fixture-not-live" };
  const identity = {
    user: { id: 2 },
    account: {
      provider: "authentik",
      type: "oauth" as const,
      providerAccountId: authentikAccountId(target.issuer, input.links[0].subject),
    },
    profile: { sub: input.links[0].subject, iss: target.issuer },
  };
  assert.equal(await authorizeAuthentikSignIn(prisma, config, identity), true);
  const token = await refreshAuthentikToken(prisma, config, { token: {}, ...identity }, target.webOrigin);
  assert.equal(token.sub, "2");
  assert.equal(token.role, "USER");
});

test("the actual operator CLI requires a reviewed plan and writes one audit record", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cal-link-cli-"));
  const inputPath = path.join(directory, "request.json");
  const planPath = path.join(directory, "plan.json");
  const input = request();
  fs.writeFileSync(inputPath, JSON.stringify(input), { mode: 0o600 });
  const run = promisify(execFile);
  const environment = Object.fromEntries(
    ["PATH", "HOME", "USER", "LANG"].filter((key) => process.env[key]).map((key) => [key, process.env[key]])
  );
  const databaseUrl = `postgresql://cal_enterprise_test@localhost:55439/${database}?host=${encodeURIComponent(connection.host)}`;
  Object.assign(environment, {
    DATABASE_URL: databaseUrl,
    CAL_AUTHENTIK_ISSUER: target.issuer,
    NEXT_PUBLIC_WEBAPP_URL: target.webOrigin,
  });
  const invoke = (args: string[]) =>
    run(process.execPath, ["scripts/link-enterprise-identity.cjs", ...args], {
      cwd: root,
      // The web app augments ProcessEnv with required server fields. This child
      // intentionally receives only the CLI's explicit synthetic environment.
      env: environment as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: 30000,
    });
  try {
    const planned = await invoke(["plan", "--request", inputPath, "--out", planPath, "--database", database]);
    assert.equal(JSON.parse(planned.stdout).status, "planned");
    assert.equal(fs.statSync(planPath).mode & 0o777, 0o600);
    assert.deepEqual(await counts(), { accounts: 0, audit: 0 });
    await assert.rejects(invoke(["plan", "--request", inputPath, "--out", planPath, "--database", database]));
    await assert.rejects(
      invoke(["apply", "--request", inputPath, "--plan", planPath, "--database", "wrong_database"])
    );
    const applied = await invoke([
      "apply",
      "--request",
      inputPath,
      "--plan",
      planPath,
      "--database",
      database,
    ]);
    assert.equal(JSON.parse(applied.stdout).status, "applied");
    const replay = await invoke([
      "apply",
      "--request",
      inputPath,
      "--plan",
      planPath,
      "--database",
      database,
    ]);
    assert.equal(JSON.parse(replay.stdout).status, "replayed");
    assert.deepEqual(await counts(), { accounts: 2, audit: 1 });
    assert.ok(!applied.stdout.includes("subject-two"));
    assert.ok(!applied.stdout.includes(databaseUrl));
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
}, 90000);

test("revocation committed while an apply waits for a locked user is rechecked", async () => {
  const input = request();
  const plan = await service.plan(input);
  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN");
    const { rows } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await blocker.query('UPDATE "users" SET locked=true WHERE id=2');
    let ended = false;
    const applying = service.apply(input, plan).then(
      () => {
        ended = true;
        return "unexpected-success";
      },
      () => {
        ended = true;
        return "refused";
      }
    );
    await waitForLinkRowLock(rows[0].pid, "users");
    assert.equal(ended, false);
    await blocker.query("COMMIT");
    assert.equal(await applying, "refused");
    assert.deepEqual(await counts(), { accounts: 0, audit: 0 });
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
});

test("a different existing Authentik identity is not silently supplemented with a new sign-in", async () => {
  const input = request();
  await prisma.account.create({
    data: {
      id: "different-existing-binding",
      userId: 2,
      type: "oauth",
      provider: "authentik",
      providerAccountId: authentikAccountId(target.issuer, "another-reviewed-subject"),
    },
  });
  await assert.rejects(service.plan(input));
  assert.deepEqual(await counts(), { accounts: 1, audit: 0 });
});

test("concurrent different subjects for one user cannot both become sign-in identities", async () => {
  const first = request();
  first.links = [first.links[0]];
  const second = request();
  second.links = [{ ...first.links[0], subject: "conflicting-second-subject" }];
  const plans = await Promise.all([service.plan(first), service.plan(second)]);
  const results = await Promise.allSettled([service.apply(first, plans[0]), service.apply(second, plans[1])]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.deepEqual(await counts(), { accounts: 1, audit: 1 });
});

async function waitForLinkRowLock(blockerPid: number, table: "Team" | "users") {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity
         WHERE datname = current_database() AND pid <> pg_backend_pid()
           AND wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))
           AND query LIKE $2
       ) AS waiting`,
      [blockerPid, `%FROM "${table}"%FOR %`]
    );
    if (result.rows[0].waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`The identity writer did not demonstrate a blocked ${table} row lock`);
}

for (const change of ["operator-role", "target-membership", "review-expiry"] as const) {
  test(`current ${change} is checked after an observed organization lock wait`, async () => {
    const input = request();
    const plan = await service.plan(input);
    const blocker = await pool.connect();
    let applying: Promise<PromiseSettledResult<unknown>> | undefined;
    try {
      await blocker.query("BEGIN");
      const { rows } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await blocker.query('SELECT id FROM "Team" WHERE id=100 FOR UPDATE');
      applying = service.apply(input, plan).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason })
      );
      await waitForLinkRowLock(rows[0].pid, "Team");
      if (change === "operator-role") {
        // Member/role writers lock organization, then users. A waiting identity
        // operation must not hold users in the reverse order.
        await blocker.query('SELECT id FROM "users" WHERE id=1 FOR UPDATE NOWAIT');
        await blocker.query("UPDATE \"users\" SET role='USER' WHERE id=1");
      } else if (change === "target-membership") {
        await blocker.query('DELETE FROM "Membership" WHERE "teamId"=100 AND "userId"=2');
      } else {
        clock = plan.expiresAt;
      }
      await blocker.query("COMMIT");
      const result = await applying;
      assert.equal(result.status, "rejected");
      if (result.status === "rejected") {
        assert.ok(result.reason instanceof Error);
        assert.match(result.reason.message, change === "review-expiry" ? /expired/ : /reviewed active/);
      }
      assert.deepEqual(await counts(), { accounts: 0, audit: 0 });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (applying) await applying;
    }
  });
}

test("linking preserves retained calendar credentials and appointment identifiers", async () => {
  await prisma.credential.create({
    data: { id: 41, userId: 2, type: "google_calendar", key: { fixture: "no-live-token" } },
  });
  await prisma.booking.create({
    data: {
      id: 42,
      uid: "retained-calendar-appointment",
      userId: 2,
      title: "Synthetic retained appointment",
      startTime: new Date("2030-01-01T10:00:00Z"),
      endTime: new Date("2030-01-01T10:30:00Z"),
    },
  });
  const before = {
    credentials: await prisma.credential.findMany(),
    bookings: await prisma.booking.findMany(),
  };
  const input = request();
  await service.apply(input, await service.plan(input));
  assert.deepEqual(
    { credentials: await prisma.credential.findMany(), bookings: await prisma.booking.findMany() },
    before
  );
  assert.deepEqual(await counts(), { accounts: 2, audit: 1 });
});
