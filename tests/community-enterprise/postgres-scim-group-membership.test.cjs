// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { before, beforeEach, after, test } = require("node:test");
const { connectFixture, sourceModules } = require("./tasker-fixture.cjs");
let db, identities, groups, actor, staff, org, foreign, team, scope, hosts, canCommit;
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
const removal = (changes = {}) => input({ event: "group-member-remove", ...changes });
before(async () => {
  db = await connectFixture(8);
  const load = sourceModules(db).load;
  identities = new (load(
    "packages/features/community-enterprise/identity/ScimIdentityService.ts"
  ).ScimIdentityService)(db);
  groups = new (load(
    "packages/features/community-enterprise/identity/ScimGroupMembershipService.ts"
  ).ScimGroupMembershipService)(db);
  hosts = new (load(
    "packages/features/community-enterprise/scheduling/QualifiedHostsService.ts"
  ).CommunityQualifiedHostsService)(db);
  canCommit = load(
    "packages/features/community-enterprise/scheduling/BookingCommitGuard.ts"
  ).assertBookingCanCommit;
});
beforeEach(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS refuse_group_audit ON "EnterpriseAuditEvent"');
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS pause_deactivation ON "Membership"');
  await db.scimMembershipGrant.deleteMany();
  await db.scimUserIdentity.deleteMany();
  await db.enterpriseAuditEvent.deleteMany();
  await db.booking.deleteMany();
  await db.host.deleteMany();
  await db.eventType.deleteMany();
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

async function assignedEvent() {
  const saved = await member();
  return db.eventType.create({
    data: {
      title: "Retained native host",
      slug: "retained",
      length: 30,
      teamId: team.id,
      schedulingType: "ROUND_ROBIN",
      hosts: { create: { userId: staff.id, memberId: saved.id, isFixed: false } },
    },
  });
}
const hostQuery = (event) => ({
  eventType: { id: event.id, users: [{ id: staff.id, email: staff.email, credentials: [] }] },
});
const commit = (event) =>
  db.$transaction(
    (tx) =>
      canCommit(tx, {
        eventTypeId: event.id,
        schedulingType: event.schedulingType,
        selectedHosts: [{ id: staff.id, email: staff.email }],
        startTime: new Date("2030-01-01T10:00:00Z"),
        endTime: new Date("2030-01-01T10:30:00Z"),
      }),
    { isolationLevel: "ReadCommitted" }
  );

test("explicit managed deactivation fences real host selection and booking commit without deleting native history", async () => {
  await groups.add(input());
  const event = await assignedEvent();
  await db.booking.create({
    data: {
      uid: randomUUID(),
      userId: staff.id,
      eventTypeId: event.id,
      title: "Future handoff still required",
      startTime: new Date("2031-01-01T10:00:00Z"),
      endTime: new Date("2031-01-01T10:30:00Z"),
    },
  });
  const original = {
    users: await db.user.findMany(),
    hosts: await db.host.findMany(),
    bookings: await db.booking.findMany(),
    events: await db.eventType.findMany(),
    root: await db.membership.findMany({ where: { teamId: org.id } }),
  };
  assert.deepEqual(
    (await hosts.findQualifiedHostsWithDelegationCredentials(hostQuery(event))).qualifiedRRHosts.map(
      (h) => h.user.id
    ),
    [staff.id]
  );
  await commit(event);
  const request = removal();
  assert.equal((await groups.deactivate(request)).status, "deactivated");
  const inactive = await member();
  const grant = await db.scimMembershipGrant.findFirstOrThrow();
  assert.equal(inactive.accepted, false);
  assert.equal(grant.lastManagedAccepted, false);
  assert.deepEqual(grant.lastManagedUpdatedAt, inactive.updatedAt);
  assert.equal(
    (await hosts.findQualifiedHostsWithDelegationCredentials(hostQuery(event))).qualifiedRRHosts.length,
    0
  );
  await assert.rejects(commit(event), { code: "booking_conflict_error" });
  assert.equal((await groups.deactivate(request)).status, "already-inactive");
  assert.equal(await db.enterpriseAuditEvent.count(), 3);
  assert.deepEqual(await db.user.findMany(), original.users);
  assert.deepEqual(await db.host.findMany(), original.hosts);
  assert.deepEqual(await db.booking.findMany(), original.bookings);
  assert.deepEqual(await db.eventType.findMany(), original.events);
  assert.deepEqual(await db.membership.findMany({ where: { teamId: org.id } }), original.root);
  await assert.rejects(groups.add(input()), denied);
});

test("deactivation preserves local privileged/custom-role grants and does not manufacture absent members", async () => {
  assert.equal((await groups.deactivate(removal())).status, "absent");
  const role = await db.role.create({ data: { name: "Local authority", teamId: team.id } });
  const saved = await db.membership.create({
    data: {
      userId: staff.id,
      teamId: team.id,
      role: "OWNER",
      accepted: true,
      customRoleId: role.id,
    },
  });
  assert.equal((await groups.deactivate(removal())).status, "preserved-local");
  assert.deepEqual(await member(), saved);
  assert.equal(await db.scimMembershipGrant.count(), 0);
  assert.equal(await db.enterpriseAuditEvent.count(), 1);
});

test("deactivation refuses changed nullable timestamps, acceptance, role and custom-role provenance", async () => {
  await groups.add(input());
  const saved = await member();
  const role = await db.role.create({ data: { name: "Changed role", teamId: team.id } });
  const provenance = await db.scimMembershipGrant.findMany();
  for (const change of [
    { updatedAt: null },
    { accepted: false },
    { role: "ADMIN" },
    { customRoleId: role.id },
  ]) {
    await db.membership.update({ where: { id: saved.id }, data: change });
    const changed = await member();
    await assert.rejects(groups.deactivate(removal()), denied);
    assert.deepEqual(await member(), changed);
    assert.deepEqual(await db.scimMembershipGrant.findMany(), provenance);
    await db.membership.update({
      where: { id: saved.id },
      data: {
        accepted: saved.accepted,
        role: saved.role,
        customRoleId: null,
        updatedAt: saved.updatedAt,
      },
    });
  }
});

test("deactivation cannot turn a filter snapshot or foreign/case-mismatched group into revocation", async () => {
  await groups.add(input());
  const saved = await member();
  for (const event of ["directory-filter-change", "group-sync", "user-disable", undefined])
    await assert.rejects(async () => groups.deactivate(removal({ event })));
  await assert.rejects(groups.deactivate(removal({ groupName: "exact-group" })), denied);
  await assert.rejects(
    groups.deactivate(removal({ identity: { ...scope, directoryId: "foreign-directory" } })),
    denied
  );
  await assert.rejects(groups.deactivate(removal({ teamId: org.id })), denied);
  await db.dSyncTeamGroupMapping.updateMany({
    data: { directoryId: "foreign-directory", organizationId: foreign.id },
  });
  await assert.rejects(groups.deactivate(removal()), denied);
  assert.deepEqual(await member(), saved);
});

test("deactivation rechecks current operator and UUID, and refuses a second directory's grant", async () => {
  await groups.add(input());
  await db.user.update({ where: { id: actor.id }, data: { role: "USER" } });
  await assert.rejects(groups.deactivate(removal()), denied);
  await db.user.update({ where: { id: actor.id }, data: { role: "ADMIN" } });
  await db.user.update({ where: { id: staff.id }, data: { uuid: randomUUID() } });
  await assert.rejects(groups.deactivate(removal()), denied);
  await db.user.update({ where: { id: staff.id }, data: { uuid: staff.uuid } });
  const { id: _id, createdAt: _created, ...snapshot } = await db.scimMembershipGrant.findFirstOrThrow();
  await db.scimMembershipGrant.create({ data: { ...snapshot, directoryId: "foreign-directory" } });
  await assert.rejects(groups.deactivate(removal()), denied);
  assert.equal((await member()).accepted, true);
});

test("deactivation audit failure atomically restores membership, provenance, native hosts and bookings", async () => {
  await groups.add(input());
  await assignedEvent();
  const saved = await member(),
    provenance = await db.scimMembershipGrant.findMany();
  const nativeHosts = await db.host.findMany(),
    bookings = await db.booking.findMany();
  await db.$executeRawUnsafe(
    "CREATE OR REPLACE FUNCTION refuse_group_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit refusal'; END $$"
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER refuse_group_audit BEFORE INSERT ON "EnterpriseAuditEvent" FOR EACH ROW EXECUTE FUNCTION refuse_group_audit()'
  );
  await assert.rejects(groups.deactivate(removal()));
  assert.deepEqual(await member(), saved);
  assert.deepEqual(await db.scimMembershipGrant.findMany(), provenance);
  assert.deepEqual(await db.host.findMany(), nativeHosts);
  assert.deepEqual(await db.booking.findMany(), bookings);
  assert.equal(await db.enterpriseAuditEvent.count(), 2);
});

test("deactivation operation IDs cannot alias a grant, another request or an externally reactivated membership", async () => {
  const add = input();
  await groups.add(add);
  await assert.rejects(groups.deactivate(removal({ operationId: add.operationId })), denied);
  const request = removal();
  await groups.deactivate(request);
  await assert.rejects(groups.deactivate({ ...request, groupName: "other" }), denied);
  await db.membership.update({ where: { id: (await member()).id }, data: { accepted: true } });
  const active = await member();
  await db.scimMembershipGrant.updateMany({
    data: { lastManagedAccepted: true, lastManagedUpdatedAt: active.updatedAt },
  });
  await assert.rejects(groups.deactivate(request), denied);
  assert.deepEqual(await member(), active);
});

test("an unchanged null timestamp remains manageable and a retained fixed host cannot become a smaller meeting", async () => {
  await groups.add(input());
  await db.membership.update({ where: { id: (await member()).id }, data: { updatedAt: null } });
  await db.scimMembershipGrant.updateMany({ data: { lastManagedUpdatedAt: null } });
  const event = await assignedEvent();
  await db.eventType.update({ where: { id: event.id }, data: { schedulingType: "COLLECTIVE" } });
  await db.host.updateMany({ data: { isFixed: true } });
  assert.equal(
    (await hosts.findQualifiedHostsWithDelegationCredentials(hostQuery(event))).fixedHosts.length,
    1
  );
  await groups.deactivate(removal());
  assert.equal(
    (await hosts.findQualifiedHostsWithDelegationCredentials(hostQuery(event))).fixedHosts.length,
    0
  );
  assert.equal(await db.host.count(), 1);
  assert.equal(await db.booking.count(), 1);
});

test("a real booking commit waits for in-flight deactivation and then refuses the stale selected host", async () => {
  await groups.add(input());
  const event = await assignedEvent();
  await db.$executeRawUnsafe(
    "CREATE OR REPLACE FUNCTION pause_deactivation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(60426541, 30001); RETURN NEW; END $$"
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER pause_deactivation BEFORE UPDATE ON "Membership" FOR EACH ROW EXECUTE FUNCTION pause_deactivation()'
  );
  let release, announce;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    announce = resolve;
  });
  let blocker;
  const holding = db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT true AS acquired FROM pg_advisory_xact_lock(60426541, 30001)`;
      blocker = (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid;
      announce();
      await gate;
    },
    { timeout: 10000 }
  );
  await ready;
  const deactivating = groups.deactivate(removal());
  deactivating.catch(() => {});
  let booking,
    deactivationPid,
    sawBookingWait = false;
  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      const rows =
        await db.$queryRaw`SELECT pid FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid))`;
      if (rows.length) {
        deactivationPid = rows[0].pid;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(deactivationPid, "Deactivation must reach the held native membership update");
    booking = commit(event);
    booking.catch(() => {});
    for (let attempt = 0; attempt < 80; attempt++) {
      const [row] =
        await db.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${deactivationPid} = ANY(pg_blocking_pids(pid))) AS blocked`;
      if (row.blocked) {
        sawBookingWait = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    assert.ok(release);
    release();
    await holding;
    await deactivating;
  }
  assert.ok(sawBookingWait, "The real booking commit must wait on the deactivation's user lock");
  await assert.rejects(booking, { code: "booking_conflict_error" });
  assert.equal((await member()).accepted, false);
  assert.equal(await db.booking.count(), 1);
});
