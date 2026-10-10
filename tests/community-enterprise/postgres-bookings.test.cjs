// SPDX-License-Identifier: MIT
// Real PostgreSQL and production query/authorization code. Only presentation
// parsers and logging are stubbed; no database query or permission is mocked.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { before, after, test } = require("node:test");
const { randomUUID } = require("node:crypto");
const ts = require("typescript");
const { Pool } = require("pg");
const { Kysely, PostgresDialect, sql } = require("kysely");
const postgresHelpers = require("kysely/helpers/postgres");
const dayjs = require("dayjs");
dayjs.extend(require("dayjs/plugin/utc"));
const ROOT = path.resolve(__dirname, "../..");
const AUTH = "packages/features/community-enterprise/authorization/";
function compile(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const limitedRequire = (name) => {
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected module in SQL test: ${name}`);
    return dependencies[name];
  };
  new Function("require", "module", "exports", output)(limitedRequire, module, module.exports);
  return module.exports;
}
const { PermissionPolicy } = compile(`${AUTH}PermissionPolicy.ts`);
const { KyselyPermissionStore } = compile(`${AUTH}KyselyPermissionStore.ts`, {
  "kysely/helpers/postgres": postgresHelpers,
});
const visibility = compile(`${AUTH}BookingVisibility.ts`);
const { getBookings } = compile("packages/trpc/server/routers/viewer/bookings/get.handler.ts", {
  "@calcom/dayjs": { __esModule: true, default: dayjs },
  "@calcom/features/bookings/lib/getAllUserBookings": {
    __esModule: true,
    default: () => {
      throw new Error("HTTP wrapper not under test");
    },
  },
  "@calcom/features/community-enterprise/authorization/BookingVisibility": visibility,
  "@calcom/features/community-enterprise/authorization/KyselyPermissionStore": { KyselyPermissionStore },
  "@calcom/features/community-enterprise/authorization/PermissionPolicy": { PermissionPolicy },
  "@calcom/kysely": { __esModule: true, default: null },
  "@calcom/lib/isEventTypeColor": { parseEventTypeColor: (value) => value ?? null },
  "@calcom/lib/isRecurringEvent": { parseRecurringEvent: (value) => value ?? null },
  "@calcom/lib/logger": { __esModule: true, default: { getSubLogger: () => ({ debug() {}, info() {} }) } },
  "@calcom/lib/safeStringify": { safeStringify: JSON.stringify },
  "@calcom/prisma/enums": {
    MembershipRole: { MEMBER: "MEMBER", ADMIN: "ADMIN", OWNER: "OWNER" },
    BookingStatus: {
      ACCEPTED: "ACCEPTED",
      CANCELLED: "CANCELLED",
      REJECTED: "REJECTED",
      PENDING: "PENDING",
      AWAITING_HOST: "AWAITING_HOST",
    },
    SchedulingType: { ROUND_ROBIN: "ROUND_ROBIN", COLLECTIVE: "COLLECTIVE", MANAGED: "MANAGED" },
  },
  "@calcom/prisma/zod-utils": { EventTypeMetaDataSchema: { parse: (value) => value } },
  "@trpc/server": require("@trpc/server"),
  kysely: { sql },
  "kysely/helpers/postgres": postgresHelpers,
});
let admin,
  pool,
  database,
  created = false;
const databaseName = `cal_enterprise_test_${process.pid}`;
const ownerIds = [1001, 1004, 1006, 1007, 1008, 1010, 1011];
const ids = (result) => result.bookings.map((booking) => booking.id).sort((a, b) => a - b);
async function list(userId = 1, filters = {}, extra = {}) {
  return getBookings({
    user: { id: userId, email: `user${userId}@fixture.test` },
    prisma: null,
    kysely: database,
    filters,
    take: 100,
    skip: 0,
    bookingListingByStatus: [],
    ...extra,
  });
}
before(
  async () => {
    const socket = process.env.CAL_ENTERPRISE_TEST_SOCKET;
    const dataDirectory = process.env.CAL_ENTERPRISE_TEST_PGDATA;
    assert.ok(
      socket && dataDirectory,
      "Supply explicit disposable PostgreSQL socket and PGDATA; tests never auto-use DATABASE_URL"
    );
    assert.ok(path.isAbsolute(socket) && path.isAbsolute(dataDirectory));
    assert.equal(path.dirname(socket), path.dirname(dataDirectory));
    assert.match(path.basename(path.dirname(socket)), /cal-enterprise-/);
    admin = new Pool({
      host: socket,
      port: 55439,
      user: "cal_enterprise_test",
      database: "postgres",
      max: 2,
      connectionTimeoutMillis: 3000,
    });
    const identity = await admin.query(
      "SELECT current_setting('data_directory') AS directory, current_user AS username"
    );
    assert.equal(identity.rows[0].directory, dataDirectory);
    assert.equal(identity.rows[0].username, "cal_enterprise_test");
    assert.equal(
      (await admin.query('SELECT count(*)::int AS count FROM "users"')).rows[0].count,
      0,
      "Template must be empty; refusing a populated application database"
    );
    await admin.query("SET statement_timeout = '120s'");
    await admin.query(`CREATE DATABASE "${databaseName}" TEMPLATE postgres`);
    created = true;
    pool = new Pool({
      host: socket,
      port: 55439,
      user: "cal_enterprise_test",
      database: databaseName,
      max: 4,
      connectionTimeoutMillis: 3000,
    });
    database = new Kysely({ dialect: new PostgresDialect({ pool }) });
    for (let id = 1; id <= 9; id++) {
      await pool.query(
        'INSERT INTO "users" (id,uuid,email,name,username,locked) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, randomUUID(), `user${id}@fixture.test`, `Fixture ${id}`, `fixture-${id}`, id === 8]
      );
    }
    await pool.query(`INSERT INTO "Team" (id,name,"isOrganization","parentId") VALUES
    (100,'Org A',true,null),(200,'Org B',true,null),(10,'Team A',false,100),
    (11,'Sibling A',false,100),(20,'Team B',false,200),(30,'Standalone',false,null)`);
    await pool.query(`INSERT INTO "Role" (id,name,"teamId","updatedAt") VALUES ('reader','Scheduler',10,NOW());
    INSERT INTO "RolePermission" (id,"roleId",resource,action) VALUES ('read-grant','reader','booking','readTeamBookings');
    INSERT INTO "Membership" ("userId","teamId",role,accepted,"customRoleId") VALUES
    (1,100,'OWNER',true,null),(2,100,'MEMBER',true,null),(2,10,'MEMBER',true,null),
    (3,200,'OWNER',true,null),(5,100,'MEMBER',true,null),(5,10,'ADMIN',false,null),
    (6,100,'MEMBER',true,null),(6,10,'MEMBER',true,'reader'),(7,100,'MEMBER',true,null),
    (7,10,'MEMBER',true,null),(8,100,'OWNER',true,null),(9,100,'OWNER',true,null),(9,200,'OWNER',true,null)`);
    const events = [
      [101, 10, null, 2],
      [102, null, null, 2],
      [103, 20, null, 2],
      [104, 10, null, null],
      [105, null, 104, 2],
      [106, 20, 104, 3],
      [107, null, null, 1],
      [108, 11, null, 2],
      [109, null, null, 3],
      [110, null, null, 3],
    ];
    for (const [id, team, parent, owner] of events) {
      await pool.query(
        'INSERT INTO "EventType" (id,title,slug,length,"teamId","parentId","userId") VALUES ($1,$2,$3,30,$4,$5,$6)',
        [id, `Event ${id}`, `event-${id}`, team, parent, owner]
      );
    }
    const bookings = [
      [1001, 101, 2],
      [1002, 102, 2],
      [1003, 103, 2],
      [1004, 105, 2],
      [1005, 106, 2],
      [1006, 107, 1],
      [1007, 109, 3],
      [1008, 110, 3],
      [1009, 102, 2],
      [1010, 101, 2],
      [1011, 108, 2],
    ];
    for (const [id, event, owner] of bookings) {
      await pool.query(
        `INSERT INTO "Booking" (id,uid,title,description,"eventTypeId","userId","startTime","endTime","createdAt","updatedAt",status,"recurringEventId")
      VALUES ($1,$2,$3,$4,$5,$6,'2030-06-01 10:00:00','2030-06-01 10:30:00',$7,$7,$8,$9)`,
        [
          id,
          `booking-${id}`,
          `Fixture booking ${id}`,
          `detail-${id}`,
          event,
          owner,
          id === 1001 ? "2026-01-01 00:00:00" : "2026-02-01 00:00:00",
          id === 1010 ? "cancelled" : "accepted",
          id <= 1004 ? "shared-series" : null,
        ]
      );
    }
    await pool.query(`INSERT INTO "Attendee" (id,email,name,"timeZone","bookingId") VALUES
    (1,'alice@external.test','Alice','UTC',1001),(2,'bob@external.test','Bob','UTC',1001),
    (3,'user1@fixture.test','Fixture 1','UTC',1007),(4,'user4@fixture.test','Fixture 4','UTC',1007),
    (5,'user1@fixture.test','Fixture 1','UTC',null),(6,'user7@fixture.test','Fixture 7','UTC',1009),
    (7,'literal%_@external.test','Literal %_','UTC',1001),(8,'user4@fixture.test','Fixture 4','UTC',1008);
    INSERT INTO "BookingSeat" (id,"referenceUid","bookingId","attendeeId") VALUES (1,'seat-fixture',1008,5),(2,'other-seat',1008,8);
    UPDATE "EventType" SET "seatsPerTimeSlot"=10,"seatsShowAttendees"=false WHERE id=110`);
  },
  { timeout: 180000 }
);
after(async () => {
  if (database) await database.destroy();
  if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  if (admin) await admin.end();
});
test("organization owner sees shared direct/managed bookings and personal participation only", async () => {
  const result = await list();
  assert.deepEqual(ids(result), ownerIds);
  assert.equal(result.totalCount, ownerIds.length);
  for (const forbidden of [1002, 1003, 1005, 1009])
    assert.ok(!JSON.stringify(result).includes(`detail-${forbidden}`));
});
test("coworker filter never reveals coworker private or foreign-team bookings", async () => {
  assert.deepEqual(ids(await list(1, { userIds: [2] })), [1001, 1004, 1010, 1011]);
});
test("coworker attendee does not confer organizational visibility", async () => {
  assert.deepEqual(ids(await list(1, { userIds: [7] })), []);
});
test("explicit foreign booking and event IDs cannot expand scope", async () => {
  assert.deepEqual(ids(await list(1, { bookingUid: "booking-1003" })), []);
  assert.deepEqual(ids(await list(1, { eventTypeIds: [103, 106] })), []);
});
test("team filter includes managed child without foreign explicit-owner child", async () => {
  assert.deepEqual(ids(await list(1, { teamIds: [10] })), [1001, 1004, 1010]);
  assert.deepEqual(ids(await list(1, { eventTypeIds: [104] })), [1004]);
});
for (const teamIds of [[999], [30], [20]])
  test(`empty or unauthorized team filter ${teamIds} returns zero, never all`, async () => {
    const result = await list(1, { teamIds });
    assert.deepEqual(ids(result), []);
    assert.equal(result.totalCount, 0);
  });
test("unknown event and user filters return empty without existence-dependent errors", async () => {
  assert.deepEqual(ids(await list(1, { eventTypeIds: [999] })), []);
  assert.deepEqual(ids(await list(1, { userIds: [999] })), []);
});
test("identity filters intersect instead of granting their union", async () => {
  assert.deepEqual(ids(await list(1, { teamIds: [10], eventTypeIds: [108] })), []);
  assert.deepEqual(ids(await list(1, { teamIds: [10], userIds: [2] })), [1001, 1004, 1010]);
});
test("a member retains their own private and cross-team host appointments", async () => {
  assert.deepEqual(ids(await list(2)), [1001, 1002, 1003, 1004, 1005, 1009, 1010, 1011]);
});
test("unprivileged coworker retains explicit personal invitation, not team visibility", async () => {
  assert.deepEqual(ids(await list(7)), [1009]);
});
test("guest participation does not depend on enterprise membership", async () => {
  assert.deepEqual(ids(await list(4)), [1007, 1008]);
});
test("pending team administrator has no delegated access", async () => {
  assert.deepEqual(ids(await list(5)), []);
});
test("custom role grants only its own team's booking scope", async () => {
  assert.deepEqual(ids(await list(6)), [1001, 1004, 1010]);
});
test("global custom role binding does not fall back to membership authority", async (t) => {
  await pool.query('UPDATE "Role" SET "teamId"=NULL WHERE id=$1', ["reader"]);
  t.after(() => pool.query('UPDATE "Role" SET "teamId"=10 WHERE id=$1', ["reader"]));
  assert.deepEqual(ids(await list(6)), []);
});
test("active organization selection only narrows delegation", async () => {
  assert.deepEqual(
    ids(await list(9, {}, { user: { id: 9, email: "ignored@invalid.test", orgId: 100 } })),
    [1001, 1004, 1010, 1011]
  );
  assert.deepEqual(
    ids(await list(9, {}, { user: { id: 9, email: "ignored@invalid.test", orgId: 200 } })),
    [1003, 1005]
  );
});
test("forged/stale caller email cannot acquire another attendee's bookings", async () => {
  assert.deepEqual(ids(await list(4, {}, { user: { id: 4, email: "user1@fixture.test" } })), [1007, 1008]);
});
test("locked actor is rejected even when they would own or attend a booking", async () => {
  await assert.rejects(list(8), (error) => error.code === "FORBIDDEN");
});
test("deleted actor is rejected", async () => {
  await assert.rejects(list(999), (error) => error.code === "FORBIDDEN");
});
test("same caller observes organization removal on next request", async (t) => {
  await pool.query('UPDATE "Membership" SET accepted=false WHERE "userId"=1 AND "teamId"=100');
  t.after(() => pool.query('UPDATE "Membership" SET accepted=true WHERE "userId"=1 AND "teamId"=100'));
  assert.deepEqual(ids(await list()), [1006, 1007, 1008]);
});
test("counts respect the same created-date filter as the page", async () => {
  const result = await list(1, { beforeCreatedDate: "2026-01-15T00:00:00Z" });
  assert.deepEqual(ids(result), [1001]);
  assert.equal(result.totalCount, 1);
});
test("counts respect the same updated-date filter as the page", async () => {
  const result = await list(1, { afterUpdatedDate: "2026-01-15T00:00:00Z" });
  assert.deepEqual(
    ids(result),
    ownerIds.filter((id) => id !== 1001)
  );
  assert.equal(result.totalCount, 6);
});
test("combined attendee-name/email filters match the same attendee without duplicate joins", async () => {
  assert.deepEqual(ids(await list(1, { attendeeName: "Alice", attendeeEmail: "bob@external.test" })), []);
  const result = await list(1, { attendeeName: "Alice", attendeeEmail: "alice@external.test" });
  assert.deepEqual(ids(result), [1001]);
  assert.equal(result.totalCount, 1);
});
test("literal wildcard characters are not silently treated as match-all search", async () => {
  const filter = { type: "t", data: { operator: "contains", operand: "%_" } };
  assert.deepEqual(ids(await list(1, { attendeeName: filter })), [1001]);
});
test("advanced equality retains case-insensitive behavior", async () => {
  const filter = { type: "t", data: { operator: "equals", operand: "ALICE" } };
  assert.deepEqual(ids(await list(1, { attendeeName: filter })), [1001]);
});
test("stable pagination has no duplicates or omissions for identical booking times", async () => {
  const seen = [];
  for (let skip = 0; skip < ownerIds.length; skip += 2) {
    const result = await list(1, {}, { take: 2, skip });
    seen.push(...result.bookings.map((b) => b.id));
    assert.equal(result.totalCount, 7);
  }
  assert.deepEqual(seen, ownerIds);
});
test("an exhausted page retains correct count without unrelated recurring metadata", async () => {
  const result = await list(1, {}, { take: 2, skip: 100 });
  assert.deepEqual(result.bookings, []);
  assert.deepEqual(result.recurringInfo, []);
  assert.equal(result.totalCount, 7);
});
test("recurring metadata excludes invisible bookings sharing the same series identifier", async () => {
  const result = await list(1, { eventTypeIds: [101] });
  assert.equal(result.recurringInfo.length, 1);
  assert.equal(result.recurringInfo[0].count, 2);
  assert.equal(result.recurringInfo[0].bookings.ACCEPTED.length, 2);
});
test("reschedule provenance is scoped instead of following an arbitrary foreign UID", async (t) => {
  await pool.query('UPDATE "Booking" SET "fromReschedule"=$1 WHERE id=1001', ["booking-1003"]);
  await pool.query('UPDATE "Booking" SET "rescheduledBy"=$1 WHERE id=1003', [
    "private-rescheduler@foreign.test",
  ]);
  t.after(() => pool.query('UPDATE "Booking" SET "fromReschedule"=NULL WHERE id=1001'));
  const result = await list(1, { bookingUid: "booking-1001" });
  assert.equal(result.bookings[0].rescheduler, null);
});
test("seated attendee privacy hides unrelated attendee and seat-reference emails", async () => {
  const result = await list(1, { bookingUid: "booking-1008" });
  assert.equal(result.bookings[0].id, 1008);
  assert.ok(result.bookings[0].attendees.every((attendee) => attendee.email === "user1@fixture.test"));
  assert.deepEqual(
    result.bookings[0].seatsReferences.map((seat) => seat.attendee?.email),
    ["user1@fixture.test"]
  );
});
test("status filtering and count use the same authorized set", async () => {
  const result = await list(1, {}, { bookingListingByStatus: ["cancelled"] });
  assert.deepEqual(ids(result), [1010]);
  assert.equal(result.totalCount, 1);
});
for (const bad of [
  { take: 0 },
  { skip: -1 },
  { take: 1.5 },
  { filters: { teamIds: [-1] } },
  { filters: { userIds: [1.2] } },
  { bookingListingByStatus: ["unknown"] },
]) {
  test(`invalid internal/API query bounds reject: ${JSON.stringify(bad)}`, async () => {
    await assert.rejects(list(1, {}, bad), (error) => error.code === "BAD_REQUEST");
  });
}
test("database-backed store agrees with in-memory policy on every team", async () => {
  const store = new KyselyPermissionStore(database);
  const snapshot = await store.snapshot(6);
  const teams = await database.selectFrom("Team").select(["id", "parentId", "isOrganization"]).execute();
  const reference = new PermissionPolicy({
    snapshot: async () => snapshot,
    teams: async (ids) => teams.filter((t) => ids.includes(t.id)),
    children: async (ids) => teams.filter((t) => ids.includes(t.parentId)),
  });
  const actual = new PermissionPolicy(store);
  for (const team of teams) {
    const query = {
      userId: 6,
      teamId: team.id,
      permission: "booking.readTeamBookings",
      fallbackRoles: ["ADMIN", "OWNER"],
    };
    assert.equal(await actual.checkPermission(query), await reference.checkPermission(query));
  }
});
test("in-flight listing is snapshot-consistent and next request sees committed revocation", async (t) => {
  let signal, release;
  const reached = new Promise((resolve) => {
    signal = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const marked = new Set();
  let paused = false;
  const plugin = {
    transformQuery({ node, queryId }) {
      if (node.kind === "SelectQueryNode" && JSON.stringify(node).includes('"name":"Membership"'))
        marked.add(queryId);
      return node;
    },
    async transformResult({ result, queryId }) {
      if (marked.has(queryId) && !paused) {
        paused = true;
        signal();
        await gate;
      }
      return result;
    },
  };
  const running = list(1, {}, { kysely: database.withPlugin(plugin) });
  t.after(() => release());
  await Promise.race([
    reached,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("Listing did not reach authorization query")), 10000);
      timer.unref();
    }),
  ]);
  await pool.query('UPDATE "Membership" SET role=$1 WHERE "userId"=1 AND "teamId"=100', ["MEMBER"]);
  t.after(() => pool.query('UPDATE "Membership" SET role=$1 WHERE "userId"=1 AND "teamId"=100', ["OWNER"]));
  release();
  assert.deepEqual(ids(await running), ownerIds);
  assert.deepEqual(ids(await list()), [1006, 1007, 1008]);
});
