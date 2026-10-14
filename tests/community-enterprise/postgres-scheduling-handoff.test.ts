// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { OrganizationMemberService } from "@calcom/features/community-enterprise/organizations/OrganizationMemberService";
import { assertBookingCanCommit } from "@calcom/features/community-enterprise/scheduling/BookingCommitGuard";
import { CommunityQualifiedHostsService } from "@calcom/features/community-enterprise/scheduling/QualifiedHostsService";
import { SchedulingHandoffService } from "@calcom/features/community-enterprise/scheduling/SchedulingHandoffService";
import prisma from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import { afterAll, beforeAll, beforeEach, test } from "vitest";

const service = new SchedulingHandoffService(prisma);
const ids = Array.from({ length: 9 }, () => randomUUID());
const actor = (id: number) => ({ id, uuid: ids[id] });
const input = (extra = {}) => ({
  organizationId: 100,
  source: actor(3),
  eventTypeId: 300,
  successor: actor(2),
  successorScheduleId: 202,
  ...extra,
});
const listing = () => ({ organizationId: 100, source: actor(3) });
const review = () => service.review(actor(1), input());
let verified = false;
beforeAll(async () => {
  const socket = process.env.CAL_ENTERPRISE_TEST_SOCKET,
    directory = process.env.CAL_ENTERPRISE_TEST_PGDATA;
  assert.ok(socket && directory);
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
        name: `Person ${id}`,
        username: `person-${id}`,
        email: `person${id}@fixture.test`,
        locked: id === 5,
        isPlatformManaged: id === 6,
        role: id === 7 ? "ADMIN" : "USER",
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
    [2, 100, "MEMBER", true],
    [3, 100, "MEMBER", true],
    [4, 100, "ADMIN", true],
    [5, 100, "MEMBER", true],
    [6, 100, "MEMBER", true],
    [8, 100, "MEMBER", false],
    [1, 110, "OWNER", true],
    [2, 110, "MEMBER", true],
    [3, 110, "MEMBER", true],
    [4, 110, "MEMBER", true],
    [5, 110, "MEMBER", true],
    [6, 110, "MEMBER", true],
    [8, 110, "MEMBER", false],
    [3, 200, "OWNER", true],
    [3, 210, "OWNER", true],
  ] as const)
    await prisma.membership.create({ data: { userId, teamId, role, accepted } });
  for (const [id, userId, organizationId] of [
    [101, 1, 100],
    [102, 2, 100],
    [103, 3, 100],
    [104, 3, 200],
  ])
    await prisma.profile.create({
      data: { id, uid: randomUUID(), userId, organizationId, username: `person-${userId}` },
    });
  for (const userId of [1, 2, 3, 4]) {
    const s = await prisma.schedule.create({
      data: {
        id: 200 + userId,
        userId,
        name: `Schedule ${userId}`,
        timeZone: "UTC",
        availability: {
          create: {
            days: [1, 2, 3, 4, 5],
            startTime: new Date("1970-01-01T08:00:00Z"),
            endTime: new Date("1970-01-01T18:00:00Z"),
          },
        },
      },
    });
    await prisma.user.update({ where: { id: userId }, data: { defaultScheduleId: s.id } });
  }
  const member = await prisma.membership.findUniqueOrThrow({
    where: { userId_teamId: { userId: 3, teamId: 110 } },
  });
  await prisma.eventType.create({
    data: {
      id: 300,
      title: "Shared appointments",
      slug: "same-link",
      teamId: 110,
      userId: 3,
      profileId: 103,
      scheduleId: 203,
      length: 30,
      schedulingType: "ROUND_ROBIN",
      locations: [],
      users: { connect: { id: 3 } },
      hosts: {
        create: { userId: 3, memberId: member.id, scheduleId: 203, priority: 3, weight: 80, isFixed: false },
      },
    },
  });
});
afterAll(async () => {
  await prisma.$disconnect();
});
const current = () =>
  prisma.eventType.findUniqueOrThrow({
    where: { id: 300 },
    select: {
      id: true,
      slug: true,
      teamId: true,
      userId: true,
      profileId: true,
      scheduleId: true,
      length: true,
      schedulingType: true,
      hosts: {
        orderBy: { userId: "asc" },
        select: {
          userId: true,
          eventTypeId: true,
          memberId: true,
          scheduleId: true,
          isFixed: true,
          groupId: true,
          weight: true,
          priority: true,
        },
      },
      users: { select: { id: true }, orderBy: { id: "asc" } },
    },
  });
