// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { PermissionCheckService } from "@calcom/features/community-enterprise/authorization/PermissionCheckService";
import {
  roleAssignmentCommitInput,
  roleCreateInput,
} from "@calcom/features/community-enterprise/roles/roleInputs";
import { ScopedRoleService } from "@calcom/features/community-enterprise/roles/ScopedRoleService";
import prisma from "@calcom/prisma";
import { afterAll, beforeAll, beforeEach, test } from "vitest";

const service = new ScopedRoleService(prisma);
const permissions = new PermissionCheckService(prisma);
const uuids = Array.from({ length: 9 }, () => randomUUID());
const actor = { id: 1, uuid: uuids[1] };
const target = { id: 2, uuid: uuids[2] };
const scope = { organizationId: 100, scopeId: 10 };
const request = () => ({
  ...scope,
  name: "Scoped observer",
  description: "Only reviewed read delegation",
  permissions: ["booking.readTeamBookings" as const],
  requestId: randomUUID(),
});
const create = (changes = {}) => service.create(actor, { ...request(), ...changes });
const proposal = (roleId: string | null, changes = {}) => ({ ...scope, target, roleId, ...changes });
const review = (roleId: string | null, changes = {}) => service.review(actor, proposal(roleId, changes));
const member = () =>
  prisma.membership.findUniqueOrThrow({ where: { userId_teamId: { userId: 2, teamId: 10 } } });
const state = async () => ({
  roles: await prisma.role.findMany({ orderBy: { id: "asc" } }),
  grants: await prisma.rolePermission.findMany({ orderBy: { id: "asc" } }),
  members: await prisma.membership.findMany({ orderBy: { id: "asc" } }),
  audits: await prisma.enterpriseAuditEvent.findMany({ orderBy: { id: "asc" } }),
});
let verified = false;
beforeAll(async () => {
  const socket = process.env.CAL_ENTERPRISE_TEST_SOCKET,
    directory = process.env.CAL_ENTERPRISE_TEST_PGDATA;
  assert.ok(socket && directory, "Use the retained disposable database runner");
  assert.equal(path.dirname(socket), path.dirname(directory));
  assert.match(path.basename(path.dirname(socket)), /^cal-enterprise-/);
  const [identity] = await prisma.$queryRaw<
    Array<{ directory: string; actor: string }>
  >`SELECT current_setting('data_directory') AS directory,current_user::text AS actor`;
  assert.equal(identity.directory, directory);
  assert.equal(identity.actor, "cal_enterprise_test");
  assert.equal(await prisma.user.count(), 0);
  verified = true;
});
beforeEach(async () => {
  assert.ok(verified);
  await prisma.$executeRawUnsafe('TRUNCATE "users", "Team", "EnterpriseAuditEvent" RESTART IDENTITY CASCADE');
  for (let id = 1; id <= 8; id++)
    await prisma.user.create({
      data: {
        id,
        uuid: uuids[id],
        email: `person${id}@fixture.test`,
        username: `person-${id}`,
        name: `Fixture ${id}`,
        role: id === 8 ? "ADMIN" : "USER",
        locked: id === 5,
        isPlatformManaged: id === 6,
      },
    });
  for (const id of [100, 200])
    await prisma.team.create({
      data: {
        id,
        name: `Organization ${id}`,
        isOrganization: true,
        organizationSettings: { create: { orgAutoAcceptEmail: "" } },
      },
    });
  for (const [id, parentId] of [
    [10, 100],
    [11, 100],
    [20, 200],
  ])
    await prisma.team.create({ data: { id, parentId, name: `Team ${id}` } });
  for (const [userId, teamId, role, accepted] of [
    [1, 100, "OWNER", true],
    [1, 10, "OWNER", true],
    [2, 100, "MEMBER", true],
    [2, 10, "MEMBER", true],
    [2, 11, "MEMBER", true],
    [3, 200, "OWNER", true],
    [3, 20, "OWNER", true],
    [4, 100, "ADMIN", true],
    [5, 100, "OWNER", true],
    [6, 100, "OWNER", true],
    [7, 100, "MEMBER", false],
  ] as const)
    await prisma.membership.create({ data: { userId, teamId, role, accepted } });
});
afterAll(async () => prisma.$disconnect());

