// SPDX-License-Identifier: MIT
// Real generated Prisma client, PostgreSQL, production key services and crypto.
// This deliberately does not bootstrap unrelated application services or HTTP.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { randomUUID } = require("node:crypto");
const { before, beforeEach, after, test } = require("node:test");
const ts = require("typescript");
const { PrismaPg } = require("@prisma/adapter-pg");
const root = path.resolve(__dirname, "../..");
let client;
const cache = new Map();
function load(filename) {
  const file = [filename, `${filename}.ts`, `${filename}.tsx`].find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  );
  assert.ok(file, `Missing source: ${filename}`);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  assert.deepEqual(output.diagnostics, []);
  const nativeRequire = createRequire(file);
  new Function("require", "module", "exports", "__filename", "__dirname", output.outputText)(
    (name) => {
      if (name === "@calcom/prisma") return { __esModule: true, default: client, prisma: client };
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }) };
      if (name === "app/_utils") return { _generateMetadata: () => ({}) };
      if (name === "next/cache") return { unstable_cache: (fn) => fn };
      if (name === "next/headers") return { headers: async () => ({}), cookies: async () => ({}) };
      if (name === "next/navigation")
        return {
          redirect: () => {
            throw new Error("redirected");
          },
        };
      if (name === "@calcom/features/auth/lib/getServerSession")
        return { getServerSession: async () => ({ user: { id: 1 } }) };
      if (name === "@calcom/lib/constants") return { APP_NAME: "Fixture" };
      if (name === "@lib/buildLegacyCtx") return { buildLegacyRequest: () => ({}) };
      if (name === "~/settings/developer/api-keys-view") return { __esModule: true, default: "ApiKeysView" };
      if (name === "uuid") return { v4: randomUUID };
      if (name.startsWith("@calcom/")) return load(path.join(root, "packages", name.slice(8)));
      if (name.startsWith(".")) return load(path.resolve(path.dirname(file), name));
      return nativeRequire(name);
    },
    module,
    module.exports,
    file,
    path.dirname(file)
  );
  return module.exports;
}
const { PrismaClient } = load(path.join(root, "packages/prisma/generated/prisma/client.ts"));
const lifecycle = load(path.join(root, "packages/features/community-enterprise/api-keys/ApiKeyLifecycle.ts"));
const management = load(
  path.join(root, "packages/features/community-enterprise/api-keys/ApiKeyManagement.ts")
);
const crypto = load(path.join(root, "packages/features/api-keys-legacy/api-keys/lib/apiKeys.ts"));
const handlers = Object.fromEntries(
  ["list", "edit", "delete", "findKeyOfType"].map((name) => [
    name,
    load(path.join(root, `packages/trpc/server/routers/viewer/apiKeys/${name}.handler.ts`))[`${name}Handler`],
  ])
);
const ctx = (id = 1) => ({ user: { id }, prisma: client });
const future = (days = 1) => new Date(Date.now() + days * 86400000);
const forbidden = (error) => error.code === "forbidden_error";
const invalid = (error) => error.code === "bad_request_error";
const findSecret = (secret) =>
  client.apiKey.findUnique({ where: { hashedKey: crypto.hashAPIKey(secret.slice(4)) } });
async function key(userId = 1, teamId = 10, extra = {}) {
  const secret = await lifecycle.createApiKey(client, userId, { teamId: teamId ?? undefined, ...extra });
  return { ...(await findSecret(secret)), secret };
}
async function revoke(keyId, actor = 1) {
  return management.revokeApiKey(client, actor, keyId);
}
async function demote() {
  await client.membership.updateMany({ where: { userId: 1 }, data: { role: "MEMBER" } });
}

