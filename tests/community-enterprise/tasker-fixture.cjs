// SPDX-License-Identifier: MIT
// Exact source loader for the retained TaskRepository/Processor. Only default
// handler registration and application-global Prisma are injected; SQL, crypto,
// async execution context and the generated database client remain real.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const ts = require("typescript");
// SQL fragments must come from the SAME generated runtime as PrismaClient.
// Importing a second runtime's tag makes nested SQL objects become parameters.
const { PrismaClient, Prisma } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const root = path.resolve(__dirname, "../..");

function sourceModules(db, handlers = {}, config = {}, substitutions = {}, sourceOverrides = {}) {
  const cache = new Map();
  const load = (name) => {
    const file = [name, name + ".ts", path.join(name, "index.ts")].find(
      (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    );
    assert.ok(file, `Missing source ${name}`);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const source = ts.transpileModule(
      sourceOverrides[path.relative(root, file)] ?? fs.readFileSync(file, "utf8"),
      {
        fileName: file,
        reportDiagnostics: true,
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true,
        },
      }
    );
    assert.deepEqual(source.diagnostics, []);
    const nativeRequire = createRequire(file);
    new Function("require", "module", "exports", "__filename", "__dirname", source.outputText)(
      (entry) => {
        if (Object.hasOwn(substitutions, entry)) return substitutions[entry];
        if (entry === "@calcom/prisma") return { prisma: db };
        if (entry === "@calcom/prisma/client") return { Prisma };
        if (entry === "./tasks") return { __esModule: true, default: handlers, tasksConfig: config };
        if (entry.startsWith("@calcom/lib/"))
          return load(path.join(root, "packages/lib", entry.slice("@calcom/lib/".length)));
        if (entry.startsWith(".")) return load(path.resolve(path.dirname(file), entry));
        return nativeRequire(entry);
      },
      module,
      module.exports,
      file,
      path.dirname(file)
    );
    return module.exports;
  };
  const base = path.join(root, "packages/features/tasker");
  return {
    load: (file) => load(path.join(root, file)),
    ...load(path.join(base, "execution.ts")),
    ...load(path.join(base, "repository.ts")),
    ...load(path.join(base, "task-processor.ts")),
  };
}

async function connectFixture(max = 4) {
  const socket = process.env.CAL_ENTERPRISE_TEST_SOCKET;
  const data = process.env.CAL_ENTERPRISE_TEST_PGDATA;
  assert.ok(socket && data, "Use the existing isolated database runner");
  assert.equal(path.dirname(socket), path.dirname(data));
  assert.match(path.basename(path.dirname(socket)), /^cal-enterprise-/);
  const db = new PrismaClient({
    errorFormat: "minimal",
    adapter: new PrismaPg({
      host: socket,
      port: 55439,
      user: "cal_enterprise_test",
      database: "postgres",
      max,
    }),
  });
  const [identity] =
    await db.$queryRaw`SELECT current_setting('data_directory') AS directory, current_user::text AS actor`;
  assert.equal(identity.directory, data);
  assert.equal(identity.actor, "cal_enterprise_test");
  assert.equal(await db.user.count(), 0);
  return db;
}
module.exports = { sourceModules, connectFixture, root };
