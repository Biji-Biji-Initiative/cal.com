// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { hashAPIKey } from "@calcom/features/api-keys-legacy/api-keys/lib/apiKeys";
import { authenticateApiKey } from "@calcom/features/community-enterprise/api-keys/ApiKeyAuthentication";
import { PermissionCheckService } from "@calcom/features/community-enterprise/authorization/PermissionCheckService";
import { OrganizationInvitationService } from "@calcom/features/community-enterprise/organizations/OrganizationInvitationService";
import { OrganizationMemberService } from "@calcom/features/community-enterprise/organizations/OrganizationMemberService";
import prisma from "@calcom/prisma";
import { afterAll, beforeAll, beforeEach, test } from "vitest";

const service = new OrganizationMemberService(prisma);
const invitations = new OrganizationInvitationService(prisma);
const ids = Array.from({ length: 10 }, () => randomUUID());
const actor = (id: number) => ({ id, uuid: ids[id] });
const request = (
  target = 3,
  operation: "remove" | "set-role" | "transfer-ownership" = "remove",
  role?: "MEMBER" | "ADMIN"
) => ({ organizationId: 100, target: actor(target), operation, ...(role ? { role } : {}) });
const member = (id = 3, teamId = 100) =>
  prisma.membership.findUnique({
    where: { userId_teamId: { userId: id, teamId } },
    select: { id: true, role: true, accepted: true, customRoleId: true },
  });
let verified = false;
beforeAll(async () => {
  const socket = process.env.CAL_ENTERPRISE_TEST_SOCKET,
    directory = process.env.CAL_ENTERPRISE_TEST_PGDATA;
  assert.ok(socket && directory, "Use the isolated fixture runner, never an application database URL");
  assert.equal(path.dirname(socket), path.dirname(directory));
  assert.match(path.basename(path.dirname(socket)), /^cal-enterprise-/);
  const [row] = await prisma.$queryRaw<
    Array<{ directory: string; actor: string }>
  >`SELECT current_setting('data_directory') AS directory, current_user::text AS actor`;
  assert.equal(row.directory, directory);
  assert.equal(row.actor, "cal_enterprise_test");
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
        uuid: ids[id],
        email: `member${id}@fixture.test`,
        username: `member-${id}`,
        name: `Synthetic ${id}`,
        emailVerified: new Date(),
        role: id === 4 ? "ADMIN" : "USER",
        locked: id === 5,
        isPlatformManaged: id === 8,
      },
    });
  for (const id of [100, 200])
    await prisma.team.create({
      data: {
        id,
        name: `Org ${id}`,
        slug: `org-${id}`,
        isOrganization: true,
        organizationSettings: { create: { orgAutoAcceptEmail: "", orgAutoJoinOnSignup: false } },
      },
    });
  for (const [id, parentId] of [
    [110, 100],
    [210, 200],
  ])
    await prisma.team.create({ data: { id, parentId, name: `Team ${id}`, slug: `team-${id}` } });
  for (const [userId, teamId, role, accepted] of [
    [1, 100, "OWNER", true],
    [2, 100, "ADMIN", true],
    [3, 100, "MEMBER", true],
    [5, 100, "MEMBER", true],
    [6, 100, "MEMBER", true],
    [7, 100, "MEMBER", false],
    [8, 100, "MEMBER", true],
    [1, 110, "OWNER", true],
    [3, 110, "MEMBER", true],
    [3, 200, "OWNER", true],
    [3, 210, "OWNER", true],
  ] as const)
    await prisma.membership.create({ data: { userId, teamId, role, accepted } });
  for (const [userId, organizationId] of [
    [1, 100],
    [2, 100],
    [3, 100],
    [6, 100],
    [3, 200],
  ])
    await prisma.profile.create({
      data: { uid: randomUUID(), userId, organizationId, username: `member-${userId}` },
    });
});
afterAll(async () => {
  await prisma.$disconnect();
});
const snapshot = async () => ({
  members: await prisma.membership.findMany({ orderBy: { id: "asc" } }),
  profiles: await prisma.profile.findMany({ orderBy: { id: "asc" } }),
  audits: await prisma.enterpriseAuditEvent.count(),
  keys: await prisma.apiKey.findMany({
    select: { id: true, userId: true, teamId: true },
    orderBy: { id: "asc" },
  }),
});
const reviewed = async (
  target = 3,
  op: "remove" | "set-role" | "transfer-ownership" = "remove",
  role?: "MEMBER" | "ADMIN",
  who = 1
) => service.review(actor(who), request(target, op, role));
async function blocked(code: string, target = 3) {
  const before = await snapshot();
  const proposal = await reviewed(target);
  assert.ok(proposal.blockers.includes(code), JSON.stringify(proposal.blockers));
  await assert.rejects(service.commit(actor(1), proposal.input), /blockers/);
  assert.deepEqual(await snapshot(), before);
}
async function key(userId: number, teamId: number | null) {
  const raw = randomBytes(16).toString("hex");
  const row = await prisma.apiKey.create({
    data: { userId, teamId, hashedKey: hashAPIKey(raw) },
    select: { id: true },
  });
  return { ...row, value: `cal_${raw}` };
}

