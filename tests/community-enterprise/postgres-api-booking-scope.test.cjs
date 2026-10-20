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
const { privateLinksFixture } = require("./private-links-fixture.cjs");
const { managedClientFixture } = require("./managed-client-fixture.cjs");
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
  nativeBookings,
  nativePrivateLinks,
  managedClients;
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
  const nativeSource = sourceModules(db).load;
  const eventNaming = compile("packages/features/eventtypes/lib/eventNaming.ts", {
    zod: require("zod"),
    "@calcom/app-store/locations": {
      guessEventLocationType() {
        throw new Error("Location placeholder is outside this export fixture");
      },
    },
  });
  const nativeCalendar = compile("packages/features/bookings/lib/getCalendarLinks.ts", {
    ics: require("ics"),
    rrule: require("rrule"),
    "@calcom/dayjs": nativeSource("packages/dayjs/index.ts"),
    "@calcom/features/eventtypes/lib/eventNaming": eventNaming,
    "@calcom/prisma/zod-utils": nativeSource("packages/prisma/zod-utils.ts"),
  });
  const { PermissionCheckService, hasPlatformClientScope } = load(
    path.join(root, "packages/features/community-enterprise/authorization/PermissionCheckService.ts")
  );
  const { MembershipRole } = sourceModules(db).load("packages/prisma/generated/prisma/enums.ts");
  const BookingAccessService = native(
    "packages/features/bookings/services/BookingAccessService.ts",
    "BookingAccessService",
    ["constructor", "isUserAHost", "doesUserIdHaveAccessToBooking"],
    {
      PermissionCheckService,
      hasPlatformClientScope,
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
      const { TRPCExceptionFilter } = compile("apps/api/v2/src/filters/trpc-exception.filter.ts", {
        "@/lib/extract-user-context": compile("apps/api/v2/src/lib/extract-user-context.ts"),
        "@/lib/filterReqHeaders": compile("apps/api/v2/src/lib/filterReqHeaders.ts"),
        "@nestjs/common": nest,
        "@calcom/platform-constants": compile("packages/platform/constants/api.ts"),
        "@calcom/platform-libraries": { TRPCError: require("@trpc/server").TRPCError },
      });
      app.useGlobalFilters(new TRPCExceptionFilter());
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
      const privateLinks = privateLinksFixture({ load, tokens, db, root, eventAccess });
      nativePrivateLinks = privateLinks;
      managedClients = managedClientFixture({ native, load, tokens, db, root });
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
          BookingAccessService,
          getAllUserBookings: listing.getAllUserBookings,
          getPagination: load(path.join(root, api, "lib/pagination/pagination.ts")).getPagination,
          getTranslation: async () => (key) => key,
          getCalendarLinks: (input) => {
            exportsCalled++;
            return nativeCalendar.getCalendarLinks(input);
          },
        }
      );
      const service = new Service();
      nativeBookings = service;
      service.eventTypeAccessService = eventAccess.access;
      service.prismaReadService = { prisma: db };
      service.prismaWriteService = { prisma: db };
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
      const NativeUsers = native(`${api}modules/users/services/users.service.ts`, "UsersService", [
        "getUserMainProfile",
      ]);
      Controller.prototype.usersService = new NativeUsers();
      return {
        controllers: [Controller, eventAccess.Controller, privateLinks.Controller],
        providers: [
          ...privateLinks.providers,
          PermissionsGuard,
          OptionalApiAuthGuard,
          BookingUidGuard,
          BookingPbacGuard,
          { provide: tokens.TokensRepository, useValue: {} },
          ...managedClients.providers,
        ],
      };
    },
  });
});

beforeEach(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS require_serializable_native_delete ON "EventType"');
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS require_serializable_private_link ON "HashedLink"');
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
  await db.membership.create({
    data: { userId: other.id, teamId: team.id, role: "MEMBER", accepted: true },
  });
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

async function laggedReaders(change, request) {
  return db.$transaction(
    async (lag) => {
      await lag.eventType.count();
      const readers = [
        nativeBookings.bookingsRepository,
        nativeBookings.eventTypesRepository,
        ...eventAccess.readers,
      ];
      const previous = readers.map((reader) => reader.dbRead);
      readers.forEach((reader) => {
        reader.dbRead = { prisma: lag };
      });
      try {
        await change();
        return await request();
      } finally {
        readers.forEach((reader, index) => {
          reader.dbRead = previous[index];
        });
      }
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 }
  );
}
test("stale native owner descriptor cannot elevate current member", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await seated("allowed", personal);
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { role: "MEMBER" },
  });
  const result = await laggedReaders(
    () => db.eventType.updateMany({ where: { slug: "allowed" }, data: { userId: other.id } }),
    () => detail("allowed", personal)
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.attendees, []);
});
test("stale native Host query cannot revive a removed host", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await seated("allowed", personal);
  const event = await db.eventType.findFirstOrThrow({ where: { slug: "allowed" } });
  await db.eventType.update({ where: { id: event.id }, data: { userId: other.id } });
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { role: "MEMBER" },
  });
  await db.host.create({ data: { eventTypeId: event.id, userId: owner.id } });
  const result = await laggedReaders(
    () => db.host.deleteMany({ where: { eventTypeId: event.id } }),
    () => detail("allowed", personal)
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.attendees, []);
  assert.equal(await db.host.count(), 0);
});
test("stale native team-admin query cannot revive demoted role", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await seated("allowed", personal);
  await db.eventType.updateMany({ where: { slug: "allowed" }, data: { userId: other.id } });
  const result = await laggedReaders(
    () =>
      db.membership.update({
        where: { userId_teamId: { userId: owner.id, teamId: team.id } },
        data: { role: "MEMBER" },
      }),
    () => detail("allowed", personal)
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.attendees, []);
});
test("stale native organization-admin query cannot revive demoted role", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await seated("personal", personal);
  await db.eventType.updateMany({ where: { slug: "personal" }, data: { userId: other.id } });
  const org = await db.team.create({ data: { name: "Current organization", isOrganization: true } });
  for (const [userId, role] of [
    [owner.id, "ADMIN"],
    [other.id, "MEMBER"],
  ])
    await db.membership.create({ data: { userId, role, teamId: org.id, accepted: true } });
  const result = await laggedReaders(
    () =>
      db.membership.update({
        where: { userId_teamId: { userId: owner.id, teamId: org.id } },
        data: { role: "MEMBER" },
      }),
    () => detail("personal", personal)
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.attendees, []);
});
test("custom read-role cannot inherit builtin administration from ADMIN storage label", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await seated("allowed", personal);
  await db.eventType.updateMany({ where: { slug: "allowed" }, data: { userId: other.id } });
  await db.role.create({
    data: {
      id: "read-not-admin",
      name: "Read event types",
      teamId: team.id,
      permissions: { create: { resource: "eventType", action: "read" } },
    },
  });
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { customRoleId: "read-not-admin" },
  });
  const result = await detail("allowed", personal);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.attendees, []);
});

