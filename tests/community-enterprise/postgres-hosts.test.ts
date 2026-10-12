// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

import { afterAll as after, beforeAll as before, beforeEach, test } from "vitest";

const { Pool } = require("pg");

import process from "node:process";
import { CommunityQualifiedHostsService } from "@calcom/features/community-enterprise/scheduling/QualifiedHostsService";
import { PrismaClient } from "@calcom/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const root = path.resolve(__dirname, "../..");
let admin, pool, prisma, service;
let created = false;
const databaseName = `cal_enterprise_hosts_${process.pid}`;

before(async () => {
  const socket = process.env.CAL_ENTERPRISE_TEST_SOCKET;
  const pgdata = process.env.CAL_ENTERPRISE_TEST_PGDATA;
  assert.ok(socket && pgdata, "Use the disposable database runner, not DATABASE_URL");
  assert.equal(path.dirname(socket), path.dirname(pgdata));
  assert.match(path.basename(path.dirname(socket)), /^cal-enterprise-/);
  admin = new Pool({ host: socket, port: 55439, user: "cal_enterprise_test", database: "postgres", max: 2 });
  const identity = (
    await admin.query("SELECT current_setting('data_directory') AS directory, current_user AS username")
  ).rows[0];
  assert.equal(identity.directory, pgdata);
  assert.equal(identity.username, "cal_enterprise_test");
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM "users"')).rows[0].count, 0);
  await admin.query("SET statement_timeout = '120s'");
  await admin.query(`CREATE DATABASE "${databaseName}" TEMPLATE postgres`);
  created = true;
  pool = new Pool({ host: socket, port: 55439, user: "cal_enterprise_test", database: databaseName, max: 4 });
  prisma = new PrismaClient({
    adapter: new PrismaPg({
      host: socket,
      port: 55439,
      user: "cal_enterprise_test",
      database: databaseName,
      max: 6,
    }),
  });
  service = new CommunityQualifiedHostsService(prisma);
}, 180000);

beforeEach(async () => {
  // The server identity and empty template were verified before this test-owned
  // database was created. Only this disposable database is reset.
  await pool.query('TRUNCATE "users", "Team", "EnterpriseAuditEvent" RESTART IDENTITY CASCADE');
  for (let id = 1; id <= 6; id++)
    await pool.query(
      'INSERT INTO "users" (id, uuid, email, name, username, locked) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, randomUUID(), `user${id}@fixture.test`, `Person ${id}`, `person-${id}`, id === 5]
    );
  await pool.query(`INSERT INTO "Team" (id,name,slug,"isOrganization","parentId") VALUES
    (100,'Organization A','alpha',true,null),(200,'Organization B','beta',true,null),
    (10,'Team A','shared',false,100),(20,'Team B','shared',false,200),(30,'Standalone','standalone',false,null);
    SELECT setval('"Team_id_seq"', 300, true);
    INSERT INTO "Membership" ("userId","teamId",accepted,role) VALUES
    (1,100,true,'OWNER'),(1,10,true,'OWNER'),(2,100,true,'MEMBER'),(2,10,true,'MEMBER'),
    (3,200,true,'OWNER'),(3,20,true,'OWNER'),(4,100,false,'OWNER'),(5,100,true,'OWNER'),(6,100,true,'MEMBER');`);
});
after(async () => {
  console.info("HOST_FIXTURE_CLEANUP", "prisma");
  if (prisma) await prisma.$disconnect();
  console.info("HOST_FIXTURE_CLEANUP", "query-pool", pool?.totalCount, pool?.idleCount);
  if (pool) await pool.end();
  console.info("HOST_FIXTURE_CLEANUP", "owned-database");
  if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  if (admin) await admin.end();
  console.info("HOST_FIXTURE_CLEANUP", "complete");
}, 60000);