const snapshot = async () => ({
  event: await current(),
  memberships: await prisma.membership.findMany({ orderBy: { id: "asc" } }),
  profiles: await prisma.profile.findMany({ orderBy: { id: "asc" } }),
  audits: await prisma.enterpriseAuditEvent.count(),
});
async function blocked(code: string) {
  const before = await snapshot();
  const planned = await review();
  assert.ok(planned.blockers.includes(code), JSON.stringify(planned.blockers));
  await assert.rejects(service.commit(actor(1), planned.input), /blockers/);
  assert.deepEqual(await snapshot(), before);
}
async function eligible() {
  return new CommunityQualifiedHostsService(prisma).findQualifiedHostsWithDelegationCredentials({
    eventType: {
      id: 300,
      schedulingType: "ROUND_ROBIN",
      users: [2, 3].map((id) => ({ id, email: `person${id}@fixture.test`, credentials: [] })),
    },
  });
}
for (const id of [2, 3, 5, 6, 7, 8])
  test(`member/global/locked/managed identity ${id} cannot take handoff authority`, async () => {
    await assert.rejects(service.events(actor(id), listing()));
    await assert.rejects(service.review(actor(id), input()));
  });
test("review lists only this organization's source event and writes no state", async () => {
  await prisma.eventType.create({
    data: { id: 301, teamId: 210, userId: 3, slug: "private-org", title: "Other org", length: 30 },
  });
  await prisma.eventType.create({
    data: { id: 302, userId: 3, slug: "private-personal", title: "Personal", length: 30 },
  });
  const before = await snapshot();
  const list = await service.events(actor(1), listing());
  assert.deepEqual(
    list.items.map((e) => e.id),
    [300]
  );
  const candidates = await service.options(actor(1), { ...listing(), eventTypeId: 300 });
  assert.deepEqual(candidates.items.map((u) => u.id).sort(), [1, 2, 4]);
  const planned = await review();
  assert.deepEqual(planned.blockers, []);
  assert.equal(planned.effects.existingAppointmentsChanged, 0);
  assert.equal(planned.effects.credentialsTransferred, 0);
  assert.deepEqual(await snapshot(), before);
});
test("one reviewed host slot changes hands; original booking address and private identities remain", async () => {
  const users = await prisma.user.findMany({ orderBy: { id: "asc" } });
  await prisma.credential.create({
    data: { id: 901, type: "fixture", userId: 3, key: { encrypted: "synthetic" } },
  });
  await prisma.booking.create({
    data: {
      uid: "past-owned",
      eventTypeId: 300,
      userId: 3,
      title: "Past",
      startTime: new Date("2020-01-01"),
      endTime: new Date("2020-01-02"),
    },
  });
  const booking = await prisma.booking.findUniqueOrThrow({ where: { uid: "past-owned" } });
  const before = await current();
  const planned = await review();
  assert.deepEqual(await service.commit(actor(1), planned.input), { recorded: true, replayed: false });
  const after = await current();
  assert.equal(after.id, before.id);
  assert.equal(after.slug, before.slug);
  assert.equal(after.teamId, before.teamId);
  assert.equal(after.userId, 2);
  assert.equal(after.profileId, 102);
  assert.equal(after.scheduleId, 202);
  assert.deepEqual(after.users, [{ id: 2 }]);
  assert.equal(after.hosts.length, 1);
  assert.equal(after.hosts[0].userId, 2);
  assert.equal(after.hosts[0].scheduleId, 202);
  assert.equal(after.hosts[0].priority, 3);
  assert.equal(after.hosts[0].weight, 80);
  assert.deepEqual(await prisma.user.findMany({ orderBy: { id: "asc" } }), users);
  assert.deepEqual(await prisma.booking.findUniqueOrThrow({ where: { uid: "past-owned" } }), booking);
  assert.equal(
    (await prisma.credential.findUniqueOrThrow({ where: { id: 901 }, select: { userId: true } })).userId,
    3
  );
  assert.deepEqual(
    (await eligible()).qualifiedRRHosts.map((h) => h.user.id),
    [2]
  );
  const member = new OrganizationMemberService(prisma);
  const removal = await member.review(actor(1), {
    organizationId: 100,
    target: actor(3),
    operation: "remove",
  });
  assert.deepEqual(removal.blockers, []);
  await member.commit(actor(1), removal.input);
  assert.equal(await prisma.membership.count({ where: { userId: 3, teamId: { in: [100, 110] } } }), 0);
  assert.equal(await prisma.membership.count({ where: { userId: 3, teamId: 200 } }), 1);
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { uid: "past-owned" } })).userId, 3);
});
test("collective cardinality and required participant slot are preserved", async () => {
  await prisma.eventType.update({ where: { id: 300 }, data: { schedulingType: "COLLECTIVE" } });
  await prisma.host.update({
    where: { userId_eventTypeId: { userId: 3, eventTypeId: 300 } },
    data: { isFixed: true },
  });
  await service.commit(actor(1), (await review()).input);
  assert.equal((await current()).hosts[0].isFixed, true);
  assert.deepEqual(
    (await eligible()).fixedHosts.map((h) => h.user.id),
    [2]
  );
});
test("ordinary organization administrator can manage an existing shared assignment without owner promotion", async () => {
  await service.commit(actor(4), (await service.review(actor(4), input())).input);
  assert.equal((await current()).hosts[0].userId, 2);
});
test("stale or foreign identity/scope is denied without retrieving personal events", async () => {
  await assert.rejects(service.review({ ...actor(1), uuid: randomUUID() }, input()));
  await assert.rejects(service.review(actor(1), input({ organizationId: 200 })));
  await assert.rejects(service.review(actor(1), input({ source: { ...actor(3), uuid: randomUUID() } })));
  await assert.rejects(service.review(actor(1), input({ successor: actor(3) })), /different successor/);
});
for (const change of [
  "source-removed",
  "successor-root-removed",
  "successor-team-removed",
  "successor-locked",
  "successor-uuid",
  "actor-demoted",
  "host-weight",
  "schedule-window",
  "event-name",
]) {
  test(`stale review refuses changed ${change}`, async () => {
    const planned = await review();
    if (change === "source-removed")
      await prisma.membership.deleteMany({ where: { userId: 3, teamId: 100 } });
    if (change === "successor-root-removed")
      await prisma.membership.deleteMany({ where: { userId: 2, teamId: 100 } });
    if (change === "successor-team-removed")
      await prisma.membership.deleteMany({ where: { userId: 2, teamId: 110 } });
    if (change === "successor-locked") await prisma.user.update({ where: { id: 2 }, data: { locked: true } });
    if (change === "successor-uuid")
      await prisma.user.update({ where: { id: 2 }, data: { uuid: randomUUID() } });
    if (change === "actor-demoted")
      await prisma.membership.updateMany({ where: { userId: 1, teamId: 100 }, data: { role: "MEMBER" } });
    if (change === "host-weight")
      await prisma.host.update({
        where: { userId_eventTypeId: { userId: 3, eventTypeId: 300 } },
        data: { weight: 101 },
      });
    if (change === "schedule-window")
      await prisma.availability.updateMany({ where: { scheduleId: 202 }, data: { days: [6] } });
    if (change === "event-name")
      await prisma.eventType.update({ where: { id: 300 }, data: { title: "Changed" } });
    const before = await snapshot();
    await assert.rejects(service.commit(actor(1), planned.input));
    assert.deepEqual(await snapshot(), before);
  });
}
for (const status of ["ACCEPTED", "PENDING", "AWAITING_HOST"] as const)
  test(`future ${status} appointment blocks configuration handoff without being re-owned`, async () => {
    await prisma.booking.create({
      data: {
        uid: randomUUID(),
        eventTypeId: 300,
        userId: 3,
        title: "Future",
        startTime: new Date("2099-01-01"),
        endTime: new Date("2099-01-02"),
        status,
      },
    });
    await blocked("future-appointments");
  });
