// SPDX-License-Identifier: MIT
// Actual EventManager/CalendarManager/Google+Microsoft adapter source and generated
// Prisma against private PostgreSQL. Only registry/auth/rendering and network
// responses are controlled. Never uses a configured application database.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, beforeEach, after, test } = require("node:test");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const f = require("./calendar-provider-fixture.cjs");
let db,
  EventManager,
  safe = false;
const ids = [];
before(async () => {
  const socket = process.env.CAL_ENTERPRISE_TEST_SOCKET,
    data = process.env.CAL_ENTERPRISE_TEST_PGDATA;
  assert.ok(socket && data);
  assert.equal(path.dirname(socket), path.dirname(data));
  assert.match(path.basename(path.dirname(socket)), /^cal-enterprise-/);
  db = new PrismaClient({
    errorFormat: "minimal",
    adapter: new PrismaPg({
      host: socket,
      port: 55439,
      user: "cal_enterprise_test",
      database: "postgres",
      max: 4,
    }),
  });
  const identity = await db.$queryRawUnsafe(
    "SELECT current_setting('data_directory') AS directory,current_user::text AS actor"
  );
  assert.equal(identity[0].directory, data);
  assert.equal(identity[0].actor, "cal_enterprise_test");
  assert.equal(await db.user.count(), 0);
  safe = true;
  EventManager = f.eventManager(db);
  f.wire.listen({ onUnhandledRequest: "error" });
});
after(async () => {
  f.wire.close();
  if (db) await db.$disconnect();
});
beforeEach(async () => {
  assert.ok(safe);
  f.reset();
  ids.length = 0;
  await db.$executeRawUnsafe('TRUNCATE "users", "Booking", "Credential" RESTART IDENTITY CASCADE');
  for (const id of [11, 12])
    await db.user.create({ data: { id, email: `person${id}@fixture.test`, username: `person-${id}` } });
  await db.credential.create({ data: { id: 7, userId: 11, type: "google_calendar", key: {} } });
  await db.credential.create({ data: { id: 8, userId: 12, type: "office365_calendar", key: {} } });
  f.adapter = (credential) => {
    ids.push(credential.id);
    return credential.type === "google_calendar"
      ? f.google.default(credential)
      : credential.type === "office365_calendar"
        ? f.office.default(credential)
        : null;
  };
});
const account = async (id) => ({
  ...(await db.credential.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      key: true,
      type: true,
      invalid: true,
      userId: true,
      teamId: true,
      appId: true,
      user: { select: { email: true } },
    },
  })),
  delegatedTo: null,
  delegationCredentialId: null,
});
const manager = async (accounts = [7]) =>
  new EventManager({ credentials: await Promise.all(accounts.map(account)), destinationCalendar: null });
const createBooking = async (id = 1) =>
  db.booking.create({
    data: {
      id,
      uid: `provider-booking-${id}`,
      userId: 11,
      title: "Synthetic existing appointment",
      startTime: new Date("2030-01-01T10:00:00Z"),
      endTime: new Date("2030-01-01T10:30:00Z"),
      location: "Shared room",
    },
  });
const reference = async (changes = {}) =>
  db.bookingReference.create({
    data: {
      type: "google_calendar",
      uid: "stored-event",
      credentialId: 7,
      externalCalendarId: "original-calendar",
      bookingId: 1,
      ...changes,
    },
  });
