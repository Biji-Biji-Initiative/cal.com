// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");
const { before, beforeEach, afterEach, after, test } = require("node:test");
const { Pool } = require("pg");
const { connectFixture, root } = require("./tasker-fixture.cjs");
const migration = fs.readFileSync(
  path.join(root, "packages/prisma/migrations/20261020094500_scim_provenance/migration.sql"),
  "utf8"
);
let db, pool, connection, first, second, membership, directory, otherDirectory, baseline;

async function snapshot() {
  const rows = {};
  for (const table of ["users", "Membership", "Booking", "Role", "DSyncData"]) {
    rows[table] = (await connection.query(`SELECT row_to_json(t) AS row FROM "${table}" t ORDER BY id`)).rows;
  }
  return rows;
}
async function reject(query, values, code) {
  await connection.query("SAVEPOINT refused");
  await assert.rejects(connection.query(query, values), { code });
  await connection.query("ROLLBACK TO SAVEPOINT refused");
  await connection.query("RELEASE SAVEPOINT refused");
}
const identity = (externalId = "Exact-Staff", user = first, dir = directory) =>
  connection.query(
    'INSERT INTO "ScimUserIdentity" (id,"directoryId","externalId","userId","expectedUserUuid") VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [randomUUID(), dir, externalId, user.id, user.uuid]
  );
const grant = (dir = directory, memberId = membership.id) =>
  connection.query(
    'INSERT INTO "ScimMembershipGrant" (id,"directoryId","membershipId","lastManagedRole","lastManagedAccepted","lastManagedCustomRoleId","lastManagedUpdatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [
      randomUUID(),
      dir,
      memberId,
      membership.role,
      membership.accepted,
      membership.customRoleId,
      membership.updatedAt,
    ]
  );

before(async () => {
  db = await connectFixture();
  pool = new Pool({
    host: process.env.CAL_ENTERPRISE_TEST_SOCKET,
    port: 55439,
    user: "cal_enterprise_test",
    database: "postgres",
    max: 1,
  });
  connection = await pool.connect();
  await connection.query("SET statement_timeout = '10s'");
  first = await db.user.create({ data: { email: "first@fixture.test" } });
  second = await db.user.create({ data: { email: "second@fixture.test" } });
  const team = await db.team.create({ data: { name: "Existing local team" } });
  const role = await db.role.create({ data: { name: "Existing custom role", teamId: team.id } });
  membership = await db.membership.create({
    data: {
      teamId: team.id,
      userId: first.id,
      role: "MEMBER",
      accepted: true,
      customRoleId: role.id,
      updatedAt: null,
    },
  });
  await db.booking.create({
    data: {
      uid: randomUUID(),
      userId: first.id,
      title: "Preserved history",
      startTime: new Date("2026-10-20T10:00:00Z"),
      endTime: new Date("2026-10-20T11:00:00Z"),
    },
  });
  directory = "directory-exact";
  otherDirectory = "directory-other";
  for (const directoryId of [directory, otherDirectory]) {
    await db.dSyncData.create({ data: { directoryId, tenant: "existing-tenant" } });
  }
  baseline = await snapshot();
});
beforeEach(async () => {
  await connection.query("BEGIN");
  // Only the new provenance tables in this verified disposable fixture are removed.
  await connection.query('DROP TABLE "ScimMembershipGrant", "ScimUserIdentity"');
});
afterEach(async () => {
  if (connection) await connection.query("ROLLBACK");
});
after(async () => {
  if (connection) connection.release();
  if (pool) await pool.end();
  if (db) await db.$disconnect();
});

