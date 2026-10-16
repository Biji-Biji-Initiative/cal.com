// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { PermissionCheckService } from "@calcom/features/community-enterprise/authorization/PermissionCheckService";
import {
  invitationNoticeType,
  noticeOutcomeId,
} from "@calcom/features/community-enterprise/organizations/InvitationNoticeOutbox";
import {
  OrganizationInvitationService,
  organizationInvitationPrefix,
  parseOrganizationInvitationBinding,
} from "@calcom/features/community-enterprise/organizations/OrganizationInvitationService";
import { TeamService } from "@calcom/features/community-enterprise/teams/TeamService";
import { RUNNING_PREFIX, taskExecution, UNKNOWN_PREFIX } from "@calcom/features/tasker/execution";
import { TaskRepository } from "@calcom/features/tasker/repository";
import { TaskProcessor } from "@calcom/features/tasker/task-processor";
import prisma from "@calcom/prisma";
import { PrismaClient } from "@calcom/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, test } from "vitest";

const service = new OrganizationInvitationService(prisma);
const uuids = Array.from({ length: 8 }, () => randomUUID());
const actor = (id: number) => ({ id, uuid: uuids[id] });
const inviteInput = (overrides = {}) => ({
  organizationId: 100,
  email: "person2@fixture.test",
  requestId: randomUUID(),
  ...overrides,
});
const responseInput = (invitationId: number, decision: "accept" | "decline" = "accept") => ({
  invitationId,
  decision,
  requestId: randomUUID(),
});
const adminInput = (invitationId: number, overrides = {}) => ({
  invitationId,
  organizationId: 100,
  requestId: randomUUID(),
  ...overrides,
});
const getMember = () =>
  prisma.membership.findUnique({
    where: { userId_teamId: { userId: 2, teamId: 100 } },
    select: { id: true, accepted: true, role: true, customRoleId: true },
  });
