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
import {
  ExistingOperatorSelfLinkService,
  existingOperatorDatabaseIdentity,
} from "@calcom/features/community-enterprise/identity/ExistingOperatorSelfLinkService";
import { PreviewOperatorBootstrap } from "@calcom/features/community-enterprise/identity/PreviewOperatorBootstrap";
import { OrganizationProvisioningService } from "@calcom/features/community-enterprise/organizations/OrganizationProvisioningService";
import { PrismaClient } from "@calcom/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, test } from "vitest";

const root = path.resolve(__dirname, "../..");
const database = `cal_enterprise_preview_${process.pid}`;
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

const bootstrapTarget = () => ({
  ...target,
  webOrigin: "https://cal.mereka.dev",
  databaseName: database,
  nativeOnly: true,
});
const firstOperator = () => ({
  operationId: randomUUID(),
  operatorUuid: randomUUID(),
  subject: "preview-fixture-subject",
  name: "Preview Fixture",
  email: "preview@example.test",
  username: "preview-fixture",
});
async function emptyPreview() {
  // beforeAll has independently bound this pool to the disposable runner's DB.
  await pool.query('TRUNCATE "users", "Team", "EnterpriseAuditEvent" RESTART IDENTITY CASCADE');
  return new PreviewOperatorBootstrap(prisma, bootstrapTarget(), () => clock);
}
const initialCounts = async () => ({
  users: await prisma.user.count(),
  accounts: await prisma.account.count(),
  teams: await prisma.team.count(),
  audit: await prisma.enterpriseAuditEvent.count(),
});

