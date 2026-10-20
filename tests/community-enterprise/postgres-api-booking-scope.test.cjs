// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { before, beforeEach, after, test } = require("node:test");
const ts = require("typescript");
const { randomBytes } = require("node:crypto");
const nest = require("@nestjs/common");
const { ConfigService } = require("@nestjs/config");
const { connectFixture, sourceModules, root } = require("./tasker-fixture.cjs");
const { createApiRuntime, fixtureModules } = require("./api-runtime-fixture.cjs");
const { bookingListing, compile } = require("./booking-listing-fixture.cjs");
const { eventAccessFixture } = require("./event-access-fixture.cjs");
let db,
  runtime,
  lifecycle,
  owner,
  other,
  team,
  foreign,
  key,
  exportsCalled,
  access,
  listing,
  primarySql,
  staleSqlReads,
  eventAccess,
  nativeBookings;
const api = "apps/api/v2/src/";
const booking = `${api}platform/bookings/2024-08-13/`;

// Run exact native methods/decorators, excluding unrelated provider/bootstrap
// imports. Access policy, SQL, Passport and HTTP dispatch are never substituted.
function native(file, className, names, bindings = {}) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const declaration = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === className
  );
  assert.ok(declaration && ts.isClassDeclaration(declaration));
  const members = declaration.members.filter((node) =>
    names.includes(ts.isConstructorDeclaration(node) ? "constructor" : node.name?.getText(source))
  );
  assert.equal(members.length, names.length);
  const result = ts.transpileModule(
    `class Native { ${members.map((node) => node.getText(source)).join("\n")} }`,
    {
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    }
  );
  assert.deepEqual(result.diagnostics, []);
  return new Function(...Object.keys(bindings), `${result.outputText}\nreturn Native;`)(
    ...Object.values(bindings)
  );
}

