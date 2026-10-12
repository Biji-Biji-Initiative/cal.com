// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

import { afterAll as after, beforeAll as before, beforeEach, test } from "vitest";

const { Pool } = require("pg");

import process from "node:process";
import { resolvePublicTeamEvent } from "@calcom/features/community-enterprise/teams/PublicTeamEvent";
import { TeamService } from "@calcom/features/community-enterprise/teams/TeamService";
import { PrismaClient } from "@calcom/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const root = path.resolve(__dirname, "../..");
let admin, pool, prisma, service;
let created = false;
const databaseName = `cal_enterprise_teams_${process.pid}`;

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
  service = new TeamService(prisma);
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
  console.info("TEAM_FIXTURE_CLEANUP", "prisma");
  if (prisma) await prisma.$disconnect();
  console.info("TEAM_FIXTURE_CLEANUP", "query-pool", pool?.totalCount, pool?.idleCount);
  if (pool) await pool.end();
  console.info("TEAM_FIXTURE_CLEANUP", "owned-database");
  if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  if (admin) await admin.end();
  console.info("TEAM_FIXTURE_CLEANUP", "complete");
}, 60000);
const createInput = (changes = {}) => ({
  organizationId: 100,
  name: "Mentoring",
  slug: "mentoring",
  timeZone: "Asia/Kuala_Lumpur",
  requestId: randomUUID(),
  ...changes,
});
const memberInput = (changes = {}) => ({
  organizationId: 100,
  teamId: 10,
  userId: 2,
  role: "MEMBER",
  requestId: randomUUID(),
  ...changes,
});
const forbidden = (error) => error.code === "forbidden_error";

test("organization owner creates a team with an owner and atomic audit", async () => {
  const input = createInput();
  const result = await service.createTeam(1, input);
  const team = await prisma.team.findUnique({ where: { id: result.teamId }, include: { members: true } });
  assert.equal(team.parentId, 100);
  assert.equal(team.isOrganization, false);
  assert.equal(team.members[0].userId, 1);
  assert.equal(team.members[0].role, "OWNER");
  const audit = await prisma.enterpriseAuditEvent.findUnique({ where: { operationId: input.requestId } });
  assert.equal(audit.entityId, team.id);
  assert.equal(audit.actorUserId, 1);
  assert.equal(audit.action, "team.created");
});
for (const actor of [2, 3, 4, 5, 999])
  test(`actor ${actor} cannot create a team without current scope`, async () => {
    await assert.rejects(service.createTeam(actor, createInput()), forbidden);
    assert.equal(await prisma.enterpriseAuditEvent.count(), 0);
    assert.equal(await prisma.team.count(), 5);
  });
