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