before(async () => {
  db = await connectFixture();
  const Repository = native(
    "packages/features/bookings/repositories/BookingRepository.ts",
    "BookingRepository",
    ["findByUidIncludeEventType", "findByIdIncludeEventType"]
  );
  const state = {
    primary: { prisma: db },
    replica: {
      prisma: new Proxy(
        {},
        {
          get() {
            throw new Error("Authorization must use primary");
          },
        }
      ),
    },
    replicaReads: 0,
    config: new ConfigService({
      api: { keyPrefix: "cal_" },
      next: { authSecret: randomBytes(32).toString("hex") },
    }),
  };
  const { load } = fixtureModules(state);
  const { PermissionCheckService } = load(
    path.join(root, "packages/features/community-enterprise/authorization/PermissionCheckService.ts")
  );
  const { MembershipRole } = sourceModules(db).load("packages/prisma/generated/prisma/enums.ts");
  const BookingAccessService = native(
    "packages/features/bookings/services/BookingAccessService.ts",
    "BookingAccessService",
    ["constructor", "isUserAHost", "doesUserIdHaveAccessToBooking"],
    {
      PermissionCheckService,
      MembershipRole,
      BookingRepository: class extends Repository {
        constructor(client) {
          super();
          this.prismaClient = client;
        }
      },
    }
  );
  access = new BookingAccessService(db);
  lifecycle = load(path.join(root, "packages/features/community-enterprise/api-keys/ApiKeyLifecycle.ts"));
  listing = bookingListing(db);
  const { KyselyWriteService } = load(path.join(root, api, "modules/kysely/kysely-write.service.ts"));
  const url = new URL("postgresql://cal_enterprise_test@localhost/postgres");
  url.searchParams.set("host", process.env.CAL_ENTERPRISE_TEST_SOCKET);
  url.searchParams.set("port", "55439");
  primarySql = new KyselyWriteService(new ConfigService({ db: { writeUrl: url.toString() } }));
  runtime = await createApiRuntime(state, {
    configure(app) {
      app.useGlobalPipes(new nest.ValidationPipe({ whitelist: true, transform: true }));
    },
    platformLibraries: { BookingAccessService },
    extend({ load, tokens }) {
      const { ApiAuthGuard } = load(path.join(root, api, "modules/auth/guards/api-auth/api-auth.guard.ts"));
      const { PermissionsGuard } = load(
        path.join(root, api, "modules/auth/guards/permissions/permissions.guard.ts")
      );
      const { Permissions } = load(
        path.join(root, api, "modules/auth/decorators/permissions/permissions.decorator.ts")
      );
      const { GetUser } = load(
        path.join(root, api, "modules/auth/decorators/get-user/get-user.decorator.ts")
      );
      const { BookingUidGuard } = load(path.join(root, booking, "guards/booking-uid.guard.ts"));
      const { BookingPbacGuard } = load(path.join(root, booking, "guards/booking-pbac.guard.ts"));
      eventAccess = eventAccessFixture({ native, load, db, root });
      const { OptionalApiAuthGuard } = load(
        path.join(root, api, "modules/auth/guards/optional-api-auth/optional-api-auth.guard.ts")
      );
      const { GetOptionalUser } = load(
        path.join(root, api, "modules/auth/decorators/get-optional-user/get-optional-user.decorator.ts")
      );
      const Service = native(
        `${booking}services/bookings.service.ts`,
        "BookingsService_2024_08_13",
        ["getCalendarLinks", "getBookings", "getBooking"],
        {
          ...nest,
          getAllUserBookings: listing.getAllUserBookings,
          getPagination: load(path.join(root, api, "lib/pagination/pagination.ts")).getPagination,
          getTranslation: async () => (key) => key,
          getCalendarLinks: ({ booking }) => {
            exportsCalled++;
            return [{ label: booking.uid, link: "https://calendar.example.test/fixture.ics" }];
          },
        }
      );
      const service = new Service();
      nativeBookings = service;
      service.eventTypeAccessService = eventAccess.access;
      service.prismaReadService = { prisma: db };
      service.kyselyWriteService = primarySql;
      service.kyselyReadService = {
        kysely: new Proxy(primarySql.kysely, {
          get(target, name) {
            if (name === "transaction") staleSqlReads++;
            const value = Reflect.get(target, name);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      };
      const Input = native(`${booking}services/input.service.ts`, "InputBookingsService_2024_08_13", [
        "transformGetBookingsFilters",
        "transformGetBookingsSort",
      ]);
      service.inputService = new Input();
      const NativeBookingRepository = native(
        `${booking}repositories/bookings.repository.ts`,
        "BookingsRepository_2024_08_13",
        [
          "getByUidWithAttendeesAndUserAndEvent",
          "getByIdsWithAttendeesWithBookingSeatAndUserAndEvent",
          "getByFromReschedule",
          "getByUid",
          "getByUidWithAttendeesWithBookingSeatAndUserAndEvent",
          "getRecurringByUidWithAttendeesAndUserAndEvent",
        ]
      );
      const NativeEvents = native(
        "apps/api/v2/src/platform/event-types/event-types_2024_06_14/event-types.repository.ts",
        "EventTypesRepository_2024_06_14",
        ["getEventTypeByIdIncludeUsersAndTeam"]
      );
      service.bookingsRepository = Object.assign(new NativeBookingRepository(), { dbRead: { prisma: db } });
      service.eventTypesRepository = Object.assign(new NativeEvents(), { dbRead: { prisma: db } });
      const types = load(path.join(root, "packages/platform/types/index.ts"));
      const output = compile(`${booking}services/output.service.ts`, {
        "@/platform/bookings/2024-08-13/repositories/bookings.repository": {
          BookingsRepository_2024_08_13: NativeBookingRepository,
        },
        "@/lib/safe-parse/default-responses-booking": load(
          path.join(root, api, "lib/safe-parse/default-responses-booking.ts")
        ),
        "@/lib/safe-parse/safe-parse": load(path.join(root, api, "lib/safe-parse/safe-parse.ts")),
        "@nestjs/common": nest,
        "class-transformer": require("class-transformer"),
        luxon: require("luxon"),
        zod: require("zod"),
        "@calcom/platform-libraries": listing.schemas,
        "@calcom/platform-types": types,
      });
      service.outputService = new output.OutputBookingsService_2024_08_13(service.bookingsRepository);
      const Controller = native(
        `${booking}controllers/bookings.controller.ts`,
        "BookingsController_2024_08_13",
        ["getCalendarLinks", "getBookings", "getBooking"],
        {
          ...nest,
          ...require("@nestjs/swagger"),
          GetBookingsInput_2024_08_13: types.GetBookingsInput_2024_08_13,
          ApiAuthGuard,
          PermissionsGuard,
          BookingUidGuard,
          BookingPbacGuard,
          OptionalApiAuthGuard,
          GetOptionalUser,
          OPTIONAL_X_CAL_CLIENT_ID_HEADER: {},
          OPTIONAL_X_CAL_SECRET_KEY_HEADER: {},
          OPTIONAL_API_KEY_OR_ACCESS_TOKEN_HEADER: {},
          GetUser,
          Permissions,
          BOOKING_READ: load(path.join(root, "packages/platform/constants/permissions.ts")).BOOKING_READ,
          API_KEY_OR_ACCESS_TOKEN_HEADER: {},
          SUCCESS_STATUS: "success",
        }
      );
      nest.Controller("v2/bookings")(Controller);
      // The bounded controller has its original method/decorators and service.
      Controller.prototype.bookingsService = service;
      Controller.prototype.usersService = { getUserMainProfile: () => null };
      return {
        controllers: [Controller, eventAccess.Controller],
        providers: [
          PermissionsGuard,
          OptionalApiAuthGuard,
          BookingUidGuard,
          BookingPbacGuard,
          { provide: tokens.TokensRepository, useValue: {} },
          { provide: tokens.OAuthClientRepository, useValue: {} },
        ],
      };
    },
  });
});

beforeEach(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS require_serializable_native_delete ON "EventType"');
  for (const model of [
    "enterpriseAuditEvent",
    "apiKey",
    "booking",
    "eventType",
    "membership",
    "rolePermission",
    "role",
    "team",
    "user",
  ])
    await db[model].deleteMany();
  owner = await db.user.create({ data: { email: "owner@fixture.test" } });
  other = await db.user.create({ data: { email: "other@fixture.test" } });
  team = await db.team.create({ data: { name: "Allowed" } });
  foreign = await db.team.create({ data: { name: "Foreign" } });
  for (const teamId of [team.id, foreign.id])
    await db.membership.create({ data: { userId: owner.id, teamId, role: "ADMIN", accepted: true } });
  for (const [uid, teamId, userId] of [
    ["allowed", team.id, owner.id],
    ["foreign", foreign.id, owner.id],
    ["unrelated", team.id, other.id],
    ["personal", null, owner.id],
  ]) {
    const event = await db.eventType.create({ data: { title: uid, slug: uid, length: 30, teamId } });
    await db.booking.create({
      data: {
        uid,
        userId,
        eventTypeId: event.id,
        title: uid,
        responses: { name: "Fixture", email: "guest@fixture.test" },
        metadata: {},
        startTime: new Date(0),
        endTime: new Date(3600000),
      },
    });
  }
  key = await lifecycle.createApiKey(db, owner.id, { teamId: team.id });
  exportsCalled = 0;
  staleSqlReads = 0;
});
after(async () => {
  if (runtime) await runtime.app.close();
  if (primarySql) await primarySql.onModuleDestroy();
  if (db) await db.$disconnect();
});

async function request(uid, token = key) {
  const response = await fetch(`${runtime.origin}/v2/bookings/${uid}/calendar-links`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}
test("same-team organizer exports through actual native route and retained policy", async () => {
  const result = await request("allowed");
  assert.equal(result.status, 200);
  assert.equal(exportsCalled, 1);
});
test("a second administered team does not widen the first team's key", async () => {
  assert.equal((await request("foreign")).status, 403);
  assert.equal(exportsCalled, 0);
});
test("team key cannot export the same owner's personal booking", async () => {
  assert.equal((await request("personal")).status, 403);
  assert.equal(exportsCalled, 0);
});
test("personal key preserves organizer authority but refuses unrelated bookings", async () => {
  const personal = await lifecycle.createApiKey(db, other.id, {});
  assert.equal((await request("allowed", personal)).status, 403);
  assert.equal((await request("unrelated", personal)).status, 200);
  assert.equal(exportsCalled, 1);
});
test("team administrator retains existing team-booking read policy", async () => {
  assert.equal((await request("unrelated")).status, 200);
  assert.equal(exportsCalled, 1);
});
test("revoked key is rejected before export even for its organizer", async () => {
  await db.apiKey.deleteMany();
  assert.equal((await request("allowed")).status, 401);
  assert.equal(exportsCalled, 0);
});
test("disabled owner is rejected before export", async () => {
  await db.user.update({ where: { id: owner.id }, data: { locked: true } });
  assert.equal((await request("allowed")).status, 401);
  assert.equal(exportsCalled, 0);
});
test("unaccepted membership cannot authorize the key or export", async () => {
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { accepted: false },
  });
  assert.equal((await request("allowed")).status, 401);
  assert.equal(exportsCalled, 0);
});
test("resource moves are evaluated on the next request", async () => {
  assert.equal((await request("allowed")).status, 200);
  await db.eventType.updateMany({ where: { slug: "allowed" }, data: { teamId: foreign.id } });
  assert.equal((await request("allowed")).status, 403);
  assert.equal(exportsCalled, 1);
});
test("missing booking never reaches calendar generation", async () => {
  assert.equal((await request("missing")).status, 403);
  assert.equal(exportsCalled, 0);
});

test("retained domain authority refuses stale scope membership even for organizer", async () => {
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { accepted: false },
  });
  assert.equal(
    await access.doesUserIdHaveAccessToBooking({
      userId: owner.id,
      bookingUid: "allowed",
      apiKeyTeamId: team.id,
    }),
    false
  );
});
test("managed child uses its native parent team, direct foreign team takes precedence", async () => {
  const parent = await db.eventType.create({
    data: { title: "Managed", slug: "managed", length: 30, teamId: team.id },
  });
  await db.eventType.updateMany({ where: { slug: "personal" }, data: { parentId: parent.id } });
  assert.equal((await request("personal")).status, 200);
  await db.eventType.updateMany({ where: { slug: "personal" }, data: { teamId: foreign.id } });
  assert.equal((await request("personal")).status, 403);
  assert.equal(exportsCalled, 1);
});
test("invalid internal scope never becomes an omitted Prisma filter", async () => {
  for (const apiKeyTeamId of [0, -1, NaN, 1.5])
    assert.equal(
      await access.doesUserIdHaveAccessToBooking({ userId: owner.id, bookingUid: "allowed", apiKeyTeamId }),
      false
    );
});