test("native relation queries share a real primary read-only repeatable-read snapshot", async (context) => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await seated("allowed", personal);
  await db.eventType.updateMany({ where: { slug: "allowed" }, data: { userId: other.id } });
  const repo = eventAccess.access.eventTypesRepository;
  const original = repo.isUserHostOfEventType;
  let observed = 0;
  repo.isUserHostOfEventType = async (...args) => {
    const client = args[2];
    assert.ok(client);
    const [mode] =
      await client.$queryRaw`SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only`;
    assert.equal(mode.isolation, "repeatable read");
    assert.equal(mode.read_only, "on");
    observed++;
    return original.apply(repo, args);
  };
  context.after(() => {
    repo.isUserHostOfEventType = original;
  });
  const result = await detail("allowed", personal);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.attendees.length, 2);
  assert.equal(observed, 1);
});

async function privateLinkEvents() {
  const result = {};
  for (const slug of ["allowed", "foreign", "personal"]) {
    const event = await db.eventType.findFirstOrThrow({ where: { slug } });
    result[slug] = await db.eventType.update({ where: { id: event.id }, data: { userId: owner.id } });
    await db.hashedLink.create({
      data: { eventTypeId: event.id, link: `synthetic-${slug}-link`, maxUsageCount: 2 },
    });
  }
  return result;
}
async function privateLink(method, eventId, linkId = "", body, token = key) {
  const response = await fetch(
    `${runtime.origin}/v2/event-types/${eventId}/private-links${linkId ? "/" + linkId : ""}`,
    {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    }
  );
  return { status: response.status, body: await response.json() };
}
test("native private-link list refuses another administered team", async () => {
  const events = await privateLinkEvents();
  const result = await privateLink("GET", events.foreign.id);
  assert.equal(result.status, 404);
  assert.equal(await db.hashedLink.count(), 3);
});
test("native private-link writes refuse foreign team scope and preserve rows", async () => {
  const events = await privateLinkEvents();
  assert.equal((await privateLink("POST", events.foreign.id, "", { maxUsageCount: 1 })).status, 404);
  assert.equal(
    (await privateLink("PATCH", events.foreign.id, "synthetic-foreign-link", { maxUsageCount: 9 })).status,
    404
  );
  assert.equal((await privateLink("DELETE", events.foreign.id, "synthetic-foreign-link")).status, 404);
  const link = await db.hashedLink.findUniqueOrThrow({ where: { link: "synthetic-foreign-link" } });
  assert.equal(link.maxUsageCount, 2);
  assert.equal(await db.hashedLink.count(), 3);
});
test("native private-link team key cannot reach personal resource", async () => {
  const events = await privateLinkEvents();
  assert.equal((await privateLink("GET", events.personal.id)).status, 404);
});
test("native private-link personal key obeys revoked resource membership", async () => {
  const events = await privateLinkEvents();
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { accepted: false },
  });
  assert.equal((await privateLink("GET", events.allowed.id, "", undefined, personal)).status, 404);
});
test("native private-link read role cannot update through ADMIN storage label", async () => {
  const events = await privateLinkEvents();
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await db.role.create({
    data: {
      id: "link-reader",
      name: "Link reader",
      teamId: team.id,
      permissions: { create: { resource: "eventType", action: "read" } },
    },
  });
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { customRoleId: "link-reader" },
  });
  assert.equal((await privateLink("GET", events.allowed.id, "", undefined, personal)).status, 200);
  assert.equal(
    (await privateLink("PATCH", events.allowed.id, "synthetic-allowed-link", { maxUsageCount: 9 }, personal))
      .status,
    404
  );
  assert.equal(
    (await db.hashedLink.findUniqueOrThrow({ where: { link: "synthetic-allowed-link" } })).maxUsageCount,
    2
  );
});
test("native private-link owner lifecycle and foreign link binding stay intact", async () => {
  const events = await privateLinkEvents();
  const listed = await privateLink("GET", events.allowed.id);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.data.length, 1);
  const created = await privateLink("POST", events.allowed.id, "", { maxUsageCount: 3 });
  assert.equal(created.status, 201);
  const linkId = created.body.data.linkId;
  assert.equal((await privateLink("PATCH", events.allowed.id, linkId, { maxUsageCount: 4 })).status, 200);
  assert.equal((await db.hashedLink.findUniqueOrThrow({ where: { link: linkId } })).maxUsageCount, 4);
  assert.equal(
    (await privateLink("PATCH", events.allowed.id, "synthetic-foreign-link", { maxUsageCount: 8 })).status,
    404
  );
  assert.equal((await privateLink("DELETE", events.allowed.id, linkId)).status, 200);
  assert.equal(await db.hashedLink.count({ where: { link: linkId } }), 0);
});
test("native private-link team administrator cannot replace actual owner", async () => {
  const events = await privateLinkEvents();
  await db.eventType.update({ where: { id: events.allowed.id }, data: { userId: other.id } });
  assert.equal((await privateLink("GET", events.allowed.id)).status, 404);
});
test("native private-link revoked key and disabled owner cannot reach service", async () => {
  const events = await privateLinkEvents();
  await db.apiKey.deleteMany();
  assert.equal((await privateLink("GET", events.allowed.id)).status, 401);
  key = await lifecycle.createApiKey(db, owner.id, { teamId: team.id });
  await db.user.update({ where: { id: owner.id }, data: { locked: true } });
  assert.equal((await privateLink("DELETE", events.allowed.id, "synthetic-allowed-link")).status, 401);
  assert.equal(await db.hashedLink.count(), 3);
});