for (const id of [3, 4, 5, 7, 8])
  test(`ordinary, global, pending, locked or managed actor ${id} has no organization management`, async () => {
    await assert.rejects(service.members(actor(id), { organizationId: 100 }));
    await assert.rejects(service.review(actor(id), request()));
  });
test("foreign organization and stale actor identity are denied", async () => {
  await assert.rejects(service.review(actor(1), { ...request(), organizationId: 200 }));
  await assert.rejects(service.review({ ...actor(1), uuid: randomUUID() }, request()));
});
test("review is read-only and never exposes credential material", async () => {
  await key(3, 110);
  const before = await snapshot();
  const proposal = await reviewed();
  assert.deepEqual(await snapshot(), before);
  assert.equal(proposal.blockers.length, 0);
  assert.equal(proposal.effects.membershipsRemoved, 2);
  assert.equal(proposal.effects.profilesRemoved, 1);
  assert.equal(proposal.effects.scopedApiKeysRevoked, 1);
  assert.ok(!JSON.stringify(proposal).match(/hashedKey|secret|identifier|operationHash/));
});
test("owner can promote a member but ordinary admins cannot assign organization roles", async () => {
  await assert.rejects(reviewed(3, "set-role", "ADMIN", 2));
  const proposal = await reviewed(3, "set-role", "ADMIN");
  await service.commit(actor(1), proposal.input);
  assert.equal((await member())?.role, "ADMIN");
  assert.equal((await member(3, 110))?.role, "MEMBER");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: 3 } })).role, "USER");
});
test("an admin cannot remove another administrator or owner", async () => {
  await assert.rejects(reviewed(1, "remove", undefined, 2));
  await prisma.membership.update({
    where: { userId_teamId: { userId: 6, teamId: 100 } },
    data: { role: "ADMIN" },
  });
  await assert.rejects(reviewed(6, "remove", undefined, 2));
});
test("active owner is retained, even if other OWNER rows are locked or pending", async () => {
  await blocked("last-owner", 1);
  for (const id of [5, 7])
    await prisma.membership.update({
      where: { userId_teamId: { userId: id, teamId: 100 } },
      data: { role: "OWNER" },
    });
  await blocked("last-owner", 1);
});
test("ownership transfer promotes only the selected accepted member and demotes the caller atomically", async () => {
  const proposal = await reviewed(6, "transfer-ownership");
  assert.equal(proposal.blockers.length, 0);
  await service.commit(actor(1), proposal.input);
  assert.equal((await member(6))?.role, "OWNER");
  assert.equal((await member(1))?.role, "ADMIN");
  assert.equal((await member(1, 110))?.role, "OWNER");
  await assert.rejects(reviewed(3, "set-role", "ADMIN", 1));
});
for (const target of [1, 5, 7, 8])
  test(`invalid ownership recipient ${target} cannot acquire owner rights`, async () => {
    await assert.rejects(reviewed(target, "transfer-ownership"));
  });