before(
  async () => {
    const socket = process.env.CAL_ENTERPRISE_TEST_SOCKET;
    const pgdata = process.env.CAL_ENTERPRISE_TEST_PGDATA;
    assert.ok(socket && pgdata, "Use the disposable database runner, never DATABASE_URL from an application");
    assert.ok(path.isAbsolute(socket) && path.isAbsolute(pgdata));
    assert.equal(path.dirname(socket), path.dirname(pgdata));
    assert.match(path.basename(path.dirname(socket)), /^cal-enterprise-/);
    client = new PrismaClient({
      adapter: new PrismaPg({
        host: socket,
        port: 55439,
        user: "cal_enterprise_test",
        database: "postgres",
        max: 4,
      }),
    });
    const [server] =
      await client.$queryRaw`SELECT current_setting('data_directory') AS directory, current_user::text AS username`;
    assert.equal(server.directory, pgdata);
    assert.equal(server.username, "cal_enterprise_test");
    assert.equal(await client.user.count(), 0, "Fixture database must be empty");
    await client.user.createMany({
      data: Array.from({ length: 4 }, (_, index) => ({
        id: index + 1,
        uuid: randomUUID(),
        email: `fixture-${index + 1}@example.test`,
        username: `key-fixture-${index + 1}`,
        locked: false,
      })),
    });
    await client.team.createMany({
      data: [
        { id: 100, name: "Organization A", isOrganization: true },
        { id: 200, name: "Organization B", isOrganization: true },
        { id: 30, name: "Standalone", isOrganization: false },
      ],
    });
    await client.team.createMany({
      data: [
        { id: 10, name: "Team A", parentId: 100 },
        { id: 20, name: "Team B", parentId: 200 },
      ],
    });
    await client.app.create({ data: { slug: "zapier", dirName: "zapier", categories: [] } });
  },
  { timeout: 30000 }
);
beforeEach(async () => {
  await client.webhook.deleteMany();
  await client.apiKey.deleteMany();
  await client.enterpriseAuditEvent.deleteMany();
  await client.membership.deleteMany();
  await client.user.updateMany({ data: { locked: false, role: "USER" } });
  await client.membership.createMany({
    data: [
      { userId: 1, teamId: 100, role: "OWNER", accepted: true },
      { userId: 1, teamId: 10, role: "OWNER", accepted: true },
      { userId: 2, teamId: 100, role: "ADMIN", accepted: true },
      { userId: 2, teamId: 10, role: "ADMIN", accepted: true },
      { userId: 3, teamId: 200, role: "OWNER", accepted: true },
      { userId: 3, teamId: 20, role: "OWNER", accepted: true },
      { userId: 1, teamId: 30, role: "OWNER", accepted: true },
    ],
  });
});
after(async () => {
  if (client) await client.$disconnect();
});

