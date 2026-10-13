// SPDX-License-Identifier: MIT
// Actual preflight SQL against isolated PostgreSQL. Minimal legacy relations
// exercise the guard, not a substitute for a full production restore rehearsal.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { before, beforeEach, afterEach, after, test } = require("node:test");
const { Pool } = require("pg");
const root = path.resolve(__dirname, "../..");
const sql = fs.readFileSync(path.join(root, "scripts/check-enterprise-migration.sql"), "utf8");
let admin, client, database;
let sequence = 0;
const prefix = `cal_preflight_${process.pid}_${randomBytes(4).toString("hex")}`;
const quoted = (name) => `"${name.replaceAll('"', '""')}"`;
let options;
before(async () => {
  const host = process.env.CAL_ENTERPRISE_TEST_SOCKET;
  const directory = process.env.CAL_ENTERPRISE_TEST_PGDATA;
  assert.ok(host && directory, "Use the disposable PostgreSQL runner, never an application URL");
  assert.equal(path.dirname(host), path.dirname(directory));
  assert.match(path.basename(path.dirname(host)), /^cal-enterprise-/);
  options = { host, port: 55439, user: "cal_enterprise_test", max: 1, connectionTimeoutMillis: 3000 };
  admin = new Pool({ ...options, database: "postgres" });
  const identity = (
    await admin.query("SELECT current_setting('data_directory') AS directory, current_user AS actor")
  ).rows[0];
  assert.equal(identity.directory, directory);
  assert.equal(identity.actor, options.user);
  assert.equal((await admin.query('SELECT count(*)::int AS count FROM "users"')).rows[0].count, 0);
});
beforeEach(async () => {
  database = `${prefix}_${++sequence}`;
  await admin.query(`CREATE DATABASE ${quoted(database)} TEMPLATE template0`);
  client = new Pool({ ...options, database });
});
afterEach(async () => {
  if (client) {
    await client.end();
    client = null;
  }
  if (database) {
    await admin.query(`DROP DATABASE ${quoted(database)}`);
    database = null;
  }
});
after(async () => {
  if (admin) await admin.end();
});
async function denied(pattern = /Migration refused/) {
  await assert.rejects(client.query(sql), pattern);
  await client.query("ROLLBACK");
}
const retiredTables = [
  "App_RoutingForms_Form",
  "App_RoutingForms_FormResponse",
  "App_RoutingForms_IncompleteBookingActions",
  "App_RoutingForms_QueuedFormResponse",
  "PendingRoutingTrace",
  "RoutingFormResponseDenormalized",
  "RoutingFormResponseField",
  "RoutingTrace",
  "WorkflowsOnRoutingForms",
  "WorkflowStepTranslation",
  "WorkflowReminder",
  "WorkflowsOnEventTypes",
  "WorkflowsOnTeams",
  "WorkflowOptOutContact",
  "AIPhoneCallConfiguration",
  "WorkflowStep",
  "Workflow",
  "Impersonations",
  "DomainWideDelegation",
];
for (const table of retiredTables) {
  test(`populated retired ${table} prevents admission without deleting its row`, async () => {
    await client.query(
      `CREATE TABLE ${quoted(table)} (value text); INSERT INTO ${quoted(table)} VALUES ('fixture-private-value')`
    );
    await denied();
    assert.equal(
      (await client.query(`SELECT value FROM ${quoted(table)}`)).rows[0].value,
      "fixture-private-value"
    );
  });
}
test("new database and empty legacy relations are admitted", async () => {
  await client.query(sql);
  for (const table of retiredTables) await client.query(`CREATE TABLE ${quoted(table)} (value integer)`);
  await client.query(sql);
  assert.equal(
    (await client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'")).rows[0]
      .count,
    retiredTables.length
  );
});
for (const [table, column, type, value] of [
  ["EventType", "redirectUrlOnNoRoutingFormResponse", "text", "https://fixture.invalid"],
  ["WrongAssignmentReport", "routingFormId", "text", "fixture-form"],
  ["users", "whitelistWorkflows", "boolean", true],
  ["users", "disableImpersonation", "boolean", true],
  ["Membership", "disableImpersonation", "boolean", true],
  ["BookingReference", "domainWideDelegationCredentialId", "integer", 7],
  ["DestinationCalendar", "domainWideDelegationCredentialId", "integer", 7],
  ["SelectedCalendar", "domainWideDelegationCredentialId", "integer", 7],
  ["AssignmentReason", "reasonEnum", "text", "ROUTING_FORM_ROUTING"],
  ["AssignmentReason", "reasonEnum", "text", "ROUTING_FORM_ROUTING_FALLBACK"],
]) {
  test(`non-default legacy ${table}.${column} blocks cleanup`, async () => {
    await client.query(`CREATE TABLE ${quoted(table)} (${quoted(column)} ${type})`);
    await client.query(`INSERT INTO ${quoted(table)} VALUES ($1)`, [value]);
    await denied();
    assert.equal(
      (await client.query(`SELECT ${quoted(column)} AS value FROM ${quoted(table)}`)).rows[0].value,
      value
    );
  });
}
for (const trigger of ["ROUTING_FORM_FALLBACK_HIT", "INSTANT_MEETING"]) {
  test(`existing ${trigger} subscriptions cannot be silently stripped`, async () => {
    await client.query(
      'CREATE TYPE "WebhookTriggerEvents" AS ENUM (\'BOOKING_CREATED\',\'ROUTING_FORM_FALLBACK_HIT\',\'INSTANT_MEETING\'); CREATE TABLE "Webhook" ("eventTriggers" "WebhookTriggerEvents"[])'
    );
    await client.query('INSERT INTO "Webhook" VALUES (ARRAY[$1]::"WebhookTriggerEvents"[])', [trigger]);
    await denied();
    assert.deepEqual(
      (await client.query('SELECT "eventTriggers"::text[] AS triggers FROM "Webhook"')).rows[0].triggers,
      [trigger]
    );
  });
}
test("default flags and retained business rows remain unchanged", async () => {
  await client.query(
    'CREATE TABLE users (id integer, email text, "disableImpersonation" boolean, "whitelistWorkflows" boolean); INSERT INTO users VALUES (7,\'fixture@example.test\',false,false); CREATE TABLE "Booking" (uid text); INSERT INTO "Booking" VALUES (\'keep-this-booking\'); CREATE TABLE "Webhook" ("eventTriggers" text[]); INSERT INTO "Webhook" VALUES (ARRAY[\'BOOKING_CREATED\'])'
  );
  const before = (await client.query("SELECT to_jsonb(u) AS value FROM users u")).rows;
  await client.query(sql);
  assert.deepEqual((await client.query("SELECT to_jsonb(u) AS value FROM users u")).rows, before);
  assert.equal((await client.query('SELECT uid FROM "Booking"')).rows[0].uid, "keep-this-booking");
});
test("row-level security cannot hide retired records from the preflight", async () => {
  await client.query(
    'CREATE TABLE "Workflow" (value integer); ALTER TABLE "Workflow" ENABLE ROW LEVEL SECURITY'
  );
  await denied(/row-security/);
});
test("unexpected legacy column types fail closed rather than skipping the check", async () => {
  await client.query(
    "CREATE TABLE users (\"disableImpersonation\" text); INSERT INTO users VALUES ('unexpected')"
  );
  await denied(/operator does not exist/);
});
test("preflight executes read-only, including after deliberate SQL mutation", async () => {
  await client.query("CREATE TABLE sentinel (value integer); INSERT INTO sentinel VALUES (1)");
  const mutant = sql.replace("COMMIT;", "INSERT INTO public.sentinel VALUES (2); COMMIT;");
  await assert.rejects(client.query(mutant), /read-only transaction/);
  await client.query("ROLLBACK");
  assert.deepEqual((await client.query("SELECT value FROM sentinel")).rows, [{ value: 1 }]);
});
