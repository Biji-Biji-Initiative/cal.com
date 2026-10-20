// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { before, beforeEach, after, test } = require("node:test");
const ts = require("typescript");
const nest = require("@nestjs/common");
const { ConfigService } = require("@nestjs/config");
const { connectFixture, sourceModules, root } = require("./tasker-fixture.cjs");
const { createApiRuntime, fixtureModules } = require("./api-runtime-fixture.cjs");
const { bookingListing, compile } = require("./booking-listing-fixture.cjs");
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
  staleSqlReads;
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
    config: new ConfigService({ api: { keyPrefix: "cal_" } }),
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
      const Service = native(
        `${booking}services/bookings.service.ts`,
        "BookingsService_2024_08_13",
        ["getCalendarLinks", "getBookings"],
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
        ["getCalendarLinks", "getBookings"],
        {
          ...nest,
          ...require("@nestjs/swagger"),
          GetBookingsInput_2024_08_13: types.GetBookingsInput_2024_08_13,
          ApiAuthGuard,
          PermissionsGuard,
          BookingUidGuard,
          BookingPbacGuard,
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
        controllers: [Controller],
        providers: [
          PermissionsGuard,
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
  for (const model of [
    "enterpriseAuditEvent",
    "apiKey",
    "booking",
    "eventType",
    "membership",
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
