// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { before, beforeEach, after, test } = require("node:test");
const { connectFixture, sourceModules } = require("./tasker-fixture.cjs");
let db, service, actor, staff, other, organization, foreignOrganization, scope;
const denied = { code: "forbidden_error" };
const request = (changes = {}) => ({
  ...scope,
  operationId: randomUUID(),
  userId: staff.id,
  expectedUserUuid: staff.uuid,
  ...changes,
});
const count = () => db.scimUserIdentity.count();
before(async () => {
  db = await connectFixture(8);
  const { ScimIdentityService } = sourceModules(db).load(
    "packages/features/community-enterprise/identity/ScimIdentityService.ts"
  );
  service = new ScimIdentityService(db);
});
beforeEach(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS refuse_scim_audit ON "EnterpriseAuditEvent"');
  await db.scimUserIdentity.deleteMany();
  await db.enterpriseAuditEvent.deleteMany();
  await db.booking.deleteMany();
  await db.membership.deleteMany();
  await db.dSyncData.deleteMany();
  await db.organizationSettings.deleteMany();
  await db.team.deleteMany();
  await db.user.deleteMany();
  actor = await db.user.create({ data: { email: "operator@fixture.test", role: "ADMIN" } });
  staff = await db.user.create({ data: { email: "staff@fixture.test" } });
  other = await db.user.create({ data: { email: "other@fixture.test" } });
  organization = await db.team.create({ data: { name: "Existing organization", isOrganization: true } });
  foreignOrganization = await db.team.create({
    data: { name: "Foreign organization", isOrganization: true },
  });
  for (const org of [organization, foreignOrganization]) {
    await db.organizationSettings.create({
      data: { organizationId: org.id, orgAutoAcceptEmail: "fixture.test" },
    });
  }
  for (const user of [actor, staff, other]) {
    await db.membership.create({
      data: { userId: user.id, teamId: organization.id, role: "MEMBER", accepted: true },
    });
  }
  await db.dSyncData.create({
    data: { directoryId: "exact-directory", tenant: "native-tenant", organizationId: organization.id },
  });
  await db.booking.create({
    data: {
      uid: randomUUID(),
      userId: staff.id,
      title: "Preserved booking",
      startTime: new Date("2026-10-20T10:00:00Z"),
      endTime: new Date("2026-10-20T11:00:00Z"),
    },
  });
  scope = {
    actorUserId: actor.id,
    actorUuid: actor.uuid,
    organizationId: organization.id,
    directoryId: "exact-directory",
    tenant: "native-tenant",
    externalId: "Exact-Staff",
  };
});
after(async () => {
  if (db) await db.$disconnect();
});

test("explicit exact binding is audited atomically and resolves without changing users/grants/bookings", async () => {
  const users = await db.user.findMany({ orderBy: { id: "asc" } });
  const members = await db.membership.findMany({ orderBy: { id: "asc" } });
  const bookings = await db.booking.findMany();
  const input = request();
  const result = await service.bind(input);
  assert.equal(result.userId, staff.id);
  assert.equal(result.expectedUserUuid, staff.uuid);
  assert.deepEqual(await service.resolve(scope), result);
  assert.deepEqual(await service.bind(input), result);
  assert.equal(await count(), 1);
  assert.equal(await db.enterpriseAuditEvent.count(), 1);
  assert.deepEqual(await db.user.findMany({ orderBy: { id: "asc" } }), users);
  assert.deepEqual(await db.membership.findMany({ orderBy: { id: "asc" } }), members);
  assert.deepEqual(await db.booking.findMany(), bookings);
});

test("resolution has no email, username or case-folding fallback and cannot create a binding", async () => {
  await assert.rejects(service.resolve({ ...scope, externalId: staff.email }), denied);
  assert.equal(await count(), 0);
  await service.bind(request());
  await assert.rejects(service.resolve({ ...scope, externalId: "exact-staff" }), denied);
  assert.equal(await count(), 1);
});

test("externalId/user rebinding and operation-ID reuse are refused without rewriting the original", async () => {
  const input = request();
  const original = await service.bind(input);
  await assert.rejects(service.bind(request({ userId: other.id, expectedUserUuid: other.uuid })), denied);
  await assert.rejects(service.bind(request({ externalId: "Different-Staff" })), denied);
  await assert.rejects(
    service.bind(
      request({
        operationId: input.operationId,
        externalId: "Different-Staff",
        userId: other.id,
        expectedUserUuid: other.uuid,
      })
    ),
    denied
  );
  assert.deepEqual(await service.resolve(scope), original);
  assert.equal(await count(), 1);
  assert.equal(await db.enterpriseAuditEvent.count(), 1);
});

test("wrong initial UUID and changed current UUID both fail closed", async () => {
  await assert.rejects(service.bind(request({ expectedUserUuid: randomUUID() })), denied);
  assert.equal(await count(), 0);
  await service.bind(request());
  await db.user.update({ where: { id: staff.id }, data: { uuid: randomUUID() } });
  await assert.rejects(service.resolve(scope), denied);
  await assert.rejects(service.bind(request()), denied);
  assert.equal(await db.enterpriseAuditEvent.count(), 1);
});

for (const change of [{ role: "USER" }, { locked: true }, { isPlatformManaged: true }]) {
  test(`current operator state ${Object.keys(change)[0]} is rechecked`, async () => {
    await service.bind(request());
    await db.user.update({ where: { id: actor.id }, data: change });
    await assert.rejects(service.resolve(scope), denied);
    await assert.rejects(service.bind(request()), denied);
    assert.equal(await db.enterpriseAuditEvent.count(), 1);
  });
}