test("existing issuance creates only a hash and one organization audit", async () => {
  const created = await key();
  const row = await client.apiKey.findUnique({ where: { id: created.id } });
  assert.notEqual(row.hashedKey, created.secret);
  assert.equal(row.hashedKey, crypto.hashAPIKey(created.secret.slice(4)));
  assert.equal(await client.enterpriseAuditEvent.count({ where: { action: "api_key.created" } }), 1);
});
test("existing rotation consumes the old credential and preserves its bindings", async () => {
  const old = await key(1, 10, { appId: "zapier", note: "private-note" });
  const rotated = await lifecycle.rotateApiKey(client, 1, old.secret, { expiresAt: future(5) });
  assert.equal(await findSecret(old.secret), null);
  const row = await findSecret(rotated);
  assert.equal(row.teamId, 10);
  assert.equal(row.userId, 1);
  assert.equal(row.appId, "zapier");
  assert.equal(row.note, "private-note");
  assert.equal(await client.enterpriseAuditEvent.count({ where: { action: "api_key.rotated" } }), 1);
});
test("rotation refuses an expired credential against the actual database", async () => {
  const old = await key();
  await client.apiKey.update({ where: { id: old.id }, data: { expiresAt: new Date(0) } });
  await assert.rejects(lifecycle.rotateApiKey(client, 1, old.secret, {}), forbidden);
  assert.equal(await client.apiKey.count(), 1);
});
test("rotation refuses a different administrator even with the correct secret", async () => {
  const old = await key();
  await assert.rejects(lifecycle.rotateApiKey(client, 2, old.secret, {}), forbidden);
});
test("the actual list handler preserves private-key filtering and never returns hashes", async () => {
  const own = await key(1, null);
  await key(2, 10);
  await key(1, 10, { appId: "zapier" });
  await key(1, 10, { note: "Cal.ai Phone API Key internal" });
  const rows = await handlers.list({ ctx: ctx() });
  assert.deepEqual(
    rows.map((row) => row.id),
    [own.id]
  );
  assert.deepEqual(
    Object.keys(rows[0]).sort(),
    ["id", "userId", "teamId", "appId", "note", "createdAt", "expiresAt", "lastUsedAt"].sort()
  );
});
test("owner can list their metadata after demotion to recover and revoke keys", async () => {
  const own = await key();
  await demote();
  assert.equal((await handlers.list({ ctx: ctx() }))[0].id, own.id);
});
test("locked owners cannot enumerate metadata", async () => {
  await key();
  await client.user.update({ where: { id: 1 }, data: { locked: true } });
  await assert.rejects(handlers.list({ ctx: ctx() }), forbidden);
});
test("application lookup uses current accepted team membership and safe fields", async () => {
  const own = await key(1, 10, { appId: "zapier" });
  const rows = await handlers.findKeyOfType({ ctx: ctx(), input: { teamId: 10, appId: "zapier" } });
  assert.equal(rows[0].id, own.id);
  assert.equal("hashedKey" in rows[0], false);
  await client.membership.updateMany({ where: { userId: 1, teamId: 10 }, data: { accepted: false } });
  await assert.rejects(
    handlers.findKeyOfType({ ctx: ctx(), input: { teamId: 10, appId: "zapier" } }),
    forbidden
  );
});
test("application lookup cannot cross organization boundaries", async () => {
  await key(3, 20, { appId: "zapier" });
  await assert.rejects(
    handlers.findKeyOfType({ ctx: ctx(), input: { teamId: 20, appId: "zapier" } }),
    forbidden
  );
});
test("edit returns safe metadata and keeps the secret and ownership unchanged", async () => {
  const old = await key();
  const target = future(3);
  const updated = await handlers.edit({
    ctx: ctx(),
    input: { id: old.id, note: "revised note", expiresAt: target },
  });
  assert.equal(updated.note, "revised note");
  assert.equal(updated.expiresAt.getTime(), target.getTime());
  assert.equal("hashedKey" in updated, false);
  const row = await findSecret(old.secret);
  assert.equal(row.id, old.id);
  assert.equal(row.userId, 1);
  assert.equal(row.teamId, 10);
  const audit = await client.enterpriseAuditEvent.findFirst({ where: { action: "api_key.updated" } });
  assert.ok(audit);
  assert.ok(!JSON.stringify(audit).includes("revised note"));
  assert.ok(!JSON.stringify(audit).includes(old.hashedKey));
});
test("identical metadata retry does not duplicate the audit record", async () => {
  const old = await key();
  const input = { id: old.id, note: "same note" };
  await management.editApiKey(client, 1, input);
  await management.editApiKey(client, 1, input);
  assert.equal(await client.enterpriseAuditEvent.count({ where: { action: "api_key.updated" } }), 1);
});
test("note-only changes do not default or extend an expiration", async () => {
  const old = await key();
  await management.editApiKey(client, 1, { id: old.id, note: null });
  assert.equal((await findSecret(old.secret)).expiresAt.getTime(), old.expiresAt.getTime());
});
test("expired key can be relabelled but cannot be reactivated by edit", async () => {
  const old = await key();
  await client.apiKey.update({ where: { id: old.id }, data: { expiresAt: new Date(0) } });
  await management.editApiKey(client, 1, { id: old.id, note: "expired credential" });
  await assert.rejects(management.editApiKey(client, 1, { id: old.id, expiresAt: future() }), invalid);
  assert.equal((await findSecret(old.secret)).expiresAt.getTime(), 0);
});
test("demoted owner can rename and revoke but cannot extend a team credential", async () => {
  const old = await key();
  await demote();
  await management.editApiKey(client, 1, { id: old.id, note: "retire this" });
  await assert.rejects(management.editApiKey(client, 1, { id: old.id, expiresAt: future(2) }), forbidden);
  assert.deepEqual(await revoke(old.id), { id: old.id });
});
test("removed parent membership blocks lifetime changes but not owner revocation", async () => {
  const old = await key();
  await client.membership.deleteMany({ where: { userId: 1, teamId: 100 } });
  await assert.rejects(management.editApiKey(client, 1, { id: old.id, expiresAt: future(2) }), forbidden);
  await revoke(old.id);
  assert.equal(await client.apiKey.count(), 0);
});
for (const [field, value] of [
  ["teamId", 20],
  ["userId", 3],
  ["hashedKey", "replacement"],
  ["appId", "zapier"],
  ["neverExpires", true],
  ["expiresAt", null],
  ["note", {}],
]) {
  test(`direct edit cannot smuggle ${field}`, async () => {
    const old = await key();
    await assert.rejects(management.editApiKey(client, 1, { id: old.id, [field]: value }), invalid);
    assert.equal((await findSecret(old.secret)).id, old.id);
  });
}
for (const action of ["edit", "revoke"]) {
  test(`${action} denies another owner without revealing whether the key exists`, async () => {
    const old = await key();
    const invoke = (id) =>
      action === "edit" ? management.editApiKey(client, 2, { id, note: "bad" }) : revoke(id, 2);
    for (const id of [old.id, "missing-key"]) await assert.rejects(invoke(id), forbidden);
    assert.equal(await client.apiKey.count(), 1);
  });
  test(`${action} rejects a locked owner`, async () => {
    const old = await key();
    await client.user.update({ where: { id: 1 }, data: { locked: true } });
    await assert.rejects(
      action === "edit" ? management.editApiKey(client, 1, { id: old.id, note: "bad" }) : revoke(old.id),
      forbidden
    );
  });
}
test("real delete handler revokes the key and records its organization", async () => {
  const old = await key();
  assert.deepEqual(await handlers.delete({ ctx: ctx(), input: { id: old.id } }), { id: old.id });
  assert.equal(await findSecret(old.secret), null);
  const audit = await client.enterpriseAuditEvent.findFirst({ where: { action: "api_key.revoked" } });
  assert.equal(audit.organizationId, 100);
  assert.equal(audit.details.keyId, old.id);
  assert.ok(!JSON.stringify(audit).includes(old.secret));
});
test("a revoked ID cannot revoke another key on replay", async () => {
  const old = await key();
  const survivor = await key();
  await revoke(old.id);
  await assert.rejects(revoke(old.id), forbidden);
  assert.ok(await findSecret(survivor.secret));
  assert.equal(await client.enterpriseAuditEvent.count({ where: { action: "api_key.revoked" } }), 1);
});
async function hooks() {
  await client.webhook.createMany({
    data: [
      {
        id: "own-zap",
        userId: 1,
        appId: "zapier",
        subscriberUrl: "https://one.example.test/",
        eventTriggers: [],
      },
      {
        id: "other-zap",
        userId: 2,
        appId: "zapier",
        subscriberUrl: "https://two.example.test/",
        eventTriggers: [],
      },
      { id: "own-other", userId: 1, subscriberUrl: "https://three.example.test/", eventTriggers: [] },
    ],
  });
}
test("Zapier revocation atomically cleans only that owner's Zapier webhooks", async () => {
  const old = await key(1, 10, { appId: "zapier" });
  await hooks();
  await revoke(old.id);
  assert.deepEqual(
    (await client.webhook.findMany({ orderBy: { id: "asc" } })).map((row) => row.id),
    ["other-zap", "own-other"]
  );
});
test("revoking a regular key does not delete Zapier hooks", async () => {
  const old = await key();
  await hooks();
  await revoke(old.id);
  assert.equal(await client.webhook.count(), 3);
});
for (const action of ["edit", "revoke", "rotate"]) {
  test(`${action} rolls back on a real PostgreSQL audit constraint failure`, async (t) => {
    const old = await key(1, 10, { appId: "zapier", note: "before" });
    await hooks();
    await client.$executeRawUnsafe(
      `ALTER TABLE "EnterpriseAuditEvent" ADD CONSTRAINT "fixture_reject_new_audit" CHECK (action = 'api_key.created') NOT VALID`
    );
    t.after(() =>
      client.$executeRawUnsafe(
        `ALTER TABLE "EnterpriseAuditEvent" DROP CONSTRAINT "fixture_reject_new_audit"`
      )
    );
    const operation =
      action === "edit"
        ? management.editApiKey(client, 1, { id: old.id, note: "after" })
        : action === "revoke"
          ? revoke(old.id)
          : lifecycle.rotateApiKey(client, 1, old.secret, {});
    await assert.rejects(operation);
    assert.equal((await findSecret(old.secret)).note, "before");
    assert.equal(await client.apiKey.count(), 1);
    assert.equal(await client.webhook.count(), 3);
  });
}
test("personal and standalone credentials do not invent organization audit scope", async () => {
  const personal = await key(1, null);
  const standalone = await key(1, 30);
  await revoke(personal.id);
  await revoke(standalone.id);
  assert.equal(await client.enterpriseAuditEvent.count(), 0);
});

