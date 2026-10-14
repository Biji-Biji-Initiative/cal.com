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
const memberDomain = load(
  "packages/features/community-enterprise/organizations/OrganizationMemberService.ts",
  {
    "node:crypto": require("node:crypto"),
    zod: require("zod"),
    "@calcom/prisma/client": { Prisma: {} },
    "@calcom/lib/errorCodes": { ErrorCode: {} },
    "@calcom/lib/errors": { ErrorWithCode: Error },
    "./OrganizationInvitationService": {
      organizationInvitationPrefix: "fixture",
      parseOrganizationInvitationBinding: () => {
        throw new Error("unexercised binding");
      },
    },
  }
);
const handoffDomain = load("packages/features/community-enterprise/scheduling/SchedulingHandoffService.ts", {
  "node:crypto": require("node:crypto"),
  zod: require("zod"),
  "@calcom/prisma/client": { Prisma: {} },
  "@calcom/lib/errorCodes": { ErrorCode: {} },
  "@calcom/lib/errors": { ErrorWithCode: Error },
});
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
    events(actor, input) {
      calls.push({ kind: "events", actor, input, db: this.db });
      return { items: [] };
    }
    options(actor, input) {
      calls.push({ kind: "options", actor, input, db: this.db });
      return { items: [] };
    }
    members(actor, input) {
      calls.push({ kind: "members", actor, input, db: this.db });
      return { items: [] };
    }
    commit(actor, input) {
      calls.push({ kind: "commit", actor, input, db: this.db });
      return { recorded: true, replayed: false };
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
    "@calcom/features/community-enterprise/scheduling/SchedulingHandoffService": {
      ...handoffDomain,
      SchedulingHandoffService: Service,
    },
    "@calcom/features/community-enterprise/organizations/OrganizationMemberService": {
      ...memberDomain,
      OrganizationMemberService: Service,
    },
    "node:crypto": require("node:crypto"),
    "@calcom/features/community-enterprise/organizations/sendOrganizationInvitationNotice": {
      sendOrganizationInvitationNotice: () => {
        throw new Error("Unexercised mail path");
      },
    },
    "@calcom/features/community-enterprise/organizations/OrganizationInvitationService": {
      OrganizationInvitationService: class {},
      invitationPageInput: require("zod").z.unknown(),
      inviteOrganizationMemberInput: require("zod").z.unknown(),
      invitationResponseInput: require("zod").z.unknown(),
      invitationAdminInput: require("zod").z.unknown(),
    },
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

const memberProposal = () => ({
  organizationId: 100,
  target: { id: 2, uuid: randomUUID() },
  operation: "remove",
  reviewHash: "a".repeat(64),
  requestId: randomUUID(),
});
for (const originValue of [undefined, "null", "https://foreign.example.test"])
  test(`member change refuses Origin ${originValue}`, async () => {
    const f = fixture();
    f.ctx.req.headers.origin = originValue;
    await assert.rejects(f.router.commitMemberChange(f.ctx, memberProposal()), /same-origin/);
    assert.equal(f.calls.length, 0);
  });
for (const extra of [
  { actorId: 1 },
  { role: "OWNER" },
  { accepted: true },
  { force: true },
  { skipReview: true },
])
  test(`member command rejects override ${JSON.stringify(extra)}`, async () => {
    const f = fixture();
    await assert.rejects(f.router.commitMemberChange(f.ctx, { ...memberProposal(), ...extra }));
    assert.equal(f.calls.length, 0);
  });
test("member changes retain authenticated actor and exact primary client", async () => {
  const f = fixture();
  const input = memberProposal();
  await f.router.commitMemberChange(f.ctx, input);
  assert.deepEqual(f.calls[0].actor, f.ctx.user);
  assert.equal(f.calls[0].db, f.ctx.prisma);
  assert.deepEqual(f.calls[0].input, input);
});
test("review and member list carry the same verified actor identity", async () => {
  const f = fixture();
  await f.router.reviewMemberChange(f.ctx, {
    organizationId: 100,
    target: { id: 2, uuid: randomUUID() },
    operation: "set-role",
    role: "ADMIN",
  });
  await f.router.organizationMembers(f.ctx, { organizationId: 100 });
  for (const call of f.calls) {
    assert.deepEqual(call.actor, f.ctx.user);
    assert.equal(call.db, f.ctx.prisma);
  }
});

const handoffRequest = () => ({
  organizationId: 100,
  source: { id: 2, uuid: randomUUID() },
  eventTypeId: 300,
  successor: { id: 3, uuid: randomUUID() },
  successorScheduleId: 200,
});
for (const route of ["reviewSchedulingHandoff", "commitSchedulingHandoff"]) {
  test(`${route} uses server subject and the configured primary service`, async () => {
    const f = fixture();
    const input = {
      ...handoffRequest(),
      ...(route.startsWith("commit") ? { requestId: randomUUID(), reviewHash: "a".repeat(64) } : {}),
    };
    await f.router[route](f.ctx, input);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0].actor, f.ctx.user);
    assert.equal(f.calls[0].db, f.ctx.prisma);
  });
  for (const changed of ["origin", "method", "actor"])
    test(`${route} rejects ${changed} before domain access`, async () => {
      const f = fixture();
      const input = {
        ...handoffRequest(),
        ...(route.startsWith("commit") ? { requestId: randomUUID(), reviewHash: "a".repeat(64) } : {}),
      };
      if (changed === "origin") f.ctx.req.headers.origin = "https://foreign.example.test";
      if (changed === "method") f.ctx.req.method = "GET";
      if (changed === "actor") input.actorId = 1;
      await assert.rejects(f.router[route](f.ctx, input));
      assert.equal(f.calls.length, 0);
    });
}
test("handoff event and successor discovery retain authenticated identity and validate resource IDs", async () => {
  const f = fixture();
  const input = handoffRequest();
  await f.router.handoffEvents(f.ctx, { organizationId: input.organizationId, source: input.source });
  await f.router.handoffOptions(f.ctx, {
    organizationId: input.organizationId,
    source: input.source,
    eventTypeId: input.eventTypeId,
  });
  assert.deepEqual(
    f.calls.map((c) => c.actor),
    [f.ctx.user, f.ctx.user]
  );
  await assert.rejects(
    f.router.handoffOptions(f.ctx, { organizationId: 100, source: input.source, eventTypeId: 0 })
  );
});