let verified = false;
beforeAll(async () => {
  const socket = process.env.CAL_ENTERPRISE_TEST_SOCKET;
  const directory = process.env.CAL_ENTERPRISE_TEST_PGDATA;
  assert.ok(socket && directory, "Use the isolated fixture runner");
  assert.equal(path.dirname(socket), path.dirname(directory));
  assert.match(path.basename(path.dirname(socket)), /^cal-enterprise-/);
  const result = await prisma.$queryRaw<
    Array<{ directory: string; actor: string }>
  >`SELECT current_setting('data_directory') AS directory, current_user::text AS actor`;
  assert.equal(result[0].directory, directory);
  assert.equal(result[0].actor, "cal_enterprise_test");
  assert.equal(await prisma.user.count(), 0);
  verified = true;
});
beforeEach(async () => {
  assert.ok(verified);
  // These tests use a proven private database and only a handful of rows. Avoid
  // recreating hundreds of empty descendant tables on every case: delete the
  // same synthetic ownership roots and recreate the identical fixture atomically.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`DELETE FROM "Task"`;
      await tx.$executeRaw`DELETE FROM "VerificationToken"`;
      await tx.$executeRaw`DELETE FROM "EnterpriseAuditEvent"`;
      await tx.$executeRaw`DELETE FROM "Team"`;
      await tx.$executeRaw`DELETE FROM "users"`;
      await tx.user.createMany({
        data: Array.from({ length: 7 }, (_, index) => {
          const id = index + 1;
          return {
            id,
            uuid: uuids[id],
            email: `person${id}@fixture.test`,
            emailVerified: new Date(),
            username: `person-${id}`,
            name: `Person ${id}`,
            role: id === 7 ? ("ADMIN" as const) : ("USER" as const),
            locked: id === 5,
            isPlatformManaged: id === 6,
          };
        }),
      });
      await tx.team.createMany({
        data: [100, 200].map((id) => ({ id, name: `Root ${id}`, slug: `root-${id}`, isOrganization: true })),
      });
      await tx.team.create({ data: { id: 101, name: "Child", slug: "child", parentId: 100 } });
      await tx.membership.createMany({
        data: [
          { userId: 1, teamId: 100, role: "OWNER", accepted: true },
          { userId: 4, teamId: 100, role: "ADMIN", accepted: true },
          { userId: 3, teamId: 200, role: "OWNER", accepted: true },
          { userId: 7, teamId: 101, role: "OWNER", accepted: true },
        ],
      });
    },
    { maxWait: 5000, timeout: 30000 }
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
const counts = async () => ({
  tokens: await prisma.verificationToken.count(),
  profiles: await prisma.profile.count(),
  audits: await prisma.enterpriseAuditEvent.count(),
  members: await prisma.membership.count(),
});

for (const id of [2, 3, 5, 6, 7])
  test(`no organization invitation authority for actor ${id}`, async () => {
    const before = await counts();
    await assert.rejects(service.invite(actor(id), inviteInput()));
    assert.deepEqual(await counts(), before);
  });
test("stale actor identity is rejected even with matching user ID", async () => {
  await assert.rejects(service.invite({ id: 1, uuid: randomUUID() }, inviteInput()));
});
test("invite creates only a pending ordinary membership, expiry and audit", async () => {
  const request = inviteInput();
  const before = Date.now();
  const result = await service.invite(actor(1), request);
  assert.equal(result.replayed, false);
  assert.ok(result.expires.getTime() >= before + 7 * 86400000);
  assert.ok(
    result.expires.getTime() <= Date.now() + 7 * 86400000,
    "Expiry is an instant, not local database wall time"
  );
  const member = await getMember();
  assert.equal(member?.accepted, false);
  assert.equal(member?.role, "MEMBER");
  assert.equal(member?.customRoleId, null);
  assert.equal(await prisma.profile.count({ where: { userId: 2 } }), 0);
  assert.deepEqual(await new TeamService(prisma).overview(2), []);
  assert.equal(
    await new PermissionCheckService(prisma).checkPermission({
      userId: 2,
      teamId: 100,
      permission: "organization.read",
    }),
    false
  );
  const token = await prisma.verificationToken.findUniqueOrThrow({ where: { id: result.invitationId } });
  assert.ok(!JSON.stringify(result).includes(token.token));
  assert.ok(!JSON.stringify(result).includes(token.identifier));
  assert.equal(
    await prisma.enterpriseAuditEvent.count({ where: { action: "organization.invitation.created" } }),
    1
  );
});
test("same request replay is stable, does not extend expiry or create more pending rows", async () => {
  const input = inviteInput();
  const first = await service.invite(actor(1), input);
  const second = await service.invite(actor(1), { ...input, email: "PERSON2@fixture.test" });
  assert.deepEqual(second, { ...first, replayed: true });
  assert.equal(await prisma.verificationToken.count(), 1);
  await assert.rejects(service.invite(actor(1), { ...input, email: "person3@fixture.test" }));
});
test("concurrent issue attempts produce one pending membership and one event", async () => {
  const input = inviteInput();
  const results = await Promise.all([service.invite(actor(1), input), service.invite(actor(1), input)]);
  assert.equal(results[0].invitationId, results[1].invitationId);
  assert.equal(results.filter((r) => r.replayed).length, 1);
  assert.equal(await prisma.verificationToken.count(), 1);
});
for (const changes of [
  { email: "nobody@fixture.test" },
  { email: "person5@fixture.test" },
  { email: "person6@fixture.test" },
  { organizationId: 101 },
  { role: "ADMIN" },
  { accepted: true },
  { actorId: 7 },
  { email: "person1@fixture.test" },
])
  test(`invalid or authority-expanding invitation ${JSON.stringify(changes)}`, async () => {
    const before = await counts();
    await assert.rejects(service.invite(actor(1), inviteInput(changes)));
    assert.deepEqual(await counts(), before);
  });
test("case-ambiguous email is never guessed and legacy pending rows are not adopted", async () => {
  await prisma.user.update({ where: { id: 3 }, data: { email: "PERSON2@fixture.test" } });
  await assert.rejects(service.invite(actor(1), inviteInput()));
  await prisma.user.update({ where: { id: 3 }, data: { email: "person3@fixture.test" } });
  await prisma.membership.create({ data: { userId: 2, teamId: 100, role: "OWNER", accepted: false } });
  await assert.rejects(service.invite(actor(1), inviteInput()));
  assert.equal((await getMember())?.role, "OWNER");
});
test("recipient sees only its invitations; outsiders cannot list another org", async () => {
  const first = await service.invite(actor(1), inviteInput());
  await service.invite(actor(3), inviteInput({ organizationId: 200 }));
  const inbox = await service.pending(actor(2), {});
  assert.equal(inbox.items.length, 2);
  assert.equal(inbox.nextCursor, null);
  assert.equal((await service.pending(actor(1), {})).items.length, 0);
  const admin = await service.pending(actor(1), { organizationId: 100 });
  assert.equal(admin.items[0].id, first.invitationId);
  assert.equal(admin.items.length, 1);
  await assert.rejects(service.pending(actor(3), { organizationId: 100 }));
  const all = JSON.stringify(inbox);
  assert.ok(!all.includes("identifier"));
  assert.ok(!all.includes("token"));
  assert.ok(!all.includes(uuids[2]));
});
test("only the bound signed-in recipient may accept or decline", async () => {
  const invited = await service.invite(actor(1), inviteInput());
  const before = await counts();
  for (const id of [1, 3, 4, 7]) {
    await assert.rejects(service.respond(actor(id), responseInput(invited.invitationId)));
    await assert.rejects(service.respond(actor(id), responseInput(invited.invitationId, "decline")));
  }
  assert.deepEqual(await counts(), before);
  assert.equal((await getMember())?.accepted, false);
});
test("accept adds a profile and exact membership without moving personal identity or accepting other teams", async () => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: 2 } });
  await prisma.membership.create({ data: { userId: 2, teamId: 101, role: "MEMBER", accepted: false } });
  const invite = await service.invite(actor(1), inviteInput());
  const input = responseInput(invite.invitationId);
  assert.deepEqual(await service.respond(actor(2), input), { responseRecorded: true, replayed: false });
  assert.equal((await getMember())?.accepted, true);
  assert.equal(await prisma.profile.count({ where: { userId: 2, organizationId: 100 } }), 1);
  assert.equal(
    (await prisma.membership.findUniqueOrThrow({ where: { userId_teamId: { userId: 2, teamId: 101 } } }))
      .accepted,
    false
  );
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: 2 } }), user);
  assert.equal(await prisma.verificationToken.count(), 0);
  assert.equal(await prisma.account.count(), 0);
  assert.equal((await new TeamService(prisma).overview(2))[0].canManage, false);
  assert.deepEqual(await service.respond(actor(2), input), { responseRecorded: true, replayed: true });
  await prisma.membership.delete({ where: { userId_teamId: { userId: 2, teamId: 100 } } });
  await service.respond(actor(2), input);
  assert.equal(await getMember(), null, "Historical response replay must not regrant access");
});
test("decline removes only the pending membership and invitation", async () => {
  const invite = await service.invite(actor(1), inviteInput());
  await service.respond(actor(2), responseInput(invite.invitationId, "decline"));
  assert.equal(await getMember(), null);
  assert.equal(await prisma.profile.count(), 0);
  assert.equal(await prisma.verificationToken.count(), 0);
  assert.equal(await prisma.membership.count(), 4);
  assert.equal(
    await prisma.enterpriseAuditEvent.count({ where: { action: "organization.invitation.declined" } }),
    1
  );
});
for (const change of [
  "expired",
  "target-uuid",
  "target-locked",
  "issuer-removed",
  "issuer-demoted",
  "issuer-uuid",
  "role-tampered",
  "profile-exists",
  "cancelled",
])
  test(`acceptance refuses ${change} without granting access`, async () => {
    const invite = await service.invite(actor(1), inviteInput());
    if (change === "expired")
      await prisma.verificationToken.update({
        where: { id: invite.invitationId },
        data: { expires: new Date(Date.now() - 1) },
      });
    if (change === "target-uuid")
      await prisma.user.update({ where: { id: 2 }, data: { uuid: randomUUID() } });
    if (change === "target-locked") await prisma.user.update({ where: { id: 2 }, data: { locked: true } });
    if (change === "issuer-removed")
      await prisma.membership.delete({ where: { userId_teamId: { userId: 1, teamId: 100 } } });
    if (change === "issuer-demoted")
      await prisma.membership.update({
        where: { userId_teamId: { userId: 1, teamId: 100 } },
        data: { role: "MEMBER" },
      });
    if (change === "issuer-uuid")
      await prisma.user.update({ where: { id: 1 }, data: { uuid: randomUUID() } });
    if (change === "role-tampered")
      await prisma.membership.update({
        where: { userId_teamId: { userId: 2, teamId: 100 } },
        data: { role: "OWNER" },
      });
    if (change === "profile-exists")
      await prisma.profile.create({
        data: { userId: 2, organizationId: 100, uid: randomUUID(), username: "existing" },
      });
    if (change === "cancelled") await service.cancel(actor(4), adminInput(invite.invitationId));
    const before = await counts();
    await assert.rejects(service.respond(actor(2), responseInput(invite.invitationId)));
    assert.deepEqual(await counts(), before);
    assert.notEqual((await getMember())?.accepted, true);
  });
