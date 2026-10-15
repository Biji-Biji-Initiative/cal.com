// SPDX-License-Identifier: MIT
// Exact schemas and router, controlled procedure/service transport boundaries.
// Real role state and native HTTP behavior are tested in their separate suites.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
function load(file, imports) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  assert.deepEqual(output.diagnostics, []);
  const module = { exports: {} };
  new Function("require", "module", "exports", output.outputText)(
    (name) => {
      assert.ok(Object.hasOwn(imports, name), `Undeclared import: ${name}`);
      return imports[name];
    },
    module,
    module.exports
  );
  return module.exports;
}
const schemas = load("packages/features/community-enterprise/roles/roleInputs.ts", { zod: require("zod") });
const origin = "https://calendar.example.test";
function fixture() {
  const calls = [];
  const service = class {
    constructor(db) {
      this.db = db;
    }
    capability(actor, input) {
      calls.push({ kind: "capability", actor, input, db: this.db });
      return { canManageRoles: false };
    }
    catalog(actor, input) {
      calls.push({ kind: "catalog", actor, input, db: this.db });
      return {};
    }
    create(actor, input) {
      calls.push({ kind: "create", actor, input, db: this.db });
      return { roleId: "fixture" };
    }
    review(actor, input) {
      calls.push({ kind: "review", actor, input, db: this.db });
      return {};
    }
    assign(actor, input) {
      calls.push({ kind: "assign", actor, input, db: this.db });
      return { recorded: true };
    }
  };
  function procedure(gates = [], schema) {
    const invoke = (callback) => async (ctx, input) => {
      const step = (i) =>
        i === gates.length
          ? callback({ ctx, input: schema ? schema.parse(input) : input })
          : gates[i]({ ctx, next: () => step(i + 1) });
      return step(0);
    };
    return {
      input: (s) => procedure(gates, s),
      use: (gate) => procedure([...gates, gate], schema),
      query: invoke,
      mutation: invoke,
    };
  }
  const { enterpriseRolesRouter: router } = load(
    "packages/trpc/server/routers/viewer/enterpriseRoles/_router.ts",
    {
      "@calcom/features/community-enterprise/roles/ScopedRoleService": { ScopedRoleService: service },
      "@calcom/features/community-enterprise/roles/roleInputs": schemas,
      "@calcom/lib/constants": { WEBAPP_URL: origin },
      "@trpc/server": require("@trpc/server"),
      "../../../procedures/authedProcedure": procedure([
        ({ ctx, next }) => {
          assert.ok(ctx.user, "Native authentication required");
          return next();
        },
      ]),
      "../../../trpc": { router: (value) => value },
    }
  );
  return {
    router,
    calls,
    ctx: { user: { id: 7, uuid: randomUUID() }, prisma: {}, req: { method: "POST", headers: { origin } } },
  };
}
const create = () => ({
  organizationId: 100,
  scopeId: 10,
  name: "Reader",
  permissions: ["booking.readTeamBookings"],
  requestId: randomUUID(),
});
for (const header of [
  undefined,
  "null",
  "https://untrusted.example.test",
  "http://calendar.example.test",
  origin + ".evil",
  [origin],
])
  test(`incorrect Origin rejected ${JSON.stringify(header)}`, async () => {
    const f = fixture();
    f.ctx.req.headers.origin = header;
    await assert.rejects(f.router.create(f.ctx, create()), /same-origin/);
    assert.equal(f.calls.length, 0);
  });
for (const method of ["GET", "OPTIONS"])
  test(`mutation cannot use ${method}`, async () => {
    const f = fixture();
    f.ctx.req.method = method;
    await assert.rejects(f.router.create(f.ctx, create()), /same-origin/);
    assert.equal(f.calls.length, 0);
  });
test("actor binding comes only from the authenticated server identity", async () => {
  const f = fixture();
  await f.router.create(f.ctx, create());
  assert.deepEqual(f.calls[0].actor, f.ctx.user);
  assert.equal(f.calls[0].db, f.ctx.prisma);
});
for (const extra of [
  { actorId: 1 },
  { userId: 1 },
  { role: "OWNER" },
  { source: "directory" },
  { permissions: ["*"] },
  { permissions: ["booking.readOrgBookings"] },
])
  test(`caller cannot inject authority or unreviewed permissions ${JSON.stringify(extra)}`, async () => {
    const f = fixture();
    await assert.rejects(f.router.create(f.ctx, { ...create(), ...extra }));
    assert.equal(f.calls.length, 0);
  });
test("review and confirmation carry exact scope, target UUID and versioned request evidence", async () => {
  const f = fixture();
  const input = {
    organizationId: 100,
    scopeId: 10,
    target: { id: 9, uuid: randomUUID() },
    roleId: "fixture",
  };
  await f.router.review(f.ctx, input);
  const confirmed = { ...input, reviewHash: "a".repeat(64), requestId: randomUUID() };
  await f.router.assign(f.ctx, confirmed);
  assert.deepEqual(
    f.calls.map((call) => call.actor),
    [f.ctx.user, f.ctx.user]
  );
  assert.deepEqual(f.calls[1].input, confirmed);
  await assert.rejects(f.router.assign(f.ctx, { ...confirmed, target: { id: 9 } }));
});
test("unauthenticated queries cannot enumerate role or member metadata", async () => {
  const f = fixture();
  f.ctx.user = null;
  await assert.rejects(
    f.router.catalog(f.ctx, { organizationId: 100, scopeId: 10 }),
    /authentication required/
  );
  assert.equal(f.calls.length, 0);
});
