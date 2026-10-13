// SPDX-License-Identifier: MIT
// Real existing API-key controller, DTO, service, Passport guards, native JWE,
// generated Prisma and PostgreSQL. Unrelated application modules stay isolated.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { before, beforeEach, after, test } = require("node:test");
const { randomUUID, randomBytes, createHash } = require("node:crypto");
const ts = require("typescript");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ConfigService } = require("@nestjs/config");
const { ValidationPipe, BadRequestException, VersioningType } = require("@nestjs/common");
const { encode } = require("next-auth/jwt");
const { createApiRuntime, fixtureModules } = require("./api-runtime-fixture.cjs");
const root = path.resolve(__dirname, "../..");
let client, runtime, lifecycle, state, keyCrypto, controllerService;
const issuer = "https://identity.example.test/application/o/calendar";
const secret = randomBytes(32).toString("hex");
const accountId = createHash("sha256")
  .update(JSON.stringify([issuer, "subject-one"]))
  .digest("hex");
const savedEnvironment = Object.fromEntries(
  ["CAL_AUTHENTIK_ENABLED", "CAL_AUTHENTIK_ONLY", "CAL_AUTHENTIK_ISSUER", "NEXTAUTH_URL"].map((name) => [
    name,
    process.env[name],
  ])
);