async function list(query = "", token = key) {
  const response = await fetch(`${runtime.origin}/v2/bookings?status=past&${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}
const uids = (result) => result.body.data.map((booking) => booking.uid).sort();
const sqlList = (changes = {}) =>
  listing.getBookings({
    user: { id: owner.id, email: owner.email, apiKeyTeamId: team.id, ...changes },
    filters: {},
    prisma: db,
    kysely: primarySql.kysely,
    bookingListingByStatus: ["past"],
    take: 100,
    skip: 0,
  });
test("native list intersects team key with rows and count", async () => {
  const result = await list();
  assert.equal(result.status, 200);
  assert.deepEqual(uids(result), ["allowed", "unrelated"]);
  assert.equal(result.body.pagination.totalItems, 2);
});
test("native list pagination cannot count or page through foreign bookings", async () => {
  const result = await list("take=1&skip=1");
  assert.equal(result.status, 200);
  assert.deepEqual(uids(result), ["unrelated"]);
  assert.equal(result.body.pagination.totalItems, 2);
});
test("foreign team and event filters restrict rather than replace credential scope", async () => {
  const event = await db.eventType.findFirstOrThrow({ where: { slug: "foreign" } });
  for (const query of [
    `teamId=${foreign.id}`,
    `eventTypeId=${event.id}`,
    "bookingUid=foreign",
    "bookingUid=personal",
  ]) {
    const result = await list(query);
    assert.equal(result.status, 200);
    assert.deepEqual(uids(result), []);
    assert.equal(result.body.pagination.totalItems, 0);
  }
});
test("mixed requested teams cannot widen the key", async () => {
  const result = await list(`teamsIds=${team.id},${foreign.id}`);
  assert.equal(result.status, 200);
  assert.deepEqual(uids(result), ["allowed", "unrelated"]);
});
test("query input cannot replace server-authenticated key scope", async () => {
  const result = await list(`apiKeyTeamId=${foreign.id}`);
  assert.equal(result.status, 200);
  assert.deepEqual(uids(result), ["allowed", "unrelated"]);
});
test("personal list retains native owner/admin visibility and refuses unrelated owner", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  assert.deepEqual(uids(await list("", personal)), ["allowed", "foreign", "personal", "unrelated"]);
  const unrelated = await lifecycle.createApiKey(db, other.id, {});
  assert.deepEqual(uids(await list("", unrelated)), ["unrelated"]);
});
test("list uses primary native Kysely rather than a stale read authority", async () => {
  assert.equal((await list()).status, 200);
  assert.equal(staleSqlReads, 0);
});
test("current snapshot scope membership is required even for organizer", async () => {
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { accepted: false },
  });
  await assert.rejects(sqlList(), { code: "FORBIDDEN" });
});
test("invalid internal list scope fails closed before SQL filters", async () => {
  for (const apiKeyTeamId of [0, -1, NaN, 1.5])
    await assert.rejects(sqlList({ apiKeyTeamId }), { code: "BAD_REQUEST" });
});
test("managed list includes parent scope and refuses conflicting direct team", async () => {
  const parent = await db.eventType.findFirstOrThrow({ where: { slug: "allowed" } });
  await db.eventType.updateMany({
    where: { slug: { in: ["personal", "foreign"] } },
    data: { parentId: parent.id },
  });
  const result = await list();
  assert.equal(result.status, 200);
  assert.deepEqual(uids(result), ["allowed", "personal", "unrelated"]);
});
test("recurring metadata excludes foreign member of same series", async () => {
  await db.booking.updateMany({
    where: { uid: { in: ["allowed", "foreign"] } },
    data: { recurringEventId: "synthetic-shared-series" },
  });
  const result = await sqlList();
  assert.equal(result.totalCount, 2);
  assert.equal(result.recurringInfo[0].count, 1);
});
test("revoked and disabled principal are denied on native list", async () => {
  await db.apiKey.deleteMany();
  assert.equal((await list()).status, 401);
  key = await lifecycle.createApiKey(db, owner.id, { teamId: team.id });
  await db.user.update({ where: { id: owner.id }, data: { locked: true } });
  assert.equal((await list()).status, 401);
});

async function seated(uid = "allowed", token = key) {
  const event = await db.eventType.findFirstOrThrow({ where: { slug: uid } });
  await db.eventType.update({
    where: { id: event.id },
    data: { userId: owner.id, seatsPerTimeSlot: 2, seatsShowAttendees: false },
  });
  const booking = await db.booking.findUniqueOrThrow({ where: { uid } });
  for (const name of ["First", "Private"]) {
    const attendee = await db.attendee.create({
      data: { bookingId: booking.id, name, email: `${name.toLowerCase()}@fixture.test`, timeZone: "UTC" },
    });
    await db.bookingSeat.create({
      data: {
        bookingId: booking.id,
        attendeeId: attendee.id,
        referenceUid: `${uid}-${name}`,
        data: { responses: { name, email: attendee.email } },
      },
    });
  }
  return detail(uid, token);
}
async function detail(uid, token) {
  const response = await fetch(`${runtime.origin}/v2/bookings/${uid}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}
async function eventToDelete(teamId = team.id, userId = owner.id) {
  return db.eventType.create({
    data: { title: "Native mutation", slug: `delete-${teamId}-${userId}`, length: 30, teamId, userId },
  });
}
async function removeEvent(id, token = key) {
  const response = await fetch(`${runtime.origin}/v2/event-types/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}
test("native seated detail retains same-team owner elevation", async () => {
  const result = await seated();
  assert.equal(result.status, 200);
  assert.equal(result.body.data.attendees.length, 2);
});
test("foreign team key cannot elevate hidden seated attendee detail", async () => {
  const result = await seated("foreign");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.attendees, []);
});
test("team key cannot elevate personal seated attendee detail", async () => {
  const result = await seated("personal");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.attendees, []);
});
test("public UID capability remains and public attendee setting stays effective", async () => {
  await seated();
  const hidden = await detail("allowed");
  assert.equal(hidden.status, 200);
  assert.deepEqual(hidden.body.data.attendees, []);
  await db.eventType.updateMany({ where: { slug: "allowed" }, data: { seatsShowAttendees: true } });
  assert.equal((await detail("allowed")).body.data.attendees.length, 2);
});
test("personal key retains native seated-owner detail", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  const result = await seated("personal", personal);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.attendees.length, 2);
});
test("native delete refuses another team while preserving the row", async () => {
  const event = await eventToDelete(foreign.id);
  assert.equal((await removeEvent(event.id)).status, 404);
  assert.equal(await db.eventType.count({ where: { id: event.id } }), 1);
});
test("native delete refuses personal scope through team key", async () => {
  const event = await eventToDelete(null);
  assert.equal((await removeEvent(event.id)).status, 404);
  assert.equal(await db.eventType.count({ where: { id: event.id } }), 1);
});
test("native delete retains owner assertion even for team administrator", async () => {
  const event = await eventToDelete(team.id, other.id);
  assert.equal((await removeEvent(event.id)).status, 403);
  assert.equal(await db.eventType.count({ where: { id: event.id } }), 1);
});
test("native delete permits scoped owner and personal owner through original route", async () => {
  const event = await eventToDelete();
  assert.equal((await removeEvent(event.id)).status, 200);
  assert.equal(await db.eventType.count({ where: { id: event.id } }), 0);
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  const otherEvent = await eventToDelete(null);
  assert.equal((await removeEvent(otherEvent.id, personal)).status, 200);
});
test("revoked or disabled owner cannot mutate through native delete", async () => {
  const event = await eventToDelete();
  await db.apiKey.deleteMany();
  assert.equal((await removeEvent(event.id)).status, 401);
  key = await lifecycle.createApiKey(db, owner.id, { teamId: team.id });
  await db.user.update({ where: { id: owner.id }, data: { locked: true } });
  assert.equal((await removeEvent(event.id)).status, 401);
  assert.equal(await db.eventType.count({ where: { id: event.id } }), 1);
});
test("native mutation and policy use a serializable transaction", async () => {
  const event = await eventToDelete();
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION require_serializable_native_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('transaction_isolation') <> 'serializable' THEN RAISE EXCEPTION 'native delete requires serializable snapshot'; END IF; RETURN OLD; END $$`
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER require_serializable_native_delete BEFORE DELETE ON "EventType" FOR EACH ROW EXECUTE FUNCTION require_serializable_native_delete()'
  );
  assert.equal((await removeEvent(event.id)).status, 200);
  assert.equal(await db.eventType.count({ where: { id: event.id } }), 0);
});

