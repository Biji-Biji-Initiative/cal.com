// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { before, beforeEach, after, test } = require("node:test");
const ts = require("typescript");
const { connectFixture, sourceModules, root } = require("./tasker-fixture.cjs");
let db, service, bookings, audits, Access, PermissionError, viewer, current, previous, owner, foreign;
let relatedReads, allReads, enriched;

// Execute exact native method bodies without loading unrelated repository
// methods/telemetry. SQL, access decisions, actor parsing and Prisma stay real.
function nativeMethods(file, className, names, includeConstructor = false, bindings = {}) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const classes = source.statements
    .filter(ts.isClassDeclaration)
    .filter((node) => node.name?.text === className);
  assert.equal(classes.length, 1);
  const members = classes[0].members.filter(
    (node) =>
      (includeConstructor && ts.isConstructorDeclaration(node)) || names.includes(node.name?.getText(source))
  );
  for (const name of names.filter((name) => name !== "getAuthorizedRescheduledLogs"))
    assert.equal(members.filter((node) => node.name?.getText(source) === name).length, 1);
  const compiled = ts.transpileModule(
    `class NativeMethods { ${members.map((node) => node.getText(source)).join("\n")} }`,
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      reportDiagnostics: true,
    }
  );
  assert.deepEqual(compiled.diagnostics, []);
  return new Function(...Object.keys(bindings), `${compiled.outputText}\nreturn NativeMethods;`)(
    ...Object.values(bindings)
  );
}

before(async () => {
  db = await connectFixture();
  const load = sourceModules(db).load;
  ({ BookingAuditAccessService: Access, BookingAuditPermissionError: PermissionError } = load(
    "packages/features/booking-audit/lib/service/BookingAuditAccessService.ts"
  ));
  const Booking = nativeMethods(
    "packages/features/bookings/repositories/BookingRepository.ts",
    "BookingRepository",
    ["findByUidIncludeEventType", "getFromRescheduleUid"],
    true
  );
  const Membership = nativeMethods(
    "packages/features/membership/repositories/MembershipRepository.ts",
    "MembershipRepository",
    ["hasMembership"],
    true
  );
  bookings = new Booking(db);
  service = new Access({ bookingRepository: bookings, membershipRepository: new Membership(db) });
  const Audit = load(
    "packages/features/booking-audit/lib/repository/PrismaBookingAuditRepository.ts"
  ).PrismaBookingAuditRepository;
  audits = new Audit({ prismaClient: db });
  const Viewer = nativeMethods(
    "packages/features/booking-audit/lib/service/BookingAuditViewerService.ts",
    "BookingAuditViewerService",
    ["getAuditLogsForBooking", "getAuthorizedRescheduledLogs"],
    false,
    { BookingAuditPermissionError: PermissionError }
  );
  viewer = new Viewer();
  const related = audits.findRescheduledLogsOfBooking.bind(audits);
  const all = audits.findAllForBooking.bind(audits);
  audits.findRescheduledLogsOfBooking = (uid) => {
    relatedReads++;
    return related(uid);
  };
  audits.findAllForBooking = (uid) => {
    allReads++;
    return all(uid);
  };
  Object.assign(viewer, {
    accessService: service,
    bookingRepository: bookings,
    bookingAuditRepository: audits,
    collectDataRequirements: (logs) => {
      enriched.push(...logs.map((log) => log.id));
      return {};
    },
    buildEnrichmentDataStore: async () => ({}),
    enrichAuditLog: async (log) => ({ id: log.id }),
    buildRescheduledFromLog: async ({ rescheduledLogs }) => ({ id: rescheduledLogs[0].id }),
  });
});