test("expired invitation can be declined but cannot be refreshed by replay", async () => {
  const request = inviteInput();
  const invite = await service.invite(actor(1), request);
  await prisma.verificationToken.update({
    where: { id: invite.invitationId },
    data: { expires: new Date(Date.now() - 1) },
  });
  assert.equal((await service.pending(actor(2), {})).items[0].actionable, false);
  await assert.rejects(service.invite(actor(1), request));
  await service.respond(actor(2), responseInput(invite.invitationId, "decline"));
  assert.equal(await getMember(), null);
});
test("cancellation plus reissue never makes the old invitation valid", async () => {
  const request = inviteInput();
  const first = await service.invite(actor(1), request);
  const cancel = adminInput(first.invitationId);
  await service.cancel(actor(4), cancel);
  await service.cancel(actor(4), cancel);
  const next = await service.invite(actor(4), inviteInput());
  assert.notEqual(next.invitationId, first.invitationId);
  await assert.rejects(service.respond(actor(2), responseInput(first.invitationId)));
  await assert.rejects(service.invite(actor(1), request));
  await assert.rejects(service.cancel(actor(3), adminInput(next.invitationId, { organizationId: 200 })));
  await service.respond(actor(2), responseInput(next.invitationId));
  assert.equal((await getMember())?.accepted, true);
});
test("concurrent accept and cancellation have one committed outcome", async () => {
  const invite = await service.invite(actor(1), inviteInput());
  const results = await Promise.allSettled([
    service.respond(actor(2), responseInput(invite.invitationId)),
    service.cancel(actor(4), adminInput(invite.invitationId)),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await prisma.verificationToken.count(), 0);
  assert.equal(
    await prisma.enterpriseAuditEvent.count({
      where: { action: { in: ["organization.invitation.accepted", "organization.invitation.cancelled"] } },
    }),
    1
  );
  const member = await getMember();
  assert.equal(await prisma.profile.count(), member?.accepted ? 1 : 0);
});
for (const action of ["created", "accepted", "declined", "cancelled"])
  test(`real audit failure rolls back invitation ${action}`, async () => {
    const invitation = action === "created" ? null : await service.invite(actor(1), inviteInput());
    const before = await counts();
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "EnterpriseAuditEvent" ADD CONSTRAINT invite_audit_failure CHECK (action <> 'organization.invitation.${action}')`
    );
    try {
      await assert.rejects(
        action === "created"
          ? service.invite(actor(1), inviteInput())
          : action === "cancelled"
            ? service.cancel(actor(4), adminInput(invitation!.invitationId))
            : service.respond(
                actor(2),
                responseInput(invitation!.invitationId, action === "accepted" ? "accept" : "decline")
              )
      );
      assert.deepEqual(await counts(), before);
      assert.notEqual((await getMember())?.accepted, true);
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "EnterpriseAuditEvent" DROP CONSTRAINT invite_audit_failure'
      );
    }
  });
test("profile collision fails acceptance atomically and keeps the pending invitation", async () => {
  await prisma.profile.create({
    data: { userId: 1, organizationId: 100, uid: randomUUID(), username: "person-2" },
  });
  const invite = await service.invite(actor(1), inviteInput());
  const before = await counts();
  await assert.rejects(service.respond(actor(2), responseInput(invite.invitationId)));
  assert.deepEqual(await counts(), before);
  assert.equal((await getMember())?.accepted, false);
});
test("notice sends only after commit and a retry does not send again", async () => {
  const invite = await service.invite(actor(1), inviteInput());
  const input = adminInput(invite.invitationId);
  let sent = 0;
  const send = async (notice: { to: string }) => {
    sent++;
    assert.equal(notice.to, "person2@fixture.test");
    assert.equal((await getMember())?.accepted, false);
    assert.equal(
      await prisma.enterpriseAuditEvent.count({
        where: { action: "organization.invitation.notification-attempted" },
      }),
      1
    );
    return "submitted" as const;
  };
  assert.ok(invite.notificationTaskId);
  assert.deepEqual(await service.deliverQueuedNotice(invite.notificationTaskId, send), {
    email: "submitted",
  });
  assert.deepEqual(await service.deliverQueuedNotice(invite.notificationTaskId, send), {
    email: "submitted",
  });
  assert.equal(sent, 1);
  await assert.rejects(service.notify(actor(4), adminInput(invite.invitationId), send), /one minute/);
  assert.equal(sent, 1);
});
test("failed email leaves a pending invitation and never reports submission", async () => {
  const invite = await service.invite(actor(1), inviteInput());
  assert.deepEqual(
    await service.deliverQueuedNotice(invite.notificationTaskId!, async () => {
      throw new Error("SMTP fixture rejected");
    }),
    { email: "unconfirmed" }
  );
  assert.equal((await getMember())?.accepted, false);
  assert.equal(await prisma.verificationToken.count(), 1);
});
test("revoked invitation cannot produce a notification", async () => {
  const invite = await service.invite(actor(1), inviteInput());
  await service.cancel(actor(1), adminInput(invite.invitationId));
  let sent = false;
  await assert.rejects(
    service.notify(actor(1), adminInput(invite.invitationId), async () => {
      sent = true;
      return "submitted";
    })
  );
  assert.equal(sent, false);
});

test("directory takeover preserves the pending rows instead of local acceptance or cancellation", async () => {
  const invite = await service.invite(actor(1), inviteInput());
  await prisma.dSyncData.create({ data: { directoryId: "fixture-directory", tenant: "fixture" } });
  await prisma.dSyncTeamGroupMapping.create({
    data: { organizationId: 100, teamId: 100, directoryId: "fixture-directory", groupName: "staff" },
  });
  const before = await counts();
  await assert.rejects(service.respond(actor(2), responseInput(invite.invitationId)), /Directory-managed/);
  await assert.rejects(
    service.respond(actor(2), responseInput(invite.invitationId, "decline")),
    /Directory-managed/
  );
  await assert.rejects(service.cancel(actor(1), adminInput(invite.invitationId)), /Directory-managed/);
  assert.deepEqual(await counts(), before);
  assert.equal((await new TeamService(prisma).overview(1))[0].canInvite, false);
});
test("custom-role identity cannot borrow its legacy ADMIN hint for invitations", async () => {
  const custom = await prisma.role.create({
    data: { name: "Narrow role", teamId: 100 },
    select: { id: true },
  });
  await prisma.membership.update({
    where: { userId_teamId: { userId: 1, teamId: 100 } },
    data: { customRoleId: custom.id },
  });
  await assert.rejects(service.invite(actor(1), inviteInput()));
});
test("notification audit failure prevents SMTP dispatch", async () => {
  const invite = await service.invite(actor(1), inviteInput());
  let sent = 0;
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "EnterpriseAuditEvent" ADD CONSTRAINT invite_notice_failure CHECK (action <> 'organization.invitation.notification-attempted')`
  );
  try {
    const result = await service.deliverQueuedNotice(invite.notificationTaskId!, async () => {
      sent++;
      return "submitted";
    });
    assert.deepEqual(result, { email: "queued" });
    assert.equal(sent, 0);
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "EnterpriseAuditEvent" DROP CONSTRAINT invite_notice_failure'
    );
  }
});
test("notification throttling expires at the real instant, not a wall-time date", async () => {
  const invite = await service.invite(actor(1), inviteInput());
  assert.ok(invite.notificationTaskId);
  await service.deliverQueuedNotice(invite.notificationTaskId, async () => "submitted");
  await prisma.task.update({
    where: { id: invite.notificationTaskId },
    data: { createdAt: new Date(Date.now() - 61000) },
  });
  await prisma.enterpriseAuditEvent.update({
    where: { operationId: `${invite.notificationTaskId}:notice-attempt` },
    data: { createdAt: new Date(Date.now() - 61000) },
  });
  assert.deepEqual(await service.notify(actor(4), adminInput(invite.invitationId), async () => "submitted"), {
    email: "submitted",
  });
});
test("malformed namespaced records cannot appear as actionable invitations", async () => {
  const invite = await service.invite(actor(1), inviteInput());
  await prisma.verificationToken.update({
    where: { id: invite.invitationId },
    data: { identifier: `cal.enterprise.invite.v1:${uuids[2]}:not-json` },
  });
  assert.deepEqual((await service.pending(actor(2), {})).items, []);
  await assert.rejects(service.respond(actor(2), responseInput(invite.invitationId)));
  assert.equal((await getMember())?.accepted, false);
});
test("inbox pagination is bounded and the continuation does not lose invitations", async () => {
  // Pagination checks reading 51 valid records, not the duration of 51 serial
  // administrative mutations. Derive fixture bindings from one actual invite;
  // all lifecycle/outbox paths have separate real transaction cases below.
  const actual = await service.invite(actor(1), inviteInput());
  const template = await prisma.verificationToken.findUniqueOrThrow({ where: { id: actual.invitationId } });
  const binding = parseOrganizationInvitationBinding(template.identifier);
  const roots = Array.from({ length: 50 }, (_, index) => 1000 + index);
  await prisma.team.createMany({
    data: roots.map((id) => ({ id, name: `Page ${id}`, slug: `page-${id}`, isOrganization: true })),
  });
  await prisma.membership.createMany({
    data: roots.flatMap((teamId) => [
      { userId: 1, teamId, role: "OWNER" as const, accepted: true },
      { userId: 2, teamId, role: "MEMBER" as const, accepted: false },
    ]),
  });
  const pending = await prisma.membership.findMany({
    where: { teamId: { in: roots }, userId: 2 },
    select: { id: true, teamId: true },
  });
  await prisma.verificationToken.createMany({
    data: pending.map((member) => ({
      teamId: member.teamId,
      expires: template.expires,
      token: createHash("sha256").update(randomUUID()).digest("hex"),
      identifier:
        organizationInvitationPrefix +
        binding.recipient.uuid +
        ":" +
        JSON.stringify({ ...binding, membershipId: member.id }),
    })),
  });
  // Count real SQL rather than asserting latency on a loaded shared host.
  const observed = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    log: [{ emit: "event", level: "query" }],
  });
  const queries: string[] = [];
  observed.$on("query", (event) => queries.push(event.query));
  const measured = new OrganizationInvitationService(observed);
  try {
    const first = await measured.pending(actor(2), {});
    assert.equal(first.items.length, 50);
    assert.ok(first.nextCursor);
    const selectCount = queries.filter((sql) => /^\s*SELECT/i.test(sql)).length;
    assert.ok(selectCount > 0 && selectCount <= 12, `Expected bounded page queries, got ${selectCount}`);
    queries.length = 0;
    const second = await measured.pending(actor(2), { cursor: first.nextCursor });
    assert.equal(second.items.length, 1);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.items, ...second.items].map((row) => row.id)).size, 51);
    assert.ok(queries.filter((sql) => /^\s*SELECT/i.test(sql)).length <= 12);
    console.log(JSON.stringify({ invitationPageSize: 50, selectCount }));
  } finally {
    await observed.$disconnect();
  }
});