test("global application ADMIN is not foreign-organization authority", async () => {
  await prisma.user.update({ where: { id: 1 }, data: { role: "ADMIN" } });
  await assert.rejects(service.createTeam(1, createInput({ organizationId: 200 })), forbidden);
});
test("same operation is idempotent and changed payload cannot reuse its ID", async () => {
  const input = createInput();
  const first = await service.createTeam(1, input);
  assert.deepEqual(await service.createTeam(1, input), { teamId: first.teamId, replayed: true });
  await assert.rejects(service.createTeam(1, { ...input, name: "Changed" }), /already used/);
  assert.equal(await prisma.enterpriseAuditEvent.count(), 1);
});
test("concurrent retries create only one team and one audit record", async () => {
  const input = createInput();
  const results = await Promise.all([service.createTeam(1, input), service.createTeam(1, input)]);
  assert.equal(results[0].teamId, results[1].teamId);
  assert.equal(await prisma.enterpriseAuditEvent.count(), 1);
});
test("invalid timezone or address fails before a mutation", async () => {
  await assert.rejects(service.createTeam(1, createInput({ timeZone: "not-a-zone" })));
  await assert.rejects(service.createTeam(1, createInput({ slug: "../escape" })));
  assert.equal(await prisma.enterpriseAuditEvent.count(), 0);
});
test("audit failure rolls the team mutation back", async () => {
  const input = createInput();
  await pool.query(`CREATE FUNCTION reject_enterprise_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit unavailable'; END $$;
    CREATE TRIGGER reject_enterprise_audit BEFORE INSERT ON "EnterpriseAuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_enterprise_audit();`);
  try {
    await assert.rejects(service.createTeam(1, input));
  } finally {
    await pool.query(
      'DROP TRIGGER reject_enterprise_audit ON "EnterpriseAuditEvent"; DROP FUNCTION reject_enterprise_audit();'
    );
  }
  assert.equal(await prisma.team.count(), 5);
  assert.equal(await prisma.enterpriseAuditEvent.count(), 0);
});
test("membership changes are limited to accepted active people in the same organization", async () => {
  await service.setMember(1, memberInput({ userId: 6, role: "ADMIN" }));
  assert.equal(
    (await prisma.membership.findUnique({ where: { userId_teamId: { userId: 6, teamId: 10 } } })).role,
    "ADMIN"
  );
  for (const userId of [3, 4, 5, 999])
    await assert.rejects(service.setMember(1, memberInput({ userId })), /active, accepted/);
  assert.equal(await prisma.enterpriseAuditEvent.count(), 1);
});
test("requested foreign team does not gain authority from the current organization", async () => {
  await assert.rejects(service.setMember(1, memberInput({ teamId: 20 })), forbidden);
});
test("last active team owner cannot be demoted", async () => {
  await assert.rejects(
    service.setMember(1, memberInput({ userId: 1, role: "ADMIN" })),
    /retain an active owner/
  );
  assert.equal(await prisma.enterpriseAuditEvent.count(), 0);
});
test("two concurrent owner demotions preserve one owner", async () => {
  await prisma.membership.update({
    where: { userId_teamId: { userId: 2, teamId: 100 } },
    data: { role: "ADMIN" },
  });
  await prisma.membership.update({
    where: { userId_teamId: { userId: 2, teamId: 10 } },
    data: { role: "OWNER" },
  });
  const result = await Promise.allSettled([
    service.setMember(1, memberInput({ userId: 1, role: "ADMIN" })),
    service.setMember(2, memberInput({ userId: 2, role: "ADMIN" })),
  ]);
  assert.equal(result.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(await prisma.membership.count({ where: { teamId: 10, role: "OWNER", accepted: true } }), 1);
  assert.equal(await prisma.enterpriseAuditEvent.count(), 1);
});
test("custom roles cannot be silently overwritten by basic-role controls", async () => {
  await prisma.role.create({
    data: { id: "custom-team-role", name: "Coordinator", teamId: 10, permissions: { create: [] } },
  });
  await prisma.membership.update({
    where: { userId_teamId: { userId: 2, teamId: 10 } },
    data: { customRoleId: "custom-team-role" },
  });
  await assert.rejects(service.setMember(1, memberInput()), /custom role/);
});
test("overview is scoped and does not return member emails or private credentials", async () => {
  const result = await service.overview(1);
  assert.equal(result.length, 1);
  assert.equal(result[0].organization.id, 100);
  assert.deepEqual(
    result[0].teams.map((team) => team.id),
    [10]
  );
  assert.equal(result[0].canManage, true);
  const text = JSON.stringify(result);
  assert.ok(!text.includes("@fixture.test"));
  assert.ok(!text.includes("Organization B"));
  const member = await service.overview(2);
  assert.equal(member[0].canManage, false);
  assert.deepEqual(member[0].eligibleMembers, []);
});
test("local membership removal affects the next administration request", async () => {
  await prisma.membership.update({
    where: { userId_teamId: { userId: 1, teamId: 100 } },
    data: { accepted: false },
  });
  assert.deepEqual(await service.overview(1), []);
  await assert.rejects(service.createTeam(1, createInput()), forbidden);
});
async function event(teamId, kind = "ROUND_ROBIN") {
  return prisma.eventType.create({
    data: { title: "Shared session", slug: "session", length: 30, teamId, schedulingType: kind },
  });
}
test("public event resolution separates identical team slugs in different organizations", async () => {
  const a = await event(10);
  const b = await event(20);
  assert.equal(
    (await resolvePublicTeamEvent(prisma, { organization: "alpha", team: "shared", event: "session" }))
      .eventTypeId,
    a.id
  );
  assert.equal(
    (await resolvePublicTeamEvent(prisma, { organization: "beta", team: "shared", event: "session" }))
      .eventTypeId,
    b.id
  );
  assert.equal(await resolvePublicTeamEvent(prisma, { team: "shared", event: "session" }), null);
});
test("ambiguous root organization names are not resolved arbitrarily", async () => {
  await event(10);
  await prisma.team.create({ data: { name: "Duplicate root", slug: "alpha", isOrganization: true } });
  assert.equal(
    await resolvePublicTeamEvent(prisma, { organization: "alpha", team: "shared", event: "session" }),
    null
  );
});
test("standalone collective events work and managed templates are not directly bookable", async () => {
  const collective = await event(30, "COLLECTIVE");
  assert.equal(
    (await resolvePublicTeamEvent(prisma, { team: "standalone", event: "session" })).eventTypeId,
    collective.id
  );
  await event(10, "MANAGED");
  assert.equal(
    await resolvePublicTeamEvent(prisma, { organization: "alpha", team: "shared", event: "session" }),
    null
  );
});
test("unknown or malformed public paths do not fall back to personal events", async () => {
  await event(10);
  for (const input of [
    { organization: "unknown", team: "shared", event: "session" },
    { organization: "alpha", team: "../shared", event: "session" },
    { organization: "alpha", team: "shared", event: "unknown" },
  ]) {
    assert.equal(await resolvePublicTeamEvent(prisma, input), null);
  }
});

test("committed audit migration is additive and creates its actual uniqueness constraints", async () => {
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("CREATE SCHEMA audit_migration_fixture");
    await connection.query("SET LOCAL search_path TO audit_migration_fixture");
    await connection.query(
      "CREATE TABLE retained_data (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO retained_data VALUES (1, 'preserved')"
    );
    const migration = fs.readFileSync(
      path.join(root, "packages/prisma/migrations/20261012010000_community_enterprise_audit/migration.sql"),
      "utf8"
    );
    await connection.query(migration);
    assert.deepEqual((await connection.query("SELECT * FROM retained_data")).rows, [
      { id: 1, value: "preserved" },
    ]);
    const indexes = (
      await connection.query(
        "SELECT indexname FROM pg_indexes WHERE schemaname='audit_migration_fixture' AND tablename='EnterpriseAuditEvent'"
      )
    ).rows;
    assert.equal(indexes.length, 4);
    assert.ok(indexes.some(({ indexname }) => indexname === "EnterpriseAuditEvent_operationId_key"));
    await connection.query(
      "INSERT INTO \"EnterpriseAuditEvent\" (id,\"operationId\",\"operationHash\",\"actorUserId\",\"organizationId\",action,details) VALUES ('audit-1','operation-1','hash',1,100,'team.created','{}')"
    );
    assert.equal(
      (await connection.query('SELECT count(*)::int AS count FROM "EnterpriseAuditEvent"')).rows[0].count,
      1
    );
  } finally {
    await connection.query("ROLLBACK");
    connection.release();
  }
});
