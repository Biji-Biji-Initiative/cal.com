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
let db, runtime, lifecycle, owner, other, team, foreign, key, exportsCalled, access;
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
  runtime = await createApiRuntime(state, {
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
        ["getCalendarLinks"],
        {
          ...nest,
          getTranslation: async () => (key) => key,
          getCalendarLinks: ({ booking }) => {
            exportsCalled++;
            return [{ label: booking.uid, link: "https://calendar.example.test/fixture.ics" }];
          },
        }
      );
      const service = new Service();
      const NativeBookingRepository = native(
        `${booking}repositories/bookings.repository.ts`,
        "BookingsRepository_2024_08_13",
        ["getByUidWithAttendeesAndUserAndEvent"]
      );
      const NativeEvents = native(
        "apps/api/v2/src/platform/event-types/event-types_2024_06_14/event-types.repository.ts",
        "EventTypesRepository_2024_06_14",
        ["getEventTypeByIdIncludeUsersAndTeam"]
      );
      service.bookingsRepository = Object.assign(new NativeBookingRepository(), { dbRead: { prisma: db } });
      service.eventTypesRepository = Object.assign(new NativeEvents(), { dbRead: { prisma: db } });
      const Controller = native(
        `${booking}controllers/bookings.controller.ts`,
        "BookingsController_2024_08_13",
        ["getCalendarLinks"],
        {
          ...nest,
          ...require("@nestjs/swagger"),
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
        startTime: new Date(0),
        endTime: new Date(3600000),
      },
    });
  }
  key = await lifecycle.createApiKey(db, owner.id, { teamId: team.id });
  exportsCalled = 0;
});
after(async () => {
  if (runtime) await runtime.app.close();
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
