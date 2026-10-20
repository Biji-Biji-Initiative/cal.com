// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { before, beforeEach, after, test } = require("node:test");
const { connectFixture, sourceModules } = require("./tasker-fixture.cjs");
let db, identities, groups, actor, staff, org, foreign, team, scope;
const denied = { code: "forbidden_error" };
const input = (changes = {}) => ({
  identity: scope,
  teamId: team.id,
  groupName: "Exact-Group",
  operationId: randomUUID(),
  ...changes,
});
const member = () =>
  db.membership.findUnique({ where: { userId_teamId: { userId: staff.id, teamId: team.id } } });
before(async () => {
  db = await connectFixture(8);
  const load = sourceModules(db).load;
  identities = new (load(
    "packages/features/community-enterprise/identity/ScimIdentityService.ts"
  ).ScimIdentityService)(db);
  groups = new (load(
    "packages/features/community-enterprise/identity/ScimGroupMembershipService.ts"
  ).ScimGroupMembershipService)(db);
});
beforeEach(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS refuse_group_audit ON "EnterpriseAuditEvent"');
  await db.scimMembershipGrant.deleteMany();
  await db.scimUserIdentity.deleteMany();
  await db.enterpriseAuditEvent.deleteMany();
  await db.booking.deleteMany();
  await db.membership.deleteMany();
  await db.dSyncTeamGroupMapping.deleteMany();
  await db.dSyncData.deleteMany();
  await db.organizationSettings.deleteMany();
  await db.role.deleteMany();
  await db.team.deleteMany();
  await db.user.deleteMany();
  actor = await db.user.create({ data: { email: "operator@fixture.test", role: "ADMIN" } });
  staff = await db.user.create({ data: { email: "staff@fixture.test" } });
  org = await db.team.create({ data: { name: "Root", isOrganization: true } });
  foreign = await db.team.create({ data: { name: "Foreign", isOrganization: true } });
  team = await db.team.create({ data: { name: "Mapped team", parentId: org.id } });
  for (const organization of [org, foreign]) {
    await db.organizationSettings.create({
      data: { organizationId: organization.id, orgAutoAcceptEmail: "fixture.test" },
    });
    await db.dSyncData.create({
      data: {
        directoryId: organization.id === org.id ? "directory" : "foreign-directory",
        tenant: "native",
        organizationId: organization.id,
      },
    });
  }
  for (const user of [actor, staff]) {
    await db.membership.create({ data: { userId: user.id, teamId: org.id, role: "MEMBER", accepted: true } });
  }
  await db.dSyncTeamGroupMapping.create({
    data: { organizationId: org.id, teamId: team.id, directoryId: "directory", groupName: "Exact-Group" },
  });
  await db.booking.create({
    data: {
      uid: randomUUID(),
      userId: staff.id,
      title: "Preserved history",
      startTime: new Date(0),
      endTime: new Date(3600000),
    },
  });
  scope = {
    actorUserId: actor.id,
    actorUuid: actor.uuid,
    organizationId: org.id,
    directoryId: "directory",
    tenant: "native",
    externalId: "Exact-Staff",
  };
  await identities.bind({
    ...scope,
    operationId: randomUUID(),
    userId: staff.id,
    expectedUserUuid: staff.uuid,
  });
});
after(async () => {
  if (db) await db.$disconnect();
});

test("exact mapped grant creates one native MEMBER, provenance snapshot and atomic audit; replay is harmless", async () => {
  const users = await db.user.findMany();
  const bookings = await db.booking.findMany();
  const request = input();
  const result = await groups.add(request);
  assert.equal(result.status, "granted");
  const saved = await member();
  assert.equal(saved.role, "MEMBER");
  assert.equal(saved.accepted, true);
  assert.equal(saved.customRoleId, null);
  const grant = await db.scimMembershipGrant.findFirstOrThrow();
  assert.equal(grant.membershipId, saved.id);
  assert.equal(grant.lastManagedRole, saved.role);
  assert.equal(grant.lastManagedAccepted, saved.accepted);
  assert.equal(grant.lastManagedCustomRoleId, null);
  assert.deepEqual(grant.lastManagedUpdatedAt, saved.updatedAt);
  assert.equal((await groups.add(request)).status, "already-managed");
  assert.equal(await db.scimMembershipGrant.count(), 1);
  assert.equal(await db.enterpriseAuditEvent.count(), 2);
  assert.deepEqual(await db.user.findMany(), users);
  assert.deepEqual(await db.booking.findMany(), bookings);
});

test("local OWNER/custom-role membership is preserved without source adoption or timestamp edits", async () => {
  const role = await db.role.create({ data: { name: "Local role", teamId: team.id } });
  const saved = await db.membership.create({
    data: { userId: staff.id, teamId: team.id, role: "OWNER", accepted: true, customRoleId: role.id },
  });
  assert.equal((await groups.add(input())).status, "preserved-local");
  assert.deepEqual(await member(), saved);
  assert.equal(await db.scimMembershipGrant.count(), 0);
  assert.equal(await db.enterpriseAuditEvent.count(), 1);
});

