// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
function render(data, organizationId) {
  const file = path.join(root, "apps/web/modules/settings/enterprise/organization-invitations.tsx");
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  assert.deepEqual(output.diagnostics, []);
  const module = { exports: {} };
  const operations = { invitations: { useQuery: () => ({ data, isPending: false }) } };
  for (const name of ["inviteMember", "respondToInvitation", "cancelInvitation", "resendInvitation"])
    operations[name] = { useMutation: () => ({ isPending: false }) };
  const imports = {
    "react/jsx-runtime": require("react/jsx-runtime"),
    react: { useRef: (value) => ({ current: value }), useState: (value) => [value, () => {}] },
    "@calcom/lib/hooks/useLocale": { useLocale: () => ({ t: (key) => key }) },
    "@calcom/trpc/react": { trpc: { viewer: { enterpriseTeams: operations }, useUtils: () => ({}) } },
    "@calcom/ui/components/button": { Button: "button" },
  };
  new Function("require", "module", "exports", output.outputText)(
    (name) => {
      assert.ok(Object.hasOwn(imports, name));
      return imports[name];
    },
    module,
    module.exports
  );
  return module.exports.default({ organizationId });
}
function flatten(node) {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (!node || typeof node !== "object") return [];
  return [node, ...flatten(node.props?.children)];
}
test("truly empty personal inbox may stay hidden", () =>
  assert.equal(render({ items: [], nextCursor: null }), null));
test("filtered empty first page must retain access to a valid continuation", () => {
  const tree = render({ items: [], nextCursor: 51 });
  assert.ok(tree);
  assert.ok(flatten(tree).some((node) => node.props?.children === "enterprise_invites_next_page"));
});
test("an administrator always retains the creation panel even with no pending rows", () => {
  assert.ok(
    flatten(render({ items: [], nextCursor: null }, 100)).some(
      (node) => node.props?.["data-testid"] === "invite-organization-member"
    )
  );
});
test("non-actionable consent is disabled without hiding the decline action", () => {
  const tree = render({
    items: [
      {
        id: 7,
        organizationName: "Fixture",
        expires: new Date(),
        actionable: false,
        recipient: { email: "fixture@example.test" },
      },
    ],
    nextCursor: null,
  });
  const nodes = flatten(tree);
  assert.equal(
    nodes.find((node) => node.props?.children === "enterprise_accept_invitation").props.disabled,
    true
  );
  assert.equal(
    nodes.find((node) => node.props?.children === "enterprise_decline_invitation").props.disabled,
    false
  );
});

test("invitation expiry includes an exact machine-readable instant", () => {
  const expires = new Date("2026-10-21T11:00:00.000Z");
  const tree = render({
    items: [
      {
        id: 7,
        organizationName: "Fixture",
        expires,
        actionable: true,
        recipient: { email: "fixture@example.test" },
      },
    ],
    nextCursor: null,
  });
  const time = flatten(tree).find((node) => node.type === "time");
  assert.ok(time);
  assert.equal(time.props.dateTime, expires.toISOString());
});