test("concurrent owner demotions never leave zero active owners", async () => {
  await prisma.membership.update({
    where: { userId_teamId: { userId: 2, teamId: 100 } },
    data: { role: "OWNER" },
  });
  const a = await reviewed(1, "set-role", "MEMBER", 1),
    b = await reviewed(2, "set-role", "MEMBER", 2);
  const results = await Promise.allSettled([
    service.commit(actor(1), a.input),
    service.commit(actor(2), b.input),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    await prisma.membership.count({
      where: { teamId: 100, accepted: true, role: "OWNER", user: { locked: false } },
    }),
    1
  );
});

test("offboarding removes only local organizational grants and additive profile", async () => {
  await prisma.credential.create({
    data: { id: 900, type: "synthetic_calendar", key: { ciphertext: "test-only" }, userId: 3 },
  });
  await prisma.eventType.create({
    data: { id: 900, title: "Personal", slug: "personal", length: 30, userId: 3 },
  });
  await prisma.booking.create({
    data: {
      uid: "personal-booking",
      userId: 3,
      eventTypeId: 900,
      title: "Personal",
      startTime: new Date("2027-01-01"),
      endTime: new Date("2027-01-02"),
    },
  });
  const personal = await prisma.user.findUniqueOrThrow({ where: { id: 3 } }),
    credential = await prisma.credential.findUniqueOrThrow({ where: { id: 900 } });
  const otherProfile = await prisma.profile.findUniqueOrThrow({
    where: { userId_organizationId: { userId: 3, organizationId: 200 } },
  });
  const proposal = await reviewed();
  await service.commit(actor(1), proposal.input);
  assert.equal(await member(), null);
  assert.equal(await member(3, 110), null);
  assert.equal((await member(3, 200))?.role, "OWNER");
  assert.deepEqual(await prisma.profile.findUniqueOrThrow({ where: { id: otherProfile.id } }), otherProfile);
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: 3 } }), personal);
  assert.deepEqual(await prisma.credential.findUniqueOrThrow({ where: { id: 900 } }), credential);
  assert.equal(await prisma.booking.count({ where: { uid: "personal-booking" } }), 1);
  assert.equal(
    await new PermissionCheckService(prisma).checkPermission({
      userId: 3,
      teamId: 110,
      permission: "team.read",
    }),
    false
  );
  assert.equal(
    await new PermissionCheckService(prisma).checkPermission({
      userId: 3,
      teamId: 210,
      permission: "team.read",
    }),
    true
  );
});
test("reviewed removal revokes only the target's organization keys and OAuth grants", async () => {
  await prisma.membership.updateMany({
    where: { userId: 3, teamId: { in: [100, 110] } },
    data: { role: "ADMIN" },
  });
  const rootKey = await key(3, 100),
    childKey = await key(3, 110),
    personalKey = await key(3, null),
    otherKey = await key(3, 200);
  await authenticateApiKey(prisma, rootKey.value, "cal_");
  for (const organizationId of [100, 200]) {
    const client = await prisma.platformOAuthClient.create({
      data: {
        name: `Client ${organizationId}`,
        secret: randomBytes(16).toString("hex"),
        permissions: 0,
        organizationId,
        redirectUris: [],
        users: { connect: { id: 3 } },
      },
    });
    await prisma.accessToken.create({
      data: {
        userId: 3,
        platformOAuthClientId: client.id,
        secret: randomBytes(16).toString("hex"),
        expiresAt: new Date("2027-01-01"),
      },
    });
    await prisma.refreshToken.create({
      data: {
        userId: 3,
        platformOAuthClientId: client.id,
        secret: randomBytes(16).toString("hex"),
        expiresAt: new Date("2027-01-01"),
      },
    });
    await prisma.platformAuthorizationToken.create({ data: { userId: 3, platformOAuthClientId: client.id } });
  }
  const proposal = await reviewed();
  assert.equal(proposal.effects.scopedApiKeysRevoked, 2);
  assert.equal(proposal.effects.oauthTokensRevoked, 3);
  await service.commit(actor(1), proposal.input);
  await assert.rejects(authenticateApiKey(prisma, rootKey.value, "cal_"));
  await assert.rejects(authenticateApiKey(prisma, childKey.value, "cal_"));
  await authenticateApiKey(prisma, personalKey.value, "cal_");
  await authenticateApiKey(prisma, otherKey.value, "cal_");
  assert.equal(await prisma.accessToken.count(), 1);
  assert.equal(await prisma.refreshToken.count(), 1);
  assert.equal(await prisma.platformAuthorizationToken.count(), 1);
  assert.equal(
    await prisma.platformOAuthClient.count({ where: { organizationId: 100, users: { some: { id: 3 } } } }),
    0
  );
});
test("role change revokes root credentials, without pretending independent child roles disappeared", async () => {
  await prisma.membership.updateMany({ where: { userId: 2, teamId: 100 }, data: { role: "ADMIN" } });
  await prisma.membership.create({ data: { userId: 2, teamId: 110, role: "ADMIN", accepted: true } });
  const rootKey = await key(2, 100),
    childKey = await key(2, 110);
  const proposal = await reviewed(2, "set-role", "MEMBER");
  assert.equal(proposal.effects.childRolesPreserved, 1);
  await service.commit(actor(1), proposal.input);
  await assert.rejects(authenticateApiKey(prisma, rootKey.value, "cal_"));
  await authenticateApiKey(prisma, childKey.value, "cal_");
});