function synchronizedReaders(key) {
  let reads = 0;
  let release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  const guarded = client.$extends({
    query: {
      apiKey: {
        async findUnique({ args, query }) {
          const result = await query(args);
          if (args.where.id === key.id || args.where.hashedKey === key.hashedKey) {
            reads++;
            if (reads === 2) release();
            let timer;
            try {
              await Promise.race([
                ready,
                new Promise((_, reject) => {
                  timer = setTimeout(() => reject(new Error("Concurrent fixture did not overlap")), 5000);
                }),
              ]);
            } finally {
              clearTimeout(timer);
            }
          }
          return result;
        },
      },
    },
  });
  return { guarded, reads: () => reads };
}
test("two actual concurrent rotations cannot both consume the same credential", async () => {
  const old = await key();
  const { guarded, reads } = synchronizedReaders(old);
  const results = await Promise.allSettled([
    lifecycle.rotateApiKey(guarded, 1, old.secret, {}),
    lifecycle.rotateApiKey(guarded, 1, old.secret, {}),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(reads() >= 3, "Loser must retry and re-read current key state");
  assert.equal(await client.apiKey.count(), 1);
  assert.equal(await findSecret(old.secret), null);
  assert.equal(await client.enterpriseAuditEvent.count({ where: { action: "api_key.rotated" } }), 1);
});
test("concurrent revoke and rotation have one valid serial winner", async () => {
  const old = await key();
  const { guarded } = synchronizedReaders(old);
  const results = await Promise.allSettled([
    management.revokeApiKey(guarded, 1, old.id),
    lifecycle.rotateApiKey(guarded, 1, old.secret, {}),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await findSecret(old.secret), null);
  assert.equal(await client.apiKey.count(), results[1].status === "fulfilled" ? 1 : 0);
});
test("concurrent double revocation produces one deletion and one audit", async () => {
  const old = await key();
  const { guarded } = synchronizedReaders(old);
  const results = await Promise.allSettled([
    management.revokeApiKey(guarded, 1, old.id),
    management.revokeApiKey(guarded, 1, old.id),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await client.apiKey.count(), 0);
  assert.equal(await client.enterpriseAuditEvent.count({ where: { action: "api_key.revoked" } }), 1);
});

test("the actual settings page supplies metadata without hashes to its client component", async () => {
  const old = await key();
  const page = load(
    path.join(root, "apps/web/app/(use-page-wrapper)/settings/(settings-layout)/developer/api-keys/page.tsx")
  ).default;
  const rendered = await page();
  assert.equal(rendered.props.apiKeys[0].id, old.id);
  assert.equal("hashedKey" in rendered.props.apiKeys[0], false);
});

test("settings page no longer uses the one-hour legacy credential-row cache", () => {
  const file = path.join(
    root,
    "apps/web/app/(use-page-wrapper)/settings/(settings-layout)/developer/api-keys/page.tsx"
  );
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  assert.ok(
    !source.statements.some(
      (node) => ts.isImportDeclaration(node) && node.moduleSpecifier.text === "next/cache"
    )
  );
});
test("metadata date validation is finite and does not mutate the caller's Date", async () => {
  const old = await key();
  for (const expiresAt of [new Date("invalid"), new Date(0)]) {
    await assert.rejects(management.editApiKey(client, 1, { id: old.id, expiresAt }), invalid);
  }
  const expiresAt = future(3);
  const stamp = expiresAt.getTime();
  await management.editApiKey(client, 1, { id: old.id, expiresAt });
  assert.equal(expiresAt.getTime(), stamp);
});
test("unknown application and team filters cannot widen metadata results", async () => {
  await key();
  assert.deepEqual(await management.listApiKeyMetadata(client, 1, { appId: "nonexistent" }), []);
  await assert.rejects(management.listApiKeyMetadata(client, 1, { teamId: 999 }), forbidden);
  await assert.rejects(management.listApiKeyMetadata(client, 1, { userId: 2 }), invalid);
});