const snapshot = async () => ({
  bookings: await db.booking.findMany({ orderBy: { id: "asc" } }),
  references: await db.bookingReference.findMany({ orderBy: { id: "asc" } }),
  credentials: await db.credential.findMany({
    select: { id: true, userId: true, type: true },
    orderBy: { id: "asc" },
  }),
});
test("real persisted reference survives changed default during reschedule and cancellation dispatch", async () => {
  await createBooking();
  await reference();
  const before = await snapshot();
  const m = await manager();
  const result = await m.reschedule(f.event(), "provider-booking-1");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].success, true);
  assert.equal(result.referencesToCreate[0].externalCalendarId, "original-calendar");
  assert.equal(result.referencesToCreate[0].credentialId, 7);
  assert.match(f.calls[0].url.pathname, /original-calendar\/events\/stored-event$/);
  f.status = 204;
  const failures = await m.deleteEventsAndMeetings({
    event: f.event(),
    bookingReferences: result.referencesToCreate,
  });
  assert.deepEqual(failures, []);
  assert.equal(f.calls[1].method, "DELETE");
  assert.match(f.calls[1].url.pathname, /original-calendar\/events\/stored-event$/);
  assert.deepEqual(await snapshot(), before);
});
test("a missing explicitly bound account cannot reuse the preceding reference account", async () => {
  await createBooking();
  await reference();
  await reference({
    type: "office365_calendar",
    uid: "second-event",
    credentialId: 8,
    externalCalendarId: "second-calendar",
  });
  await db.credential.update({ where: { id: 8 }, data: { invalid: true } });
  const m = await manager([7]);
  const result = await m.reschedule(f.event(), "provider-booking-1");
  assert.equal(result.results.length, 2);
  assert.equal(result.results.filter((r) => r.success).length, 1);
  assert.deepEqual(ids, [7]);
  assert.equal(f.calls.length, 1);
  assert.equal(result.results.find((r) => !r.success).type, "office365_calendar");
});
test("a credential of the wrong provider is never passed to that reference", async () => {
  await createBooking();
  await reference({ credentialId: 8 });
  const result = await (await manager([7, 8])).reschedule(f.event(), "provider-booking-1");
  assert.equal(result.results[0].success, false);
  assert.deepEqual(ids, []);
  assert.equal(f.calls.length, 0);
});
test("unbound legacy references cannot fan out across multiple accounts", async () => {
  await createBooking();
  await reference({ credentialId: null });
  await db.credential.create({ data: { id: 9, userId: 11, type: "google_calendar", key: {} } });
  const result = await (await manager([7, 9])).reschedule(f.event(), "provider-booking-1");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].success, false);
  assert.equal(f.calls.length, 0);
});
test("one unambiguous legacy account remains compatible", async () => {
  await createBooking();
  await reference({ credentialId: null });
  const result = await (await manager()).reschedule(f.event(), "provider-booking-1");
  assert.equal(result.results[0].success, true);
  assert.deepEqual(ids, [7]);
});
test("resource failure is isolated and does not prevent another bound provider result", async () => {
  await createBooking();
  await reference();
  await reference({
    type: "office365_calendar",
    credentialId: 8,
    uid: "office-event",
    externalCalendarId: "office-calendar",
  });
  f.adapter = (credential) => {
    ids.push(credential.id);
    if (credential.id === 7) throw new Error("Synthetic auth failure");
    return f.office.default(credential);
  };
  const result = await (await manager([7, 8])).reschedule(f.event(), "provider-booking-1");
  assert.equal(result.results.filter((r) => !r.success).length, 1);
  assert.equal(result.results.filter((r) => r.success).length, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url.hostname, "graph.microsoft.com");
});
test("failed create result cannot mint a blank BookingReference", async () => {
  f.adapter = { createEvent: async () => undefined };
  const result = await (await manager()).create(f.event());
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].success, false);
  assert.deepEqual(result.referencesToCreate, []);
  assert.equal(await db.bookingReference.count(), 0);
});
test("known successful creation preserves provider and calendar binding", async () => {
  const result = await (await manager()).create(f.event());
  assert.equal(result.results[0].success, true);
  assert.equal(result.referencesToCreate[0].uid, "stored-event");
  assert.equal(result.referencesToCreate[0].credentialId, 7);
  assert.equal(result.referencesToCreate[0].externalCalendarId, "new-default");
});
test("failed location update is reported without fabricating an empty replacement reference", async () => {
  await createBooking();
  await reference();
  const before = await snapshot();
  f.status = 403;
  const result = await (await manager()).updateLocation(f.event(), {
    id: 1,
    userId: 11,
    references: await db.bookingReference.findMany(),
  });
  assert.equal(result.results[0].success, false);
  assert.deepEqual(result.referencesToCreate, []);
  assert.deepEqual(await snapshot(), before);
});
test("cleanup refusal is retained instead of thrown away and old references remain", async () => {
  await createBooking();
  const ref = await reference();
  const before = await snapshot();
  f.status = 404;
  const failures = await (await manager()).deleteEventsAndMeetings({
    event: f.event(),
    bookingReferences: [ref],
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].success, false);
  assert.match(failures[0].calError, /not confirmed/);
  assert.deepEqual(await snapshot(), before);
});
test("missing adapter, unsupported reference and blank target cannot be a cleanup receipt", async () => {
  f.adapter = null;
  const failures = await (await manager()).deleteEventsAndMeetings({
    event: f.event(),
    bookingReferences: [
      { type: "google_calendar", uid: "event", credentialId: 7 },
      { type: "unknown", uid: "event" },
      { type: "google_calendar", uid: "", credentialId: 7 },
    ],
  });
  assert.equal(failures.length, 3);
  assert.equal(f.calls.length, 0);
});
test("reassignment preserves cleanup failure beside new provider success", async () => {
  await createBooking();
  await reference();
  f.adapter = {
    deleteEvent: async () => {
      throw new Error("Synthetic refusal");
    },
    createEvent: async () => ({ id: "new-event" }),
  };
  const result = await (await manager()).reschedule(f.event(), "provider-booking-1", undefined, true);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].success, true);
  assert.equal(result.results[1].success, false);
  assert.deepEqual(
    result.referencesToCreate.map((ref) => ref.uid),
    ["new-event"]
  );
});
test("replacement merge never deletes the old resource until all target updates resolve", async () => {
  await createBooking();
  await createBooking(2);
  await reference();
  await reference({ bookingId: 2, uid: "replacement-event" });
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const sequence = [];
  f.adapter = {
    updateEvent: async () => {
      sequence.push("updating");
      await wait;
      sequence.push("updated");
      return { id: "replacement-event" };
    },
    deleteEvent: async () => {
      sequence.push("deleted");
    },
  };
  const operation = (await manager()).reschedule(f.event(), "provider-booking-1", 2);
  while (!sequence.length) await new Promise(setImmediate);
  assert.deepEqual(sequence, ["updating"]);
  release();
  await operation;
  assert.deepEqual(sequence, ["updating", "updated", "deleted"]);
});
test("failed replacement and identical target never cause old-resource deletion", async () => {
  await createBooking();
  await createBooking(2);
  await reference();
  await reference({ bookingId: 2, uid: "replacement-event" });
  const deleted = [];
  f.adapter = {
    updateEvent: async () => undefined,
    deleteEvent: async (id) => {
      deleted.push(id);
    },
  };
  const m = await manager();
  const first = await m.reschedule(f.event(), "provider-booking-1", 2);
  assert.equal(first.results[0].success, false);
  assert.deepEqual(deleted, []);
  await db.bookingReference.updateMany({ where: { bookingId: 2 }, data: { uid: "stored-event" } });
  f.adapter = {
    updateEvent: async () => ({ id: "stored-event" }),
    deleteEvent: async (id) => {
      deleted.push(id);
    },
  };
  await m.reschedule(f.event(), "provider-booking-1", 2);
  assert.deepEqual(deleted, []);
});