for (const id of [2, 3, 4, 5, 6, 7, 8])
  test(`ordinary, foreign, admin, disabled or managed actor ${id} cannot define roles`, async () => {
    const identity = { id, uuid: uuids[id] };
    const before = await state();
    assert.deepEqual(await service.capability(identity, scope), { canManageRoles: false });
    await assert.rejects(service.create(identity, request()), /current organization owner/);
    await assert.rejects(service.catalog(identity, scope));
    assert.deepEqual(await state(), before);
  });
test("actor UUID binding and removed owner membership are rechecked", async () => {
  await assert.rejects(service.create({ ...actor, uuid: randomUUID() }, request()));
  await prisma.membership.deleteMany({ where: { userId: 1, teamId: 100 } });
  await assert.rejects(create());
  assert.equal(await prisma.role.count(), 0);
});
for (const changes of [{ scopeId: 20 }, { scopeId: 200 }, { organizationId: 10 }, { scopeId: 999 }])
  test(`foreign or malformed scope denied ${JSON.stringify(changes)}`, async () => {
    await assert.rejects(create(changes));
    assert.equal(await prisma.role.count(), 0);
  });
test("system, global and unaudited legacy definitions cannot be assigned", async () => {
  for (const [id, teamId, type] of [
    ["global", null, "CUSTOM"],
    ["system", 10, "SYSTEM"],
    ["legacy", 10, "CUSTOM"],
  ] as const) {
    await prisma.role.create({
      data: {
        id,
        teamId,
        type,
        name: id,
        permissions: { create: { resource: "booking", action: "readTeamBookings" } },
      },
    });
    await assert.rejects(review(id));
  }
  const rows = await service.catalog(actor, scope);
  assert.ok(rows.roles.every((role) => !role.managed));
  assert.equal((await member()).customRoleId, null);
});
test("definition creation changes no member and retains local actor/scope provenance", async () => {
  const before = (await state()).members;
  const created = await create();
  assert.equal(created.replayed, false);
  assert.deepEqual((await state()).members, before);
  const role = await prisma.role.findUniqueOrThrow({ where: { id: created.roleId } });
  assert.equal(role.type, "CUSTOM");
  assert.equal(role.teamId, 10);
  const audit = await prisma.enterpriseAuditEvent.findFirstOrThrow({
    where: { action: "custom-role.created" },
  });
  assert.equal(audit.organizationId, 100);
  assert.equal(audit.entityId, 10);
  assert.equal(audit.actorUserId, 1);
  assert.equal((audit.details as { source: string }).source, "local");
  assert.equal((audit.details as { roleId: string }).roleId, role.id);
});
test("role definition replay is canonical and never recreates deleted definitions", async () => {
  const input = {
    ...request(),
    permissions: ["eventType.read", "booking.readTeamBookings"] as (
      | "eventType.read"
      | "booking.readTeamBookings"
    )[],
  };
  const first = await service.create(actor, input);
  assert.deepEqual(await service.create(actor, { ...input, permissions: [...input.permissions].reverse() }), {
    roleId: first.roleId,
    replayed: true,
  });
  await assert.rejects(service.create(actor, { ...input, name: "different" }), /another request/);
  await prisma.role.delete({ where: { id: first.roleId } });
  await assert.rejects(service.create(actor, input));
  assert.equal(await prisma.role.count(), 0);
});
test("a duplicate name cannot create parallel definitions in one scope", async () => {
  const results = await Promise.allSettled([create(), create({ name: "SCOPED OBSERVER" })]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(await prisma.role.count(), 1);
  assert.equal(await prisma.enterpriseAuditEvent.count(), 1);
});
test("same names in different scopes remain distinct roles", async () => {
  const a = await create(),
    b = await create({ scopeId: 11 });
  assert.notEqual(a.roleId, b.roleId);
  await assert.rejects(review(b.roleId), /exact scope/);
});
test("assignment review is read-only and commit changes only its accepted member binding", async () => {
  const created = await create();
  const before = await state();
  const plan = await review(created.roleId);
  assert.deepEqual(await state(), before);
  assert.equal(plan.provenance, "local");
  await service.assign(actor, plan.input);
  const after = await member();
  assert.equal(after.customRoleId, created.roleId);
  assert.equal(after.role, "MEMBER");
  assert.equal(after.accepted, true);
  assert.equal(
    (await prisma.membership.findUniqueOrThrow({ where: { userId_teamId: { userId: 2, teamId: 11 } } }))
      .customRoleId,
    null
  );
  assert.equal(await prisma.enterpriseAuditEvent.count({ where: { action: "custom-role.assigned" } }), 1);
  assert.equal(
    await permissions.checkPermission({ userId: 2, teamId: 10, permission: "booking.readTeamBookings" }),
    true
  );
  assert.equal(
    await permissions.checkPermission({ userId: 2, teamId: 11, permission: "booking.readTeamBookings" }),
    false
  );
  assert.equal(
    await permissions.checkPermission({ userId: 2, teamId: 10, permission: "eventType.create" }),
    false
  );
  assert.equal(
    await permissions.checkPermission({ userId: 2, teamId: 100, permission: "organization.update" }),
    false
  );
  assert.deepEqual(
    await permissions.getTeamIdsWithPermission({ userId: 2, permission: "booking.readTeamBookings" }),
    [10]
  );
});
test("return to standard member revokes delegated booking visibility without erasing membership", async () => {
  const created = await create();
  await service.assign(actor, (await review(created.roleId)).input);
  const plan = await review(null);
  assert.equal(plan.before?.name, "Scoped observer");
  assert.equal(plan.after, null);
  await service.assign(actor, plan.input);
  assert.equal((await member()).customRoleId, null);
  assert.equal(
    await permissions.checkPermission({ userId: 2, teamId: 10, permission: "booking.readTeamBookings" }),
    false
  );
  assert.equal(
    await permissions.checkPermission({ userId: 2, teamId: 10, permission: "eventType.read" }),
    true
  );
});
test("root custom roles never imply rights over child or sibling teams", async () => {
  const role = await create({ scopeId: 100 });
  const plan = await review(role.roleId, { scopeId: 100 });
  await service.assign(actor, plan.input);
  assert.deepEqual(
    await permissions.getTeamIdsWithPermission({ userId: 2, permission: "booking.readTeamBookings" }),
    [100]
  );
  assert.equal(
    await permissions.checkPermission({ userId: 2, teamId: 10, permission: "booking.readTeamBookings" }),
    false
  );
});
for (const role of ["ADMIN", "OWNER"] as const)
  test(`never replace a ${role} membership or evade last-owner protection`, async () => {
    const created = await create();
    await prisma.membership.updateMany({ where: { userId: 2, teamId: 10 }, data: { role } });
    const before = await state();
    await assert.rejects(review(created.roleId), /ordinary member/);
    assert.deepEqual(await state(), before);
    await assert.rejects(review(created.roleId, { target: actor }), /ordinary member/);
  });
test("inherited root administrator rights cannot be disguised as a restricted child role", async () => {
  const role = await create();
  await prisma.membership.updateMany({ where: { userId: 2, teamId: 100 }, data: { role: "ADMIN" } });
  await assert.rejects(review(role.roleId), /Inherited organization/);
});
for (const changed of ["locked", "uuid", "pending", "removed", "role-definition"])
  test(`post-review ${changed} change prevents assignment`, async () => {
    const created = await create(),
      plan = await review(created.roleId);
    if (changed === "locked") await prisma.user.update({ where: { id: 2 }, data: { locked: true } });
    if (changed === "uuid") await prisma.user.update({ where: { id: 2 }, data: { uuid: randomUUID() } });
    if (changed === "pending")
      await prisma.membership.updateMany({ where: { userId: 2, teamId: 10 }, data: { accepted: false } });
    if (changed === "removed") await prisma.membership.deleteMany({ where: { userId: 2, teamId: 100 } });
    if (changed === "role-definition")
      await prisma.rolePermission.deleteMany({ where: { roleId: created.roleId } });
    const before = await state();
    await assert.rejects(service.assign(actor, plan.input));
    assert.deepEqual(await state(), before);
  });
test("replay cannot restore an earlier permission binding over a newer assignment", async () => {
  const a = await create(),
    b = await create({ name: "Event browser", permissions: ["eventType.read"] });
  const first = await review(a.roleId);
  await service.assign(actor, first.input);
  await service.assign(actor, (await review(b.roleId)).input);
  const before = await state();
  assert.deepEqual(await service.assign(actor, first.input), { recorded: true, replayed: true });
  assert.deepEqual(await state(), before);
  assert.equal((await member()).customRoleId, b.roleId);
});
test("stale review is refused even when the newly selected role itself did not change", async () => {
  const a = await create(),
    b = await create({ name: "Event browser", permissions: ["eventType.read"] });
  const pending = await review(a.roleId);
  await service.assign(actor, (await review(b.roleId)).input);
  await assert.rejects(service.assign(actor, pending.input), /review again/);
});
test("duplicate confirmation records one assignment and one audit", async () => {
  const role = await create(),
    plan = await review(role.roleId);
  const results = await Promise.all([service.assign(actor, plan.input), service.assign(actor, plan.input)]);
  assert.equal(results.filter((row) => row.replayed).length, 1);
  assert.equal(await prisma.enterpriseAuditEvent.count({ where: { action: "custom-role.assigned" } }), 1);
});
for (const action of ["custom-role.created", "custom-role.assigned"])
  test(`actual ${action} audit failure rolls back all writes`, async () => {
    const created = action.endsWith("assigned") ? await create() : null;
    const plan = created ? await review(created.roleId) : null;
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "EnterpriseAuditEvent" ADD CONSTRAINT role_fixture_audit_failure CHECK (action <> '${action}')`
    );
    const before = await state();
    try {
      await assert.rejects(plan ? service.assign(actor, plan.input) : create());
      assert.deepEqual(await state(), before);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "EnterpriseAuditEvent" DROP CONSTRAINT role_fixture_audit_failure'
      );
    }
  });
test("personal identity and resources are preserved across custom assignment and removal", async () => {
  await prisma.credential.create({
    data: { id: 99, type: "synthetic", userId: 2, key: { ciphertext: "fixture-only" } },
  });
  const before = await prisma.user.findUniqueOrThrow({ where: { id: 2 } });
  const role = await create();
  await service.assign(actor, (await review(role.roleId)).input);
  await service.assign(actor, (await review(null)).input);
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: 2 } }), before);
  assert.equal(
    (await prisma.credential.findUniqueOrThrow({ where: { id: 99 }, select: { userId: true } })).userId,
    2
  );
  assert.equal(await prisma.profile.count(), 0);
});
for (const extra of [
  { permissions: ["*"] },
  { permissions: ["organization.update"] },
  { permissions: ["apiKey.manage"] },
  { permissions: ["booking.read"] },
  { permissions: ["booking.readOrgBookings"] },
  { permissions: ["eventType.read", "eventType.read"] },
  { permissions: [] },
  { type: "SYSTEM" },
  { actorId: 8 },
])
  test(`unsupported capability or authority input is not assignable ${JSON.stringify(extra)}`, () => {
    assert.equal(roleCreateInput.safeParse({ ...request(), ...extra }).success, false);
  });
test("commit cannot accept forged permissions or provenance fields", async () => {
  const role = await create(),
    plan = await review(role.roleId);
  assert.equal(roleAssignmentCommitInput.safeParse({ ...plan.input, source: "directory" }).success, false);
  assert.equal(roleAssignmentCommitInput.safeParse({ ...plan.input, permissions: ["*"] }).success, false);
});

for (const level of ["organization", "team"])
  test(`directory-owned ${level} cannot be overwritten locally`, async () => {
    await prisma.dSyncData.create({
      data: {
        directoryId: "fixture-directory",
        tenant: "fixture",
        ...(level === "organization" ? { organizationId: 100 } : {}),
      },
    });
    if (level === "team")
      await prisma.dSyncTeamGroupMapping.create({
        data: {
          organizationId: 100,
          teamId: 10,
          directoryId: "fixture-directory",
          groupName: "fixture-group",
        },
      });
    const before = await state();
    await assert.rejects(create(), /Directory/);
    assert.deepEqual(await state(), before);
  });
for (const userId of [1, 2])
  test(`retained directory attribute provenance for user ${userId} survives removed group filters`, async () => {
    const role = await create();
    await prisma.dSyncData.create({ data: { directoryId: "fixture-directory", tenant: "fixture" } });
    const attr = await prisma.attribute.create({
      data: {
        teamId: 100,
        type: "TEXT",
        name: "Fixture",
        slug: "fixture",
        options: { create: { value: "directory", slug: "directory", contains: [] } },
      },
      select: { options: { select: { id: true } } },
    });
    const rootMember = await prisma.membership.findUniqueOrThrow({
      where: { userId_teamId: { userId, teamId: 100 } },
    });
    await prisma.attributeToUser.create({
      data: {
        memberId: rootMember.id,
        attributeOptionId: attr.options[0].id,
        createdByDSyncId: "fixture-directory",
      },
    });
    const before = await state();
    await assert.rejects(review(role.roleId), /Directory grant provenance/);
    assert.deepEqual(await state(), before);
    assert.equal(await prisma.attributeToUser.count(), 1);
  });

test("owner loss committed while assignment waits on the root is observed before writing", async () => {
  const role = await create(),
    plan = await review(role.roleId);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Team" WHERE id=100 FOR UPDATE`;
      entered();
      await hold;
      await tx.membership.updateMany({ where: { userId: 1, teamId: 100 }, data: { role: "ADMIN" } });
    },
    { timeout: 15000 }
  );
  await started;
  const pending = service.assign(actor, plan.input).then(
    (value) => ({ value }),
    (error: unknown) => ({ error })
  );
  let observed = false;
  try {
    const deadline = Date.now() + 5000;
    while (!observed && Date.now() < deadline) {
      const [waiting] = await prisma.$queryRaw<
        Array<{ count: number }>
      >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FROM "Team"%FOR UPDATE%'`;
      observed = waiting.count > 0;
      if (!observed) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(observed, "The assignment must be observed waiting, not just started concurrently");
  } finally {
    release();
    await holder;
  }
  const result = await pending;
  assert.ok("error" in result);
  assert.equal((await member()).customRoleId, null);
  assert.equal(await prisma.enterpriseAuditEvent.count({ where: { action: "custom-role.assigned" } }), 0);
});