test("removed actor's outstanding invitations cannot revive after later re-admission", async () => {
  const invite = await invitations.invite(actor(2), {
    organizationId: 100,
    email: "member4@fixture.test",
    requestId: randomUUID(),
  });
  const proposal = await reviewed(2);
  assert.equal(proposal.effects.invitationsCancelled, 1);
  assert.equal(proposal.effects.pendingAdmissionsCancelled, 1);
  await service.commit(actor(1), proposal.input);
  assert.equal(await member(4), null);
  await prisma.membership.create({ data: { userId: 2, teamId: 100, role: "ADMIN", accepted: true } });
  await assert.rejects(
    invitations.respond(actor(4), {
      invitationId: invite.invitationId,
      decision: "accept",
      requestId: randomUUID(),
    })
  );
});
test("exact replay never regrants after role changes or removal", async () => {
  const proposal = await reviewed();
  const first = await service.commit(actor(1), proposal.input);
  assert.equal(first.replayed, false);
  const before = await snapshot();
  assert.equal((await service.commit(actor(1), proposal.input)).replayed, true);
  assert.deepEqual(await snapshot(), before);
  await assert.rejects(service.commit(actor(2), proposal.input));
  await assert.rejects(service.commit(actor(1), { ...proposal.input, operation: "set-role", role: "ADMIN" }));
});
test("self-removal preserves prior outcome readback without requiring a removed membership", async () => {
  const proposal = await reviewed(2, "remove", undefined, 2);
  await service.commit(actor(2), proposal.input);
  assert.equal((await service.commit(actor(2), proposal.input)).replayed, true);
  await assert.rejects(service.members(actor(2), { organizationId: 100 }));
});
for (const change of ["role", "uuid", "actor-demoted", "new-key", "child-grant", "replacement-membership"])
  test(`review is invalidated by ${change}`, async () => {
    const proposal = await reviewed();
    if (change === "role")
      await prisma.membership.update({
        where: { userId_teamId: { userId: 3, teamId: 100 } },
        data: { role: "ADMIN" },
      });
    if (change === "uuid") await prisma.user.update({ where: { id: 3 }, data: { uuid: randomUUID() } });
    if (change === "actor-demoted")
      await prisma.membership.update({
        where: { userId_teamId: { userId: 1, teamId: 100 } },
        data: { role: "MEMBER" },
      });
    if (change === "new-key") await key(3, 110);
    if (change === "child-grant")
      await prisma.membership.update({
        where: { userId_teamId: { userId: 3, teamId: 110 } },
        data: { role: "ADMIN" },
      });
    if (change === "replacement-membership") {
      await prisma.membership.delete({ where: { userId_teamId: { userId: 3, teamId: 100 } } });
      await prisma.membership.create({ data: { userId: 3, teamId: 100, role: "MEMBER", accepted: true } });
    }
    const before = await snapshot();
    await assert.rejects(service.commit(actor(1), proposal.input));
    assert.deepEqual(await snapshot(), before);
  });