test("preview plan does not create an account or disclose the raw subject/email", async () => {
  const bootstrap = await emptyPreview();
  const input = firstOperator();
  const plan = await bootstrap.plan(input);
  assert.equal(plan.rows.length, 1);
  assert.deepEqual(await initialCounts(), { users: 0, accounts: 0, teams: 0, audit: 0 });
  for (const text of [input.email, input.subject, input.name])
    assert.ok(!JSON.stringify(plan).includes(text));
});
test("preview apply creates one native operator without passwords, auto-membership or verified-email claims", async () => {
  const bootstrap = await emptyPreview();
  const input = firstOperator();
  const result = await bootstrap.apply(input, await bootstrap.plan(input));
  assert.equal(result.status, "applied");
  assert.deepEqual(await initialCounts(), { users: 1, accounts: 1, teams: 0, audit: 1 });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: result.userId },
    select: {
      role: true,
      uuid: true,
      completedOnboarding: true,
      emailVerified: true,
      locked: true,
      password: { select: { userId: true } },
    },
  });
  assert.deepEqual(user, {
    role: "ADMIN",
    uuid: input.operatorUuid,
    completedOnboarding: false,
    emailVerified: null,
    locked: false,
    password: null,
  });
  const audit = await prisma.enterpriseAuditEvent.findUniqueOrThrow({
    where: { operationId: input.operationId },
  });
  assert.equal(audit.organizationId, 0);
  assert.ok(JSON.stringify(audit.details).includes("out-of-band-database-operator"));
  assert.ok(!JSON.stringify(audit.details).includes(input.subject));
  const config = { issuer: target.issuer, clientId: "fixture-client", clientSecret: "fixture-only-secret" };
  const account = {
    provider: "authentik",
    type: "oauth" as const,
    providerAccountId: authentikAccountId(target.issuer, input.subject),
  };
  const profile = { sub: input.subject, iss: target.issuer };
  assert.equal(
    await authorizeAuthentikSignIn(prisma, config, {
      account,
      profile,
      user: { id: result.userId },
    }),
    true
  );
  const token = await refreshAuthentikToken(
    prisma,
    config,
    { token: {}, account, user: { id: result.userId } },
    bootstrapTarget().webOrigin
  );
  assert.equal(token.id, result.userId);
  assert.equal(token.role, "ADMIN");
  assert.equal(token.org, undefined);
});
for (const change of [
  { webOrigin: "https://cal.mereka.io" },
  { webOrigin: "https://cal.mereka.dev.attacker.test" },
  { webOrigin: "http://cal.mereka.dev" },
  { databaseName: "calcom" },
  { databaseName: "postgres" },
  { databaseName: "cal_enterprise_preview;DROP" },
  { nativeOnly: false },
  { issuer: "https://user:password@identity.example.test/" },
]) {
  test(`preview target rejects ${JSON.stringify(change)}`, () => {
    assert.throws(() => new PreviewOperatorBootstrap(prisma, { ...bootstrapTarget(), ...change }));
  });
}
for (const state of [
  "user",
  "pending-team",
  "credential",
  "event",
  "booking",
  "audit",
  "webhook",
  "destination",
] as const) {
  test(`preview plan refuses pre-existing ${state} without modifying it`, async () => {
    const bootstrap = await emptyPreview();
    if (state === "user")
      await prisma.user.create({ data: { email: "existing@example.test", locked: true } });
    if (state === "pending-team")
      await prisma.team.create({ data: { name: "Reserved", slug: "reserved", pendingPayment: true } });
    if (state === "credential") await prisma.credential.create({ data: { type: "fixture", key: {} } });
    if (state === "event")
      await prisma.eventType.create({ data: { title: "Orphan", slug: "orphan", length: 20 } });
    if (state === "booking")
      await prisma.booking.create({
        data: { uid: randomUUID(), title: "Existing", startTime: new Date(), endTime: new Date() },
      });
    if (state === "webhook")
      await prisma.webhook.create({
        data: { id: randomUUID(), subscriberUrl: "https://example.test/no-delivery", eventTriggers: [] },
      });
    if (state === "destination")
      await prisma.destinationCalendar.create({
        data: { integration: "fixture", externalId: "no-provider-id" },
      });
    if (state === "audit")
      await prisma.enterpriseAuditEvent.create({
        data: {
          operationId: randomUUID(),
          operationHash: "prior",
          action: "prior",
          actorUserId: 0,
          organizationId: 0,
          details: {},
        },
      });
    const before = await initialCounts();
    await assert.rejects(bootstrap.plan(firstOperator()));
    assert.deepEqual(await initialCounts(), before);
  });
}
test("preview apply rechecks an empty plan after another writer creates an account", async () => {
  const bootstrap = await emptyPreview();
  const input = firstOperator();
  const plan = await bootstrap.plan(input);
  await prisma.user.create({ data: { email: "raced@example.test" } });
  await assert.rejects(bootstrap.apply(input, plan));
  assert.deepEqual(await initialCounts(), { users: 1, accounts: 0, teams: 0, audit: 0 });
});
test("preview apply rejects expired, changed, foreign and malformed plans", async () => {
  const bootstrap = await emptyPreview();
  const input = firstOperator();
  const plan = await bootstrap.plan(input);
  await assert.rejects(bootstrap.apply({ ...input, role: "ADMIN" }, plan));
  await assert.rejects(bootstrap.apply({ ...input, subject: "foreign-subject" }, plan));
  await assert.rejects(bootstrap.apply(input, { ...plan, expiresAt: plan.expiresAt + 1 }));
  const other = new PreviewOperatorBootstrap(
    prisma,
    { ...bootstrapTarget(), databaseFingerprint: "b".repeat(64) },
    () => clock
  );
  await assert.rejects(other.apply(input, plan));
  clock = plan.expiresAt;
  await assert.rejects(bootstrap.apply(input, plan));
  assert.deepEqual(await initialCounts(), { users: 0, accounts: 0, teams: 0, audit: 0 });
});
test("preview apply refuses a contending writer rather than waiting under old application activity", async () => {
  const bootstrap = await emptyPreview();
  const input = firstOperator();
  const plan = await bootstrap.plan(input);
  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query('LOCK TABLE "users" IN ROW EXCLUSIVE MODE');
    await assert.rejects(bootstrap.apply(input, plan));
    assert.deepEqual(await initialCounts(), { users: 0, accounts: 0, teams: 0, audit: 0 });
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
});
test("competing initial operators cannot both commit", async () => {
  const bootstrap = await emptyPreview();
  const a = firstOperator();
  const b = { ...firstOperator(), email: "second@example.test", username: "second" };
  const pa = await bootstrap.plan(a),
    pb = await bootstrap.plan(b);
  const outcomes = await Promise.allSettled([bootstrap.apply(a, pa), bootstrap.apply(b, pb)]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  assert.deepEqual(await initialCounts(), { users: 1, accounts: 1, teams: 0, audit: 1 });
});
test("preview account and identity roll back when mandatory audit creation fails", async () => {
  const bootstrap = await emptyPreview();
  const input = firstOperator();
  const plan = await bootstrap.plan(input);
  await pool.query(`CREATE OR REPLACE FUNCTION reject_preview_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit refused'; END $$;
    CREATE TRIGGER refuse_identity_audit BEFORE INSERT ON "EnterpriseAuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_preview_audit();`);
  await assert.rejects(bootstrap.apply(input, plan));
  assert.deepEqual(await initialCounts(), { users: 0, accounts: 0, teams: 0, audit: 0 });
});
for (const change of ["none", "locked", "demoted", "unlinked", "rebound"] as const) {
  test(`preview replay is read-only and never repairs ${change} authority`, async () => {
    const bootstrap = await emptyPreview();
    const input = firstOperator();
    const plan = await bootstrap.plan(input);
    const result = await bootstrap.apply(input, plan);
    if (change === "locked")
      await prisma.user.update({ where: { id: result.userId }, data: { locked: true } });
    if (change === "demoted")
      await prisma.user.update({ where: { id: result.userId }, data: { role: "USER" } });
    if (change === "unlinked" || change === "rebound") await prisma.account.deleteMany();
    if (change === "rebound")
      await prisma.account.create({
        data: {
          id: randomUUID(),
          userId: result.userId,
          type: "oauth",
          provider: "authentik",
          providerAccountId: authentikAccountId(target.issuer, input.subject),
        },
      });
    const before = await initialCounts();
    if (change === "none") assert.equal((await bootstrap.apply(input, plan)).status, "replayed");
    else await assert.rejects(bootstrap.apply(input, plan));
    assert.deepEqual(await initialCounts(), before);
  });
}
test("actual preview CLI plans and applies under native-only configuration, without public setup", async () => {
  await emptyPreview();
  const input = firstOperator();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cal-bootstrap-cli-"));
  const requestFile = path.join(directory, "request.json"),
    planFile = path.join(directory, "plan.json");
  const environment = Object.fromEntries(
    ["PATH", "HOME", "USER", "LANG"].filter((key) => process.env[key]).map((key) => [key, process.env[key]])
  );
  const databaseUrl = `postgresql://cal_enterprise_test@localhost:55439/${database}?host=${encodeURIComponent(connection.host)}`;
  Object.assign(environment, {
    DATABASE_URL: databaseUrl,
    CAL_AUTHENTIK_ISSUER: target.issuer,
    NEXT_PUBLIC_WEBAPP_URL: "https://cal.mereka.dev",
    CAL_AUTHENTIK_ENABLED: "true",
    CAL_AUTHENTIK_ONLY: "true",
  });
  const invoke = (args: string[], extra: Record<string, string> = {}) =>
    promisify(execFile)(process.execPath, ["scripts/link-enterprise-identity.cjs", ...args], {
      cwd: root,
      env: { ...environment, ...extra } as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: 30000,
    });
  try {
    fs.writeFileSync(requestFile, JSON.stringify(input), { mode: 0o600 });
    const planArgs = ["bootstrap-plan", "--request", requestFile, "--out", planFile, "--database", database];
    await assert.rejects(invoke(planArgs, { CAL_AUTHENTIK_ONLY: "false" }));
    assert.equal(fs.existsSync(planFile), false);
    const planned = await invoke(planArgs);
    assert.equal(JSON.parse(planned.stdout).count, 1);
    assert.equal(fs.statSync(planFile).mode & 0o777, 0o600);
    assert.equal(await prisma.user.count(), 0);
    const args = ["bootstrap-apply", "--request", requestFile, "--plan", planFile, "--database", database];
    const applied = await invoke(args);
    assert.equal(JSON.parse(applied.stdout).status, "applied");
    assert.equal(JSON.parse((await invoke(args)).stdout).status, "replayed");
    for (const value of [input.email, input.subject, databaseUrl]) assert.ok(!applied.stdout.includes(value));
    assert.deepEqual(await initialCounts(), { users: 1, accounts: 1, teams: 0, audit: 1 });
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
  // Four separate CLI processes retain their individual 30s bounds. This new
  // aggregate test needs their combined budget; it is not a login-latency target.
}, 150000);

test("the bootstrapped operator can use the existing reviewed organization service", async () => {
  const bootstrap = await emptyPreview();
  const input = firstOperator();
  const result = await bootstrap.apply(input, await bootstrap.plan(input));
  const organization = new OrganizationProvisioningService(prisma);
  const actor = { id: result.userId, uuid: result.userUuid };
  const review = await organization.review(actor, {
    name: "Synthetic Preview Organization",
    slug: "preview-organization",
    timeZone: "UTC",
    ownerEmail: input.email,
    memberEmails: [],
  });
  const created = await organization.provision(actor, review.input);
  const member = await prisma.membership.findFirstOrThrow({
    where: { teamId: created.organizationId, userId: result.userId },
    select: { accepted: true, role: true },
  });
  assert.deepEqual(member, { accepted: true, role: "OWNER" });
  assert.deepEqual(await initialCounts(), { users: 1, accounts: 1, teams: 1, audit: 2 });
  assert.equal(await prisma.credential.count(), 0);
  assert.equal(await prisma.booking.count(), 0);
  assert.equal(await prisma.userPassword.count(), 0);
});

test("a plausible preview name cannot mislabel the actual database connection", async () => {
  await emptyPreview();
  const wrong = new PreviewOperatorBootstrap(
    prisma,
    {
      ...bootstrapTarget(),
      databaseName: "cal_enterprise_preview_different",
    },
    () => clock
  );
  await assert.rejects(
    wrong.plan(firstOperator()),
    /Preview bootstrap requires the reviewed empty isolated target/
  );
  assert.deepEqual(await initialCounts(), { users: 0, accounts: 0, teams: 0, audit: 0 });
});

const selfRequest = () => ({
  operationId: randomUUID(),
  actorUserId: 1,
  actorUuid: uuids[0],
  subject: "self-operator-subject",
});
const selfTarget = async () => ({
  issuer: target.issuer,
  webOrigin: "https://cal.mereka.dev",
  databaseName: database,
  nativeOnly: true,
  databaseFingerprint: (await existingOperatorDatabaseIdentity(prisma)).fingerprint,
});
const selfFixture = async () => {
  await pool.query('DELETE FROM "Team"');
  await pool.query('UPDATE "users" SET username=NULL,"completedOnboarding"=false WHERE id=1');
  return new ExistingOperatorSelfLinkService(prisma, await selfTarget(), () => clock);
};

test("existing admin self-link preserves occupied personal accounts, calendar OAuth and incomplete setup", async () => {
  const self = await selfFixture(),
    input = selfRequest();
  await prisma.account.create({
    data: {
      id: "prior-google-binding",
      userId: 1,
      type: "oauth",
      provider: "google",
      providerAccountId: "synthetic-google-id",
    },
  });
  await prisma.credential.create({ data: { userId: 1, type: "google_calendar", key: { synthetic: true } } });
  const before = {
    users: await prisma.user.findMany({ orderBy: { id: "asc" } }),
    credentials: await prisma.credential.findMany(),
    google: await prisma.account.findUnique({ where: { id: "prior-google-binding" } }),
  };
  const plan = await self.plan(input);
  assert.deepEqual(await counts(), { accounts: 1, audit: 0 });
  assert.ok(!JSON.stringify(plan).includes(input.subject));
  const result = await self.apply(input, plan);
  assert.equal(result.status, "applied");
  assert.equal((await self.apply(input, plan)).status, "replayed");
  assert.deepEqual(await counts(), { accounts: 2, audit: 1 });
  assert.deepEqual(await prisma.user.findMany({ orderBy: { id: "asc" } }), before.users);
  assert.deepEqual(await prisma.credential.findMany(), before.credentials);
  assert.deepEqual(await prisma.account.findUnique({ where: { id: "prior-google-binding" } }), before.google);
  assert.equal(await prisma.team.count(), 0);
  assert.equal(await prisma.membership.count(), 0);
  assert.equal(await prisma.userPassword.count(), 0);
  const config = { issuer: target.issuer, clientId: "fixture", clientSecret: "fixture-not-live" };
  const identity = {
    user: { id: 1 },
    account: {
      provider: "authentik",
      type: "oauth" as const,
      providerAccountId: authentikAccountId(target.issuer, input.subject),
    },
    profile: { sub: input.subject, iss: target.issuer },
  };
  assert.equal(await authorizeAuthentikSignIn(prisma, config, identity), true);
  assert.equal(
    (await refreshAuthentikToken(prisma, config, { token: {}, ...identity }, "https://cal.mereka.dev")).role,
    "ADMIN"
  );
});

for (const change of [
  "missing-user",
  "non-admin",
  "locked",
  "wrong-uuid",
  "platform-managed",
  "organization",
  "child-organization",
  "foreign-subject",
  "other-binding",
  "extra-target",
] as const) {
  test(`existing self-link refuses ${change} without linking or promoting anybody`, async () => {
    const self = await selfFixture(),
      input = selfRequest();
    if (change === "missing-user") input.actorUserId = 9999;
    if (change === "non-admin") await prisma.user.update({ where: { id: 1 }, data: { role: "USER" } });
    if (change === "locked") await prisma.user.update({ where: { id: 1 }, data: { locked: true } });
    if (change === "wrong-uuid") input.actorUuid = randomUUID();
    if (change === "platform-managed")
      await prisma.user.update({ where: { id: 1 }, data: { isPlatformManaged: true } });
    if (change === "organization")
      await prisma.team.create({ data: { name: "Fixture", slug: "fixture", isOrganization: true } });
    if (change === "child-organization") {
      const parent = await prisma.team.create({ data: { name: "Personal", slug: "personal" } });
      await prisma.team.create({
        data: { name: "Child", slug: "child", isOrganization: true, parentId: parent.id },
      });
    }
    if (change === "foreign-subject" || change === "other-binding")
      await prisma.account.create({
        data: {
          userId: change === "foreign-subject" ? 2 : 1,
          type: "oauth",
          provider: "authentik",
          providerAccountId: authentikAccountId(
            target.issuer,
            change === "foreign-subject" ? input.subject : "other-subject"
          ),
          id: randomUUID(),
        },
      });
    const before = await counts();
    await assert.rejects(self.plan(change === "extra-target" ? { ...input, targetUserId: 2 } : input));
    assert.deepEqual(await counts(), before);
  });
}

test("self-link actual database identity and reviewed target are enforced by the service", async () => {
  const self = await selfFixture(),
    input = selfRequest(),
    good = await selfTarget();
  const plan = await self.plan(input);
  for (const changed of [{ databaseName: "other_database" }, { databaseFingerprint: "b".repeat(64) }]) {
    const other = new ExistingOperatorSelfLinkService(prisma, { ...good, ...changed }, () => clock);
    await assert.rejects(other.plan(input));
    await assert.rejects(other.apply(input, plan));
  }
  for (const changed of [
    { webOrigin: "https://cal.mereka.io" },
    { nativeOnly: false },
    { issuer: "https://identity.example.test" },
    { issuer: "http://identity.example.test/o/cal" },
  ])
    assert.throws(() => new ExistingOperatorSelfLinkService(prisma, { ...good, ...changed }));
  await assert.rejects(self.apply({ ...input, subject: "changed-subject" }, plan));
  await assert.rejects(self.apply(input, { ...plan, expiresAt: plan.expiresAt + 1 }));
  clock = plan.expiresAt;
  await assert.rejects(self.apply(input, plan));
  assert.deepEqual(await counts(), { accounts: 0, audit: 0 });
});

test("self-link rechecks post-review actor and organization state and refuses a Team writer", async () => {
  const self = await selfFixture(),
    input = selfRequest(),
    plan = await self.plan(input);
  await prisma.user.update({ where: { id: 1 }, data: { locked: true } });
  await assert.rejects(self.apply(input, plan));
  await prisma.user.update({ where: { id: 1 }, data: { locked: false } });
  const organization = await prisma.team.create({ data: { name: "New", slug: "new", isOrganization: true } });
  await assert.rejects(self.apply(input, plan));
  await prisma.team.delete({ where: { id: organization.id } });
  const blocker = await pool.connect();
  try {
    await blocker.query("BEGIN");
    await blocker.query('LOCK TABLE "Team" IN ROW EXCLUSIVE MODE');
    await assert.rejects(self.apply(input, plan));
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
  assert.deepEqual(await counts(), { accounts: 0, audit: 0 });
});

test("self-link audit failure rolls back the Account binding", async () => {
  const self = await selfFixture(),
    input = selfRequest(),
    plan = await self.plan(input);
  await pool.query(`CREATE OR REPLACE FUNCTION refuse_self_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit refused'; END $$;
    CREATE TRIGGER refuse_identity_audit BEFORE INSERT ON "EnterpriseAuditEvent" FOR EACH ROW EXECUTE FUNCTION refuse_self_audit();`);
  await assert.rejects(self.apply(input, plan));
  assert.deepEqual(await counts(), { accounts: 0, audit: 0 });
});

test("concurrent self-link operations are idempotent and a second subject cannot replace the first", async () => {
  const self = await selfFixture(),
    input = selfRequest(),
    plan = await self.plan(input);
  const results = await Promise.all([self.apply(input, plan), self.apply(input, plan)]);
  assert.deepEqual(results.map((x) => x.status).sort(), ["applied", "replayed"]);
  await assert.rejects(self.plan({ ...input, operationId: randomUUID(), subject: "second-subject" }));
  assert.deepEqual(await counts(), { accounts: 1, audit: 1 });
});

for (const change of ["unlinked", "rebound", "demoted", "locked", "platform-managed"] as const) {
  test(`self-link replay refuses ${change} authority without repairing it`, async () => {
    const self = await selfFixture(),
      input = selfRequest(),
      plan = await self.plan(input);
    const applied = await self.apply(input, plan);
    if (change === "unlinked" || change === "rebound") await prisma.account.deleteMany();
    if (change === "rebound")
      await prisma.account.create({
        data: {
          id: randomUUID(),
          userId: 1,
          type: "oauth",
          provider: "authentik",
          providerAccountId: applied.bindings[0].accountId,
        },
      });
    if (change === "demoted") await prisma.user.update({ where: { id: 1 }, data: { role: "USER" } });
    if (change === "locked") await prisma.user.update({ where: { id: 1 }, data: { locked: true } });
    if (change === "platform-managed")
      await prisma.user.update({ where: { id: 1 }, data: { isPlatformManaged: true } });
    const before = await counts();
    await assert.rejects(self.apply(input, plan));
    assert.deepEqual(await counts(), before);
  });
}

test("actual self-link CLI plans and applies an existing admin without organization bootstrap", async () => {
  await selfFixture();
  const input = selfRequest(),
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "cal-self-cli-"));
  const requestFile = path.join(directory, "request.json"),
    planFile = path.join(directory, "plan.json");
  const environment = Object.fromEntries(
    ["PATH", "HOME", "USER", "LANG"].filter((k) => process.env[k]).map((k) => [k, process.env[k]])
  );
  const databaseUrl = `postgresql://cal_enterprise_test@localhost:55439/${database}?host=${encodeURIComponent(connection.host)}`;
  Object.assign(environment, {
    DATABASE_URL: databaseUrl,
    CAL_AUTHENTIK_ISSUER: target.issuer,
    NEXT_PUBLIC_WEBAPP_URL: "https://cal.mereka.dev",
    CAL_AUTHENTIK_ENABLED: "true",
    CAL_AUTHENTIK_ONLY: "true",
  });
  const invoke = (args: string[]) =>
    promisify(execFile)(process.execPath, ["scripts/link-enterprise-identity.cjs", ...args], {
      cwd: root,
      env: environment as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: 30000,
    });
  try {
    fs.writeFileSync(requestFile, JSON.stringify(input), { mode: 0o600 });
    assert.equal(
      JSON.parse(
        (await invoke(["self-plan", "--request", requestFile, "--out", planFile, "--database", database]))
          .stdout
      ).status,
      "planned"
    );
    assert.equal(fs.statSync(planFile).mode & 0o777, 0o600);
    assert.deepEqual(await counts(), { accounts: 0, audit: 0 });
    const args = ["self-apply", "--request", requestFile, "--plan", planFile, "--database", database];
    const applied = await invoke(args);
    assert.equal(JSON.parse(applied.stdout).status, "applied");
    assert.equal(JSON.parse((await invoke(args)).stdout).status, "replayed");
    assert.ok(!applied.stdout.includes(input.subject) && !applied.stdout.includes(databaseUrl));
    assert.deepEqual(await counts(), { accounts: 1, audit: 1 });
    assert.equal(await prisma.user.count(), 4);
    assert.equal(await prisma.team.count(), 0);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
}, 150000);

test("different self-link operations and subjects serialize on the actor row", async () => {
  const self = await selfFixture(),
    first = selfRequest();
  const second = { ...selfRequest(), subject: "different-reviewed-subject" };
  const plans = await Promise.all([self.plan(first), self.plan(second)]);
  const results = await Promise.allSettled([self.apply(first, plans[0]), self.apply(second, plans[1])]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(results.filter((x) => x.status === "rejected").length, 1);
  assert.deepEqual(await counts(), { accounts: 1, audit: 1 });
});

for (const field of ["version", "purpose", "authority", "planHash", "requestHash", "targetHash"] as const) {
  test(`self-link replay rejects incompatible audit ${field}`, async () => {
    const self = await selfFixture(),
      input = selfRequest(),
      plan = await self.plan(input);
    await self.apply(input, plan);
    const prior = await prisma.enterpriseAuditEvent.findUniqueOrThrow({
      where: { operationId: input.operationId },
    });
    assert.ok(prior.details && typeof prior.details === "object" && !Array.isArray(prior.details));
    await prisma.enterpriseAuditEvent.update({
      where: { operationId: input.operationId },
      data: {
        details: {
          ...prior.details,
          [field]:
            field === "version"
              ? 2
              : field === "planHash"
                ? (plan.planHash === "b".repeat(64) ? "a" : "b").repeat(64)
                : "changed",
        },
      },
    });
    const before = await counts();
    await assert.rejects(self.apply(input, plan));
    assert.deepEqual(await counts(), before);
  });
}