async function event(changes = {}) {
  await prisma.eventType.create({
    data: {
      id: 501,
      title: "Advisory",
      slug: "advisory",
      length: 30,
      teamId: 10,
      schedulingType: "ROUND_ROBIN",
      hosts: {
        create: [
          { userId: 1, isFixed: false },
          { userId: 2, isFixed: false },
        ],
      },
      ...changes,
    },
  });
  return input();
}
async function input(id = 501) {
  return {
    eventType: await prisma.eventType.findUnique({
      where: { id },
      include: {
        users: { include: { credentials: true } },
        hosts: { include: { user: { include: { credentials: true } } } },
      },
    }),
  };
}
const rr = (result) => result.qualifiedRRHosts.map((host) => host.user.id).sort((a, b) => a - b);
const fixed = (result) => result.fixedHosts.map((host) => host.user.id).sort((a, b) => a - b);
async function original(eventTypeId = 501, userId = 2, uid = "original") {
  return prisma.booking.create({
    data: {
      uid,
      title: "Original",
      eventTypeId,
      userId,
      startTime: new Date("2030-06-10T10:00:00Z"),
      endTime: new Date("2030-06-10T10:30:00Z"),
      status: "ACCEPTED",
    },
  });
}

test("real modern RR assignments retain eligible alternatives", async () => {
  const q = await event();
  assert.deepEqual(rr(await service.findQualifiedHostsWithDelegationCredentials(q)), [1, 2]);
});
test("current assignment deletion defeats a previously loaded event", async () => {
  const q = await event();
  await prisma.host.delete({ where: { userId_eventTypeId: { userId: 2, eventTypeId: 501 } } });
  assert.deepEqual(rr(await service.findQualifiedHostsWithDelegationCredentials(q)), [1]);
});
test("current team removal defeats a stale payload and the same service object", async () => {
  const q = await event();
  assert.deepEqual(rr(await service.findQualifiedHostsWithDelegationCredentials(q)), [1, 2]);
  await prisma.membership.delete({ where: { userId_teamId: { userId: 2, teamId: 10 } } });
  assert.deepEqual(rr(await service.findQualifiedHostsWithDelegationCredentials(q)), [1]);
});
test("organization removal invalidates leftover team membership", async () => {
  const q = await event();
  await prisma.membership.delete({ where: { userId_teamId: { userId: 2, teamId: 100 } } });
  assert.deepEqual(rr(await service.findQualifiedHostsWithDelegationCredentials(q)), [1]);
});
test("pending membership cannot schedule an assigned host", async () => {
  const q = await event();
  await prisma.membership.update({
    where: { userId_teamId: { userId: 2, teamId: 10 } },
    data: { accepted: false },
  });
  assert.deepEqual(rr(await service.findQualifiedHostsWithDelegationCredentials(q)), [1]);
});
test("account lock is checked after the event was loaded", async () => {
  const q = await event();
  await prisma.user.update({ where: { id: 2 }, data: { locked: true } });
  assert.deepEqual(rr(await service.findQualifiedHostsWithDelegationCredentials(q)), [1]);
});
test("a foreign user cannot become an eligible host through stale source data", async () => {
  const q = await event();
  await prisma.host.create({ data: { eventTypeId: 501, userId: 3, isFixed: false } });
  const expanded = await input();
  assert.deepEqual(rr(await service.findQualifiedHostsWithDelegationCredentials(expanded)), [1, 2]);
});
test("rerouting to a removed or foreign user yields no hosts and no fallback", async () => {
  const q = await event();
  for (const id of [3, 999]) {
    const result = await service.findQualifiedHostsWithDelegationCredentials({
      ...q,
      routedTeamMemberIds: [id],
    });
    assert.deepEqual(rr(result), []);
    assert.deepEqual(result.allFallbackRRHosts, []);
    assert.deepEqual(fixed(result), []);
  }
});
test("legacy users relation participates in round robin instead of becoming collective", async () => {
  const q = await event({ hosts: undefined, users: { connect: [{ id: 1 }, { id: 2 }] } });
  const result = await service.findQualifiedHostsWithDelegationCredentials(q);
  assert.deepEqual(rr(result), [1, 2]);
  assert.deepEqual(fixed(result), []);
});
test("fixed and RR participants remain separate", async () => {
  const q = await event({
    hosts: {
      create: [
        { userId: 1, isFixed: true },
        { userId: 2, isFixed: false },
      ],
    },
  });
  const result = await service.findQualifiedHostsWithDelegationCredentials({
    ...q,
    routedTeamMemberIds: [2],
  });
  assert.deepEqual(rr(result), [2]);
  assert.deepEqual(fixed(result), [1]);
});
test("loss of a fixed host cannot silently create a smaller event", async () => {
  const q = await event({
    hosts: {
      create: [
        { userId: 1, isFixed: true },
        { userId: 2, isFixed: false },
      ],
    },
  });
  await prisma.user.update({ where: { id: 1 }, data: { locked: true } });
  assert.deepEqual(await service.findQualifiedHostsWithDelegationCredentials(q), {
    qualifiedRRHosts: [],
    allFallbackRRHosts: [],
    fixedHosts: [],
  });
});
test("collective event loses all availability when one required person is removed", async () => {
  const q = await event({ schedulingType: "COLLECTIVE" });
  assert.deepEqual(fixed(await service.findQualifiedHostsWithDelegationCredentials(q)), [1, 2]);
  await prisma.membership.delete({ where: { userId_teamId: { userId: 2, teamId: 10 } } });
  assert.deepEqual(fixed(await service.findQualifiedHostsWithDelegationCredentials(q)), []);
});
test("same-host rescheduling preserves the original eligible host", async () => {
  const q = await event({ rescheduleWithSameRoundRobinHost: true });
  await original();
  assert.deepEqual(
    rr(await service.findQualifiedHostsWithDelegationCredentials({ ...q, rescheduleUid: "original" })),
    [2]
  );
});
test("explicit reroute overrides same-host but keeps exact restrictions", async () => {
  const q = await event({ rescheduleWithSameRoundRobinHost: true });
  await original();
  assert.deepEqual(
    rr(
      await service.findQualifiedHostsWithDelegationCredentials({
        ...q,
        rescheduleUid: "original",
        routedTeamMemberIds: [1],
      })
    ),
    [1]
  );
});
test("the original host is not resurrected after organization removal", async () => {
  const q = await event({ rescheduleWithSameRoundRobinHost: true });
  await original();
  await prisma.membership.delete({ where: { userId_teamId: { userId: 2, teamId: 100 } } });
  assert.deepEqual(
    rr(await service.findQualifiedHostsWithDelegationCredentials({ ...q, rescheduleUid: "original" })),
    []
  );
});
test("a reschedule UID from another event confers no host authority", async () => {
  const q = await event({ rescheduleWithSameRoundRobinHost: true });
  await prisma.eventType.create({ data: { id: 502, title: "Other", slug: "other", length: 30, userId: 2 } });
  await original(502);
  assert.deepEqual(
    rr(await service.findQualifiedHostsWithDelegationCredentials({ ...q, rescheduleUid: "original" })),
    []
  );
});
test("seat reschedule UID is resolved through its owning booking", async () => {
  const q = await event({ rescheduleWithSameRoundRobinHost: true });
  const b = await original();
  const attendee = await prisma.attendee.create({
    data: { email: "guest@example.test", name: "Guest", timeZone: "UTC", bookingId: b.id },
  });
  await prisma.bookingSeat.create({
    data: { referenceUid: "seat", bookingId: b.id, attendeeId: attendee.id },
  });
  assert.deepEqual(
    rr(await service.findQualifiedHostsWithDelegationCredentials({ ...q, rescheduleUid: "seat" })),
    [2]
  );
});
test("intersection, not a union, combines route and requested subset", async () => {
  const q = await event();
  const result = await service.findQualifiedHostsWithDelegationCredentials({
    ...q,
    routedTeamMemberIds: [1],
    rrHostSubsetIds: [2],
  });
  assert.deepEqual(rr(result), []);
  assert.deepEqual(result.allFallbackRRHosts, []);
});
test("a managed child uses the parent's team when it has no own team", async () => {
  await event();
  await prisma.eventType.create({
    data: {
      id: 502,
      title: "Child",
      slug: "child",
      length: 30,
      parentId: 501,
      schedulingType: "ROUND_ROBIN",
      users: { connect: [{ id: 1 }, { id: 2 }] },
    },
  });
  assert.deepEqual(rr(await service.findQualifiedHostsWithDelegationCredentials(await input(502))), [1, 2]);
});
test("explicit child-team ownership is not overridden by its parent's team", async () => {
  await event();
  await prisma.eventType.create({
    data: {
      id: 502,
      title: "Child",
      slug: "child",
      length: 30,
      parentId: 501,
      teamId: 20,
      schedulingType: "ROUND_ROBIN",
      users: { connect: [{ id: 1 }, { id: 2 }] },
    },
  });
  assert.deepEqual(rr(await service.findQualifiedHostsWithDelegationCredentials(await input(502))), []);
});
test("standalone teams need their own accepted members, not an invented organization", async () => {
  await prisma.membership.create({ data: { userId: 1, teamId: 30, accepted: true, role: "MEMBER" } });
  const q = await event({ teamId: 30 });
  assert.deepEqual(rr(await service.findQualifiedHostsWithDelegationCredentials(q)), [1]);
});
test("individual bookings do not require enterprise memberships", async () => {
  const q = await event({
    teamId: null,
    schedulingType: null,
    hosts: undefined,
    userId: 3,
    users: { connect: [{ id: 3 }] },
  });
  assert.deepEqual(fixed(await service.findQualifiedHostsWithDelegationCredentials(q)), [3]);
});