for (const mode of ["MANAGED", "automatic", "recurring", "seats", "instant"] as const)
  test(`special ${mode} event requires its real lifecycle`, async () => {
    await prisma.eventType.update({
      where: { id: 300 },
      data:
        mode === "MANAGED"
          ? { schedulingType: "MANAGED" }
          : mode === "automatic"
            ? { assignAllTeamMembers: true }
            : mode === "recurring"
              ? { recurringEvent: { count: 3 } }
              : mode === "seats"
                ? { seatsPerTimeSlot: 2 }
                : { isInstantEvent: true },
    });
    await blocked("managed-or-special-event");
  });
for (const mode of [
  "location",
  "destination",
  "selected",
  "host-location",
  "app",
  "email",
  "webhook",
] as const)
  test(`provider-bound ${mode} config is not copied to another person`, async () => {
    await prisma.credential.create({
      data: { id: 900, userId: 3, type: "google_calendar", key: { encrypted: "synthetic" } },
    });
    if (mode === "location")
      await prisma.eventType.update({
        where: { id: 300 },
        data: { locations: [{ type: "integrations:google:meet" }] },
      });
    if (mode === "destination")
      await prisma.destinationCalendar.create({
        data: {
          eventTypeId: 300,
          credentialId: 900,
          integration: "google_calendar",
          externalId: "synthetic",
        },
      });
    if (mode === "selected")
      await prisma.selectedCalendar.create({
        data: {
          eventTypeId: 300,
          userId: 3,
          credentialId: 900,
          integration: "google_calendar",
          externalId: "synthetic",
        },
      });
    if (mode === "host-location")
      await prisma.hostLocation.create({
        data: { eventTypeId: 300, userId: 3, type: "link", link: "https://fixture.invalid" },
      });
    if (mode === "app")
      await prisma.eventType.update({
        where: { id: 300 },
        data: { metadata: { apps: { stripe: { enabled: true } } } },
      });
    if (mode === "email")
      await prisma.eventType.update({
        where: { id: 300 },
        data: { customReplyToEmail: "private@fixture.test" },
      });
    if (mode === "webhook")
      await prisma.webhook.create({
        data: {
          id: randomUUID(),
          eventTypeId: 300,
          userId: 3,
          subscriberUrl: "https://fixture.invalid",
          eventTriggers: ["BOOKING_CREATED"],
        },
      });
    await blocked("provider-configuration");
    assert.equal(
      (await prisma.credential.findUniqueOrThrow({ where: { id: 900 }, select: { userId: true } })).userId,
      3
    );
  });
