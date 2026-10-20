// SPDX-License-Identifier: MIT
// Retain the actual listing engine/wrapper, policy, parsers and SQL. Only the
// unused application-global connection and diagnostic logging are substituted.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { sourceModules, root } = require("./tasker-fixture.cjs");

function compile(file, dependencies = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
    },
  });
  assert.deepEqual(output.diagnostics, []);
  const module = { exports: {} };
  new Function("require", "module", "exports", output.outputText)(
    (name) => {
      assert.ok(Object.hasOwn(dependencies, name), `Undeclared listing dependency: ${name}`);
      return dependencies[name];
    },
    module,
    module.exports
  );
  return module.exports;
}

function bookingListing(db) {
  const load = sourceModules(db).load;
  const schemas = load("packages/prisma/zod-utils.ts");
  const enums = load("packages/prisma/generated/prisma/enums.ts");
  const auth = "packages/features/community-enterprise/authorization/";
  const helpers = require("kysely/helpers/postgres");
  let wrapper;
  const { getBookings } = compile("packages/trpc/server/routers/viewer/bookings/get.handler.ts", {
    "@calcom/dayjs": load("packages/dayjs/index.ts"),
    "@calcom/features/bookings/lib/getAllUserBookings": {
      __esModule: true,
      default: (...args) => wrapper(...args),
    },
    "@calcom/features/community-enterprise/authorization/BookingVisibility": load(
      `${auth}BookingVisibility.ts`
    ),
    "@calcom/features/community-enterprise/authorization/KyselyPermissionStore": compile(
      `${auth}KyselyPermissionStore.ts`,
      { "kysely/helpers/postgres": helpers }
    ),
    "@calcom/features/community-enterprise/authorization/PermissionPolicy": load(
      `${auth}PermissionPolicy.ts`
    ),
    "@calcom/kysely": { __esModule: true, default: null },
    "@calcom/lib/isEventTypeColor": compile("packages/lib/isEventTypeColor.ts", {
      "@calcom/prisma/zod-utils": schemas,
    }),
    "@calcom/lib/isRecurringEvent": compile("packages/lib/isRecurringEvent.ts", {
      "@calcom/prisma/zod-utils": schemas,
    }),
    "@calcom/lib/logger": { __esModule: true, default: { getSubLogger: () => ({ debug() {}, info() {} }) } },
    "@calcom/lib/safeStringify": load("packages/lib/safeStringify.ts"),
    "@calcom/prisma/enums": enums,
    "@calcom/prisma/zod-utils": schemas,
    "@trpc/server": require("@trpc/server"),
    kysely: require("kysely"),
    "kysely/helpers/postgres": helpers,
  });
  wrapper = compile("packages/features/bookings/lib/getAllUserBookings.ts", {
    "@calcom/trpc/server/routers/viewer/bookings/get.handler": { getBookings },
  }).default;
  return { getBookings, getAllUserBookings: wrapper, schemas };
}
module.exports = { bookingListing, compile };