test("native owner scope refuses missing internal principal identity", async () => {
  const events = await privateLinkEvents();
  assert.equal(await eventAccess.access.userOwnsEventType({}, events.allowed.id), false);
});
test("native private-link HEAD uses read action for a read-only owner role", async () => {
  const events = await privateLinkEvents();
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await db.role.create({
    data: {
      id: "head-reader",
      name: "Read link metadata",
      teamId: team.id,
      permissions: { create: { resource: "eventType", action: "read" } },
    },
  });
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { customRoleId: "head-reader" },
  });
  const response = await fetch(`${runtime.origin}/v2/event-types/${events.allowed.id}/private-links`, {
    method: "HEAD",
    headers: { Authorization: `Bearer ${personal}` },
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

function afterOwnerAdmission(context, change) {
  const original = eventAccess.access.userOwnsEventType.bind(eventAccess.access);
  let changed = false;
  eventAccess.access.userOwnsEventType = async (...args) => {
    const allowed = await original(...args);
    if (!args[3] && allowed && !changed) {
      changed = true;
      await change();
    }
    return allowed;
  };
  context.after(() => {
    eventAccess.access.userOwnsEventType = original;
  });
}
test("native private-link create rechecks revoked membership after owner guard", async (context) => {
  const events = await privateLinkEvents();
  afterOwnerAdmission(context, () =>
    db.membership.update({
      where: { userId_teamId: { userId: owner.id, teamId: team.id } },
      data: { accepted: false },
    })
  );
  assert.equal((await privateLink("POST", events.allowed.id, "", { maxUsageCount: 3 })).status, 404);
  assert.equal(await db.hashedLink.count(), 3);
});
test("native private-link update rechecks moved resource after owner guard", async (context) => {
  const events = await privateLinkEvents();
  afterOwnerAdmission(context, () =>
    db.eventType.update({
      where: { id: events.allowed.id },
      data: { teamId: foreign.id },
    })
  );
  assert.equal(
    (await privateLink("PATCH", events.allowed.id, "synthetic-allowed-link", { maxUsageCount: 9 })).status,
    404
  );
  assert.equal(
    (await db.hashedLink.findUniqueOrThrow({ where: { link: "synthetic-allowed-link" } })).maxUsageCount,
    2
  );
});
test("native private-link delete rechecks actual owner after owner guard", async (context) => {
  const events = await privateLinkEvents();
  afterOwnerAdmission(context, () =>
    db.eventType.update({
      where: { id: events.allowed.id },
      data: { userId: other.id },
    })
  );
  assert.equal((await privateLink("DELETE", events.allowed.id, "synthetic-allowed-link")).status, 404);
  assert.equal(await db.hashedLink.count(), 3);
});
test("native private-link list rechecks disabled principal after owner guard", async (context) => {
  const events = await privateLinkEvents();
  afterOwnerAdmission(context, () => db.user.update({ where: { id: owner.id }, data: { locked: true } }));
  const result = await privateLink("GET", events.allowed.id);
  assert.equal(result.status, 404);
  assert.equal(result.body.data, undefined);
});
test("native private-link writes execute inside PostgreSQL serializable transaction", async () => {
  const events = await privateLinkEvents();
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION require_serializable_private_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_setting('transaction_isolation') <> 'serializable' THEN RAISE EXCEPTION 'private link mutation requires serializable snapshot'; END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$`
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER require_serializable_private_link BEFORE INSERT OR UPDATE OR DELETE ON "HashedLink" FOR EACH ROW EXECUTE FUNCTION require_serializable_private_link()'
  );
  const created = await privateLink("POST", events.allowed.id, "", { maxUsageCount: 3 });
  assert.equal(created.status, 201);
  const id = created.body.data.linkId;
  assert.equal((await privateLink("PATCH", events.allowed.id, id, { maxUsageCount: 4 })).status, 200);
  assert.equal((await privateLink("DELETE", events.allowed.id, id)).status, 200);
});
test("native private-link listing shares a primary read-only owner snapshot", async (context) => {
  const events = await privateLinkEvents();
  const original = nativePrivateLinks.repo.listByEventTypeId.bind(nativePrivateLinks.repo);
  let observed = 0;
  nativePrivateLinks.repo.listByEventTypeId = async (id, client) => {
    assert.ok(client, "native repository must receive the authority transaction");
    const [mode] =
      await client.$queryRaw`SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS readonly`;
    assert.equal(mode.isolation, "repeatable read");
    assert.equal(mode.readonly, "on");
    observed++;
    return original(id, client);
  };
  context.after(() => {
    nativePrivateLinks.repo.listByEventTypeId = original;
  });
  const result = await privateLink("GET", events.allowed.id);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.length, 1);
  assert.equal(observed, 1);
});

test("private-link bearer IDs remain distinct when owner and clock repeat", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { generateHashedLink } = sourceModules(db).load("packages/lib/generateHashedLink.ts");
  const links = Array.from({ length: 256 }, () => generateHashedLink(101));
  assert.equal(new Set(links).size, links.length);
  const translator = require("short-uuid")();
  for (const link of links) {
    const uuid = translator.toUUID(link);
    assert.equal(require("uuid").validate(uuid), true);
    assert.equal(require("uuid").version(uuid), 4);
    assert.match(link, /^[1-9A-HJ-NP-Za-km-z]{22}$/);
  }
});
test("private-link bearer cannot be reconstructed from public owner and time", (context) => {
  const timestamp = Date.now();
  context.mock.timers.enable({ apis: ["Date"], now: timestamp });
  const { generateHashedLink } = sourceModules(db).load("packages/lib/generateHashedLink.ts");
  const translator = require("short-uuid")();
  const { v5 } = require("uuid");
  const predicted = translator.fromUUID(v5(`101:${timestamp}`, v5.URL));
  assert.notEqual(generateHashedLink(101), predicted);
});
test("native private-link create succeeds twice for the same owner and millisecond", async (context) => {
  const events = await privateLinkEvents();
  context.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const first = await privateLink("POST", events.allowed.id, "", { maxUsageCount: 3 });
  const second = await privateLink("POST", events.allowed.id, "", { maxUsageCount: 3 });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(first.body.data.linkId, second.body.data.linkId);
  assert.equal(await db.hashedLink.count(), 5);
  assert.equal((await privateLink("GET", events.allowed.id)).body.data.length, 3);
});

function afterBookingAdmission(context, change) {
  const { BookingPbacGuard } = runtime.load(path.join(root, booking, "guards/booking-pbac.guard.ts"));
  const guard = runtime.module.get(BookingPbacGuard);
  const authority = guard.bookingAccessService;
  const original = authority.doesUserIdHaveAccessToBooking.bind(authority);
  let changed = false;
  authority.doesUserIdHaveAccessToBooking = async (input) => {
    const allowed = await original(input);
    if (allowed && !changed) {
      changed = true;
      await change();
    }
    return allowed;
  };
  context.after(() => {
    authority.doesUserIdHaveAccessToBooking = original;
  });
}
test("native export refuses resource moved after actual guard admission", async (context) => {
  afterBookingAdmission(context, () =>
    db.eventType.updateMany({ where: { slug: "allowed" }, data: { teamId: foreign.id } })
  );
  assert.equal((await request("allowed")).status, 403);
  assert.equal(exportsCalled, 0);
});
test("native export refuses owner disabled after actual guard admission", async (context) => {
  afterBookingAdmission(context, () => db.user.update({ where: { id: owner.id }, data: { locked: true } }));
  assert.equal((await request("allowed")).status, 403);
  assert.equal(exportsCalled, 0);
});
test("native export refuses membership revoked after actual guard admission", async (context) => {
  afterBookingAdmission(context, () =>
    db.membership.update({
      where: { userId_teamId: { userId: owner.id, teamId: team.id } },
      data: { accepted: false },
    })
  );
  assert.equal((await request("allowed")).status, 403);
  assert.equal(exportsCalled, 0);
});
test("native personal export rechecks changed booking organizer after guard", async (context) => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  afterBookingAdmission(context, () =>
    db.booking.update({ where: { uid: "personal" }, data: { userId: other.id } })
  );
  assert.equal((await request("personal", personal)).status, 403);
  assert.equal(exportsCalled, 0);
});
test("native export uses current data despite real lagging reader snapshot", async () => {
  const event = await db.eventType.findFirstOrThrow({ where: { slug: "allowed" } });
  await db.eventType.update({
    where: { id: event.id },
    data: { eventName: "{Event type title}", title: "old-title", description: "old-description" },
  });
  await db.booking.update({
    where: { uid: "allowed" },
    data: { metadata: { videoCallUrl: "https://old-location.example.test" } },
  });
  const result = await laggedReaders(
    async () => {
      await db.eventType.update({
        where: { id: event.id },
        data: { title: "current-title", description: "current-description" },
      });
      await db.booking.update({
        where: { uid: "allowed" },
        data: { metadata: { videoCallUrl: "https://current-location.example.test" } },
      });
    },
    () => request("allowed")
  );
  assert.equal(result.status, 200);
  const output = JSON.stringify(result.body);
  for (const text of ["old-title", "old-description", "old-location"])
    assert.equal(output.includes(text), false);
  for (const text of ["current-title", "current-description", "current-location"])
    assert.equal(output.includes(text), true);
  assert.deepEqual(
    result.body.data.map((link) => link.id),
    ["googleCalendar", "microsoftOffice", "microsoftOutlook", "ics"]
  );
  const ics = result.body.data.find((link) => link.id === "ics").link;
  assert.match(decodeURIComponent(ics), /BEGIN:VCALENDAR/);
});
test("native export hydration and policy use the same primary read-only snapshot", async (context) => {
  const repo = nativeBookings.bookingsRepository;
  const original = repo.getByUidWithAttendeesAndUserAndEvent.bind(repo);
  let observed = 0;
  repo.getByUidWithAttendeesAndUserAndEvent = async (uid, client) => {
    assert.ok(client, "native export hydration needs the authority client");
    const [mode] =
      await client.$queryRaw`SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS readonly`;
    assert.equal(mode.isolation, "repeatable read");
    assert.equal(mode.readonly, "on");
    observed++;
    return original(uid, client);
  };
  context.after(() => {
    repo.getByUidWithAttendeesAndUserAndEvent = original;
  });
  assert.equal((await request("allowed")).status, 200);
  assert.equal(observed, 1);
});

async function personalExportHost() {
  const event = await db.eventType.findFirstOrThrow({ where: { slug: "allowed" } });
  const bookingRow = await db.booking.update({ where: { uid: "allowed" }, data: { userId: other.id } });
  await db.host.create({ data: { eventTypeId: event.id, userId: owner.id } });
  await db.attendee.create({
    data: { bookingId: bookingRow.id, name: "Current host", email: owner.email, timeZone: "UTC" },
  });
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { role: "MEMBER" },
  });
  return lifecycle.createApiKey(db, owner.id, {});
}
test("personal-key export refuses revoked organizer resource membership", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { accepted: false },
  });
  assert.equal((await request("allowed", personal)).status, 403);
  assert.equal(exportsCalled, 0);
});
test("personal-key export cannot revive retained Host after parent removal", async () => {
  const personal = await personalExportHost();
  const org = await db.team.create({ data: { name: "Host parent", isOrganization: true } });
  await db.team.update({ where: { id: team.id }, data: { parentId: org.id } });
  await db.membership.create({ data: { userId: owner.id, teamId: org.id, role: "MEMBER", accepted: false } });
  assert.equal((await request("allowed", personal)).status, 403);
  assert.equal(exportsCalled, 0);
  assert.equal(await db.host.count({ where: { userId: owner.id } }), 1);
});
test("personal-key organizer needs a current read grant rather than ADMIN label", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await db.role.create({
    data: {
      id: "export-updater",
      name: "No booking read",
      teamId: team.id,
      permissions: { create: { resource: "eventType", action: "update" } },
    },
  });
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { customRoleId: "export-updater" },
  });
  assert.equal((await request("allowed", personal)).status, 403);
  assert.equal(exportsCalled, 0);
});
test("personal-key current MEMBER Host preserves native export contract", async () => {
  const personal = await personalExportHost();
  assert.equal((await request("allowed", personal)).status, 200);
  assert.equal(exportsCalled, 1);
});
for (const [resource, action] of [
  ["eventType", "read"],
  ["booking", "readTeamBookings"],
])
  test(`personal-key owner export retains explicit ${resource}.${action} role`, async () => {
    const personal = await lifecycle.createApiKey(db, owner.id, {});
    await db.role.create({
      data: {
        id: "export-reader",
        name: "Explicit export reader",
        teamId: team.id,
        permissions: { create: { resource, action } },
      },
    });
    await db.membership.update({
      where: { userId_teamId: { userId: owner.id, teamId: team.id } },
      data: { customRoleId: "export-reader" },
    });
    assert.equal((await request("allowed", personal)).status, 200);
    assert.equal(exportsCalled, 1);
  });
test("personal-key resource read does not itself grant another organizer export", async () => {
  const personal = await lifecycle.createApiKey(db, owner.id, {});
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { role: "MEMBER" },
  });
  assert.equal((await request("unrelated", personal)).status, 403);
  assert.equal(exportsCalled, 0);
});
test("legacy default booking authority remains compatible without API scope marker", async () => {
  await db.membership.update({
    where: { userId_teamId: { userId: owner.id, teamId: team.id } },
    data: { accepted: false },
  });
  assert.equal(await access.doesUserIdHaveAccessToBooking({ userId: owner.id, bookingUid: "allowed" }), true);
});

test("personal-key organizer cannot export a team's booking without membership", async () => {
  const personal = await lifecycle.createApiKey(db, other.id, {});
  assert.equal(await db.membership.count({ where: { userId: other.id, teamId: team.id } }), 0);
  assert.equal((await request("unrelated", personal)).status, 403);
  assert.equal(exportsCalled, 0);
});

async function managedEvents() {
  const events = await privateLinkEvents();
  const org = await db.team.create({ data: { name: "Managed scope", isOrganization: true } });
  const otherOrg = await db.team.create({ data: { name: "Other managed scope", isOrganization: true } });
  for (const [child, parent] of [
    [team, org],
    [foreign, otherOrg],
  ]) {
    await db.team.update({ where: { id: child.id }, data: { parentId: parent.id } });
    await db.membership.create({
      data: { userId: owner.id, teamId: parent.id, role: "OWNER", accepted: true },
    });
  }
  await db.user.update({ where: { id: owner.id }, data: { role: "ADMIN" } });
  const secret = randomBytes(32).toString("hex");
  const client = await db.platformOAuthClient.create({
    data: {
      id: "synthetic-managed-client",
      name: "Local scope fixture",
      secret,
      permissions: 15,
      organizationId: org.id,
      redirectUris: [],
    },
  });
  return {
    events,
    org,
    otherOrg,
    client,
    headers: { "x-cal-client-id": client.id, "x-cal-secret-key": secret },
  };
}
async function managedRequest(route, headers, method = "GET", body) {
  const response = await fetch(`${runtime.origin}${route}`, {
    method,
    headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}
const privatePath = (id, link = "") => `/v2/event-types/${id}/private-links${link ? "/" + link : ""}`;
test("native managed client cannot list another administered organization's links", async () => {
  const f = await managedEvents();
  assert.equal((await managedRequest(privatePath(f.events.foreign.id), f.headers)).status, 404);
});
test("native managed client cannot mutate another administered organization", async () => {
  const f = await managedEvents(),
    route = privatePath(f.events.foreign.id, "synthetic-foreign-link");
  assert.equal(
    (await managedRequest(privatePath(f.events.foreign.id), f.headers, "POST", { maxUsageCount: 3 })).status,
    404
  );
  assert.equal((await managedRequest(route, f.headers, "PATCH", { maxUsageCount: 9 })).status, 404);
  assert.equal((await managedRequest(route, f.headers, "DELETE")).status, 404);
  assert.equal(await db.hashedLink.count(), 3);
  assert.equal(
    (await db.hashedLink.findUniqueOrThrow({ where: { link: "synthetic-foreign-link" } })).maxUsageCount,
    2
  );
});
test("native managed client cannot become its owner's global personal key", async () => {
  const f = await managedEvents();
  assert.equal((await managedRequest(privatePath(f.events.personal.id), f.headers)).status, 404);
});
test("native managed client retains own-root child CRUD and actual owner assertion", async () => {
  const f = await managedEvents(),
    route = privatePath(f.events.allowed.id);
  assert.equal((await managedRequest(route, f.headers)).status, 200);
  const created = await managedRequest(route, f.headers, "POST", { maxUsageCount: 3 });
  assert.equal(created.status, 201);
  const linkPath = privatePath(f.events.allowed.id, created.body.data.linkId);
  assert.equal((await managedRequest(linkPath, f.headers, "PATCH", { maxUsageCount: 4 })).status, 200);
  assert.equal((await managedRequest(linkPath, f.headers, "DELETE")).status, 200);
  await db.eventType.update({ where: { id: f.events.allowed.id }, data: { userId: other.id } });
  assert.equal((await managedRequest(route, f.headers)).status, 404);
});
test("native managed client retains explicitly associated personal owner", async () => {
  const f = await managedEvents();
  await db.platformOAuthClient.update({
    where: { id: f.client.id },
    data: { users: { connect: { id: owner.id } } },
  });
  assert.equal((await managedRequest(privatePath(f.events.personal.id), f.headers)).status, 200);
});
test("native managed scope rechecks client organization after owner guard", async (context) => {
  const f = await managedEvents();
  afterOwnerAdmission(context, () =>
    db.platformOAuthClient.update({ where: { id: f.client.id }, data: { organizationId: f.otherOrg.id } })
  );
  assert.equal(
    (await managedRequest(privatePath(f.events.allowed.id, "synthetic-allowed-link"), f.headers, "DELETE"))
      .status,
    404
  );
  assert.equal(await db.hashedLink.count(), 3);
});
test("native optional booking detail cannot elevate roster across client scope", async () => {
  const f = await managedEvents();
  await seated("foreign");
  const result = await managedRequest("/v2/bookings/foreign", f.headers);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.attendees, []);
});
test("native optional booking detail retains scoped owner roster", async () => {
  const f = await managedEvents();
  await seated("allowed");
  const result = await managedRequest("/v2/bookings/allowed", f.headers);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.attendees.length, 2);
});
test("actual lagging native client admission cannot revive deleted resource scope", async () => {
  const f = await managedEvents();
  await seated("allowed");
  const result = await db.$transaction(
    async (lag) => {
      await lag.platformOAuthClient.count();
      const previous = managedClients.clients.dbRead;
      managedClients.clients.dbRead = { prisma: lag };
      try {
        await db.platformOAuthClient.delete({ where: { id: f.client.id } });
        return await managedRequest("/v2/bookings/allowed", f.headers);
      } finally {
        managedClients.clients.dbRead = previous;
      }
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 }
  );
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.attendees, []);
});
test("native managed client retains its root resource", async () => {
  const f = await managedEvents();
  await db.eventType.update({ where: { id: f.events.allowed.id }, data: { teamId: f.org.id } });
  assert.equal((await managedRequest(privatePath(f.events.allowed.id), f.headers)).status, 200);
});
test("native managed parent scope cannot replace an explicit foreign team", async () => {
  const f = await managedEvents();
  await db.eventType.update({ where: { id: f.events.personal.id }, data: { parentId: f.events.allowed.id } });
  assert.equal((await managedRequest(privatePath(f.events.personal.id), f.headers)).status, 200);
  await db.eventType.update({ where: { id: f.events.personal.id }, data: { teamId: foreign.id } });
  assert.equal((await managedRequest(privatePath(f.events.personal.id), f.headers)).status, 404);
});
test("native selected managed client is not widened by a secondary foreign key", async () => {
  const f = await managedEvents();
  const foreignKey = await lifecycle.createApiKey(db, owner.id, { teamId: foreign.id });
  assert.equal(
    (
      await managedRequest(privatePath(f.events.foreign.id), {
        ...f.headers,
        Authorization: `Bearer ${foreignKey}`,
      })
    ).status,
    404
  );
});
test("native managed client read bits cannot authorize private-link writes", async () => {
  const f = await managedEvents();
  await db.platformOAuthClient.update({ where: { id: f.client.id }, data: { permissions: 1 } });
  assert.equal((await managedRequest(privatePath(f.events.allowed.id), f.headers)).status, 200);
  assert.equal(
    (
      await managedRequest(privatePath(f.events.allowed.id, "synthetic-allowed-link"), f.headers, "PATCH", {
        maxUsageCount: 9,
      })
    ).status,
    403
  );
  assert.equal(
    (await db.hashedLink.findUniqueOrThrow({ where: { link: "synthetic-allowed-link" } })).maxUsageCount,
    2
  );
});
test("native managed calendar export cannot cross administered organizations", async () => {
  const f = await managedEvents();
  const result = await managedRequest("/v2/bookings/foreign/calendar-links", f.headers);
  assert.equal(result.status, 403);
  assert.equal(exportsCalled, 0);
});
test("native managed calendar export requires explicit personal owner association", async () => {
  const f = await managedEvents();
  assert.equal((await managedRequest("/v2/bookings/personal/calendar-links", f.headers)).status, 403);
  await db.platformOAuthClient.update({
    where: { id: f.client.id },
    data: { users: { connect: { id: owner.id } } },
  });
  assert.equal((await managedRequest("/v2/bookings/personal/calendar-links", f.headers)).status, 200);
  assert.equal(exportsCalled, 1);
});
test("native managed calendar export retains own child and root contracts", async () => {
  const f = await managedEvents();
  assert.equal((await managedRequest("/v2/bookings/allowed/calendar-links", f.headers)).status, 200);
  await db.eventType.update({ where: { id: f.events.allowed.id }, data: { teamId: f.org.id } });
  assert.equal((await managedRequest("/v2/bookings/allowed/calendar-links", f.headers)).status, 200);
  assert.equal(exportsCalled, 2);
});
test("native managed export rechecks organization changed after booking guard", async (context) => {
  const f = await managedEvents();
  afterBookingAdmission(context, () =>
    db.platformOAuthClient.update({ where: { id: f.client.id }, data: { organizationId: f.otherOrg.id } })
  );
  assert.equal((await managedRequest("/v2/bookings/allowed/calendar-links", f.headers)).status, 403);
  assert.equal(exportsCalled, 0);
});
test("native managed export rechecks root membership revoked after booking guard", async (context) => {
  const f = await managedEvents();
  afterBookingAdmission(context, () =>
    db.membership.update({
      where: { userId_teamId: { userId: owner.id, teamId: f.org.id } },
      data: { accepted: false },
    })
  );
  assert.equal((await managedRequest("/v2/bookings/allowed/calendar-links", f.headers)).status, 403);
  assert.equal(exportsCalled, 0);
});
test("native managed export retains parent scope but rejects explicit foreign team", async () => {
  const f = await managedEvents();
  await db.eventType.update({ where: { id: f.events.personal.id }, data: { parentId: f.events.allowed.id } });
  assert.equal((await managedRequest("/v2/bookings/personal/calendar-links", f.headers)).status, 200);
  await db.eventType.update({ where: { id: f.events.personal.id }, data: { teamId: foreign.id } });
  assert.equal((await managedRequest("/v2/bookings/personal/calendar-links", f.headers)).status, 403);
  assert.equal(exportsCalled, 1);
});
test("native managed export cannot borrow a secondary foreign API key", async () => {
  const f = await managedEvents();
  const foreignKey = await lifecycle.createApiKey(db, owner.id, { teamId: foreign.id });
  assert.equal(
    (
      await managedRequest("/v2/bookings/foreign/calendar-links", {
        ...f.headers,
        Authorization: `Bearer ${foreignKey}`,
      })
    ).status,
    403
  );
  assert.equal(exportsCalled, 0);
});
test("native managed export rechecks client deleted after booking guard", async (context) => {
  const f = await managedEvents();
  afterBookingAdmission(context, () => db.platformOAuthClient.delete({ where: { id: f.client.id } }));
  assert.equal((await managedRequest("/v2/bookings/allowed/calendar-links", f.headers)).status, 403);
  assert.equal(exportsCalled, 0);
  assert.equal(await db.booking.count(), 4);
});

const managedList = (fixture, query = "") =>
  managedRequest(`/v2/bookings?status=past&${query}`, fixture.headers);
test("native managed list constrains actual rows and counts to current client", async () => {
  const f = await managedEvents(),
    result = await managedList(f);
  assert.equal(result.status, 200);
  assert.deepEqual(uids(result), ["allowed", "unrelated"]);
  assert.equal(result.body.pagination.totalItems, 2);
});
test("native managed list page cannot traverse another administered scope", async () => {
  const f = await managedEvents(),
    result = await managedList(f, "take=1&skip=1");
  assert.equal(result.status, 200);
  assert.deepEqual(uids(result), ["unrelated"]);
  assert.equal(result.body.pagination.totalItems, 2);
});
test("native managed list caller identity filters cannot widen current client", async () => {
  const f = await managedEvents();
  for (const query of [
    `teamsIds=${foreign.id}`,
    `eventTypeIds=${f.events.foreign.id}`,
    "bookingUid=foreign",
  ]) {
    const result = await managedList(f, query);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data, []);
    assert.equal(result.body.pagination.totalItems, 0);
  }
});
test("native managed list retains explicitly associated personal owner", async () => {
  const f = await managedEvents();
  await db.platformOAuthClient.update({
    where: { id: f.client.id },
    data: { users: { connect: { id: owner.id } } },
  });
  const result = await managedList(f);
  assert.equal(result.status, 200);
  assert.deepEqual(uids(result), ["allowed", "personal", "unrelated"]);
  assert.equal(result.body.pagination.totalItems, 3);
});
test("native managed list retains root and managed parent but refuses conflicting team", async () => {
  const f = await managedEvents();
  await db.eventType.update({ where: { id: f.events.allowed.id }, data: { teamId: f.org.id } });
  await db.eventType.update({ where: { id: f.events.personal.id }, data: { parentId: f.events.allowed.id } });
  assert.deepEqual(uids(await managedList(f)), ["allowed", "personal", "unrelated"]);
  await db.eventType.update({ where: { id: f.events.personal.id }, data: { teamId: foreign.id } });
  assert.deepEqual(uids(await managedList(f)), ["allowed", "unrelated"]);
});
function afterListPermission(context, change) {
  const { PermissionsGuard } = runtime.load(
    path.join(root, api, "modules/auth/guards/permissions/permissions.guard.ts")
  );
  const guard = runtime.module.get(PermissionsGuard),
    original = guard.canActivate.bind(guard);
  let changed = false;
  guard.canActivate = async (ctx) => {
    const allowed = await original(ctx);
    if (allowed && !changed) {
      changed = true;
      await change();
    }
    return allowed;
  };
  context.after(() => {
    guard.canActivate = original;
  });
}
test("native managed list uses organization changed after permission admission", async (context) => {
  const f = await managedEvents();
  afterListPermission(context, () =>
    db.platformOAuthClient.update({ where: { id: f.client.id }, data: { organizationId: f.otherOrg.id } })
  );
  const result = await managedList(f);
  assert.equal(result.status, 200);
  assert.deepEqual(uids(result), ["foreign"]);
  assert.equal(result.body.pagination.totalItems, 1);
});
test("native managed list refuses client deleted after permission admission", async (context) => {
  const f = await managedEvents();
  afterListPermission(context, () => db.platformOAuthClient.delete({ where: { id: f.client.id } }));
  const result = await managedList(f);
  assert.equal(result.status, 403);
  assert.equal(result.body.data, undefined);
});
test("native managed list cannot retain team organizers after root revocation", async (context) => {
  const f = await managedEvents();
  afterListPermission(context, () =>
    db.membership.update({
      where: { userId_teamId: { userId: owner.id, teamId: f.org.id } },
      data: { accepted: false },
    })
  );
  const result = await managedList(f);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, []);
  assert.equal(result.body.pagination.totalItems, 0);
});
test("native managed list refuses disabled principal in its actual read snapshot", async (context) => {
  const f = await managedEvents();
  afterListPermission(context, () => db.user.update({ where: { id: owner.id }, data: { locked: true } }));
  assert.equal((await managedList(f)).status, 403);
});
test("native managed list rejects a non-organization client root", async (context) => {
  const f = await managedEvents();
  afterListPermission(context, () =>
    db.team.update({ where: { id: f.org.id }, data: { isOrganization: false } })
  );
  assert.equal((await managedList(f)).status, 403);
});
test("retained listing series metadata cannot traverse a foreign client member", async () => {
  const f = await managedEvents();
  await db.booking.updateMany({
    where: { uid: { in: ["allowed", "foreign"] } },
    data: { recurringEventId: "synthetic-client-series" },
  });
  const result = await sqlList({ apiKeyTeamId: undefined, apiClientId: f.client.id });
  assert.equal(result.totalCount, 2);
  assert.equal(result.recurringInfo.length, 1);
  assert.equal(result.recurringInfo[0].count, 1);
});
test("retained listing rescheduler lookup stays within selected client visibility", async () => {
  const f = await managedEvents();
  await db.booking.update({ where: { uid: "allowed" }, data: { fromReschedule: "foreign" } });
  await db.booking.update({
    where: { uid: "foreign" },
    data: { rescheduledBy: "foreign-client-private@fixture.test" },
  });
  const result = await sqlList({ apiKeyTeamId: undefined, apiClientId: f.client.id });
  assert.equal(result.bookings.find((booking) => booking.uid === "allowed").rescheduler, null);
});
test("retained listing invalid internal client marker fails closed", async () => {
  await managedEvents();
  for (const apiClientId of ["", null, 123])
    await assert.rejects(sqlList({ apiKeyTeamId: undefined, apiClientId }), { code: "BAD_REQUEST" });
});

test("native managed list uses selected client instead of another default profile", async () => {
  const f = await managedEvents();
  await db.profile.create({
    data: {
      uid: "synthetic-other-profile",
      username: "other-default",
      organizationId: f.otherOrg.id,
      userId: owner.id,
    },
  });
  const result = await managedList(f);
  assert.equal(result.status, 200);
  assert.deepEqual(uids(result), ["allowed", "unrelated"]);
  assert.equal(result.body.pagination.totalItems, 2);
});