test("a successor must choose their own nonempty availability, not a copied personal schedule", async () => {
  await assert.rejects(service.review(actor(1), input({ successorScheduleId: 203 })), /successor/);
  await prisma.availability.deleteMany({ where: { scheduleId: 202 } });
  await assert.rejects(review(), /configured availability/);
});
test("already assigned successor is not merged with a second weighted host slot", async () => {
  await prisma.host.create({ data: { eventTypeId: 300, userId: 2, isFixed: false } });
  await blocked("successor-already-assigned");
});
test("host role group and policy survive handoff without copying location or calendar credentials", async () => {
  const group = await prisma.hostGroup.create({ data: { name: "Required pool", eventTypeId: 300 } });
  await prisma.host.update({
    where: { userId_eventTypeId: { userId: 3, eventTypeId: 300 } },
    data: { groupId: group.id },
  });
  await service.commit(actor(1), (await review()).input);
  assert.equal((await current()).hosts[0].groupId, group.id);
});
test("shared restriction and another host's source-owned schedule stay blockers for offboarding", async () => {
  await prisma.eventType.update({
    where: { id: 300 },
    data: {
      userId: 1,
      profileId: null,
      scheduleId: null,
      restrictionScheduleId: 203,
      users: { set: [] },
      hosts: { deleteMany: {} },
    },
  });
  const removal = await new OrganizationMemberService(prisma).review(actor(1), {
    organizationId: 100,
    target: actor(3),
    operation: "remove",
  });
  assert.ok(removal.blockers.includes("scheduling-handoff"));
  await blocked("special-schedule");
});
test("same request replay does not reassign again or require the old host to remain assigned", async () => {
  const planned = await review();
  await service.commit(actor(1), planned.input);
  const before = await snapshot();
  assert.deepEqual(await service.commit(actor(1), planned.input), { recorded: true, replayed: true });
  assert.deepEqual(await snapshot(), before);
  await assert.rejects(
    service.commit(actor(1), { ...planned.input, successorScheduleId: 201 }),
    /already belongs/
  );
});
test("concurrent identical submissions record a single assignment and audit", async () => {
  const planned = await review();
  const results = await Promise.all([
    service.commit(actor(1), planned.input),
    service.commit(actor(1), planned.input),
  ]);
  assert.equal(results.filter((r) => r.replayed).length, 1);
  assert.equal(await prisma.enterpriseAuditEvent.count(), 1);
  assert.equal((await current()).hosts.length, 1);
});
test("real audit failure restores every changed host/event field", async () => {
  const planned = await review();
  const before = await snapshot();
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "EnterpriseAuditEvent" ADD CONSTRAINT handoff_fixture_failure CHECK (action <> 'organization.scheduling.handoff')`
  );
  try {
    await assert.rejects(service.commit(actor(1), planned.input));
    assert.deepEqual(await snapshot(), before);
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "EnterpriseAuditEvent" DROP CONSTRAINT handoff_fixture_failure'
    );
  }
});
for (const extra of [
  { actorId: 7 },
  { teamId: 210 },
  { successor: { ...actor(2), role: "OWNER" } },
  { credentials: { transfer: true } },
  { eventTypeId: 0 },
])
  test(`unexpected authority/resource fields are rejected ${JSON.stringify(extra)}`, async () => {
    await assert.rejects(service.review(actor(1), input(extra)));
    assert.equal(await prisma.enterpriseAuditEvent.count(), 0);
  });

function barrier() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { enter, release, entered, held };
}
async function observeWaitingUserLock() {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const [row] = await prisma.$queryRaw<
      Array<{ n: number }>
    >`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM%users%FOR UPDATE%'`;
    if (row.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("The actual competing request must wait on the retained user lock");
}
const bookingInput = (id: number) => ({
  eventTypeId: 300,
  schedulingType: "ROUND_ROBIN",
  selectedHosts: [{ id, email: `person${id}@fixture.test` }],
  startTime: new Date("2099-01-01T10:00:00Z"),
  endTime: new Date("2099-01-01T10:30:00Z"),
});

test("a booking committed while handoff waits is observed before the assignment changes", async () => {
  const planned = await review();
  const gate = barrier();
  const booking = prisma.$transaction(
    async (tx) => {
      await assertBookingCanCommit(tx, bookingInput(3));
      await tx.booking.create({
        data: {
          uid: "booking-won",
          eventTypeId: 300,
          userId: 3,
          title: "Fixture",
          startTime: bookingInput(3).startTime,
          endTime: bookingInput(3).endTime,
        },
      });
      gate.enter();
      await gate.held;
    },
    { isolationLevel: "ReadCommitted", timeout: 15000 }
  );
  const bookingResult = booking.then(
    () => ({ ok: true }),
    (error) => ({ error })
  );
  await Promise.race([
    gate.entered,
    bookingResult.then((result) => {
      if ("error" in result) throw result.error;
    }),
  ]);
  const handoff = service.commit(actor(1), planned.input).then(
    (value) => ({ value }),
    (error) => ({ error })
  );
  try {
    await observeWaitingUserLock();
  } finally {
    gate.release();
  }
  assert.ok("ok" in (await bookingResult));
  assert.ok("error" in (await handoff));
  assert.equal((await current()).hosts[0].userId, 3);
  assert.equal(await prisma.enterpriseAuditEvent.count(), 0);
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { uid: "booking-won" } })).userId, 3);
});