test("an unverified account cannot claim an invitation address merely by storing that email", async () => {
  await prisma.user.update({ where: { id: 2 }, data: { emailVerified: null } });
  const before = await counts();
  await assert.rejects(service.invite(actor(1), inviteInput()));
  assert.deepEqual(await counts(), before);
});
test("email verification must still hold when the bound account accepts", async () => {
  await prisma.user.update({ where: { id: 2 }, data: { emailVerified: new Date() } });
  const invitation = await service.invite(actor(1), inviteInput());
  await prisma.user.update({ where: { id: 2 }, data: { emailVerified: null } });
  await assert.rejects(service.respond(actor(2), responseInput(invitation.invitationId)));
  assert.equal((await getMember())?.accepted, false);
  assert.equal(await prisma.profile.count({ where: { userId: 2 } }), 0);
  await service.respond(actor(2), responseInput(invitation.invitationId, "decline"));
  assert.equal(await getMember(), null);
});
test("unverified email stops notices without blocking a harmless decline", async () => {
  await prisma.user.update({ where: { id: 2 }, data: { emailVerified: new Date() } });
  const invitation = await service.invite(actor(1), inviteInput());
  await prisma.user.update({ where: { id: 2 }, data: { emailVerified: null } });
  let attempts = 0;
  await assert.rejects(
    service.notify(actor(1), adminInput(invitation.invitationId), async () => {
      attempts++;
      return "submitted";
    })
  );
  assert.equal(attempts, 0);
});
test("unverified recipient sees a non-actionable invitation, not an acceptance grant", async () => {
  await prisma.user.update({ where: { id: 2 }, data: { emailVerified: new Date() } });
  await service.invite(actor(1), inviteInput());
  await prisma.user.update({ where: { id: 2 }, data: { emailVerified: null } });
  assert.equal((await service.pending(actor(2), {})).items[0].actionable, false);
});
test("a legitimate verified email change does not transfer the identity-bound invitation", async () => {
  await prisma.user.update({ where: { id: 2 }, data: { emailVerified: new Date() } });
  const invitation = await service.invite(actor(1), inviteInput());
  await prisma.user.update({
    where: { id: 2 },
    data: { email: "new-address@fixture.test", emailVerified: new Date() },
  });
  await service.respond(actor(2), responseInput(invitation.invitationId));
  assert.equal((await getMember())?.accepted, true);
  assert.equal(await prisma.profile.count({ where: { userId: 2, organizationId: 100 } }), 1);
});