// Extract the real bootstrap expressions so the fixture cannot silently use
// more permissive validation/versioning than the production entrypoint.
function configureHttp(app, constants) {
  const file = path.join(root, "apps/api/v2/src/bootstrap.ts");
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const selections = { validation: [], versioning: [] };
  const visit = (node) => {
    if (ts.isNewExpression(node) && node.expression.getText(source) === "ValidationPipe")
      selections.validation.push(node);
    if (ts.isCallExpression(node) && node.expression.getText(source) === "app.enableVersioning")
      selections.versioning.push(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(selections.validation.length, 1);
  assert.equal(selections.versioning.length, 1);
  const dependencies = { ValidationPipe, BadRequestException, VersioningType, ...constants };
  const evaluate = (node) => {
    const output = ts.transpileModule(`const result = ${node.getText(source)};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    return new Function(...Object.keys(dependencies), `${output}\nreturn result;`)(
      ...Object.values(dependencies)
    );
  };
  app.useGlobalPipes(evaluate(selections.validation[0]));
  app.enableVersioning(evaluate(selections.versioning[0]));
}

async function send(key, body = {}, headers = {}) {
  const response = await fetch(`${runtime.origin}/v2/api-keys/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}
const issue = (teamId = 10, options = {}, userId = 1) =>
  lifecycle.createApiKey(
    client,
    userId,
    { teamId: teamId ?? undefined, ...options },
    state.config.get("api.keyPrefix")
  );
const row = (key) =>
  client.apiKey.findUnique({
    where: { hashedKey: keyCrypto.hashAPIKey(key.slice(state.config.get("api.keyPrefix").length)) },
  });
async function cookie() {
  const token = {
    sub: "1",
    email: "old@example.test",
    upId: "usr-1",
    authentik: { version: 1, issuer, accountId, bindingId: "binding-one", userId: 1 },
  };
  return `next-auth.session-token=${await encode({ token, secret, maxAge: 3600 })}`;
}
const auditCount = () => client.enterpriseAuditEvent.count({ where: { action: "api_key.rotated" } });

before(
  async () => {
    const socket = process.env.CAL_ENTERPRISE_TEST_SOCKET;
    const directory = process.env.CAL_ENTERPRISE_TEST_PGDATA;
    assert.ok(
      socket && directory,
      "Use the isolated DB runner; never default to an application DATABASE_URL"
    );
    assert.equal(path.dirname(socket), path.dirname(directory));
    assert.match(path.basename(path.dirname(socket)), /^cal-enterprise-/);
    state = {
      primary: { prisma: null },
      replicaReads: 0,
      staleUser: { id: 1, role: "ADMIN", locked: false },
      config: new ConfigService({
        api: { keyPrefix: "cal_" },
        next: { authSecret: secret },
        app: { baseUrl: "https://calendar.example.test" },
      }),
    };
    const { load } = fixtureModules(state);
    const { PrismaClient } = load(path.join(root, "packages/prisma/generated/prisma/client.ts"));
    client = new PrismaClient({
      adapter: new PrismaPg({
        host: socket,
        port: 55439,
        user: "cal_enterprise_test",
        database: "postgres",
        max: 4,
      }),
    });
    state.primary.prisma = client;
    const [identity] =
      await client.$queryRaw`SELECT current_setting('data_directory') AS directory, current_user::text AS username`;
    assert.equal(identity.directory, directory);
    assert.equal(identity.username, "cal_enterprise_test");
    assert.equal(await client.user.count(), 0, "Refuse populated test database");
    lifecycle = load(path.join(root, "packages/features/community-enterprise/api-keys/ApiKeyLifecycle.ts"));
    keyCrypto = load(path.join(root, "packages/features/api-keys-legacy/api-keys/lib/apiKeys.ts"));
    const constants = load(path.join(root, "packages/platform/constants/api.ts"));
    Object.assign(process.env, {
      CAL_AUTHENTIK_ENABLED: "true",
      CAL_AUTHENTIK_ONLY: "true",
      CAL_AUTHENTIK_ISSUER: issuer,
      NEXTAUTH_URL: "http://127.0.0.1:38917",
    });
    runtime = await createApiRuntime(state, {
      apiKeyController: true,
      configure: (app) => configureHttp(app, constants),
    });
    const { ApiKeysService } = runtime.load(
      path.join(root, "apps/api/v2/src/modules/api-keys/services/api-keys.service.ts")
    );
    controllerService = runtime.module.get(ApiKeysService);
  },
  { timeout: 60000 }
);

beforeEach(async () => {
  state.primary.prisma = client;
  state.replicaReads = 0;
  state.config.set("api.keyPrefix", "cal_");
  await client.user.updateMany({ data: { movedToProfileId: null } });
  for (const model of ["enterpriseAuditEvent", "apiKey", "account", "profile", "membership", "user", "team"])
    await client[model].deleteMany();
  for (const id of [1, 2])
    await client.user.create({
      data: { id, uuid: randomUUID(), email: `user${id}@fixture.test`, username: `fixture-${id}` },
    });
  for (const id of [100, 200])
    await client.team.create({ data: { id, name: `Organization ${id}`, isOrganization: true } });
  for (const [id, parentId] of [
    [10, 100],
    [20, 200],
    [30, null],
  ])
    await client.team.create({ data: { id, name: `Team ${id}`, parentId } });
  for (const [userId, teamId, role] of [
    [1, 100, "MEMBER"],
    [1, 10, "ADMIN"],
    [1, 30, "OWNER"],
    [2, 200, "MEMBER"],
    [2, 20, "ADMIN"],
  ])
    await client.membership.create({ data: { userId, teamId, role, accepted: true } });
  await client.account.create({
    data: {
      id: "binding-one",
      type: "oauth",
      provider: "authentik",
      providerAccountId: accountId,
      userId: 1,
    },
  });
});

after(async () => {
  if (runtime) await runtime.app.close();
  if (client) await client.$disconnect();
  for (const [name, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("existing controller rotates a key over HTTP and preserves the response contract", async () => {
  const old = await issue(10, { note: "kept note", neverExpires: true });
  const previous = await row(old);
  const start = Date.now();
  const response = await send(old);
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), ["data", "status"]);
  assert.equal(response.body.status, "success");
  assert.deepEqual(Object.keys(response.body.data), ["apiKey"]);
  const replacement = response.body.data.apiKey;
  assert.notEqual(replacement, old);
  assert.match(replacement, /^cal_[a-f0-9]{32}$/);
  const current = await row(replacement);
  assert.ok(current);
  assert.equal(await row(old), null);
  assert.equal(current.userId, previous.userId);
  assert.equal(current.teamId, previous.teamId);
  assert.equal(current.note, previous.note);
  assert.equal(current.appId, previous.appId);
  assert.ok(
    current.expiresAt.getTime() >= start + 30 * 86400000 &&
      current.expiresAt.getTime() <= Date.now() + 30 * 86400000
  );
  assert.equal(await auditCount(), 1);
  assert.equal(state.replicaReads, 0);
  assert.ok(!JSON.stringify(response.body).includes(current.hashedKey));
});
test("plaintext replacement responses explicitly prohibit storage", async () => {
  const response = await send(await issue());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("refresh accepts only the actual API-key credential before resolving a browser identity", async () => {
  const key = await issue();
  let queries = 0;
  state.primary.prisma = client.$extends({
    query: {
      $allModels: {
        $allOperations: async ({ args, query }) => {
          queries++;
          return query(args);
        },
      },
    },
  });
  const response = await send(null, {}, { Cookie: await cookie() });
  assert.equal(response.status, 401);
  assert.equal(queries, 0);
  assert.ok(await row(key));
  assert.equal(await auditCount(), 0);
});
for (const days of [1, 60])
  test(`actual DTO and controller accept ${days} whole days`, async () => {
    const old = await issue();
    const start = Date.now();
    const response = await send(old, { apiKeyDaysValid: days });
    assert.equal(response.status, 200);
    const current = await row(response.body.data.apiKey);
    assert.ok(
      current.expiresAt.getTime() >= start + days * 86400000 &&
        current.expiresAt.getTime() <= Date.now() + days * 86400000
    );
  });
test("explicit never-expiring rotation retains the existing null-expiry contract", async () => {
  const response = await send(await issue(), { apiKeyNeverExpires: true });
  assert.equal(response.status, 200);
  assert.equal((await row(response.body.data.apiKey)).expiresAt, null);
});
for (const body of [
  { apiKeyDaysValid: 0 },
  { apiKeyDaysValid: -1 },
  { apiKeyDaysValid: 1.5 },
  { apiKeyDaysValid: "30" },
  { apiKeyDaysValid: null },
  { apiKeyDaysValid: [] },
  { apiKeyDaysValid: {} },
  { apiKeyNeverExpires: "true" },
  { apiKeyNeverExpires: 0 },
  { apiKeyNeverExpires: null },
  { apiKeyNeverExpires: true, apiKeyDaysValid: 30 },
  { apiKeyDaysValid: Number.MAX_SAFE_INTEGER },
]) {
  test(`invalid HTTP lifetime is rejected without consuming the original: ${JSON.stringify(body)}`, async () => {
    const old = await issue();
    const response = await send(old, body);
    assert.equal(response.status, 400);
    assert.ok(await row(old));
    assert.equal(await auditCount(), 0);
    assert.equal(await client.apiKey.count(), 1);
  });
}
test("request data cannot transfer a key's owner, scope, app or hash", async () => {
  const old = await issue();
  const previous = await row(old);
  const response = await send(old, {
    userId: 2,
    teamId: 20,
    appId: "injected",
    hashedKey: "injected",
    note: "injected",
    apiKeyDaysValid: 3,
  });
  assert.equal(response.status, 200);
  const current = await row(response.body.data.apiKey);
  assert.equal(current.userId, previous.userId);
  assert.equal(current.teamId, previous.teamId);
  assert.equal(current.appId, previous.appId);
  assert.equal(current.note, previous.note);
  assert.notEqual(current.hashedKey, "injected");
});
for (const version of [undefined, "2024-04-15", "2024-09-04", "invalid-version"]) {
  test(`production version selection reaches refresh for ${version ?? "default"}`, async () => {
    const response = await send(await issue(), {}, version ? { "cal-api-version": version } : {});
    assert.equal(response.status, 200);
  });
}
for (const change of ["lock", "pending", "demote", "remove-parent", "delete-key", "expired"]) {
  test(`unchanged bearer cannot rotate after ${change}`, async () => {
    const old = await issue();
    const stored = await row(old);
    if (change === "lock") await client.user.update({ where: { id: 1 }, data: { locked: true } });
    if (change === "pending")
      await client.membership.updateMany({ where: { userId: 1, teamId: 10 }, data: { accepted: false } });
    if (change === "demote")
      await client.membership.updateMany({ where: { userId: 1, teamId: 10 }, data: { role: "MEMBER" } });
    if (change === "remove-parent") await client.membership.deleteMany({ where: { userId: 1, teamId: 100 } });
    if (change === "delete-key") await client.apiKey.delete({ where: { id: stored.id } });
    if (change === "expired")
      await client.apiKey.update({
        where: { id: stored.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    const response = await send(old);
    assert.equal(response.status, 401);
    assert.equal(await auditCount(), 0);
  });
}
test("real key input wins over a different valid cookie identity without changing ownership", async () => {
  const old = await issue(20, {}, 2);
  const response = await send(old, {}, { Cookie: await cookie() });
  assert.equal(response.status, 200);
  assert.equal((await row(response.body.data.apiKey)).userId, 2);
});
test("failed explicit bearer cannot fall back to a valid native cookie", async () => {
  const response = await send("cal_invalid", {}, { Cookie: await cookie() });
  assert.equal(response.status, 401);
  assert.equal(await client.apiKey.count(), 0);
});
test("actual configured prefix and case-insensitive scheme round-trip through rotation", async () => {
  state.config.set("api.keyPrefix", "fixture_");
  const old = await issue();
  const response = await send(null, {}, { Authorization: `bearer ${old}` });
  assert.equal(response.status, 200);
  assert.match(response.body.data.apiKey, /^fixture_[a-f0-9]{32}$/);
});
test("a committed replacement invalidates the original HTTP credential", async () => {
  const old = await issue();
  const first = await send(old);
  assert.equal(first.status, 200);
  assert.equal((await send(old)).status, 401);
  assert.equal((await send(first.body.data.apiKey)).status, 200);
  assert.equal(await client.apiKey.count(), 1);
  assert.equal(await auditCount(), 2);
});
test("synchronized HTTP refreshes consume the same prior key only once", async () => {
  const old = await issue();
  let arrivals = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const timer = setTimeout(release, 5000);
  state.primary.prisma = client.$extends({
    query: {
      apiKey: {
        async findUnique({ args, query }) {
          const result = await query(args);
          // Only the mutation's existing-key projection, not the earlier auth read.
          if (args.select?.note === true && result) {
            arrivals++;
            if (arrivals === 2) release();
            if (arrivals <= 2) await gate;
          }
          return result;
        },
      },
    },
  });
  let responses;
  try {
    responses = await Promise.all([send(old), send(old)]);
  } finally {
    clearTimeout(timer);
    release();
  }
  assert.equal(
    arrivals,
    2,
    "Both mutation transactions must read the old credential before either consumes it"
  );
  assert.equal(responses.filter((r) => r.status === 200).length, 1);
  assert.equal(responses.filter((r) => r.status === 403).length, 1);
  assert.equal(await client.apiKey.count(), 1);
  assert.equal(await auditCount(), 1);
  assert.equal(await row(old), null);
});

test("a real audit constraint failure rolls back the entire HTTP rotation", async (t) => {
  const old = await issue();
  await client.$executeRawUnsafe(
    `ALTER TABLE "EnterpriseAuditEvent" ADD CONSTRAINT controller_fixture_audit_failure CHECK (action <> 'api_key.rotated')`
  );
  t.after(() =>
    client.$executeRawUnsafe(
      'ALTER TABLE "EnterpriseAuditEvent" DROP CONSTRAINT controller_fixture_audit_failure'
    )
  );
  const response = await send(old);
  assert.equal(response.status, 500);
  assert.ok(await row(old));
  assert.equal(await client.apiKey.count(), 1);
  assert.equal(await auditCount(), 0);
  assert.ok(!JSON.stringify(response.body).includes(old));
});
test("authority is checked again after guard acceptance before mutation", async (t) => {
  const old = await issue();
  const original = controllerService.refreshApiKey.bind(controllerService);
  controllerService.refreshApiKey = async (...args) => {
    await client.membership.updateMany({ where: { userId: 1, teamId: 10 }, data: { role: "MEMBER" } });
    return original(...args);
  };
  t.after(() => {
    controllerService.refreshApiKey = original;
  });
  const response = await send(old);
  assert.equal(response.status, 403);
  assert.ok(await row(old));
  assert.equal(await auditCount(), 0);
});