test("a precomputed departing-host booking waits for handoff and then fails current host eligibility", async () => {
  const planned = await review();
  const gate = barrier();
  const guarded = prisma.$extends({
    query: {
      enterpriseAuditEvent: {
        async create({ args, query }) {
          const result = await query(args);
          if (args.data.action === "organization.scheduling.handoff") {
            gate.enter();
            await gate.held;
          }
          return result;
        },
      },
    },
  });
  const transfer = new SchedulingHandoffService(guarded as unknown as typeof prisma).commit(
    actor(1),
    planned.input
  );
  const transferResult = transfer.then(
    (value) => ({ value }),
    (error) => ({ error })
  );
  await Promise.race([
    gate.entered,
    transferResult.then((result) => {
      if ("error" in result) throw result.error;
    }),
  ]);
  const booking = prisma
    .$transaction(
      async (tx) => {
        await assertBookingCanCommit(tx, bookingInput(3));
        return tx.booking.create({
          data: {
            uid: "departing-host-must-not-book",
            eventTypeId: 300,
            userId: 3,
            title: "Fixture",
            startTime: bookingInput(3).startTime,
            endTime: bookingInput(3).endTime,
          },
        });
      },
      { isolationLevel: "ReadCommitted", timeout: 15000 }
    )
    .then(
      (value) => ({ value }),
      (error) => ({ error })
    );
  try {
    await observeWaitingUserLock();
  } finally {
    gate.release();
  }
  assert.ok("value" in (await transferResult));
  assert.ok("error" in (await booking));
  assert.equal(await prisma.booking.count(), 0);
  assert.equal((await current()).hosts[0].userId, 2);
  await prisma.$transaction((tx) => assertBookingCanCommit(tx, bookingInput(2)), {
    isolationLevel: "ReadCommitted",
  });
});