beforeEach(async () => {
  await db.bookingAudit.deleteMany();
  await db.auditActor.deleteMany();
  await db.booking.deleteMany();
  await db.eventType.deleteMany();
  await db.membership.deleteMany();
  await db.team.deleteMany();
  await db.user.deleteMany();
  owner = await db.user.create({ data: { email: "owner@fixture.test" } });
  foreign = await db.user.create({ data: { email: "foreign@fixture.test" } });
  const actor = await db.auditActor.create({ data: { type: "USER", userUuid: owner.uuid } });
  const org = await db.team.create({ data: { name: "Own organization", isOrganization: true } });
  const other = await db.team.create({ data: { name: "Foreign organization", isOrganization: true } });
  for (const [userId, teamId] of [
    [owner.id, org.id],
    [foreign.id, other.id],
  ])
    await db.membership.create({ data: { userId, teamId, accepted: true, role: "MEMBER" } });
  for (const [uid, teamId] of [
    ["previous", other.id],
    ["current", org.id],
  ]) {
    const event = await db.eventType.create({ data: { title: uid, slug: uid, length: 30, teamId } });
    await db.booking.create({
      data: {
        uid,
        userId: owner.id,
        eventTypeId: event.id,
        title: uid,
        startTime: new Date(0),
        endTime: new Date(3600000),
        ...(uid === "current" ? { fromReschedule: "previous" } : {}),
      },
    });
    await audits.create({
      bookingUid: uid,
      actorId: actor.id,
      type: "RECORD_UPDATED",
      action: uid === "current" ? "CREATED" : "RESCHEDULED",
      timestamp: new Date(0),
      source: "WEBAPP",
      operationId: `synthetic-${uid}`,
      data: null,
    });
  }
  current = await db.bookingAudit.findFirstOrThrow({ where: { bookingUid: "current" } });
  previous = await db.bookingAudit.findFirstOrThrow({ where: { bookingUid: "previous" } });
  relatedReads = allReads = 0;
  enriched = [];
});
after(async () => {
  if (db) await db.$disconnect();
});
const request = () =>
  viewer.getAuditLogsForBooking({
    bookingUid: "current",
    userId: owner.id,
    userEmail: owner.email,
    userTimeZone: "UTC",
    organizationId: null,
  });
const visible = async () => (await request()).auditLogs.map((log) => log.id);

test("authorized predecessor uses real native access/repository and retains both audit records", async () => {
  assert.deepEqual(await visible(), [current.id, previous.id]);
  assert.equal(relatedReads, 1);
  assert.deepEqual(enriched, [current.id, previous.id]);
});

test("foreign-owner predecessor is never read or enriched and all persisted history remains intact", async () => {
  await db.booking.update({ where: { uid: "previous" }, data: { userId: foreign.id } });
  const before = {
    bookings: await db.booking.findMany(),
    audits: await db.bookingAudit.findMany(),
    actors: await db.auditActor.findMany(),
  };
  assert.deepEqual(await visible(), [current.id]);
  assert.equal(relatedReads, 0);
  assert.deepEqual(enriched, [current.id]);
  assert.deepEqual(await db.booking.findMany(), before.bookings);
  assert.deepEqual(await db.bookingAudit.findMany(), before.audits);
  assert.deepEqual(await db.auditActor.findMany(), before.actors);
});

for (const state of ["deleted", "ownerless"]) {
  test(`${state} predecessor cannot expose its retained audit`, async () => {
    if (state === "deleted") await db.booking.delete({ where: { uid: "previous" } });
    else await db.booking.update({ where: { uid: "previous" }, data: { userId: null } });
    assert.deepEqual(await visible(), [current.id]);
    assert.equal(relatedReads, 0);
    assert.deepEqual(enriched, [current.id]);
    assert.equal(await db.bookingAudit.count(), 2);
  });
}

test("each request rechecks changed predecessor ownership instead of trusting the reschedule link", async () => {
  assert.deepEqual(await visible(), [current.id, previous.id]);
  await db.booking.update({ where: { uid: "previous" }, data: { userId: foreign.id } });
  relatedReads = 0;
  enriched = [];
  assert.deepEqual(await visible(), [current.id]);
  assert.equal(relatedReads, 0);
  assert.deepEqual(enriched, [current.id]);
});

test("primary authorization remains mandatory before either audit query", async () => {
  await db.booking.update({ where: { uid: "current" }, data: { userId: foreign.id } });
  await assert.rejects(request(), PermissionError);
  assert.equal(allReads, 0);
  assert.equal(relatedReads, 0);
  assert.deepEqual(enriched, []);
});

test("a missing reschedule link performs no predecessor read", async () => {
  await db.booking.update({ where: { uid: "current" }, data: { fromReschedule: null } });
  assert.deepEqual(await visible(), [current.id]);
  assert.equal(relatedReads, 0);
});