test("a locally created role changed outside its recorded definition cannot be adopted silently", async () => {
  const role = await create();
  await prisma.rolePermission.updateMany({
    where: { roleId: role.roleId },
    data: { resource: "eventType", action: "read" },
  });
  const before = await state();
  await assert.rejects(review(role.roleId), /unreviewed or changed provenance/);
  assert.deepEqual(await state(), before);
});

test("unclassified custom parent roles are not treated as locally managed grants", async () => {
  const role = await create();
  await prisma.role.create({
    data: {
      id: "legacy-parent",
      name: "Legacy parent",
      teamId: 100,
      type: "CUSTOM",
      permissions: { create: { resource: "eventType", action: "read" } },
    },
  });
  await prisma.membership.updateMany({
    where: { userId: 2, teamId: 100 },
    data: { customRoleId: "legacy-parent" },
  });
  const before = await state();
  await assert.rejects(review(role.roleId), /provenance/);
  assert.deepEqual(await state(), before);
});
test("a valid local custom parent and child retain separate explicit scopes", async () => {
  const rootRole = await create({ scopeId: 100, name: "Root observer" });
  await service.assign(actor, (await review(rootRole.roleId, { scopeId: 100 })).input);
  const childRole = await create();
  await service.assign(actor, (await review(childRole.roleId)).input);
  assert.deepEqual(
    await permissions.getTeamIdsWithPermission({ userId: 2, permission: "booking.readTeamBookings" }),
    [10, 100]
  );
  await prisma.membership.deleteMany({ where: { userId: 2, teamId: 100 } });
  assert.deepEqual(
    await permissions.getTeamIdsWithPermission({ userId: 2, permission: "booking.readTeamBookings" }),
    []
  );
});
test("new role creation cannot exceed the bounded administration catalogue", async () => {
  await prisma.role.createMany({
    data: Array.from({ length: 100 }, (_, index) => ({ name: `existing-${index}`, teamId: 10 })),
  });
  await assert.rejects(create(), /maximum reviewed role/);
  assert.equal(await prisma.role.count(), 100);
  assert.equal(await prisma.enterpriseAuditEvent.count(), 0);
});