test("routed rescheduling still requires the original event identity", async () => {
  const q = await event();
  await prisma.eventType.create({ data: { id: 502, title: "Other", slug: "other", length: 30, userId: 2 } });
  await original(502);
  assert.deepEqual(
    rr(
      await service.findQualifiedHostsWithDelegationCredentials({
        ...q,
        rescheduleUid: "original",
        routedTeamMemberIds: [1],
      })
    ),
    []
  );
});
test("cancelled booking same-host policy follows the configured rebooking setting", async () => {
  const q = await event({ rescheduleWithSameRoundRobinHost: true, allowReschedulingCancelledBookings: true });
  await original();
  await prisma.booking.update({ where: { uid: "original" }, data: { status: "CANCELLED" } });
  assert.deepEqual(
    rr(await service.findQualifiedHostsWithDelegationCredentials({ ...q, rescheduleUid: "original" })),
    [2]
  );
  await prisma.eventType.update({ where: { id: 501 }, data: { allowReschedulingCancelledBookings: false } });
  assert.deepEqual(
    rr(await service.findQualifiedHostsWithDelegationCredentials({ ...q, rescheduleUid: "original" })),
    []
  );
});

// Real PostgreSQL commit-boundary tests; this suite does not load Prismock.
import { assertBookingCanCommit } from "@calcom/features/community-enterprise/scheduling/BookingCommitGuard";