test("role/accepted/timestamp drift is refused rather than overwritten", async () => {
  await groups.add(input());
  const saved = await member();
  for (const change of [
    { role: "ADMIN" },
    { accepted: false },
    { updatedAt: null },
    { updatedAt: new Date(saved.updatedAt.getTime() + 1) },
  ]) {
    await db.membership.update({ where: { id: saved.id }, data: change });
    const changed = await member();
    await assert.rejects(groups.add(input()), denied);
    assert.deepEqual(await member(), changed);
    await db.membership.update({
      where: { id: saved.id },
      data: { role: saved.role, accepted: saved.accepted, updatedAt: saved.updatedAt },
    });
  }
});

test("matching persisted custom-role or privileged snapshots still cannot be managed", async () => {
  await groups.add(input());
  const saved = await member();
  const role = await db.role.create({ data: { name: "Protected", teamId: team.id } });
  await db.membership.update({ where: { id: saved.id }, data: { customRoleId: role.id } });
  const changed = await member();
  await db.scimMembershipGrant.updateMany({
    data: { lastManagedCustomRoleId: role.id, lastManagedUpdatedAt: changed.updatedAt },
  });
  await assert.rejects(groups.add(input()), denied);
  assert.deepEqual(await member(), changed);
});

test("foreign/changed group mapping, case mismatch and root/foreign target teams fail closed", async () => {
  await assert.rejects(groups.add(input({ groupName: "exact-group" })), denied);
  for (const teamId of [org.id, foreign.id]) await assert.rejects(groups.add(input({ teamId })), denied);
  await db.dSyncTeamGroupMapping.updateMany({
    data: { directoryId: "foreign-directory", organizationId: foreign.id },
  });
  await assert.rejects(groups.add(input()), denied);
  assert.equal(await member(), null);
});

test("current operator revocation and user UUID drift are rechecked inside the grant transaction", async () => {
  await db.user.update({ where: { id: actor.id }, data: { role: "USER" } });
  await assert.rejects(groups.add(input()), denied);
  await db.user.update({ where: { id: actor.id }, data: { role: "ADMIN" } });
  await db.user.update({ where: { id: staff.id }, data: { uuid: randomUUID() } });
  await assert.rejects(groups.add(input()), denied);
  assert.equal(await member(), null);
});

test("ambiguous multi-directory provenance is refused without touching either grant", async () => {
  await groups.add(input());
  const saved = await db.scimMembershipGrant.findFirstOrThrow();
  const { id: _id, createdAt: _createdAt, ...snapshot } = saved;
  await db.scimMembershipGrant.create({ data: { ...snapshot, directoryId: "foreign-directory" } });
  await assert.rejects(groups.add(input()), denied);
  assert.equal(await db.scimMembershipGrant.count(), 2);
});

test("audit failure rolls back membership and provenance together while retaining identity/bookings", async () => {
  await db.$executeRawUnsafe(
    "CREATE OR REPLACE FUNCTION refuse_group_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit refusal'; END $$"
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER refuse_group_audit BEFORE INSERT ON "EnterpriseAuditEvent" FOR EACH ROW EXECUTE FUNCTION refuse_group_audit()'
  );
  await assert.rejects(groups.add(input()));
  assert.equal(await member(), null);
  assert.equal(await db.scimMembershipGrant.count(), 0);
  assert.equal(await db.scimUserIdentity.count(), 1);
  assert.equal(await db.booking.count(), 1);
});

test("concurrent absent-member requests grant once and preserve unique provenance", async () => {
  const results = await Promise.allSettled([groups.add(input()), groups.add(input())]);
  assert.equal(
    results.filter((entry) => entry.status === "fulfilled" && entry.value.status === "granted").length,
    1
  );
  for (const entry of results)
    if (entry.status === "rejected") assert.ok(["P2034", "P2002"].includes(entry.reason.code));
  assert.equal(await db.membership.count({ where: { userId: staff.id, teamId: team.id } }), 1);
  assert.equal(await db.scimMembershipGrant.count(), 1);
  assert.equal(await db.enterpriseAuditEvent.count(), 2);
});

test("pending-payment and platform child teams cannot receive a directory grant", async () => {
  for (const state of [{ pendingPayment: true }, { isPlatform: true }]) {
    await db.team.update({
      where: { id: team.id },
      data: { pendingPayment: false, isPlatform: false, ...state },
    });
    await assert.rejects(groups.add(input()), denied);
    assert.equal(await member(), null);
  }
});

test("an owned deactivated membership cannot report add or replay as an active grant", async () => {
  const request = input();
  await groups.add(request);
  const initial = await member();
  await db.membership.update({ where: { id: initial.id }, data: { accepted: false } });
  const inactive = await member();
  await db.scimMembershipGrant.updateMany({
    data: {
      lastManagedAccepted: false,
      lastManagedUpdatedAt: inactive.updatedAt,
    },
  });
  const provenance = await db.scimMembershipGrant.findMany();
  await assert.rejects(groups.add(request), denied);
  await assert.rejects(groups.add(input()), denied);
  assert.deepEqual(await member(), inactive);
  assert.deepEqual(await db.scimMembershipGrant.findMany(), provenance);
  assert.equal(await db.enterpriseAuditEvent.count(), 2);
});
