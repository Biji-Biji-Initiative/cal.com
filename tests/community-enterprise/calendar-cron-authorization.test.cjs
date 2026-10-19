// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const process = require("node:process");
const { test } = require("node:test");
const { sourceModules } = require("./tasker-fixture.cjs");

const routes = [
  { name: "calendar-subscriptions", unauthorizedStatus: 403 },
  { name: "calendar-subscriptions-cleanup", unauthorizedStatus: 403 },
  { name: "selected-calendars", unauthorizedStatus: 401 },
];
const configured = {
  CRON_API_KEY: randomBytes(32).toString("hex"),
  CRON_SECRET: randomBytes(32).toString("hex"),
};

async function withConfiguration(config, run) {
  const previous = Object.fromEntries(Object.keys(configured).map((key) => [key, process.env[key]]));
  for (const key of Object.keys(configured)) {
    if (config[key] === undefined) delete process.env[key];
    else process.env[key] = config[key];
  }
  try {
    await run();
  } finally {
    for (const key of Object.keys(configured)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function fixture(route) {
  const work = { dependencies: 0, queries: 0, provider: 0 };
  class Repository {
    constructor() {
      work.dependencies++;
    }
  }
  class CacheService extends Repository {
    async cleanupStaleCache() {
      work.provider++;
    }
  }
  class SubscriptionService extends Repository {
    async isCacheEnabled() {
      return true;
    }
    async isSyncEnabled() {
      return false;
    }
    async checkForNewSubscriptions() {
      work.provider++;
    }
  }
  class HttpError extends Error {
    constructor({ statusCode, message }) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  const responder = (handler) => async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      return Response.json({ message: error.message }, { status: error.statusCode });
    }
  };
  const log = { info() {}, warn() {}, error() {}, debug() {} };
  const substitutions = {
    "next/server": { NextResponse: { json: Response.json.bind(Response) } },
    "@calcom/features/bookings/repositories/BookingRepository": { BookingRepository: Repository },
    "@calcom/features/calendar-subscription/adapters/AdaptersFactory": { DefaultAdapterFactory: Repository },
    "@calcom/features/calendar-subscription/lib/CalendarSubscriptionService": {
      CalendarSubscriptionService: SubscriptionService,
    },
    "@calcom/features/calendar-subscription/lib/cache/CalendarCacheEventRepository": {
      CalendarCacheEventRepository: Repository,
    },
    "@calcom/features/calendar-subscription/lib/cache/CalendarCacheEventService": {
      CalendarCacheEventService: CacheService,
    },
    "@calcom/features/calendar-subscription/lib/sync/CalendarSyncService": {
      CalendarSyncService: Repository,
    },
    "@calcom/features/di/containers/FeatureRepository": { getFeatureRepository: () => ({}) },
    "@calcom/features/di/containers/TeamFeatureRepository": { getTeamFeatureRepository: () => ({}) },
    "@calcom/features/di/containers/UserFeatureRepository": { getUserFeatureRepository: () => ({}) },
    "@calcom/features/selectedCalendar/repositories/SelectedCalendarRepository": {
      SelectedCalendarRepository: Repository,
    },
    "@calcom/features/credentials/repositories/CredentialRepository": {
      CredentialRepository: {
        async findAllDelegationByTypeIncludeUserAndTake() {
          work.queries++;
          return [];
        },
      },
    },
    "@calcom/app-store/delegationCredential": {
      findUniqueDelegationCalendarCredential: () => assert.fail("Unexpected provider lookup"),
    },
    "@calcom/app-store/googlecalendar/lib/CalendarService": {
      createGoogleCalendarServiceWithGoogleType: () => assert.fail("Unexpected provider creation"),
    },
    "@calcom/lib/CalendarAppError": {
      CalendarAppDelegationCredentialInvalidGrantError: class extends Error {},
    },
    "@calcom/lib/http-error": { HttpError },
    "@calcom/lib/logger": { __esModule: true, default: { getSubLogger: () => log } },
    "@calcom/lib/safeStringify": { safeStringify: JSON.stringify },
    "@calcom/web/app/api/defaultResponderForAppDir": { defaultResponderForAppDir: responder },
    "../../defaultResponderForAppDir": { defaultResponderForAppDir: responder },
  };
  const source = sourceModules({}, {}, {}, substitutions);
  substitutions["@calcom/features/tasker/api/authorization"] = source.load(
    "packages/features/tasker/api/authorization.ts"
  );
  const handler = source.load(`apps/web/app/api/cron/${route.name}/route.ts`).GET;
  return {
    work,
    invoke: ({ header, query } = {}) => {
      const url = new URL(`http://127.0.0.1/api/cron/${route.name}`);
      if (query !== undefined) url.searchParams.set("apiKey", query);
      const request = new Request(url, { headers: header === undefined ? {} : { authorization: header } });
      return handler(Object.assign(request, { nextUrl: url }));
    },
  };
}

const denied = [
  {
    name: "absent alternate secret",
    config: { CRON_API_KEY: configured.CRON_API_KEY },
    header: "Bearer undefined",
  },
  { name: "literal undefined", config: {}, header: "undefined" },
  { name: "literal null", config: {}, header: "Bearer null" },
  { name: "empty raw configuration", config: { CRON_API_KEY: "", CRON_SECRET: "" }, query: "" },
  { name: "blank raw configuration", config: { CRON_API_KEY: "  " }, query: "  " },
  { name: "empty bearer configuration", config: { CRON_SECRET: "" }, query: "Bearer " },
  { name: "blank bearer configuration", config: { CRON_SECRET: "  " }, query: "Bearer   " },
  { name: "missing credential", config: configured },
  { name: "wrong credential", config: configured, header: "Bearer wrong-fixture" },
  { name: "wrong bearer case", config: configured, header: `bearer ${configured.CRON_SECRET}` },
];

for (const route of routes) {
  for (const scenario of denied) {
    test(`${route.name} rejects ${scenario.name} before dependency or provider work`, async () => {
      await withConfiguration(scenario.config, async () => {
        const f = fixture(route);
        const response = await f.invoke(scenario);
        assert.equal(response.status, route.unauthorizedStatus);
        assert.deepEqual(f.work, { dependencies: 0, queries: 0, provider: 0 });
      });
    });
  }
  for (const [name, request] of [
    ["raw header", { header: configured.CRON_API_KEY }],
    ["raw query", { query: configured.CRON_API_KEY }],
    ["bearer header", { header: `Bearer ${configured.CRON_SECRET}` }],
    ["bearer query", { query: `Bearer ${configured.CRON_SECRET}` }],
  ]) {
    test(`${route.name} preserves configured ${name} authorization`, async () => {
      await withConfiguration(configured, async () => {
        const f = fixture(route);
        const response = await f.invoke(request);
        assert.equal(response.status, 200);
        assert.ok(f.work.dependencies + f.work.queries + f.work.provider > 0);
        const body = await response.text();
        assert.ok(!body.includes(configured.CRON_API_KEY));
        assert.ok(!body.includes(configured.CRON_SECRET));
        if (name === "raw query") {
          const before = { ...f.work };
          for (const query of [` ${configured.CRON_API_KEY}`, `${configured.CRON_API_KEY} `]) {
            assert.equal((await f.invoke({ query })).status, route.unauthorizedStatus);
          }
          assert.deepEqual(f.work, before);
          const padded = ` ${configured.CRON_API_KEY} `;
          await withConfiguration({ ...configured, CRON_API_KEY: padded }, async () => {
            const exact = fixture(route);
            assert.equal((await exact.invoke({ query: padded })).status, 200);
            const prior = { ...exact.work };
            assert.equal(
              (await exact.invoke({ query: configured.CRON_API_KEY })).status,
              route.unauthorizedStatus
            );
            assert.deepEqual(exact.work, prior);
          });
        }
      });
    });
  }
  test(`${route.name} does not fall back from an incorrect header to a valid query`, async () => {
    await withConfiguration(configured, async () => {
      const f = fixture(route);
      const response = await f.invoke({ header: "wrong-fixture", query: configured.CRON_API_KEY });
      assert.equal(response.status, route.unauthorizedStatus);
      assert.deepEqual(f.work, { dependencies: 0, queries: 0, provider: 0 });
    });
  });
  test(`${route.name} checks the current configuration on each invocation`, async () => {
    await withConfiguration(configured, async () => {
      const f = fixture(route);
      assert.equal((await f.invoke({ header: `Bearer ${configured.CRON_SECRET}` })).status, 200);
      const before = { ...f.work };
      delete process.env.CRON_SECRET;
      const response = await f.invoke({ header: `Bearer ${configured.CRON_SECRET}` });
      assert.equal(response.status, route.unauthorizedStatus);
      assert.deepEqual(f.work, before);
    });
  });
}