const commitStart = new Date("2030-06-10T10:00:00Z");
function commitInput(overrides = {}) {
  return {
    eventTypeId: 501,
    schedulingType: "ROUND_ROBIN",
    selectedHosts: [{ id: 1, email: "user1@fixture.test" }],
    startTime: commitStart,
    endTime: new Date(commitStart.getTime() + 1800000),
    ...overrides,
  };
}
const checkCommit = (input) =>
  prisma.$transaction((tx) => assertBookingCanCommit(tx, input), {
    isolationLevel: "ReadCommitted",
    timeout: 10000,
  });

test("commit guard refuses a snapshot that cannot see a preceding lock holder commit", async () => {
  await event();
  await assert.rejects(
    prisma.$transaction((tx) => assertBookingCanCommit(tx, commitInput()), {
      isolationLevel: "RepeatableRead",
    }),
    /read-committed isolation/
  );
});
test("commit guard permits an eligible free host", async () => {
  await event();
  await checkCommit(commitInput());
});
test("commit guard rejects stale host identity and revoked membership", async () => {
  await event();
  await assert.rejects(
    checkCommit(commitInput({ selectedHosts: [{ id: 1, email: "changed@fixture.test" }] }))
  );
  await prisma.membership.delete({ where: { userId_teamId: { userId: 1, teamId: 10 } } });
  await assert.rejects(checkCommit(commitInput()));
});
test("commit guard cannot reduce a collective meeting or select two members of one RR group", async () => {
  await event();
  await assert.rejects(
    checkCommit(
      commitInput({
        selectedHosts: [
          { id: 1, email: "user1@fixture.test" },
          { id: 2, email: "user2@fixture.test" },
        ],
      })
    )
  );
  await prisma.eventType.update({ where: { id: 501 }, data: { schedulingType: "COLLECTIVE" } });
  await assert.rejects(checkCommit(commitInput({ schedulingType: "COLLECTIVE" })));
  await checkCommit(
    commitInput({
      schedulingType: "COLLECTIVE",
      selectedHosts: [
        { id: 1, email: "user1@fixture.test" },
        { id: 2, email: "user2@fixture.test" },
      ],
    })
  );
});
test("commit guard rejects an overlapping accepted appointment across event types", async () => {
  await event();
  await prisma.eventType.create({ data: { id: 502, title: "Other", slug: "other", length: 30, userId: 1 } });
  await original(502, 1);
  await assert.rejects(
    checkCommit(
      commitInput({ startTime: new Date("2030-06-10T10:15:00Z"), endTime: new Date("2030-06-10T10:45:00Z") })
    )
  );
});
test("commit guard permits exact adjacency without buffers", async () => {
  await event();
  await original(501, 1);
  await checkCommit(
    commitInput({ startTime: new Date("2030-06-10T10:30:00Z"), endTime: new Date("2030-06-10T11:00:00Z") })
  );
});
test("commit guard preserves the existing event's after buffer", async () => {
  await event();
  await prisma.eventType.create({
    data: { id: 502, title: "Other", slug: "other", length: 30, userId: 1, afterEventBuffer: 20 },
  });
  await original(502, 1);
  await assert.rejects(
    checkCommit(
      commitInput({ startTime: new Date("2030-06-10T10:45:00Z"), endTime: new Date("2030-06-10T11:15:00Z") })
    )
  );
});
test("commit guard preserves the candidate event's before buffer", async () => {
  await event({ beforeEventBuffer: 15 });
  await prisma.eventType.create({ data: { id: 502, title: "Other", slug: "other", length: 30, userId: 1 } });
  await original(502, 1);
  await assert.rejects(
    checkCommit(
      commitInput({ startTime: new Date("2030-06-10T10:40:00Z"), endTime: new Date("2030-06-10T11:10:00Z") })
    )
  );
});
test("commit guard detects a selected host who participates in another organizer's appointment", async () => {
  await event();
  const booking = await original(501, 2);
  await prisma.attendee.create({
    data: { name: "Host", email: "user1@fixture.test", timeZone: "UTC", bookingId: booking.id },
  });
  await assert.rejects(checkCommit(commitInput()));
});
test("pending bookings reserve time only when their event requires blocking", async () => {
  await event();
  await prisma.eventType.create({
    data: {
      id: 502,
      title: "Other",
      slug: "other",
      length: 30,
      userId: 1,
      requiresConfirmation: true,
      requiresConfirmationWillBlockSlot: true,
    },
  });
  const booking = await original(502, 1);
  await prisma.booking.update({ where: { id: booking.id }, data: { status: "PENDING" } });
  await assert.rejects(checkCommit(commitInput()));
  await prisma.eventType.update({ where: { id: 502 }, data: { requiresConfirmationWillBlockSlot: false } });
  await checkCommit(commitInput());
});
test("cancelled appointments do not reserve host time", async () => {
  await event();
  const booking = await original(501, 1);
  await prisma.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED" } });
  await checkCommit(commitInput());
});
test("reschedule exclusion is bound to the unchanged original booking", async () => {
  await event();
  const booking = await original(501, 1);
  await checkCommit(commitInput({ original: booking }));
  await prisma.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED" } });
  await assert.rejects(checkCommit(commitInput({ original: booking })));
});
test("a losing reschedule does not cancel its previous booking", async () => {
  await event();
  const old = await original(501, 1);
  await prisma.booking.create({
    data: {
      uid: "blocking",
      title: "Busy",
      eventTypeId: 501,
      userId: 1,
      startTime: new Date("2030-06-11T10:00:00Z"),
      endTime: new Date("2030-06-11T10:30:00Z"),
      status: "ACCEPTED",
    },
  });
  await assert.rejects(
    prisma.$transaction(
      async (tx) => {
        await assertBookingCanCommit(
          tx,
          commitInput({
            original: old,
            startTime: new Date("2030-06-11T10:00:00Z"),
            endTime: new Date("2030-06-11T10:30:00Z"),
          })
        );
        await tx.booking.update({ where: { id: old.id }, data: { status: "CANCELLED" } });
      },
      { isolationLevel: "ReadCommitted" }
    )
  );
  assert.equal((await prisma.booking.findUnique({ where: { id: old.id } })).status, "ACCEPTED");
});
async function raceCommitInputs(inputs) {
  const barrier = await pool.connect();
  let requests;
  let released = false;
  try {
    await barrier.query("BEGIN");
    const gateId = (await barrier.query("SELECT pg_backend_pid() AS id")).rows[0].id;
    const shared = inputs[0].selectedHosts
      .map((host) => host.id)
      .filter((id) => inputs[1].selectedHosts.some((host) => host.id === id));
    if (inputs[0].original && inputs[0].original.id === inputs[1].original?.id) {
      await barrier.query('SELECT id FROM "Booking" WHERE id=$1 FOR UPDATE', [inputs[0].original.id]);
    } else {
      assert.ok(shared.length);
      await barrier.query('SELECT id FROM "users" WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE', [shared]);
    }
    requests = Promise.allSettled(
      inputs.map((input, index) =>
        prisma.$transaction(
          async (tx) => {
            await assertBookingCanCommit(tx, input);
            if (input.original)
              await tx.booking.update({ where: { id: input.original.id }, data: { status: "CANCELLED" } });
            return tx.booking.create({
              data: {
                uid: `concurrent-${index}`,
                title: "Race",
                eventTypeId: input.eventTypeId,
                userId: input.selectedHosts[0].id,
                startTime: input.startTime,
                endTime: input.endTime,
                status: "ACCEPTED",
                attendees: {
                  create: input.selectedHosts
                    .slice(1)
                    .map((host) => ({ email: host.email, name: "Host", timeZone: "UTC" })),
                },
              },
            });
          },
          { isolationLevel: "ReadCommitted", timeout: 10000 }
        )
      )
    );
    let waiting = 0;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      waiting = (
        await pool.query(
          `WITH RECURSIVE waiters(pid) AS (
        SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))
        UNION SELECT a.pid FROM pg_stat_activity a JOIN waiters w ON w.pid = ANY(pg_blocking_pids(a.pid))
      ) SELECT count(*)::int AS count FROM waiters`,
          [gateId]
        )
      ).rows[0].count;
      if (waiting === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(waiting, 2, "Both real transactions must contend for the owned row gate");
    await barrier.query("COMMIT");
    released = true;
    const settled = await requests;
    assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = settled.find((result) => result.status === "rejected");
    assert.equal(rejected?.reason?.code, "booking_conflict_error");
    return settled.find((result) => result.status === "fulfilled").value;
  } finally {
    if (!released) await barrier.query("ROLLBACK");
    barrier.release();
    if (requests) await requests;
  }
}
test("PostgreSQL permits only one overlapping cross-event booking to commit", async () => {
  await event();
  await prisma.eventType.create({
    data: {
      id: 502,
      title: "Other",
      slug: "other",
      length: 30,
      teamId: 10,
      schedulingType: "ROUND_ROBIN",
      hosts: { create: [{ userId: 1, isFixed: false }] },
    },
  });
  await raceCommitInputs([
    commitInput(),
    commitInput({
      eventTypeId: 502,
      startTime: new Date("2030-06-10T10:15:00Z"),
      endTime: new Date("2030-06-10T10:45:00Z"),
    }),
  ]);
  assert.equal(await prisma.booking.count({ where: { status: "ACCEPTED" } }), 1);
});
test("a shared collective participant cannot be double-booked under different organizers", async () => {
  await event({ schedulingType: "COLLECTIVE" });
  await prisma.eventType.create({
    data: {
      id: 502,
      title: "Other",
      slug: "other",
      length: 30,
      teamId: 10,
      schedulingType: "ROUND_ROBIN",
      hosts: { create: [{ userId: 2, isFixed: false }] },
    },
  });
  await raceCommitInputs([
    commitInput({
      schedulingType: "COLLECTIVE",
      selectedHosts: [
        { id: 1, email: "user1@fixture.test" },
        { id: 2, email: "user2@fixture.test" },
      ],
    }),
    commitInput({
      eventTypeId: 502,
      selectedHosts: [{ id: 2, email: "user2@fixture.test" }],
      startTime: new Date("2030-06-10T10:15:00Z"),
      endTime: new Date("2030-06-10T10:45:00Z"),
    }),
  ]);
  assert.equal(await prisma.booking.count({ where: { status: "ACCEPTED" } }), 1);
});

test("two reschedules of one booking to disjoint new hosts cannot both succeed", async () => {
  await event();
  const old = await original(501, 1);
  await raceCommitInputs([
    commitInput({
      original: old,
      startTime: new Date("2030-06-11T10:00:00Z"),
      endTime: new Date("2030-06-11T10:30:00Z"),
    }),
    commitInput({
      original: old,
      selectedHosts: [{ id: 2, email: "user2@fixture.test" }],
      startTime: new Date("2030-06-12T10:00:00Z"),
      endTime: new Date("2030-06-12T10:30:00Z"),
    }),
  ]);
  assert.equal(await prisma.booking.count({ where: { status: "ACCEPTED" } }), 1);
  assert.equal((await prisma.booking.findUnique({ where: { id: old.id } })).status, "CANCELLED");
});
test("reversed collective host order cannot bypass a shared-host conflict", async () => {
  await event({ schedulingType: "COLLECTIVE" });
  await prisma.eventType.create({
    data: {
      id: 502,
      title: "Other",
      slug: "other",
      length: 30,
      teamId: 10,
      schedulingType: "COLLECTIVE",
      hosts: {
        create: [
          { userId: 1, isFixed: false },
          { userId: 2, isFixed: false },
        ],
      },
    },
  });
  const hosts = [
    { id: 1, email: "user1@fixture.test" },
    { id: 2, email: "user2@fixture.test" },
  ];
  await raceCommitInputs([
    commitInput({ schedulingType: "COLLECTIVE", selectedHosts: hosts }),
    commitInput({
      eventTypeId: 502,
      schedulingType: "COLLECTIVE",
      selectedHosts: [...hosts].reverse(),
      startTime: new Date("2030-06-10T10:15:00Z"),
      endTime: new Date("2030-06-10T10:45:00Z"),
    }),
  ]);
});
test("independent hosts are not blocked merely because they share an event", async () => {
  await event();
  const requests = [1, 2].map((id) =>
    prisma.$transaction(
      async (tx) => {
        const input = commitInput({ selectedHosts: [{ id, email: `user${id}@fixture.test` }] });
        await assertBookingCanCommit(tx, input);
        return tx.booking.create({
          data: {
            uid: `independent-${id}`,
            title: "Independent",
            eventTypeId: 501,
            userId: id,
            startTime: input.startTime,
            endTime: input.endTime,
            status: "ACCEPTED",
          },
        });
      },
      { isolationLevel: "ReadCommitted", timeout: 10000 }
    )
  );
  await Promise.all(requests);
  assert.equal(await prisma.booking.count({ where: { status: "ACCEPTED" } }), 2);
});