for (const action of ["remove", "set-role", "transfer-ownership"] as const)
  test(`audit failure rolls back ${action} and credential revocation`, async () => {
    await key(3, 110);
    const proposal = await reviewed(3, action, action === "set-role" ? "ADMIN" : undefined);
    const before = await snapshot();
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "EnterpriseAuditEvent" ADD CONSTRAINT fixture_member_audit_failure CHECK (action NOT LIKE 'organization.member.%')`
    );
    try {
      await assert.rejects(service.commit(actor(1), proposal.input));
      assert.deepEqual(await snapshot(), before);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "EnterpriseAuditEvent" DROP CONSTRAINT fixture_member_audit_failure'
      );
    }
  });

for (const kind of ["owner", "host", "legacy-user", "profile", "schedule"] as const)
  test(`scheduling ${kind} references require explicit handoff`, async () => {
    const profile = await prisma.profile.findUniqueOrThrow({
      where: { userId_organizationId: { userId: 3, organizationId: 100 } },
    });
    const schedule =
      kind === "schedule"
        ? await prisma.schedule.create({ data: { name: "Owned schedule", userId: 3 } })
        : null;
    await prisma.eventType.create({
      data: {
        id: 600,
        title: "Team event",
        slug: "handoff",
        length: 30,
        teamId: 110,
        userId: kind === "owner" ? 3 : null,
        profileId: kind === "profile" ? profile.id : null,
        scheduleId: schedule?.id,
        hosts: kind === "host" ? { create: { userId: 3 } } : undefined,
        users: kind === "legacy-user" ? { connect: { id: 3 } } : undefined,
      },
    });
    await blocked("scheduling-handoff");
  });
test("future bookings require handoff, past booking history is preserved", async () => {
  await prisma.eventType.create({
    data: { id: 600, title: "Team event", slug: "bookings", length: 30, teamId: 110 },
  });
  await prisma.booking.create({
    data: {
      uid: "future-org",
      userId: 3,
      eventTypeId: 600,
      title: "Future",
      startTime: new Date("2030-01-01"),
      endTime: new Date("2030-01-02"),
    },
  });
  await blocked("future-bookings");
  await prisma.booking.update({
    where: { uid: "future-org" },
    data: { startTime: new Date("2020-01-01"), endTime: new Date("2020-01-02") },
  });
  const proposal = await reviewed();
  assert.equal(proposal.blockers.length, 0);
  await service.commit(actor(1), proposal.input);
  assert.equal(await prisma.booking.count({ where: { uid: "future-org" } }), 1);
});
test("a hidden foreign Host cascade is blocked rather than deleting another scope", async () => {
  await prisma.eventType.create({
    data: { id: 601, userId: 6, title: "Another personal event", slug: "foreign", length: 30 },
  });
  const child = await member(3, 110);
  assert.ok(child);
  await prisma.host.create({ data: { userId: 6, eventTypeId: 601, memberId: child.id } });
  await blocked("linked-host-records");
  assert.equal(await prisma.host.count(), 1);
});
test("existing sole child-team owner must transfer that team before leaving the root", async () => {
  await prisma.membership.update({
    where: { userId_teamId: { userId: 3, teamId: 110 } },
    data: { role: "OWNER" },
  });
  await prisma.membership.delete({ where: { userId_teamId: { userId: 1, teamId: 110 } } });
  await blocked("last-team-owner");
});
for (const mode of ["legacy-org", "moved-profile"] as const)
  test(`relocated personal profile ${mode} cannot be silently detached`, async () => {
    const profile = await prisma.profile.findUniqueOrThrow({
      where: { userId_organizationId: { userId: 3, organizationId: 100 } },
    });
    await prisma.user.update({
      where: { id: 3 },
      data: mode === "legacy-org" ? { organizationId: 100 } : { movedToProfileId: profile.id },
    });
    await blocked("relocated-profile");
  });
test("shared credentials and active webhooks require an explicit integration handoff", async () => {
  await prisma.credential.create({
    data: { type: "team_calendar", key: { opaque: "synthetic" }, teamId: 110, userId: 3 },
  });
  await prisma.webhook.create({
    data: {
      id: randomUUID(),
      userId: 3,
      teamId: 110,
      subscriberUrl: "https://integration.example.test",
      eventTriggers: ["BOOKING_CREATED"],
    },
  });
  const proposal = await reviewed();
  assert.ok(proposal.blockers.includes("shared-calendar-credentials"));
  assert.ok(proposal.blockers.includes("scoped-webhooks"));
  await assert.rejects(service.commit(actor(1), proposal.input));
});
test("automatic email-domain admission must be stopped before removal", async () => {
  await prisma.organizationSettings.update({
    where: { organizationId: 100 },
    data: { isOrganizationVerified: true, orgAutoJoinOnSignup: true, orgAutoAcceptEmail: "fixture.test" },
  });
  await blocked("automatic-readmission");
});
test("directory-owned root grants cannot be edited locally without a team mapping", async () => {
  await prisma.dSyncData.create({
    data: { directoryId: "synthetic-directory", tenant: "synthetic-tenant", organizationId: 100 },
  });
  await assert.rejects(reviewed(), /Directory-managed/);
  await assert.rejects(service.members(actor(1), { organizationId: 100 }), /Directory-managed/);
});
test("nested roots are not mistaken for ordinary child-team membership", async () => {
  await prisma.team.create({ data: { name: "Nested organization", isOrganization: true, parentId: 100 } });
  await blocked("nested-organizations");
});
test("custom root and child roles are preserved instead of converted to basic roles", async () => {
  const role = await prisma.role.create({ data: { name: "Custom", teamId: 110 } });
  await prisma.membership.update({
    where: { userId_teamId: { userId: 3, teamId: 110 } },
    data: { customRoleId: role.id },
  });
  await blocked("custom-child-role");
  await prisma.membership.update({
    where: { userId_teamId: { userId: 3, teamId: 100 } },
    data: { customRoleId: role.id },
  });
  await assert.rejects(reviewed(), /Custom-role/);
});
test("an instance-locked member can be offboarded but cannot receive additional authority", async () => {
  const proposal = await reviewed(5);
  assert.equal(proposal.blockers.length, 0);
  await service.commit(actor(1), proposal.input);
  assert.equal(await member(5), null);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: 5, locked: {} } })).locked, true);
});
test("malformed invitation binding fails before deleting any membership or credential", async () => {
  await prisma.verificationToken.create({
    data: {
      teamId: 100,
      identifier: "cal.enterprise.invite.v1:malformed",
      token: randomUUID(),
      expires: new Date("2030-01-01"),
    },
  });
  await assert.rejects(reviewed());
  assert.ok(await member());
});
test("acceptance of an invitation becomes a stale membership review, not a deleted unrelated grant", async () => {
  const invite = await invitations.invite(actor(2), {
    organizationId: 100,
    email: "member4@fixture.test",
    requestId: randomUUID(),
  });
  const proposal = await reviewed(2);
  await invitations.respond(actor(4), {
    invitationId: invite.invitationId,
    decision: "accept",
    requestId: randomUUID(),
  });
  await assert.rejects(service.commit(actor(1), proposal.input), /changed/);
  assert.equal((await member(4))?.accepted, true);
});
test("member list is paginated and does not confuse pending grants with active membership", async () => {
  for (let id = 30; id < 85; id++)
    await prisma.user.create({
      data: {
        id,
        uuid: randomUUID(),
        email: `page${id}@fixture.test`,
        teams: { create: { teamId: 100, role: "MEMBER", accepted: true } },
      },
    });
  const first = await service.members(actor(1), { organizationId: 100 });
  assert.equal(first.items.length, 50);
  assert.ok(first.nextCursor);
  const second = await service.members(actor(1), { organizationId: 100, cursor: first.nextCursor });
  assert.equal(second.nextCursor, null);
  const all = [...first.items, ...second.items];
  assert.equal(new Set(all.map((r) => r.id)).size, all.length);
  assert.ok(!all.some((r) => r.userId === 7));
});
for (const input of [
  { ...request(), role: "OWNER" },
  { ...request(), operation: "set-role" },
  { ...request(), role: "ADMIN" },
  { ...request(), actorId: 1 },
  { ...request(), target: { ...actor(3), role: "ADMIN" } },
])
  test(`strict member command rejects injected or invalid fields ${JSON.stringify(input)}`, async () => {
    await assert.rejects(service.review(actor(1), input as never));
  });

test("disabled scoped webhooks require handoff because their owner can reactivate them", async () => {
  await prisma.webhook.create({
    data: {
      id: randomUUID(),
      userId: 3,
      teamId: 110,
      subscriberUrl: "https://disabled.example.test",
      active: false,
      eventTriggers: ["BOOKING_CREATED"],
    },
  });
  await blocked("scoped-webhooks");
});
test("local offboarding cannot claim to remove instance-wide administrative authority", async () => {
  await prisma.user.update({ where: { id: 3 }, data: { role: "ADMIN" } });
  await blocked("instance-administrator");
});
test("revoked scoped keys remain revoked after an independently approved later membership", async () => {
  await prisma.membership.updateMany({
    where: { userId: 3, teamId: { in: [100, 110] } },
    data: { role: "ADMIN" },
  });
  const issued = await key(3, 100);
  const proposal = await reviewed();
  await service.commit(actor(1), proposal.input);
  assert.equal(await prisma.apiKey.findUnique({ where: { id: issued.id }, select: { id: true } }), null);
  await prisma.membership.create({ data: { userId: 3, teamId: 100, role: "ADMIN", accepted: true } });
  await assert.rejects(authenticateApiKey(prisma, issued.value, "cal_"));
});
test("organization attribute removal is explicit and preserves another organization's attributes", async () => {
  for (const teamId of [100, 200]) {
    const attribute = await prisma.attribute.create({
      data: { teamId, name: "Specialism", slug: "specialism", type: "TEXT" },
    });
    const option = await prisma.attributeOption.create({
      data: { attributeId: attribute.id, value: "Synthetic", slug: "synthetic", contains: [] },
    });
    const current = await member(3, teamId);
    assert.ok(current);
    await prisma.attributeToUser.create({ data: { memberId: current.id, attributeOptionId: option.id } });
  }
  const proposal = await reviewed();
  assert.equal(proposal.effects.organizationAttributesRemoved, 1);
  await service.commit(actor(1), proposal.input);
  assert.equal(await prisma.attributeToUser.count(), 1);
  assert.equal(await prisma.attribute.count(), 2);
});
test("the commit's user-row lock orders concurrent local account revocation", async () => {
  const proposal = await reviewed();
  let arrived;
  let release;
  const waiting = new Promise((resolve) => {
    arrived = resolve;
  });
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const guarded = prisma.$extends({
    query: {
      enterpriseAuditEvent: {
        async create({ args, query }) {
          const result = await query(args);
          if (args.data.action === "organization.member.remove") {
            arrived();
            await hold;
          }
          return result;
        },
      },
    },
  });
  const removal = new OrganizationMemberService(guarded as unknown as typeof prisma).commit(
    actor(1),
    proposal.input
  );
  await waiting;
  const update = prisma.user.update({ where: { id: 3 }, data: { locked: true } });
  const updateResult = update.then(
    (value) => ({ value }),
    (error) => ({ error })
  );
  let observed = false;
  try {
    const deadline = Date.now() + 5000;
    while (!observed && Date.now() < deadline) {
      const [row] = await prisma.$queryRaw<
        Array<{ n: number }>
      >`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%UPDATE%users%'`;
      observed = row.n > 0;
      if (!observed) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(observed, "Account revocation must be observed waiting, not inferred from sequential requests");
  } finally {
    release();
  }
  await removal;
  assert.ok("value" in (await updateResult));
  assert.equal(await member(), null);
});

test("unclassified inherited invitation links require review instead of being ignored during offboarding", async () => {
  await prisma.verificationToken.create({
    data: {
      identifier: "legacy-team-invitation",
      token: randomUUID(),
      teamId: 110,
      expires: new Date("2030-01-01"),
    },
  });
  await blocked("legacy-invitation-links");
  assert.equal(await prisma.verificationToken.count(), 1);
});