const noticeRepository = () => new TaskRepository({ prismaClient: prisma });
const taskRow = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } });
const noticeOutcome = (id: string) =>
  prisma.enterpriseAuditEvent.findUnique({ where: { operationId: noticeOutcomeId(id) } });
async function queuedInvite() {
  const input = inviteInput();
  const invite = await service.invite(actor(1), input);
  assert.ok(invite.notificationTaskId);
  return { ...invite, notificationTaskId: invite.notificationTaskId, input };
}
const delivery = async () => "submitted" as const;
function noticeWorker(send = delivery) {
  return new TaskProcessor({
    repository: noticeRepository(),
    handlers: {
      [invitationNoticeType]: async () => async (payload, id) => {
        assert.ok(id);
        await service.consumeQueuedNotice(payload, id, send);
      },
    },
    concurrency: 2,
    maxTasks: 20,
  });
}
const makeDue = (id: string) => prisma.$executeRaw`
  UPDATE "Task" SET "scheduledAt"=(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 millisecond' WHERE id=${id}`;
const ageNotice = async (id: string) => {
  await prisma.task.update({ where: { id }, data: { createdAt: new Date(Date.now() - 61000) } });
  await prisma.enterpriseAuditEvent.updateMany({
    where: { operationId: `${id}:notice-attempt` },
    data: { createdAt: new Date(Date.now() - 61000) },
  });
};

