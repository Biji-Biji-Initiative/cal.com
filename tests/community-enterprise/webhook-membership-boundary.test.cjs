// SPDX-License-Identifier: MIT
// Execute the retained procedure; explicit database/policy doubles isolate the
// resource-scope decision. The native member journey also checks real HTTP/DB.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const filename = "packages/trpc/server/routers/viewer/webhook/util.ts";
function fixture() {
  const state = {
    webhook: {
      id: "fixture",
      userId: null,
      teamId: 100,
      eventTypeId: null,
      platform: false,
      platformOAuthClientId: null,
    },
    event: null,
    operator: { role: "USER", locked: false },
    allowed: false,
    calls: [],
  };
  const text =
    process.env.CAL_WEBHOOK_BASELINE === "true"
      ? execFileSync("git", ["show", `260c7cbba8b618d34b2f2ebd6c6e4d35f831892b:${filename}`], {
          cwd: root,
          encoding: "utf8",
        })
      : fs.readFileSync(path.join(root, filename), "utf8");
  const output = ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const db = {
    webhook: { findUnique: async () => state.webhook },
    eventType: { findUnique: async () => state.event },
    user: { findUnique: async () => state.operator },
  };
  const imports = {
    "@calcom/prisma": { prisma: db },
    "@trpc/server": require("@trpc/server"),
    "../../../procedures/authedProcedure": { input: () => ({ use: (callback) => callback }) },
    "./types": { webhookIdAndEventTypeIdSchema: require("zod").z.unknown() },
    "@calcom/features/community-enterprise/authorization/PermissionCheckService": {
      PermissionCheckService: class {
        constructor(client) {
          assert.equal(client, db);
        }
        async checkPermission(input) {
          state.calls.push(input);
          return state.allowed;
        }
      },
    },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(
    (name) => {
      assert.ok(Object.hasOwn(imports, name), name);
      return imports[name];
    },
    module,
    module.exports
  );
  state.run = (input = { id: "fixture" }) =>
    module.exports.createWebhookProcedure()({
      ctx: { user: { id: 7, role: "ADMIN" } },
      input,
      next: () => "allowed",
    });
  return state;
}
test("ownerless team webhook needs current scoped authority", async () => {
  const f = fixture();
  await assert.rejects(f.run(), /FORBIDDEN/);
  assert.equal(f.calls[0].teamId, 100);
});
test("historical personal ownership cannot bypass removed organization authority", async () => {
  const f = fixture();
  f.webhook.userId = 7;
  await assert.rejects(f.run(), /FORBIDDEN/);
});
test("current team authority preserves the supported shared-team path", async () => {
  const f = fixture();
  f.allowed = true;
  assert.equal(await f.run(), "allowed");
});
test("personal webhook ownership remains independent of organization membership", async () => {
  const f = fixture();
  f.webhook.userId = 7;
  f.webhook.teamId = null;
  assert.equal(await f.run(), "allowed");
  assert.equal(f.calls.length, 0);
});
test("another person's personal webhook remains private", async () => {
  const f = fixture();
  f.webhook.userId = 8;
  f.webhook.teamId = null;
  await assert.rejects(f.run(), /FORBIDDEN/);
});
test("unowned and unscoped webhook is not public administration", async () => {
  const f = fixture();
  f.webhook.teamId = null;
  await assert.rejects(f.run(), /FORBIDDEN/);
});
test("conflicting lookup identifiers cannot authorize a different handler target", async () => {
  const f = fixture();
  f.allowed = true;
  await assert.rejects(f.run({ id: "fixture", webhookId: "another" }), /BAD_REQUEST/);
});
test("platform webhook does not trust a stale instance-admin session hint", async () => {
  const f = fixture();
  f.webhook.teamId = null;
  f.webhook.platform = true;
  await assert.rejects(f.run(), /FORBIDDEN/);
  f.operator.role = "ADMIN";
  assert.equal(await f.run(), "allowed");
  f.operator.locked = true;
  await assert.rejects(f.run(), /FORBIDDEN/);
});
test("client-bound webhook cannot borrow an ordinary browser session", async () => {
  const f = fixture();
  f.allowed = true;
  f.webhook.platformOAuthClientId = "client";
  await assert.rejects(f.run(), /FORBIDDEN/);
});
test("event-level owner must still hold its organizational authority", async () => {
  const f = fixture();
  f.webhook.teamId = null;
  f.webhook.eventTypeId = 9;
  f.event = { id: 9, userId: 7, teamId: 100 };
  await assert.rejects(f.run(), /FORBIDDEN/);
  f.allowed = true;
  assert.equal(await f.run(), "allowed");
});
test("contradictory event and webhook organization scopes fail closed", async () => {
  const f = fixture();
  f.allowed = true;
  f.webhook.eventTypeId = 9;
  f.event = { id: 9, userId: 7, teamId: 200 };
  await assert.rejects(f.run(), /FORBIDDEN/);
});
test("event creation input is checked against its own scope", async () => {
  const f = fixture();
  f.event = { id: 9, userId: 7, teamId: null, profile: { organizationId: 100 } };
  await assert.rejects(f.run({ eventTypeId: 9 }), /FORBIDDEN/);
  f.allowed = true;
  assert.equal(await f.run({ eventTypeId: 9 }), "allowed");
});