test("migration preserves existing users, custom-role/local grants, directories and booking history", async () => {
  await connection.query(migration);
  assert.deepEqual(await snapshot(), baseline);
  for (const table of ["ScimUserIdentity", "ScimMembershipGrant"]) {
    assert.equal((await connection.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n, 0);
  }
});

test("without the migration the new persistence tables are actually unavailable", async () => {
  await reject('SELECT * FROM "ScimUserIdentity"', [], "42P01");
  await reject('SELECT * FROM "ScimMembershipGrant"', [], "42P01");
  await connection.query(migration);
  assert.equal((await identity()).rows[0].externalId, "Exact-Staff");
});

test("externalId is case-exact and directory-scoped, with UUID snapshot retained", async () => {
  await connection.query(migration);
  const row = (await identity()).rows[0];
  await identity("exact-staff", second);
  await identity("Exact-Staff", first, otherDirectory);
  assert.equal(row.expectedUserUuid, first.uuid);
  assert.equal((await connection.query('SELECT count(*)::int AS n FROM "ScimUserIdentity"')).rows[0].n, 3);
});

test("duplicate externalId and same-directory user rebinds fail at the database boundary", async () => {
  await connection.query(migration);
  await identity();
  await connection.query("SAVEPOINT duplicate");
  await assert.rejects(identity("Exact-Staff", second), { code: "23505" });
  await connection.query("ROLLBACK TO SAVEPOINT duplicate");
  await assert.rejects(identity("Different-External", first), { code: "23505" });
  await connection.query("ROLLBACK TO SAVEPOINT duplicate");
  assert.equal((await connection.query('SELECT count(*)::int AS n FROM "ScimUserIdentity"')).rows[0].n, 1);
});

test("missing directory/user/membership targets are refused without creating authority", async () => {
  await connection.query(migration);
  await reject(
    'INSERT INTO "ScimUserIdentity" (id,"directoryId","externalId","userId","expectedUserUuid") VALUES ($1,$2,$3,$4,$5)',
    [randomUUID(), "missing-directory", "external", first.id, first.uuid],
    "23503"
  );
  await reject(
    'INSERT INTO "ScimUserIdentity" (id,"directoryId","externalId","userId","expectedUserUuid") VALUES ($1,$2,$3,$4,$5)',
    [randomUUID(), directory, "external", -1, first.uuid],
    "23503"
  );
  await connection.query("SAVEPOINT missing");
  await assert.rejects(grant(directory, -1), { code: "23503" });
  await connection.query("ROLLBACK TO SAVEPOINT missing");
  assert.deepEqual(await snapshot(), baseline);
});

test("grant snapshots preserve custom roles and nullable timestamps without adopting local rows", async () => {
  await connection.query(migration);
  const row = (await grant()).rows[0];
  assert.equal(row.lastManagedRole, membership.role);
  assert.equal(row.lastManagedAccepted, true);
  assert.equal(row.lastManagedCustomRoleId, membership.customRoleId);
  assert.equal(row.lastManagedUpdatedAt, null);
  assert.deepEqual(await snapshot(), baseline);
});

test("a repeated directory/member grant is refused", async () => {
  await connection.query(migration);
  await grant();
  await connection.query("SAVEPOINT duplicate");
  await assert.rejects(grant(), { code: "23505" });
  await connection.query("ROLLBACK TO SAVEPOINT duplicate");
  assert.equal((await connection.query('SELECT count(*)::int AS n FROM "ScimMembershipGrant"')).rows[0].n, 1);
});

test("directory, user and membership deletion cannot silently cascade away provenance", async () => {
  await connection.query(migration);
  await identity();
  await grant();
  await reject('DELETE FROM "DSyncData" WHERE "directoryId"=$1', [directory], "23001");
  await reject('DELETE FROM "users" WHERE id=$1', [first.id], "23001");
  await reject('DELETE FROM "Membership" WHERE id=$1', [membership.id], "23001");
  assert.deepEqual(await snapshot(), baseline);
});

test("referenced directory IDs cannot be rewritten under persisted provenance", async () => {
  await connection.query(migration);
  await identity();
  await grant();
  await reject(
    'UPDATE "DSyncData" SET "directoryId"=$1 WHERE "directoryId"=$2',
    ["rebound-directory", directory],
    "23001"
  );
});

test("provenance writes roll back together and leave existing rows intact", async () => {
  await connection.query(migration);
  await connection.query("SAVEPOINT atomic");
  await identity();
  await grant();
  await connection.query("ROLLBACK TO SAVEPOINT atomic");
  assert.equal((await connection.query('SELECT count(*)::int AS n FROM "ScimUserIdentity"')).rows[0].n, 0);
  assert.equal((await connection.query('SELECT count(*)::int AS n FROM "ScimMembershipGrant"')).rows[0].n, 0);
  assert.deepEqual(await snapshot(), baseline);
});

test("duplicate migration replay fails atomically without losing accepted data", async () => {
  await connection.query(migration);
  const original = (await identity()).rows[0];
  await grant();
  await reject(migration, [], "42P07");
  assert.deepEqual((await connection.query('SELECT * FROM "ScimUserIdentity"')).rows, [original]);
  assert.equal((await connection.query('SELECT count(*)::int AS n FROM "ScimMembershipGrant"')).rows[0].n, 1);
  assert.deepEqual(await snapshot(), baseline);
});