test("initial invitation, audit and ID-only notification intent commit in one transaction", async () => {
  const invite = await queuedInvite();
  const task = await taskRow(invite.notificationTaskId);
  assert.equal(task.type, invitationNoticeType);
  assert.equal(task.attempts, 0);
  assert.equal(task.succeededAt, null);
  const payload = JSON.parse(task.payload);
  assert.deepEqual(payload, {
    version: 1,
    actor: actor(1),
    organizationId: 100,
    invitationId: invite.invitationId,
    requestId: invite.input.requestId,
  });
  for (const marker of ["@fixture.test", "Person", "token", "subscriberUrl"])
    assert.ok(!task.payload.includes(marker));
  const audit = await prisma.enterpriseAuditEvent.findUniqueOrThrow({
    where: { operationId: invite.input.requestId },
  });
  assert.equal(audit.action, "organization.invitation.created");
  assert.equal((audit.details as { notificationTaskId: string }).notificationTaskId, task.id);
  assert.equal((await getMember())?.accepted, false);
});
test("outbox insertion failure rolls back the pending membership, token and creation audit", async () => {
  const before = await counts();
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Task" ADD CONSTRAINT notice_queue_failure CHECK (type <> 'organizationInvitation')`
  );
  try {
    await assert.rejects(service.invite(actor(1), inviteInput()));
    assert.deepEqual(await counts(), before);
    assert.equal(await prisma.task.count(), 0);
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "Task" DROP CONSTRAINT notice_queue_failure');
  }
});
test("creation audit failure also rolls back its newly inserted outbox row", async () => {
  const before = await counts();
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "EnterpriseAuditEvent" ADD CONSTRAINT outbox_create_audit_failure CHECK (action <> 'organization.invitation.created')`
  );
  try {
    await assert.rejects(service.invite(actor(1), inviteInput()));
    assert.deepEqual(await counts(), before);
    assert.equal(await prisma.task.count(), 0);
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "EnterpriseAuditEvent" DROP CONSTRAINT outbox_create_audit_failure'
    );
  }
});
test("a new worker recovers committed intent when the request never starts sending", async () => {
  const invite = await queuedInvite();
  let sent = 0;
  const outcome = await noticeWorker(async () => {
    sent++;
    return "submitted";
  }).processQueue();
  assert.equal(outcome.succeeded, 1);
  assert.equal(sent, 1);
  assert.equal(
    (await noticeOutcome(invite.notificationTaskId))?.action,
    "organization.invitation.notification-submitted"
  );
  assert.ok((await taskRow(invite.notificationTaskId)).succeededAt);
  assert.equal((await getMember())?.accepted, false);
  assert.equal(
    (
      await noticeWorker(async () => {
        sent++;
        return "submitted";
      }).processQueue()
    ).claimed,
    0
  );
  assert.equal(sent, 1);
});
test("replaying invitation creation recovers the same task without extending expiry or sending twice", async () => {
  const invite = await queuedInvite();
  const again = await new OrganizationInvitationService(prisma).invite(actor(1), invite.input);
  assert.equal(again.notificationTaskId, invite.notificationTaskId);
  assert.equal(again.replayed, true);
  assert.equal(again.expires.getTime(), invite.expires.getTime());
  assert.equal(await prisma.task.count(), 1);
  let sent = 0;
  await Promise.all([
    service.deliverQueuedNotice(invite.notificationTaskId, async () => {
      sent++;
      await new Promise((r) => setTimeout(r, 50));
      return "submitted";
    }),
    noticeWorker(async () => {
      sent++;
      return "submitted";
    }).processQueue(),
  ]);
  assert.equal(sent, 1);
  assert.ok((await taskRow(invite.notificationTaskId)).succeededAt);
});
for (const change of [
  "cancel",
  "accept",
  "decline",
  "expire",
  "issuer-demoted",
  "recipient-locked",
  "recipient-unverified",
  "recipient-uuid",
  "directory",
] as const) {
  test(`queued notice suppresses ${change} before any transport call`, async () => {
    const invite = await queuedInvite();
    if (change === "cancel") await service.cancel(actor(1), adminInput(invite.invitationId));
    if (change === "accept" || change === "decline")
      await service.respond(actor(2), responseInput(invite.invitationId, change));
    if (change === "expire")
      await prisma.verificationToken.update({
        where: { id: invite.invitationId },
        data: { expires: new Date(0) },
      });
    if (change === "issuer-demoted")
      await prisma.membership.update({
        where: { userId_teamId: { userId: 1, teamId: 100 } },
        data: { role: "MEMBER" },
      });
    if (change === "recipient-locked") await prisma.user.update({ where: { id: 2 }, data: { locked: true } });
    if (change === "recipient-unverified")
      await prisma.user.update({ where: { id: 2 }, data: { emailVerified: null } });
    if (change === "recipient-uuid")
      await prisma.user.update({ where: { id: 2 }, data: { uuid: randomUUID() } });
    if (change === "directory") {
      await prisma.dSyncData.create({ data: { directoryId: "notice-fixture-directory", tenant: "fixture" } });
      await prisma.dSyncTeamGroupMapping.create({
        data: {
          organizationId: 100,
          teamId: 100,
          directoryId: "notice-fixture-directory",
          groupName: "staff",
        },
      });
    }
    let sent = 0;
    assert.deepEqual(
      await service.deliverQueuedNotice(invite.notificationTaskId, async () => {
        sent++;
        return "submitted";
      }),
      { email: "not_sent" }
    );
    assert.equal(sent, 0);
    assert.ok((await taskRow(invite.notificationTaskId)).succeededAt);
    assert.equal(
      (await noticeOutcome(invite.notificationTaskId))?.action,
      "organization.invitation.notification-suppressed"
    );
    assert.equal(
      await prisma.enterpriseAuditEvent.count({
        where: { operationId: `${invite.notificationTaskId}:notice-attempt` },
      }),
      0
    );
  });
}
test("queue payload does not freeze or transfer authority to an outdated recipient email", async () => {
  const invite = await queuedInvite();
  await prisma.user.update({ where: { id: 2 }, data: { email: "current-address@fixture.test" } });
  let recipient = "";
  await service.deliverQueuedNotice(invite.notificationTaskId, async (notice) => {
    recipient = notice.to;
    return "submitted";
  });
  assert.equal(recipient, "current-address@fixture.test");
  assert.ok(!(await taskRow(invite.notificationTaskId)).payload.includes(recipient));
});
test("a transport that may have submitted before throwing is quarantined, never automatically resent", async () => {
  const invite = await queuedInvite();
  let externalEffects = 0;
  const send = async () => {
    externalEffects++;
    throw new Error("fixture-sensitive-transport-reply@example.test");
  };
  assert.deepEqual(await service.deliverQueuedNotice(invite.notificationTaskId, send), {
    email: "unconfirmed",
  });
  assert.equal(externalEffects, 1);
  const task = await taskRow(invite.notificationTaskId);
  assert.ok(task.lastError?.startsWith(UNKNOWN_PREFIX));
  assert.equal((await noticeOutcome(task.id))?.action, "organization.invitation.notification-unconfirmed");
  await makeDue(task.id);
  assert.equal((await noticeWorker(send).processQueue()).claimed, 0);
  await ageNotice(task.id);
  await assert.rejects(service.notify(actor(1), adminInput(invite.invitationId), send), /reconcile/);
  assert.equal(externalEffects, 1);
  const logs =
    JSON.stringify(await prisma.enterpriseAuditEvent.findMany()) + JSON.stringify(await taskRow(task.id));
  assert.ok(!logs.includes("fixture-sensitive-transport-reply"));
});
test("a kill-switch result is recorded as not submitted, not delivered or automatically retried", async () => {
  const invite = await queuedInvite();
  let calls = 0;
  assert.deepEqual(
    await service.deliverQueuedNotice(invite.notificationTaskId, async () => {
      calls++;
      return "not_sent";
    }),
    { email: "not_sent" }
  );
  assert.equal(
    (await noticeOutcome(invite.notificationTaskId))?.action,
    "organization.invitation.notification-not_sent"
  );
  assert.ok((await taskRow(invite.notificationTaskId)).succeededAt);
  assert.equal(
    (
      await noticeWorker(async () => {
        calls++;
        return "submitted";
      }).processQueue()
    ).claimed,
    0
  );
  assert.equal(calls, 1);
  assert.equal((await getMember())?.accepted, false);
});