async function admitted(token = key) {
  const { ApiAuthStrategy } = runtime.load(
    path.join(root, api, "modules/auth/strategies/api-auth/api-auth.strategy.ts")
  );
  const strategy = runtime.module.get(ApiAuthStrategy);
  return strategy.getSuccessUser(await strategy.apiKeyStrategy(token, {}));
}
test("mutation refuses scope membership revoked after actual native admission", async () => {
  const event = await eventToDelete();
  const user = await admitted();
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { accepted: false },
  });
  await assert.rejects(
    eventAccess.service.deleteEventType(event.id, user),
    (error) => error instanceof nest.HttpException && error.getStatus() === 404
  );
  assert.equal(await db.eventType.count({ where: { id: event.id } }), 1);
});
test("personal mutation rechecks owner activation inside transaction", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  const user = await admitted(personal);
  const event = await eventToDelete(null);
  await db.user.update({ where: { id: owner.id }, data: { locked: true } });
  await assert.rejects(
    eventAccess.service.deleteEventType(event.id, user),
    (error) => error instanceof nest.HttpException && error.getStatus() === 404
  );
  assert.equal(await db.eventType.count({ where: { id: event.id } }), 1);
});
test("read-only custom-role drift cannot authorize scoped mutation", async () => {
  const event = await eventToDelete();
  const user = await admitted();
  await db.role.create({
    data: {
      id: "scope-reader",
      name: "Reader",
      teamId: team.id,
      permissions: { create: { resource: "eventType", action: "read" } },
    },
  });
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { customRoleId: "scope-reader" },
  });
  await assert.rejects(
    eventAccess.service.deleteEventType(event.id, user),
    (error) => error instanceof nest.HttpException && error.getStatus() === 404
  );
  assert.equal(await db.eventType.count({ where: { id: event.id } }), 1);
});
test("native mutation retains current owner check after admission", async () => {
  const event = await eventToDelete();
  const user = await admitted();
  await db.eventType.update({ where: { id: event.id }, data: { userId: other.id } });
  await assert.rejects(
    eventAccess.service.deleteEventType(event.id, user),
    (error) => error instanceof nest.HttpException && error.getStatus() === 403
  );
  assert.equal(await db.eventType.count({ where: { id: event.id } }), 1);
});
test("managed mutation uses parent scope and refuses explicit foreign team", async () => {
  const parent = await db.eventType.findFirstOrThrow({ where: { slug: "allowed" } });
  const managed = await eventToDelete(null);
  await db.eventType.update({ where: { id: managed.id }, data: { parentId: parent.id } });
  assert.equal((await removeEvent(managed.id)).status, 200);
  const conflicting = await eventToDelete(foreign.id);
  await db.eventType.update({ where: { id: conflicting.id }, data: { parentId: parent.id } });
  assert.equal((await removeEvent(conflicting.id)).status, 404);
  assert.equal(await db.eventType.count({ where: { id: conflicting.id } }), 1);
});