test("the configured address conflict is shown instead of changing the shared URL", async () => {
  await prisma.eventType.create({
    data: { userId: 2, slug: "same-link", title: "Existing private event", length: 15 },
  });
  await blocked("successor-address-conflict");
});
test("locked departing members can hand off, but their private identity is not unlocked", async () => {
  await prisma.user.update({ where: { id: 3 }, data: { locked: true } });
  await service.commit(actor(1), (await review()).input);
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: 3, locked: {} }, select: { locked: true } })).locked,
    true
  );
});
test("a source-owned schedule attached to a different host still blocks member removal", async () => {
  await prisma.eventType.update({
    where: { id: 300 },
    data: {
      userId: 1,
      profileId: null,
      scheduleId: null,
      users: { set: [] },
      hosts: { deleteMany: {}, create: { userId: 1, scheduleId: 203 } },
    },
  });
  const removal = await new OrganizationMemberService(prisma).review(actor(1), {
    organizationId: 100,
    target: actor(3),
    operation: "remove",
  });
  assert.ok(removal.blockers.includes("scheduling-handoff"));
  await blocked("shared-schedule");
});

test("nullable schedule timezone uses the successor's real timezone and invalidates a changed review", async () => {
  await prisma.schedule.update({ where: { id: 202 }, data: { timeZone: null } });
  await prisma.user.update({ where: { id: 2 }, data: { timeZone: "Asia/Kuala_Lumpur" } });
  const choices = await service.options(actor(1), { ...listing(), eventTypeId: 300 });
  assert.equal(
    choices.items.find((user) => user.id === 2)?.schedules.find((schedule) => schedule.id === 202)?.timeZone,
    "Asia/Kuala_Lumpur"
  );
  const planned = await review();
  assert.equal(planned.schedule.timeZone, "Asia/Kuala_Lumpur");
  await prisma.user.update({ where: { id: 2 }, data: { timeZone: "Pacific/Guadalcanal" } });
  await assert.rejects(service.commit(actor(1), planned.input), /review the handoff again/);
});
test("invalid successor schedule timezone is not mislabeled as UTC", async () => {
  await prisma.schedule.update({ where: { id: 202 }, data: { timeZone: "not-a-timezone" } });
  await assert.rejects(review(), /timezone needs correction/);
});
test("event discovery has stable bounded pagination without substituting personal events", async () => {
  for (let id = 301; id <= 352; id++)
    await prisma.eventType.create({
      data: { id, title: `Shared ${id}`, slug: `shared-${id}`, teamId: 110, userId: 3, length: 30 },
    });
  const first = await service.events(actor(1), listing());
  assert.equal(first.items.length, 50);
  assert.equal(first.nextCursor, 349);
  const second = await service.events(actor(1), { ...listing(), cursor: first.nextCursor! });
  assert.deepEqual(
    second.items.map((event) => event.id),
    [350, 351, 352]
  );
  assert.equal(second.nextCursor, null);
});

