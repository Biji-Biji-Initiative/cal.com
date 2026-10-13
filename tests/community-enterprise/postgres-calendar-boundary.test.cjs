// SPDX-License-Identifier: MIT
// Real Nest controller/services and generated Prisma/PostgreSQL. Authentication
// supplies fixture principals; Google/OAuth and unrelated services are bounded doubles.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { randomUUID } = require("node:crypto");
const { before, beforeEach, after, test } = require("node:test");
const ts = require("typescript");
require("reflect-metadata");
const { Test } = require("@nestjs/testing");
const { UnauthorizedException } = require("@nestjs/common");
const { PrismaPg } = require("@prisma/adapter-pg");
const root = path.resolve(__dirname, "../..");
const base = "apps/api/v2/src/modules/cal-unified-calendars/";
let client, app, origin, repository;
const state = { provider: [], oauth: 0, primary: 0, replica: 0, failedPrimary: false };
class PrismaReadService {}
class PrismaWriteService {}
class CalendarsService {}
class GCalService {}
class CredentialsRepository {}
class UnifiedCalendarsFreebusyService {}
class FixtureAuthGuard {
  canActivate(context) {
    const request = context.switchToHttp().getRequest();
    const id = Number(request.headers["x-fixture-user"]);
    if (![1, 2, 3].includes(id)) throw new UnauthorizedException();
    request.user = { id, role: id === 2 ? "ADMIN" : "USER" };
    return true;
  }
}
class FixturePermissionsGuard {
  canActivate() {
    return true;
  }
}
const event = () => ({
  id: "provider-event",
  summary: "Fixture appointment",
  status: "confirmed",
  start: { dateTime: "2026-10-15T08:00:00Z" },
  end: { dateTime: "2026-10-15T09:00:00Z" },
  organizer: { email: "owner@example.test" },
});
class Calendar {
  constructor() {
    state.oauth++;
    this.events = Object.fromEntries(
      ["get", "patch"].map((method) => [
        method,
        async (input) => {
          state.provider.push({ method, input });
          return { data: event() };
        },
      ])
    );
  }
}
const substitutions = new Map([
  ["@/modules/prisma/prisma-read.service", { PrismaReadService }],
  ["@/modules/prisma/prisma-write.service", { PrismaWriteService }],
  ["@/platform/calendars/services/calendars.service", { CalendarsService }],
  ["@/platform/calendars/services/gcal.service", { GoogleCalendarService: GCalService }],
  ["@/modules/credentials/credentials.repository", { CredentialsRepository }],
  [
    "@/modules/cal-unified-calendars/services/unified-calendars-freebusy.service",
    { UnifiedCalendarsFreebusyService },
  ],
  ["@/modules/auth/guards/api-auth/api-auth.guard", { ApiAuthGuard: FixtureAuthGuard }],
  ["@/modules/auth/guards/permissions/permissions.guard", { PermissionsGuard: FixturePermissionsGuard }],
  [
    "@calcom/platform-libraries/app-store",
    {
      OAuth2UniversalSchema: { parse: (value) => value },
      DelegationCredentialRepository: {
        findByIdIncludeSensitiveServiceAccountKey: () => {
          throw new Error("Unexercised delegation boundary");
        },
      },
    },
  ],
  ["@googleapis/calendar", { calendar_v3: { Calendar } }],
  [
    "googleapis-common",
    {
      JWT: class {
        constructor() {
          throw new Error("Unexercised JWT boundary");
        }
      },
    },
  ],
]);
const cache = new Map();
function load(filename) {
  const file = [filename, `${filename}.ts`, `${filename}.tsx`, path.join(filename, "index.ts")].find(
    (p) => fs.existsSync(p) && fs.statSync(p).isFile()
  );
  assert.ok(file, `Missing source ${filename}`);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
    },
  });
  assert.deepEqual(compiled.diagnostics, []);
  const nativeRequire = createRequire(file);
  new Function("require", "module", "exports", "__filename", "__dirname", compiled.outputText)(
    (name) => {
      if (substitutions.has(name)) return substitutions.get(name);
      if (name === "@calcom/platform-constants")
        return Object.assign(
          {},
          ...["api", "index"].map((p) => load(path.join(root, "packages/platform/constants", p)))
        );
      if (name === "@calcom/prisma/client")
        return load(path.join(root, "packages/prisma/generated/prisma/client.ts"));
      if (name.startsWith("@/")) return load(path.join(root, "apps/api/v2/src", name.slice(2)));
      if (name.startsWith(".")) return load(path.resolve(path.dirname(file), name));
      return nativeRequire(name);
    },
    module,
    module.exports,
    file,
    path.dirname(file)
  );
  return module.exports;
}
const { PrismaClient } = load(path.join(root, "packages/prisma/generated/prisma/client.ts"));
const { BookingReferencesRepository_2024_08_13 } = load(
  path.join(
    root,
    "apps/api/v2/src/platform/bookings/2024-08-13/repositories/booking-references.repository.ts"
  )
);
const { CalUnifiedCalendarsController } = load(
  path.join(root, base, "controllers/cal-unified-calendars.controller.ts")
);
const { UnifiedCalendarService } = load(path.join(root, base, "services/unified-calendar.service.ts"));
const { GoogleCalendarService } = load(path.join(root, base, "services/google-calendar.service.ts"));
before(
  async () => {
    const socket = process.env.CAL_ENTERPRISE_TEST_SOCKET,
      pgdata = process.env.CAL_ENTERPRISE_TEST_PGDATA;
    assert.ok(
      socket && pgdata && path.isAbsolute(socket) && path.isAbsolute(pgdata),
      "Use the private disposable runner only"
    );
    assert.equal(path.dirname(socket), path.dirname(pgdata));
    assert.match(path.basename(path.dirname(socket)), /^cal-enterprise-/);
    client = new PrismaClient({
      adapter: new PrismaPg({
        host: socket,
        port: 55439,
        user: "cal_enterprise_test",
        database: "postgres",
        max: 3,
      }),
    });
    const [server] =
      await client.$queryRaw`SELECT current_setting('data_directory') AS directory, current_user::text AS username`;
    assert.equal(server.directory, pgdata);
    assert.equal(server.username, "cal_enterprise_test");
    assert.equal(await client.user.count(), 0);
    await client.user.createMany({
      data: [1, 2, 3].map((id) => ({
        id,
        uuid: randomUUID(),
        email: `calendar-${id}@example.test`,
        locked: false,
      })),
    });
    const primary = {
      prisma: {
        bookingReference: {
          findFirst(query) {
            state.primary++;
            if (state.failedPrimary) throw new Error("primary unavailable");
            return client.bookingReference.findFirst(query);
          },
        },
      },
    };
    const replica = {
      prisma: {
        bookingReference: {
          findFirst(query) {
            state.replica++;
            return client.bookingReference.findFirst(query);
          },
          findMany: (query) => client.bookingReference.findMany(query),
        },
      },
    };
    const module = await Test.createTestingModule({
      controllers: [CalUnifiedCalendarsController],
      providers: [
        BookingReferencesRepository_2024_08_13,
        GoogleCalendarService,
        UnifiedCalendarService,
        { provide: PrismaReadService, useValue: replica },
        { provide: PrismaWriteService, useValue: primary },
        {
          provide: GCalService,
          useValue: {
            redirectUri: "http://localhost/test-only",
            getOAuthClient: async () => ({ setCredentials() {} }),
          },
        },
        { provide: CalendarsService, useValue: {} },
        { provide: CredentialsRepository, useValue: {} },
        { provide: UnifiedCalendarsFreebusyService, useValue: {} },
      ],
    }).compile();
    repository = module.get(BookingReferencesRepository_2024_08_13);
    app = module.createNestApplication({ logger: false });
    await app.listen(0, "127.0.0.1");
    origin = await app.getUrl();
  },
  { timeout: 30000 }
);
beforeEach(async () => {
  await client.bookingReference.deleteMany();
  await client.booking.deleteMany();
  await client.credential.deleteMany();
  await client.user.updateMany({ data: { locked: false } });
  await client.credential.createMany({
    data: [1, 2].map((id) => ({
      id,
      userId: id,
      type: "google_calendar",
      key: { access_token: `fixture-provider-${id}` },
    })),
  });
  await client.booking.createMany({
    data: [1, 2].map((id) => ({
      id,
      uid: `booking-${id}`,
      userId: id,
      title: "Test",
      startTime: new Date("2026-10-15T08:00:00Z"),
      endTime: new Date("2026-10-15T09:00:00Z"),
    })),
  });
  await client.bookingReference.create({
    data: {
      id: 1,
      uid: "provider-event",
      type: "google_calendar",
      bookingId: 1,
      credentialId: 1,
      externalCalendarId: "calendar-owner-1",
    },
  });
  Object.assign(state, { provider: [], oauth: 0, primary: 0, replica: 0, failedPrimary: false });
});
after(async () => {
  if (app) await app.close();
  if (client) await client.$disconnect();
});
async function call(method, user = 1, route = "events", uid = "provider-event", extra = "") {
  return fetch(`${origin}/v2/calendars/google/${route}/${uid}${extra}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(user === null ? {} : { "x-fixture-user": String(user) }),
    },
    ...(method === "PATCH" ? { body: JSON.stringify({ title: "Updated", userId: 1 }) } : {}),
  });
}
for (const method of ["GET", "PATCH"])
  for (const route of ["events", "event"]) {
    test(`owner ${method} ${route} retains provider behavior without secret output`, async () => {
      const response = await call(method, 1, route);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(state.provider.length, 1);
      assert.equal(state.provider[0].input.calendarId, "calendar-owner-1");
      assert.equal(state.provider[0].input.eventId, "provider-event");
      assert.equal(state.replica, 0);
      assert.ok(!text.includes("fixture-provider-"));
      assert.ok(!text.includes("delegationCredential"));
    });
    test(`foreign ${method} ${route} is indistinguishable from absent and calls no provider`, async () => {
      const foreign = await call(method, 2, route),
        missing = await call(method, 2, route, "absent");
      assert.equal(foreign.status, 404);
      assert.equal(missing.status, 404);
      assert.deepEqual(await foreign.json(), await missing.json());
      assert.equal(state.oauth, 0);
      assert.equal(state.provider.length, 0);
    });
  }
for (const method of ["GET", "PATCH"]) {
  test(`${method} cannot smuggle owner ID in body or query`, async () => {
    assert.equal((await call(method, 3, "events", "provider-event", "?userId=1")).status, 404);
    assert.equal(state.oauth, 0);
  });
  test(`${method} anonymous request is rejected before repository`, async () => {
    assert.equal((await call(method, null)).status, 401);
    assert.equal(state.primary, 0);
  });
  for (const bad of ["deleted", "orphaned", "wrong-provider", "locked"]) {
    test(`${method} denies ${bad} reference before credential use`, async () => {
      if (bad === "deleted")
        await client.bookingReference.update({ where: { id: 1 }, data: { deleted: true } });
      if (bad === "orphaned")
        await client.bookingReference.update({ where: { id: 1 }, data: { bookingId: null } });
      if (bad === "wrong-provider")
        await client.bookingReference.update({ where: { id: 1 }, data: { type: "office365_calendar" } });
      if (bad === "locked") await client.user.update({ where: { id: 1 }, data: { locked: true } });
      assert.equal((await call(method)).status, 404);
      assert.equal(state.oauth, 0);
      assert.equal(state.provider.length, 0);
    });
  }
}
test("duplicate external ID cannot choose another owner first", async () => {
  await client.bookingReference.update({
    where: { id: 1 },
    data: { bookingId: 2, credentialId: 2, externalCalendarId: "foreign-calendar" },
  });
  await client.bookingReference.create({
    data: {
      id: 2,
      uid: "provider-event",
      type: "google_calendar",
      bookingId: 1,
      credentialId: 1,
      externalCalendarId: "right-calendar",
    },
  });
  assert.equal((await call("GET")).status, 200);
  assert.equal(state.provider[0].input.calendarId, "right-calendar");
});
test("committed ownership transfer is checked on the next identical request", async () => {
  assert.equal((await call("GET")).status, 200);
  await client.booking.update({ where: { id: 1 }, data: { userId: 2 } });
  const calls = state.provider.length;
  assert.equal((await call("GET")).status, 404);
  assert.equal(state.provider.length, calls);
});
test("primary failure never falls back to replica or provider", async () => {
  state.failedPrimary = true;
  assert.equal((await call("GET")).status, 500);
  assert.equal(state.replica, 0);
  assert.equal(state.oauth, 0);
});
for (const invalid of [undefined, null, 0, -1, 1.1, "1", NaN, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid internal owner ${String(invalid)} cannot drop the Prisma filter`, async () => {
    assert.equal(
      await repository.getBookingReferencesIncludeSensitiveCredentials("provider-event", invalid),
      null
    );
    assert.equal(state.primary, 0);
    assert.equal(state.replica, 0);
  });
}
test("sensitive lookup returns only provider-required metadata", async () => {
  const value = await repository.getBookingReferencesIncludeSensitiveCredentials("provider-event", 1);
  assert.deepEqual(Object.keys(value).sort(), [
    "booking",
    "credential",
    "delegationCredential",
    "externalCalendarId",
    "uid",
  ]);
  assert.deepEqual(Object.keys(value.credential), ["key"]);
});