test("native seated detail retains accepted team administrator authority", async () => {
  await seated();
  await db.eventType.updateMany({ where: { slug: "allowed" }, data: { userId: other.id } });
  const result = await detail("allowed", key);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.attendees.length, 2);
});

test("personal owner credential cannot revive revoked team attendee access", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await seated("allowed", personal);
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { accepted: false },
  });
  assert.equal((await admitted(personal)).id, owner.id);
  const result = await detail("allowed", personal);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.attendees, []);
});
test("retained native Host requires accepted resource membership", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await seated("allowed", personal);
  const event = await db.eventType.findFirstOrThrow({ where: { slug: "allowed" } });
  await db.eventType.update({ where: { id: event.id }, data: { userId: other.id } });
  const membership = await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { role: "MEMBER" },
  });
  await db.host.create({ data: { userId: owner.id, eventTypeId: event.id, memberId: membership.id } });
  assert.equal((await detail("allowed", personal)).body.data.attendees.length, 2);
  await db.membership.update({ where: { id: membership.id }, data: { accepted: false } });
  const result = await detail("allowed", personal);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.attendees, []);
  assert.equal(await db.host.count({ where: { eventTypeId: event.id, userId: owner.id } }), 1);
});
test("personal resource read observes custom-role action rather than stale ADMIN label", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await seated("allowed", personal);
  await db.role.create({
    data: {
      id: "resource-role",
      name: "Limited",
      teamId: team.id,
      permissions: { create: { resource: "booking", action: "readTeamBookings" } },
    },
  });
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { customRoleId: "resource-role" },
  });
  assert.deepEqual((await detail("allowed", personal)).body.data.attendees, []);
  await db.rolePermission.create({
    data: { roleId: "resource-role", resource: "eventType", action: "read" },
  });
  assert.equal((await detail("allowed", personal)).body.data.attendees.length, 2);
});
test("personal credential cannot delete a team resource after membership revocation", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  const event = await eventToDelete();
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { accepted: false },
  });
  assert.equal((await removeEvent(event.id, personal)).status, 404);
  assert.equal(await db.eventType.count({ where: { id: event.id } }), 1);
});
test("personal instance-admin key flag cannot replace a resource relationship", async () => {
  await db.user.update({ where: { id: owner.id }, data: { role: "ADMIN" } });
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  const principal = await admitted(personal);
  assert.equal(principal.isSystemAdmin, true);
  assert.equal(principal.apiKeyTeamId, null);
  await seated("personal", personal);
  await db.eventType.updateMany({ where: { slug: "personal" }, data: { userId: other.id } });
  const result = await detail("personal", personal);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.attendees, []);
});
test("standalone team administrator is not coworker organization administrator", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await seated("personal", personal);
  await db.eventType.updateMany({ where: { slug: "personal" }, data: { userId: other.id } });
  await db.membership.create({ data: { userId: other.id, teamId: team.id, accepted: true, role: "MEMBER" } });
  assert.deepEqual((await detail("personal", personal)).body.data.attendees, []);
  const org = await db.team.create({ data: { name: "Real organization", isOrganization: true } });
  for (const [userId, role] of [
    [owner.id, "OWNER"],
    [other.id, "MEMBER"],
  ])
    await db.membership.create({ data: { userId, role, teamId: org.id, accepted: true } });
  assert.equal((await detail("personal", personal)).body.data.attendees.length, 2);
});
test("managed parent team membership constrains personal owner detail", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await seated("personal", personal);
  const parent = await db.eventType.findFirstOrThrow({ where: { slug: "allowed" } });
  await db.eventType.updateMany({ where: { slug: "personal" }, data: { parentId: parent.id } });
  assert.equal((await detail("personal", personal)).body.data.attendees.length, 2);
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { accepted: false },
  });
  assert.deepEqual((await detail("personal", personal)).body.data.attendees, []);
});
test("parent organization revocation constrains a leftover accepted child grant", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await seated("allowed", personal);
  const org = await db.team.create({ data: { name: "Parent organization", isOrganization: true } });
  await db.team.update({ where: { id: team.id }, data: { parentId: org.id } });
  const root = await db.membership.create({
    data: { userId: owner.id, teamId: org.id, accepted: true, role: "MEMBER" },
  });
  assert.equal((await detail("allowed", personal)).body.data.attendees.length, 2);
  await db.membership.update({ where: { id: root.id }, data: { accepted: false } });
  assert.deepEqual((await detail("allowed", personal)).body.data.attendees, []);
});
test("explicit current custom-role delete grant retains owner-only mutation", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  const event = await eventToDelete();
  await db.role.create({
    data: {
      id: "resource-delete",
      name: "Delete own",
      teamId: team.id,
      permissions: { create: { resource: "eventType", action: "delete" } },
    },
  });
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { role: "MEMBER", customRoleId: "resource-delete" },
  });
  assert.equal((await removeEvent(event.id, personal)).status, 200);
  const unrelated = await eventToDelete(team.id, other.id);
  assert.equal((await removeEvent(unrelated.id, personal)).status, 403);
  assert.equal(await db.eventType.count({ where: { id: unrelated.id } }), 1);
});