test("disabled provider bindings cannot be inherited and reactivated under a successor", async () => {
  await prisma.eventType.update({
    where: { id: 300 },
    data: { metadata: { apps: { stripe: { enabled: false, credentialId: 100 } } } },
  });
  await blocked("provider-configuration");
});
for (const malformed of ["metadata", "locations"] as const)
  test(`unrecognized ${malformed} representation fails closed`, async () => {
    await prisma.eventType.update({
      where: { id: 300 },
      data: { [malformed]: "unclassified legacy configuration" },
    });
    await blocked("provider-configuration");
  });

// Reuse the prior member-removal preservation ratchet for the one Host row
// this operation replaces. An upstream cascade must not silently erase a new
// dependency that the current handoff planner does not know how to preserve.
async function hostDeletionReferences() {
  return prisma.$queryRaw<Array<{ schema: string; child: string; columns: string[]; deleteAction: string }>>`
    SELECT ns.nspname::text AS schema, child.relname::text AS child,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, position)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.position) AS columns,
      c.confdeltype::text AS "deleteAction"
    FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid
      JOIN pg_namespace ns ON ns.oid=child.relnamespace
    WHERE c.contype='f' AND c.confrelid='public."Host"'::regclass
    ORDER BY ns.nspname, child.relname, c.oid`;
}
function requireReviewedHostReferences(actual: Awaited<ReturnType<typeof hostDeletionReferences>>) {
  assert.deepEqual(
    actual,
    [{ schema: "public", child: "HostLocation", columns: ["userId", "eventTypeId"], deleteAction: "c" }],
    "Host deletion effects changed; review handoff preservation before accepting the upstream schema"
  );
}
test("the actual Host deletion effects match the handoff preservation contract", async () => {
  requireReviewedHostReferences(await hostDeletionReferences());
});
test("an actual added host cascade fails update acceptance without executing a handoff", async () => {
  await prisma.$executeRawUnsafe(
    'CREATE TABLE "HandoffFutureHostReference" (id integer PRIMARY KEY, "userId" integer NOT NULL, "eventTypeId" integer NOT NULL, FOREIGN KEY ("userId", "eventTypeId") REFERENCES "Host"("userId", "eventTypeId") ON DELETE CASCADE)'
  );
  try {
    await prisma.$executeRaw`INSERT INTO "HandoffFutureHostReference" (id,"userId","eventTypeId") VALUES (1,3,300)`;
    const before = await snapshot();
    const actual = await hostDeletionReferences();
    assert.ok(actual.some((row) => row.child === "HandoffFutureHostReference"));
    assert.throws(() => requireReviewedHostReferences(actual), /preservation/);
    assert.deepEqual(
      await prisma.$queryRaw`SELECT id,"userId","eventTypeId" FROM "HandoffFutureHostReference"`,
      [{ id: 1, userId: 3, eventTypeId: 300 }]
    );
    assert.deepEqual(await snapshot(), before);
  } finally {
    await prisma.$executeRawUnsafe('DROP TABLE "HandoffFutureHostReference"');
  }
  requireReviewedHostReferences(await hostDeletionReferences());
});
