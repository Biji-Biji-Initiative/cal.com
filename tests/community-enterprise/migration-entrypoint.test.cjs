// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { test } = require("node:test");
const root = path.resolve(__dirname, "../..");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cal-migration-entrypoint-"));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  for (const folder of ["scripts", "ops/node_modules/prisma/build", "ops/packages/prisma", "apps/web"])
    fs.mkdirSync(path.join(directory, folder), { recursive: true });
  for (const name of ["enterprise-runtime-entrypoint.cjs", "check-enterprise-migration.sql"])
    fs.copyFileSync(path.join(root, "scripts", name), path.join(directory, "scripts", name));
  const sql = fs.readFileSync(path.join(directory, "scripts/check-enterprise-migration.sql"));
  const manifest = {
    schemaVersion: 1,
    sourceSha: "a".repeat(40),
    publicOrigin: "https://calendar.example.test",
    migrationPreflightSha256: createHash("sha256").update(sql).digest("hex"),
  };
  fs.writeFileSync(path.join(directory, "enterprise-build.json"), JSON.stringify(manifest));
  const trace = path.join(directory, "calls.jsonl");
  fs.writeFileSync(
    path.join(directory, "ops/node_modules/prisma/build/index.js"),
    `
    const fs = require('node:fs');
    const command = process.argv[2];
    fs.appendFileSync(process.env.FIXTURE_TRACE, JSON.stringify({command})+'\\n');
    if (command === 'db') {
      const text = fs.readFileSync(0,'utf8');
      if (!text.includes('BEGIN READ ONLY;')) process.exit(41);
      process.exit(Number(process.env.FIXTURE_PREFLIGHT_EXIT || 0));
    }
    if (command === 'migrate') process.exit(Number(process.env.FIXTURE_MIGRATION_EXIT || 0));
    process.exit(42);
  `
  );
  fs.writeFileSync(path.join(directory, "apps/web/server.js"), "console.log('WEB_WITHOUT_MIGRATION');");
  const env = {
    PATH: process.env.PATH,
    FIXTURE_TRACE: trace,
    DATABASE_URL: "postgresql://fixture@127.0.0.1:1/fixture",
    DATABASE_DIRECT_URL: "postgresql://fixture@127.0.0.1:1/fixture",
    CAL_ENTERPRISE_EXPECTED_DATABASE: "fixture",
    NEXT_PUBLIC_WEBAPP_URL: manifest.publicOrigin,
    NEXTAUTH_URL: `${manifest.publicOrigin}/api/auth`,
    NEXTAUTH_SECRET: "n".repeat(32),
    CALENDSO_ENCRYPTION_KEY: "e".repeat(32),
    CAL_AUTHENTIK_ENABLED: "true",
    CAL_AUTHENTIK_ONLY: "true",
    CAL_AUTHENTIK_ISSUER: "https://identity.example.test/application/o/cal",
    CAL_AUTHENTIK_CLIENT_ID: "fixture",
    CAL_AUTHENTIK_CLIENT_SECRET: "fixture-secret-not-live",
  };
  return {
    directory,
    env,
    run: (args = ["migrate"], overrides = {}) =>
      spawnSync(
        process.execPath,
        [path.join(directory, "scripts/enterprise-runtime-entrypoint.cjs"), ...args],
        { env: { ...env, ...overrides }, encoding: "utf8", timeout: 10000 }
      ),
    calls: () =>
      fs.existsSync(trace) ? fs.readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse) : [],
  };
}
test("packaged entrypoint runs read-only admission before migration", (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    f.calls().map((c) => c.command),
    ["db", "migrate"]
  );
});
test("preflight refusal propagates and migration never starts", (t) => {
  const f = fixture(t);
  const result = f.run(["migrate"], { FIXTURE_PREFLIGHT_EXIT: "19" });
  assert.equal(result.status, 19);
  assert.deepEqual(
    f.calls().map((c) => c.command),
    ["db"]
  );
});
test("migration failure is not rewritten into success", (t) => {
  const f = fixture(t);
  assert.equal(f.run(["migrate"], { FIXTURE_MIGRATION_EXIT: "23" }).status, 23);
});
test("missing or modified preflight cannot be bypassed", (t) => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.directory, "scripts/check-enterprise-migration.sql"), "\n-- modified\n");
  assert.notEqual(f.run().status, 0);
  assert.deepEqual(f.calls(), []);
  fs.unlinkSync(path.join(f.directory, "scripts/check-enterprise-migration.sql"));
  assert.notEqual(f.run().status, 0);
  assert.deepEqual(f.calls(), []);
});
test("web startup never performs a migration preflight or mutation", (t) => {
  const f = fixture(t);
  const result = f.run(["web"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WEB_WITHOUT_MIGRATION/);
  assert.deepEqual(f.calls(), []);
});
test("wrong target and extra arguments fail before starting any database command", (t) => {
  const f = fixture(t);
  assert.notEqual(f.run(["migrate"], { CAL_ENTERPRISE_EXPECTED_DATABASE: "another" }).status, 0);
  assert.notEqual(f.run(["migrate", "--bypass"]).status, 0);
  assert.deepEqual(f.calls(), []);
});