async function participantSeats() {
  await seated();
  const actorSeat = await db.attendee.findFirstOrThrow({ where: { email: "first@fixture.test" } });
  await db.attendee.update({ where: { id: actorSeat.id }, data: { email: other.email } });
  await db.bookingSeat.update({
    where: { attendeeId: actorSeat.id },
    data: { data: { responses: { name: "Participant", email: other.email, answer: "own-answer" } } },
  });
  const privateSeat = await db.attendee.findFirstOrThrow({ where: { email: "private@fixture.test" } });
  await db.bookingSeat.update({
    where: { attendeeId: privateSeat.id },
    data: { data: { responses: { name: "Private", email: privateSeat.email, answer: "private-answer" } } },
  });
  return { token: await lifecycle.createApiKey(db, other.id, {}), actorSeat };
}
function row(result) {
  assert.equal(result.status, 200);
  assert.equal(result.body.pagination.totalItems, 1);
  return result.body.data[0];
}
test("native participant list retains authoritative own-seat masking and answer", async () => {
  const { token } = await participantSeats();
  const result = await list("bookingUid=allowed", token);
  assert.deepEqual(
    row(result).attendees.map((attendee) => attendee.email),
    [other.email]
  );
  assert.equal(row(result).attendees[0].bookingFieldsResponses.answer, "own-answer");
  assert.equal(JSON.stringify(result.body).includes("private-answer"), false);
});
test("recurring native participant list retains the same seat masking", async () => {
  const { token } = await participantSeats();
  await db.booking.update({ where: { uid: "allowed" }, data: { recurringEventId: "synthetic-seat-series" } });
  const result = await list("bookingUid=allowed", token);
  assert.deepEqual(
    row(result).attendees.map((attendee) => attendee.email),
    [other.email]
  );
  assert.equal(JSON.stringify(result.body).includes("private-answer"), false);
});
function beforeHydration(context, callback) {
  const repo = nativeBookings.bookingsRepository;
  const original = repo.getByIdsWithAttendeesWithBookingSeatAndUserAndEvent;
  repo.getByIdsWithAttendeesWithBookingSeatAndUserAndEvent = async (ids) => {
    await callback();
    return original.call(repo, ids);
  };
  context.after(() => {
    repo.getByIdsWithAttendeesWithBookingSeatAndUserAndEvent = original;
  });
}
test("native hydration cannot add a seat outside selected attendee snapshot", async (context) => {
  const { token } = await participantSeats();
  beforeHydration(context, async () => {
    const booking = await db.booking.findUniqueOrThrow({ where: { uid: "allowed" } });
    const attendee = await db.attendee.create({
      data: { bookingId: booking.id, name: "Later", email: "later@fixture.test", timeZone: "UTC" },
    });
    await db.bookingSeat.create({
      data: {
        bookingId: booking.id,
        attendeeId: attendee.id,
        referenceUid: "later-seat",
        data: { responses: { name: "Later", email: attendee.email, answer: "later-private-answer" } },
      },
    });
  });
  const result = await list("bookingUid=allowed", token);
  assert.deepEqual(
    row(result).attendees.map((attendee) => attendee.email),
    [other.email]
  );
  assert.equal(JSON.stringify(result.body).includes("later-private-answer"), false);
});
test("native hydration refuses a selected attendee rebound to another email", async (context) => {
  const { token, actorSeat } = await participantSeats();
  beforeHydration(context, async () => {
    await db.attendee.update({ where: { id: actorSeat.id }, data: { email: "replacement@fixture.test" } });
    await db.bookingSeat.update({
      where: { attendeeId: actorSeat.id },
      data: {
        data: {
          responses: {
            name: "Replacement",
            email: "replacement@fixture.test",
            answer: "replacement-private-answer",
          },
        },
      },
    });
  });
  const result = await list("bookingUid=allowed", token);
  assert.deepEqual(row(result).attendees, []);
  assert.equal(JSON.stringify(result.body).includes("replacement-private-answer"), false);
});
test("native hydrated seat data must belong to selected booking references", async () => {
  const { token, actorSeat } = await participantSeats();
  const foreignBooking = await db.booking.findUniqueOrThrow({ where: { uid: "foreign" } });
  await db.bookingSeat.update({
    where: { attendeeId: actorSeat.id },
    data: {
      bookingId: foreignBooking.id,
      data: { responses: { name: "Foreign seat", email: other.email, answer: "foreign-seat-answer" } },
    },
  });
  const result = await list("bookingUid=allowed", token);
  assert.equal(row(result).attendees.length, 1);
  assert.equal(row(result).attendees[0].seatUid, undefined);
  assert.equal(JSON.stringify(result.body).includes("foreign-seat-answer"), false);
});
test("native list preserves owner roster selected by retained query", async () => {
  await participantSeats();
  const result = await list("bookingUid=allowed");
  assert.equal(row(result).attendees.length, 2);
});
test("native list preserves explicitly public attendee setting", async () => {
  const { token } = await participantSeats();
  await db.eventType.updateMany({ where: { slug: "allowed" }, data: { seatsShowAttendees: true } });
  const result = await list("bookingUid=allowed", token);
  assert.equal(row(result).attendees.length, 2);
});
