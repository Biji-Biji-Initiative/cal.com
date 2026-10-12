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
