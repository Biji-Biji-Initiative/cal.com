// SPDX-License-Identifier: MIT
// Production schemas/router, controlled procedure/service boundaries. Native
// HTTP, operator identity and database behavior are exercised by other suites.
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
      assert.ok(Object.hasOwn(imports, name), `Unspecified import ${name}`);
      return imports[name];
    },
    module,
    module.exports
  );
  return module.exports;
}
const domain = load(
  "packages/features/community-enterprise/organizations/OrganizationProvisioningService.ts",
  {
    "node:crypto": require("node:crypto"),
    zod: require("zod"),
    "@calcom/prisma/client": { Prisma: {} },
    "@calcom/lib/errorCodes": { ErrorCode: {} },
    "@calcom/lib/errors": { ErrorWithCode: Error },
  }
);
const origin = "https://calendar.example.test";
function fixture() {
  const calls = [];
  function chain(gates = [], schema) {
    const make = (callback) => async (ctx, input) => {
      const execute = async (at) =>
        at === gates.length
          ? callback({ ctx, input: schema ? schema.parse(input) : input })
          : gates[at]({ ctx, next: () => execute(at + 1) });
      return execute(0);
    };
    return {
      use: (gate) => chain([...gates, gate], schema),
      input: (validator) => chain(gates, validator),
      mutation: make,
      query: make,
    };
  }
  class Service {
    constructor(db) {
      this.db = db;
    }
    capabilities(actor) {
      calls.push({ kind: "capabilities", actor, db: this.db });
      return { canProvision: true };
    }
    review(actor, input) {
      calls.push({ kind: "review", actor, input, db: this.db });
      return { input };
    }
    provision(actor, input) {
      calls.push({ kind: "provision", actor, input, db: this.db });
      return { organizationId: 100, replayed: false };
    }
  }
  const { enterpriseTeamsRouter } = load("packages/trpc/server/routers/viewer/enterpriseTeams/_router.ts", {
    "@calcom/features/community-enterprise/organizations/OrganizationProvisioningService": {
      ...domain,
      OrganizationProvisioningService: Service,
    },
    "@calcom/features/community-enterprise/teams/TeamService": {
      TeamService: class {},
      createTeamInput: require("zod").z.unknown(),
      setMemberInput: require("zod").z.unknown(),
    },
    "@calcom/lib/constants": { WEBAPP_URL: origin },
    "@trpc/server": require("@trpc/server"),
    "../../../procedures/authedProcedure": chain([
      ({ ctx, next }) => {
        assert.ok(ctx.user, "Authenticated procedure rejected");
        return next();
      },
    ]),
    "../../../trpc": { router: (entries) => entries },
  });
  return {
    router: enterpriseTeamsRouter,
    calls,
    ctx: { user: { id: 7, uuid: randomUUID() }, prisma: {}, req: { method: "POST", headers: { origin } } },
  };
}
const proposal = () => ({
  name: "Fixture",
  slug: "fixture",
  timeZone: "UTC",
  owner: { id: 2, uuid: randomUUID() },
  members: [],
  requestId: randomUUID(),
});
for (const received of [
  undefined,
  "null",
  "https://other.example.test",
  "http://calendar.example.test",
  "https://calendar.example.test.evil",
  [origin],
])
  test(`privileged mutation refuses incorrect Origin ${JSON.stringify(received)}`, async () => {
    const f = fixture();
    f.ctx.req.headers.origin = received;
    await assert.rejects(f.router.provisionOrganization(f.ctx, proposal()), /same-origin operator interface/);
    assert.equal(f.calls.length, 0);
  });
for (const method of ["GET", "HEAD", "OPTIONS"])
  test(`privileged mutation refuses ${method}`, async () => {
    const f = fixture();
    f.ctx.req.method = method;
    await assert.rejects(f.router.provisionOrganization(f.ctx, proposal()), /same-origin operator interface/);
    assert.equal(f.calls.length, 0);
  });
test("actual router forwards only server-resolved actor and primary client", async () => {
  const f = fixture();
  const input = proposal();
  const result = await f.router.provisionOrganization(f.ctx, input);
  assert.equal(result.organizationId, 100);
  assert.deepEqual(f.calls[0].actor, f.ctx.user);
  assert.equal(f.calls[0].db, f.ctx.prisma);
  assert.deepEqual(f.calls[0].input, input);
});
test("review also requires same-origin and capability discovery does not enumerate accounts", async () => {
  const f = fixture();
  const input = {
    name: "Fixture",
    slug: "fixture",
    timeZone: "UTC",
    ownerEmail: "member@example.test",
    memberEmails: [],
  };
  delete f.ctx.req.headers.origin;
  await assert.rejects(f.router.reviewOrganization(f.ctx, input), /same-origin/);
  assert.deepEqual(await f.router.provisioningCapabilities(f.ctx), { canProvision: true });
  f.ctx.req.headers.origin = origin;
  await f.router.reviewOrganization(f.ctx, input);
  assert.deepEqual(f.calls[1].actor, f.ctx.user);
});
for (const extra of [
  { actorId: 1 },
  { operator: true },
  { role: "ADMIN" },
  { isOrganizationVerified: true },
  { orgAutoJoinOnSignup: true },
  { parentId: 100 },
])
  test(`caller cannot supply authority or policy fields ${JSON.stringify(extra)}`, async () => {
    const f = fixture();
    await assert.rejects(f.router.provisionOrganization(f.ctx, { ...proposal(), ...extra }));
    assert.equal(f.calls.length, 0);
  });
test("bounded schema refuses too many admissions or malformed stable identities", () => {
  assert.equal(
    domain.provisionOrganizationInput.safeParse({
      ...proposal(),
      members: Array.from({ length: 20 }, (_, i) => ({ id: i + 10, uuid: randomUUID() })),
    }).success,
    false
  );
  assert.equal(
    domain.provisionOrganizationInput.safeParse({ ...proposal(), owner: { id: 2, uuid: "stale" } }).success,
    false
  );
});