test("wrong operator UUID and unaccepted actor/target memberships are refused", async () => {
  await assert.rejects(service.bind(request({ actorUuid: randomUUID() })), denied);
  for (const user of [actor, staff]) {
    await db.membership.update({
      where: { userId_teamId: { userId: user.id, teamId: organization.id } },
      data: { accepted: false },
    });
    await assert.rejects(service.bind(request()), denied);
    await db.membership.update({
      where: { userId_teamId: { userId: user.id, teamId: organization.id } },
      data: { accepted: true },
    });
  }
  assert.equal(await count(), 0);
});

test("foreign/null directory organization and tenant drift cannot confer authority", async () => {
  await service.bind(request());
  for (const organizationId of [foreignOrganization.id, null]) {
    await db.dSyncData.update({ where: { directoryId: scope.directoryId }, data: { organizationId } });
    await assert.rejects(service.resolve(scope), denied);
    await assert.rejects(service.bind(request()), denied);
  }
  for (const user of [actor, staff]) {
    await db.membership.create({
      data: { userId: user.id, teamId: foreignOrganization.id, role: "MEMBER", accepted: true },
    });
  }
  await db.dSyncData.update({
    where: { directoryId: scope.directoryId },
    data: { organizationId: foreignOrganization.id },
  });
  await assert.rejects(service.resolve({ ...scope, organizationId: foreignOrganization.id }), denied);
  await db.dSyncData.update({
    where: { directoryId: scope.directoryId },
    data: { organizationId: organization.id, tenant: "changed-tenant" },
  });
  await assert.rejects(service.resolve(scope), denied);
  await assert.rejects(service.resolve({ ...scope, tenant: "changed-tenant" }), denied);
  assert.equal(await count(), 1);
});

test("non-root organizations and missing/locked target membership cannot be linked", async () => {
  await db.team.update({ where: { id: organization.id }, data: { parentId: foreignOrganization.id } });
  await assert.rejects(service.bind(request()), denied);
  await db.team.update({ where: { id: organization.id }, data: { parentId: null } });
  await db.user.update({ where: { id: staff.id }, data: { locked: true } });
  await assert.rejects(service.bind(request()), denied);
  await db.user.update({ where: { id: staff.id }, data: { locked: false } });
  await db.membership.delete({ where: { userId_teamId: { userId: staff.id, teamId: organization.id } } });
  await assert.rejects(service.bind(request()), denied);
  assert.equal(await count(), 0);
});

test("input rejects normalization, control characters and extra identity/role fields", async () => {
  for (const input of [
    request({ externalId: " Exact-Staff" }),
    request({ externalId: "Exact\nStaff" }),
    request({ email: staff.email }),
    request({ role: "OWNER" }),
  ]) {
    assert.throws(() => service.bind(input));
  }
  assert.equal(await count(), 0);
});

test("audit insertion failure rolls back the binding without changing booking history", async () => {
  await db.$executeRawUnsafe(
    "CREATE OR REPLACE FUNCTION refuse_scim_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit refusal'; END $$"
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER refuse_scim_audit BEFORE INSERT ON "EnterpriseAuditEvent" FOR EACH ROW EXECUTE FUNCTION refuse_scim_audit()'
  );
  await assert.rejects(service.bind(request()));
  assert.equal(await count(), 0);
  assert.equal(await db.enterpriseAuditEvent.count(), 0);
  assert.equal(await db.booking.count(), 1);
});

test("concurrent competing absent-key bindings admit one mapping and one audit", async () => {
  const results = await Promise.allSettled([
    service.bind(request()),
    service.bind(request({ externalId: "competing-external" })),
  ]);
  assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(results.filter((entry) => entry.status === "rejected").length, 1);
  assert.equal(await count(), 1);
  assert.equal(await db.enterpriseAuditEvent.count(), 1);
});

test("operator revocation committed while a binding waits cannot authorize a stale write", async () => {
  /** @type {(() => void) | undefined} */
  let release;
  let locked;
  const gate = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  const ready = new Promise((resolve) => {
    locked = resolve;
  });
  let blocker;
  const update = db.$transaction(
    async (tx) => {
      await tx.user.update({ where: { id: actor.id }, data: { role: "USER" } });
      blocker = (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid;
      locked();
      await gate;
    },
    { timeout: 10000 }
  );
  await ready;
  const pending = service.bind(request());
  pending.catch(() => {});
  let observed = false;
  try {
    for (let attempt = 0; attempt < 40; attempt++) {
      const [state] =
        await db.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid))) AS blocked`;
      if (state.blocked) {
        observed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    assert.ok(release);
    release();
    await update;
  }
  await assert.rejects(pending);
  assert.equal(observed, true, "The real binding must have waited for the held operator row");
  assert.equal(await count(), 0);
  assert.equal(await db.enterpriseAuditEvent.count(), 0);
});

test("an unaudited preexisting mapping cannot be silently adopted as reviewed authority", async () => {
  await db.scimUserIdentity.create({
    data: {
      directoryId: scope.directoryId,
      externalId: scope.externalId,
      userId: staff.id,
      expectedUserUuid: staff.uuid,
    },
  });
  await assert.rejects(service.resolve(scope), denied);
  await assert.rejects(service.bind(request()), denied);
  assert.equal(await db.enterpriseAuditEvent.count(), 0);
});