// Execute the actual page reader with explicit in-memory query boundaries. This
// checks bounded hydration and policy equivalence, not PostgreSQL performance.
function inboxReader() {
  class ErrorWithCode extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  const file = "packages/features/community-enterprise/organizations/OrganizationInvitationService.ts";
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });
  assert.deepEqual(output.diagnostics, []);
  const module = { exports: {} };
  const imports = {
    "node:crypto": require("node:crypto"),
    "@calcom/lib/errorCodes": { ErrorCode: { Forbidden: "FORBIDDEN", BadRequest: "BAD_REQUEST" } },
    "@calcom/lib/errors": { ErrorWithCode },
    "@calcom/prisma/client": { Prisma: {} },
    zod: require("zod"),
    "../../tasker/execution": {},
    "./InvitationNoticeDelivery": {},
    "./InvitationNoticeOutbox": {},
  };
  new Function("require", "module", "exports", output.outputText)(
    (name) => {
      assert.ok(Object.hasOwn(imports, name), `Unreviewed page dependency ${name}`);
      return imports[name];
    },
    module,
    module.exports
  );
  return module.exports;
}
function pageFixture() {
  const { randomUUID } = require("node:crypto");
  const { OrganizationInvitationService, organizationInvitationPrefix } = inboxReader();
  const actor = { id: 2, uuid: randomUUID() },
    issuer = { id: 1, uuid: randomUUID() };
  const users = [actor, issuer].map((u) => ({
    ...u,
    name: "Fixture",
    email: `${u.id}@example.test`,
    locked: false,
    isPlatformManaged: false,
    emailVerified: new Date(),
  }));
  const roots = Array.from({ length: 51 }, (_, i) => ({
    id: 100 + i,
    name: `Root ${i}`,
    parentId: null,
    isOrganization: true,
    pendingPayment: false,
    dsyncTeamGroupMapping: [],
  }));
  const members = roots.flatMap((org, i) => [
    { id: i * 2 + 1, teamId: org.id, userId: 2, role: "MEMBER", accepted: false, customRoleId: null },
    { id: i * 2 + 2, teamId: org.id, userId: 1, role: "OWNER", accepted: true, customRoleId: null },
  ]);
  const rows = roots.map((org, i) => ({
    id: i + 1,
    teamId: org.id,
    createdAt: new Date(0),
    expires: new Date(Date.now() + 60000),
    identifier: `${organizationInvitationPrefix}${actor.uuid}:${JSON.stringify({ recipient: actor, issuer, membershipId: i * 2 + 1 })}`,
  }));
  const fixture = { rows, roots, members, users, actor, calls: [], fail: false };
  const count = (name) => fixture.calls.push(name);
  const tx = {
    user: {
      async findUnique({ where }) {
        count("actor");
        return users.find((u) => u.id === where.id);
      },
      async findMany({ where }) {
        count("users");
        return users.filter((u) => where.id.in.includes(u.id));
      },
    },
    verificationToken: {
      async findMany({ where, take, orderBy }) {
        count("page");
        assert.equal(take, 51);
        assert.deepEqual(orderBy, { id: "asc" });
        return rows
          .filter((r) => r.id > (where.id?.gt ?? 0) && r.identifier.startsWith(where.identifier.startsWith))
          .slice(0, take);
      },
    },
    membership: {
      async findMany({ where }) {
        count("members");
        if (fixture.fail) throw new Error("fixture query unavailable");
        return members.filter((m) =>
          where.OR.some(
            (item) => item.id?.in.includes(m.id) || (item.userId === m.userId && item.teamId === m.teamId)
          )
        );
      },
    },
    team: {
      async findMany({ where }) {
        count("roots");
        return roots.filter((o) => where.id.in.includes(o.id));
      },
    },
    async $queryRaw() {
      count("clock");
      return [{ milliseconds: Date.now() }];
    },
  };
  fixture.service = new OrganizationInvitationService({
    async $transaction(work, options) {
      assert.equal(options.isolationLevel, "RepeatableRead");
      assert.equal(options.timeout, 10000);
      return work(tx);
    },
  });
  return fixture;
}
test("the page reader hydrates fifty invitations without per-row database calls", async () => {
  const f = pageFixture();
  const first = await f.service.pending(f.actor, {});
  assert.equal(first.items.length, 50);
  assert.equal(first.nextCursor, 50);
  assert.ok(first.items.every((row) => row.actionable));
  assert.equal(f.calls.length, 6);
  assert.equal(f.calls.filter((n) => n === "users").length, 1);
  f.calls.length = 0;
  const next = await f.service.pending(f.actor, { cursor: first.nextCursor });
  assert.equal(next.items.length, 1);
  assert.equal(next.nextCursor, null);
  assert.equal(f.calls.length, 6);
  assert.equal(new Set([...first.items, ...next.items].map((r) => r.id)).size, 51);
  for (const value of ["identifier", f.actor.uuid]) assert.ok(!JSON.stringify(first).includes(value));
});
test("batched member and root data cannot turn foreign or withdrawn grants into an actionable invitation", async () => {
  const f = pageFixture();
  f.members[0].teamId = 200;
  f.members[2].accepted = true;
  f.roots[2].pendingPayment = true;
  f.roots[3].dsyncTeamGroupMapping = [{ id: "directory" }];
  f.members[9].role = "MEMBER";
  f.members[11].customRoleId = "scoped-role";
  const page = await f.service.pending(f.actor, {});
  assert.deepEqual(
    page.items.slice(0, 2).map((x) => [x.id, x.actionable]),
    [
      [5, false],
      [6, false],
    ]
  );
  assert.equal(page.items.length, 46);
  assert.equal(page.nextCursor, 50);
});
test("malformed rows still advance a full page's continuation without hiding later invitations", async () => {
  const f = pageFixture();
  f.rows.slice(0, 50).forEach((row) => {
    row.identifier = row.identifier.split(":").slice(0, 3).join(":") + ":bad-json";
  });
  const page = await f.service.pending(f.actor, {});
  assert.deepEqual(page.items, []);
  assert.equal(page.nextCursor, 50);
  assert.equal((await f.service.pending(f.actor, { cursor: page.nextCursor })).items[0].id, 51);
});
test("an unavailable batch query rejects the page instead of pretending it is empty", async () => {
  const f = pageFixture();
  f.fail = true;
  await assert.rejects(f.service.pending(f.actor, {}), /fixture query unavailable/);
});
