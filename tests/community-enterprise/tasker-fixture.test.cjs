// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const runtime = createRequire(path.resolve(__dirname, "../../packages/prisma/generated/prisma/client.ts"))(
  "@prisma/client/runtime/client"
);
const { PrismaPg } = require("@prisma/adapter-pg");

const fixturePath = path.join(__dirname, "tasker-fixture.cjs");
function fixture() {
  const module = { exports: {} };
  const nativeRequire = createRequire(fixturePath);
  new Function(
    "require",
    "module",
    "exports",
    "__filename",
    "__dirname",
    fs.readFileSync(fixturePath, "utf8")
  )(
    (entry) => {
      assert.notEqual(entry, "@prisma/client", "The fixture must not load the default generated client");
      return nativeRequire(entry);
    },
    module,
    module.exports,
    fixturePath,
    __dirname
  );
  return module.exports;
}

test("the fixture loads the custom client without installing a process-wide TypeScript hook", () => {
  const before = require.extensions[".ts"];
  const { PrismaClient, Prisma } = fixture();
  assert.equal(typeof PrismaClient, "function");
  assert.equal(typeof Prisma.sql, "function");
  assert.equal(require.extensions[".ts"], before);
});

test("database and application fixtures share the complete custom-generated client exports", () => {
  const loaded = fixture();
  const application = loaded.sourceModules(
    {},
    {},
    {},
    {},
    {
      "packages/features/tasker/task-processor.ts":
        'export { PrismaClient, Prisma } from "@calcom/prisma/client";',
    }
  );
  assert.equal(application.PrismaClient, loaded.PrismaClient);
  assert.equal(application.Prisma, loaded.Prisma);
  const second = loaded.sourceModules(
    {},
    {},
    {},
    {},
    {
      "packages/features/tasker/task-processor.ts":
        'export { PrismaClient, Prisma } from "@calcom/prisma/client";',
    }
  );
  assert.equal(second.PrismaClient, loaded.PrismaClient);
  assert.equal(second.Prisma, loaded.Prisma);
});

test("native SQL and join retain runtime identity and flatten nested fragments", () => {
  const { Prisma } = fixture();
  assert.equal(Prisma.sql, runtime.sqltag);
  assert.equal(Prisma.join, runtime.join);
  const conditions = [Prisma.sql`id = ${7}`, Prisma.sql`tenant = ${9}`];
  const query = Prisma.sql`SELECT id FROM tasks WHERE ${Prisma.join(conditions, " AND ")}`;
  assert.ok(query instanceof runtime.Sql);
  assert.equal(query.sql, "SELECT id FROM tasks WHERE id = ? AND tenant = ?");
  assert.deepEqual(query.values, [7, 9]);
});

test("the custom client constructs with the native adapter without opening a database connection", async () => {
  const { PrismaClient, Prisma } = fixture();
  const client = new PrismaClient({ adapter: new PrismaPg({ host: "/nonexistent-tasker-fixture-socket" }) });
  try {
    assert.equal(client._clientVersion, Prisma.prismaVersion.client);
    assert.equal(typeof client.task.findMany, "function");
    assert.equal(typeof client.$queryRaw, "function");
  } finally {
    await client.$disconnect();
  }
});

test("the actual TaskRepository receives native nested SQL rather than fragment parameters", async () => {
  const { sourceModules } = fixture();
  const db = { $queryRaw: runtime.sqltag };
  const { TaskRepository } = sourceModules(db);
  const query = await new TaskRepository({ prismaClient: db }).getNextBatch();
  assert.ok(query instanceof runtime.Sql);
  assert.match(query.sql, /clock_timestamp\(\)/);
  assert.match(query.sql, /"lastError" NOT LIKE \?/);
  assert.deepEqual(query.values, ["tasker:v1:running:%", "tasker:v1:unconfirmed:%"]);
});
