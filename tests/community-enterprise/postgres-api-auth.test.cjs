// SPDX-License-Identifier: MIT
// Real Nest HTTP, Passport, NextAuth JWE and generated Prisma/PostgreSQL.
// The fixture does not bootstrap unrelated OAuth/queue/business controllers.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, beforeEach, after, test } = require("node:test");
const { randomUUID, randomBytes, createHash } = require("node:crypto");
const { PrismaPg } = require("@prisma/adapter-pg");
const { ConfigService } = require("@nestjs/config");
const { encode } = require("next-auth/jwt");
const { fixtureModules, createApiRuntime } = require("./api-runtime-fixture.cjs");
const root = path.resolve(__dirname, "../..");
let client, runtime, lifecycle, state, authKey;
const issuer = "https://identity.example.test/application/o/calendar";
const accountId = createHash("sha256")
  .update(JSON.stringify([issuer, "subject-one"]))
  .digest("hex");
const secret = randomBytes(32).toString("hex");
const savedEnvironment = Object.fromEntries(
  ["CAL_AUTHENTIK_ENABLED", "CAL_AUTHENTIK_ONLY", "CAL_AUTHENTIK_ISSUER", "NEXTAUTH_URL"].map((key) => [
    key,
    process.env[key],
  ])
);
const policyEnvironment = () =>
  Object.assign(process.env, {
    CAL_AUTHENTIK_ENABLED: "true",
    CAL_AUTHENTIK_ONLY: "true",
    CAL_AUTHENTIK_ISSUER: issuer,
    NEXTAUTH_URL: "http://127.0.0.1:38917",
  });
const native = (overrides = {}) => ({
  sub: "1",
  email: "former-address@example.test",
  role: "ADMIN",
  upId: "usr-1",
  authentik: { version: 1, issuer, accountId, bindingId: "binding-one", userId: 1 },
  ...overrides,
});
async function cookie(token = native(), options = {}) {
  return `next-auth.session-token=${await encode({ token, secret, maxAge: 3600, ...options })}`;
}
async function request(route, headers = {}) {
  const response = await fetch(`${runtime.origin}/fixture/${route}`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}
async function key(input = {}) {
  return lifecycle.createApiKey(client, 1, { teamId: 10, ...input });
}

before(
  async () => {
    const socket = process.env.CAL_ENTERPRISE_TEST_SOCKET;
    const directory = process.env.CAL_ENTERPRISE_TEST_PGDATA;
    assert.ok(
      socket && directory,
      "Use the isolated database runner; never fall back to deployed DATABASE_URL"
    );
    assert.equal(path.dirname(socket), path.dirname(directory));
    assert.match(path.basename(path.dirname(socket)), /^cal-enterprise-/);
    state = {
      primary: { prisma: null },
      permissionFixture: true,
      replicaReads: 0,
      staleUser: { id: 1, role: "ADMIN", locked: false },
      config: new ConfigService({
        api: { keyPrefix: "cal_" },
        next: { authSecret: secret },
        app: { baseUrl: "https://calendar.example.test" },
        CALENDSO_ENCRYPTION_KEY: secret,
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
    state.replica = {
      prisma: {
        accessToken: {
          findFirst(query) {
            state.replicaReads++;
            if (state.keepManagedSnapshot) {
              if (query.select?.client) return Promise.resolve({ client: state.managedClient });
              if (query.select?.userId) return Promise.resolve({ userId: 1 });
              if (query.select?.expiresAt) return Promise.resolve({ expiresAt: state.managedExpiry });
            }
            return client.accessToken.findFirst(query);
          },
        },
        platformOAuthClient: {
          findUnique(query) {
            state.replicaReads++;
            return state.keepManagedSnapshot
              ? Promise.resolve(state.managedClient)
              : client.platformOAuthClient.findUnique(query);
          },
        },
      },
    };
    const [identity] =
      await client.$queryRaw`SELECT current_setting('data_directory') AS directory, current_user::text AS username`;
    assert.equal(identity.directory, directory);
    assert.equal(identity.username, "cal_enterprise_test");
    assert.equal(await client.user.count(), 0, "Refuse a populated test fixture");
    lifecycle = load(path.join(root, "packages/features/community-enterprise/api-keys/ApiKeyLifecycle.ts"));
    authKey = load(
      path.join(root, "packages/features/community-enterprise/api-keys/ApiKeyAuthentication.ts")
    ).authenticateApiKey;
    policyEnvironment();
    runtime = await createApiRuntime(state);
  },
  { timeout: 60000 }
);

beforeEach(async () => {
  policyEnvironment();
  state.primary.prisma = client;
  state.replicaReads = 0;
  state.keepManagedSnapshot = false;
  state.managedClient = null;
  state.permissionUser = null;
  await client.user.updateMany({ data: { movedToProfileId: null } });
  for (const model of [
    "accessToken",
    "refreshToken",
    "platformOAuthClient",
    "enterpriseAuditEvent",
    "apiKey",
    "account",
    "profile",
    "membership",
    "rolePermission",
    "role",
    "user",
    "team",
  ])
    await client[model].deleteMany();
  for (const id of [1, 2])
    await client.user.create({
      data: {
        id,
        uuid: randomUUID(),
        email: `user${id}@fixture.test`,
        name: `Fixture ${id}`,
        username: `fixture-${id}`,
      },
    });
  for (const id of [100, 200])
    await client.team.create({ data: { id, name: `Org ${id}`, isOrganization: true } });
  for (const [id, parentId] of [
    [10, 100],
    [20, 200],
    [30, null],
  ])
    await client.team.create({ data: { id, name: `Team ${id}`, parentId } });
  for (const [userId, teamId, role] of [
    [1, 100, "MEMBER"],
    [1, 10, "ADMIN"],
    [1, 200, "MEMBER"],
    [1, 20, "ADMIN"],
    [1, 30, "OWNER"],
    [2, 200, "OWNER"],
  ]) {
    await client.membership.create({ data: { userId, teamId, role, accepted: true } });
  }
  for (const [id, organizationId] of [
    [11, 100],
    [22, 200],
  ]) {
    await client.profile.create({
      data: { id, uid: `profile-${id}`, userId: 1, organizationId, username: `profile-user-${id}` },
    });
  }
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
  for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

for (const route of ["native", "cookie"]) {
  test(`${route}: real encrypted native cookie reaches the production Passport strategy`, async () => {
    const result = await request(route, { Cookie: await cookie() });
    assert.equal(result.status, 200);
    assert.equal(result.body.id, 1);
    assert.equal(result.body.role, "USER");
    assert.equal(state.replicaReads, 0);
  });
  test(`${route}: no cookie, forged ciphertext and expired JWE are refused`, async () => {
    assert.equal((await request(route)).status, 401);
    assert.equal(
      (await request(route, { Cookie: await cookie(native(), { secret: randomBytes(32).toString("hex") }) }))
        .status,
      401
    );
    assert.equal((await request(route, { Cookie: await cookie(native(), { maxAge: -120 }) })).status, 401);
  });
  test(`${route}: strict mode rejects a valid legacy cookie, not just malformed JWTs`, async () => {
    assert.equal(
      (await request(route, { Cookie: await cookie({ sub: "1", email: "user1@fixture.test" }) })).status,
      401
    );
  });
  test(`${route}: existing cookie is denied after committed local disablement`, async () => {
    const unchanged = await cookie();
    assert.equal((await request(route, { Cookie: unchanged })).status, 200);
    await client.user.update({ where: { id: 1 }, data: { locked: true } });
    assert.equal((await request(route, { Cookie: unchanged })).status, 401);
    assert.equal(state.replicaReads, 0);
  });
  test(`${route}: unlink/relink does not revive the prior session binding`, async () => {
    const unchanged = await cookie();
    await client.account.delete({ where: { id: "binding-one" } });
    assert.equal((await request(route, { Cookie: unchanged })).status, 401);
    await client.account.create({
      data: {
        id: "replacement-binding",
        type: "oauth",
        provider: "authentik",
        providerAccountId: accountId,
        userId: 1,
      },
    });
    assert.equal((await request(route, { Cookie: unchanged })).status, 401);
  });
}
for (const sub of ["1junk", "01", "0", "2", "9007199254740992"]) {
  test(`signed subject ${sub} cannot borrow another identity binding`, async () => {
    assert.equal((await request("cookie", { Cookie: await cookie(native({ sub })) })).status, 401);
  });
}
test("selected organization comes from a validated owned profile", async () => {
  const unchanged = await cookie(native({ upId: "prof-profile-22", org: { id: 999, role: "OWNER" } }));
  const result = await request("cookie", { Cookie: unchanged });
  assert.equal(result.status, 200);
  assert.equal(result.body.organizationId, 200);
  await client.membership.delete({ where: { userId_teamId: { userId: 1, teamId: 200 } } });
  assert.equal((await request("cookie", { Cookie: unchanged })).status, 401);
});
test("mixed mode legacy identity uses the verified ID and filters removed profiles", async () => {
  process.env.CAL_AUTHENTIK_ONLY = "false";
  await client.user.update({ where: { id: 1 }, data: { movedToProfileId: 22 } });
  await client.membership.delete({ where: { userId_teamId: { userId: 1, teamId: 200 } } });
  const result = await request("cookie", { Cookie: await cookie({ sub: "1", email: "user2@fixture.test" }) });
  assert.equal(result.status, 200);
  assert.equal(result.body.id, 1);
  assert.equal(result.body.organizationId, 100);
  assert.deepEqual(result.body.profileOrganizations, [100]);
});
test("mixed mode still validates native markers and issuer continuity", async () => {
  process.env.CAL_AUTHENTIK_ONLY = "false";
  const unchanged = await cookie();
  process.env.CAL_AUTHENTIK_ISSUER = "https://other.example.test/application/o/calendar";
  assert.equal((await request("cookie", { Cookie: unchanged })).status, 401);
});
test("native API does not require the OAuth client secret to read an existing binding", async () => {
  assert.equal(process.env.CAL_AUTHENTIK_CLIENT_SECRET, undefined);
  assert.equal((await request("cookie", { Cookie: await cookie() })).status, 200);
});

test("real key HTTP authentication uses primary ownership and current scoped profiles", async () => {
  const unchanged = await key();
  const result = await request("key", { Authorization: `Bearer ${unchanged}`, "x-organization-id": "200" });
  assert.equal(result.status, 200);
  assert.equal(result.body.organizationId, 10);
  assert.deepEqual(result.body.profileOrganizations, [100]);
  assert.equal(result.body.role, "USER");
  assert.equal(result.body.isSystemAdmin, false);
  assert.equal(state.replicaReads, 0);
});
test("team credentials cannot inherit their owner's instance administrator authority", async () => {
  await client.user.update({ where: { id: 1 }, data: { role: "ADMIN", movedToProfileId: 22 } });
  const result = await request("key", { Authorization: `Bearer ${await key()}` });
  assert.equal(result.status, 200);
  assert.equal(result.body.role, "USER");
  assert.equal(result.body.isSystemAdmin, false);
  assert.deepEqual(result.body.profileOrganizations, [100]);
});
test("personal credentials retain existing instance role behavior without invented team scope", async () => {
  await client.user.update({ where: { id: 1 }, data: { role: "ADMIN" } });
  const result = await request("key", { Authorization: `Bearer ${await key({ teamId: undefined })}` });
  assert.equal(result.status, 200);
  assert.equal(result.body.organizationId, null);
  assert.equal(result.body.isSystemAdmin, true);
});
test("standalone-team credentials have no unrelated organization profiles", async () => {
  const result = await request("key", { Authorization: `Bearer ${await key({ teamId: 30 })}` });
  assert.equal(result.status, 200);
  assert.equal(result.body.organizationId, 30);
  assert.deepEqual(result.body.profileOrganizations, []);
});
for (const change of [
  "locked",
  "direct-demotion",
  "direct-pending",
  "direct-removal",
  "parent-removal",
  "custom-role",
  "malformed-hierarchy",
  "deleted-key",
  "expired-key",
]) {
  test(`unchanged API credential is rejected after ${change} in primary state`, async () => {
    const unchanged = await key();
    const headers = { Authorization: `Bearer ${unchanged}` };
    assert.equal((await request("key", headers)).status, 200);
    if (change === "locked") await client.user.update({ where: { id: 1 }, data: { locked: true } });
    if (change === "direct-demotion")
      await client.membership.update({
        where: { userId_teamId: { userId: 1, teamId: 10 } },
        data: { role: "MEMBER" },
      });
    if (change === "direct-pending")
      await client.membership.update({
        where: { userId_teamId: { userId: 1, teamId: 10 } },
        data: { accepted: false },
      });
    if (change === "direct-removal")
      await client.membership.delete({ where: { userId_teamId: { userId: 1, teamId: 10 } } });
    if (change === "parent-removal")
      await client.membership.delete({ where: { userId_teamId: { userId: 1, teamId: 100 } } });
    if (change === "custom-role") {
      await client.role.create({ data: { id: "narrow", name: "Narrow role", teamId: 10 } });
      await client.membership.update({
        where: { userId_teamId: { userId: 1, teamId: 10 } },
        data: { customRoleId: "narrow" },
      });
    }
    if (change === "malformed-hierarchy")
      await client.team.update({ where: { id: 100 }, data: { isOrganization: false } });
    if (change === "deleted-key") await client.apiKey.deleteMany();
    if (change === "expired-key")
      await client.apiKey.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
    assert.equal((await request("key", headers)).status, 401);
    assert.equal(state.replicaReads, 0);
  });
}
test("rotation invalidates the same HTTP bearer and permits only its committed replacement", async () => {
  const old = await key();
  const replacement = await lifecycle.rotateApiKey(client, 1, old, {}, "cal_");
  assert.equal((await request("key", { Authorization: `Bearer ${old}` })).status, 401);
  assert.equal((await request("key", { Authorization: `Bearer ${replacement}` })).status, 200);
});
test("expired-key and nonexistent-key responses do not disclose different key metadata", async () => {
  const existing = await key();
  await client.apiKey.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
  const expired = await request("key", { Authorization: `Bearer ${existing}` });
  const missing = await request("key", { Authorization: `Bearer cal_${randomBytes(16).toString("hex")}` });
  assert.equal(expired.status, 401);
  assert.deepEqual(expired.body, missing.body);
});
test("actual route decorators reject key-to-access-token and cookie-to-key substitution", async () => {
  assert.equal((await request("access", { Authorization: `Bearer ${await key()}` })).status, 401);
  assert.equal((await request("key", { Cookie: await cookie() })).status, 401);
  assert.equal((await request("key", { Authorization: "Bearer unrecognized-opaque-token" })).status, 401);
});
test("malformed or rejected explicit Bearer never falls back to a valid cookie", async () => {
  const unchanged = await cookie();
  for (const authorization of [
    "Basic aaaa",
    "Bearer one two",
    `Bearer cal_${randomBytes(16).toString("hex")}`,
  ]) {
    assert.equal((await request("any", { Authorization: authorization, Cookie: unchanged })).status, 401);
  }
});
test("read authentication does not mutate key rows or record fake administrative changes", async () => {
  const credential = await key();
  const before = await client.apiKey.findMany();
  const audit = await client.enterpriseAuditEvent.count();
  const result = await authKey(client, credential, "cal_");
  assert.ok(!("hashedKey" in result) && !("hashedKey" in result.user));
  assert.deepEqual(await client.apiKey.findMany(), before);
  assert.equal(await client.enterpriseAuditEvent.count(), audit);
});
test("a primary outage fails closed rather than accepting the poisoned replica principal", async () => {
  const credential = await key();
  state.primary.prisma = {
    $transaction: async () => {
      throw new Error("synthetic primary unavailable");
    },
  };
  const result = await request("key", { Authorization: `Bearer ${credential}` });
  assert.equal(result.status, 500);
  assert.equal(state.replicaReads, 0);
});
test("in-flight key authentication uses one snapshot; next identical request sees the lock", async (t) => {
  const credential = await key();
  let signal, release;
  let paused = false;
  const reached = new Promise((resolve) => {
    signal = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  state.primary.prisma = client.$extends({
    query: {
      user: {
        async findUnique({ args, query }) {
          const result = await query(args);
          if (!paused) {
            paused = true;
            signal();
            await gate;
          }
          return result;
        },
      },
    },
  });
  t.after(() => release());
  const running = request("key", { Authorization: `Bearer ${credential}` });
  await Promise.race([
    reached,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("No authority read reached")), 3000);
      timer.unref();
    }),
  ]);
  await client.user.update({ where: { id: 1 }, data: { locked: true } });
  release();
  assert.equal((await running).status, 200);
  state.primary.prisma = client;
  assert.equal((await request("key", { Authorization: `Bearer ${credential}` })).status, 401);
});

test("an instance administrator without direct membership cannot keep using a team credential", async () => {
  const credential = await key();
  await client.user.update({ where: { id: 1 }, data: { role: "ADMIN" } });
  await client.membership.delete({ where: { userId_teamId: { userId: 1, teamId: 10 } } });
  assert.equal((await request("key", { Authorization: `Bearer ${credential}` })).status, 401);
});
test("an explicit custom apiKey.manage grant cannot retain an unrestricted legacy credential", async () => {
  const credential = await key();
  await client.role.create({
    data: {
      id: "custom-manage",
      name: "Custom manager",
      teamId: 10,
      permissions: { create: { id: "custom-manage-permission", resource: "apiKey", action: "manage" } },
    },
  });
  await client.membership.update({
    where: { userId_teamId: { userId: 1, teamId: 10 } },
    data: { customRoleId: "custom-manage" },
  });
  assert.equal((await request("key", { Authorization: `Bearer ${credential}` })).status, 401);
});
test("native API requires an explicitly configured secret before token decoding", async (t) => {
  const credential = await cookie();
  state.config.set("next.authSecret", undefined);
  t.after(() => state.config.set("next.authSecret", secret));
  assert.equal((await request("cookie", { Cookie: credential })).status, 401);
  assert.equal((await request("native", { Cookie: credential })).status, 401);
});

test("a non-finite legacy database expiry never produces authenticated access", async () => {
  const credential = await key();
  await client.$executeRaw`UPDATE "ApiKey" SET "expiresAt" = 'infinity'::timestamp`;
  const result = await request("key", { Authorization: `Bearer ${credential}` });
  assert.ok([401, 500].includes(result.status));
});
test("configured API-key prefix and case-insensitive Bearer scheme work on the real route", async (t) => {
  state.config.set("api.keyPrefix", "fixture_");
  t.after(() => state.config.set("api.keyPrefix", "cal_"));
  const credential = await lifecycle.createApiKey(client, 1, { teamId: 10 }, "fixture_");
  assert.equal((await request("key", { Authorization: `bearer ${credential}` })).status, 200);
  assert.equal((await request("key", { Authorization: `Bearer ${await key()}` })).status, 401);
});

async function managed(permissions = 16) {
  const clientSecret = randomBytes(32).toString("hex");
  const token = randomBytes(32).toString("hex");
  await client.membership.update({
    where: { userId_teamId: { userId: 1, teamId: 100 } },
    data: { role: "OWNER" },
  });
  state.managedClient = await client.platformOAuthClient.create({
    data: {
      id: "permission-client",
      name: "Permission fixture",
      secret: clientSecret,
      permissions,
      organizationId: 100,
      redirectUris: [],
    },
  });
  state.managedExpiry = new Date(Date.now() + 3600000);
  await client.accessToken.create({
    data: {
      secret: token,
      userId: 1,
      platformOAuthClientId: state.managedClient.id,
      expiresAt: state.managedExpiry,
    },
  });
  state.permissionUser = await client.user.findUniqueOrThrow({
    where: { id: 1 },
    select: { id: true, locked: true, role: true, profiles: { select: { organizationId: true } } },
  });
  return {
    token,
    clientSecret,
    headers: { "x-cal-client-id": state.managedClient.id, "x-cal-secret-key": clientSecret },
  };
}
async function permission(route, headers = {}) {
  const response = await fetch(`${runtime.origin}/permission/${route}`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json() };
}
for (const mode of ["client", "access"]) {
  test(`${mode} permission positive control preserves the selected actor and read/write bits`, async () => {
    const auth = await managed();
    const headers = mode === "client" ? auth.headers : { Authorization: `Bearer ${auth.token}` };
    const read = await permission("read", headers);
    assert.equal(read.status, 200);
    assert.equal(read.body.id, 1);
    assert.equal(read.body.method, mode === "client" ? "oauth-client" : "access-token");
    assert.equal((await permission("write", headers)).status, 403);
    await client.platformOAuthClient.update({
      where: { id: "permission-client" },
      data: { permissions: 48 },
    });
    assert.equal((await permission("write", headers)).status, 200);
  });
  test(`${mode} cannot borrow an ambient signed native cookie to bypass write permissions`, async () => {
    const auth = await managed();
    const headers = mode === "client" ? auth.headers : { Authorization: `Bearer ${auth.token}` };
    assert.equal((await permission("write", { ...headers, Cookie: await cookie() })).status, 403);
  });
  test(`${mode} honors controller-level permissions instead of treating missing method metadata as public`, async () => {
    const auth = await managed();
    const headers = mode === "client" ? auth.headers : { Authorization: `Bearer ${auth.token}` };
    assert.equal((await permission("inherited", headers)).status, 403);
    assert.equal((await permission("read", headers)).status, 200);
  });
  test(`${mode} sees a grant reduction despite a deliberately stale authentication replica/cache`, async () => {
    const auth = await managed(48);
    const headers = mode === "client" ? auth.headers : { Authorization: `Bearer ${auth.token}` };
    assert.equal((await permission("write", headers)).status, 200);
    state.keepManagedSnapshot = true;
    await client.platformOAuthClient.update({
      where: { id: "permission-client" },
      data: { permissions: 16 },
    });
    assert.equal((await permission("write", headers)).status, 403);
  });
  test(`${mode} refuses the locally locked actor even when upstream authentication sees stale active state`, async () => {
    const auth = await managed(48);
    state.keepManagedSnapshot = true;
    await client.user.update({ where: { id: 1 }, data: { locked: true } });
    const headers = mode === "client" ? auth.headers : { Authorization: `Bearer ${auth.token}` };
    assert.equal((await permission("write", headers)).status, 403);
  });
  test(`${mode} primary authority outage never falls back to the stale accepting reader`, async () => {
    const auth = await managed(48);
    state.keepManagedSnapshot = true;
    state.primary.prisma = {
      accessToken: {
        findFirst: async () => {
          throw new Error("Fixture primary unavailable");
        },
      },
      platformOAuthClient: {
        findFirst: async () => {
          throw new Error("Fixture primary unavailable");
        },
      },
    };
    const headers = mode === "client" ? auth.headers : { Authorization: `Bearer ${auth.token}` };
    assert.equal((await permission("write", headers)).status, 500);
  });
}
for (const kind of ["unrelated-key", "unrelated-token"]) {
  test(`selected client cannot obtain permissions from ${kind} in a secondary bearer header`, async () => {
    const auth = await managed();
    const bearer = kind === "unrelated-key" ? `cal_${randomBytes(24).toString("hex")}` : auth.token;
    assert.equal(
      (await permission("write", { ...auth.headers, Authorization: `Bearer ${bearer}` })).status,
      403
    );
  });
}
for (const transition of ["expired", "deleted", "other-owner"]) {
  test(`managed access token ${transition} is refused despite stale admission`, async () => {
    const auth = await managed(48);
    state.keepManagedSnapshot = true;
    if (transition === "expired") await client.accessToken.updateMany({ data: { expiresAt: new Date(0) } });
    if (transition === "deleted") await client.accessToken.deleteMany();
    if (transition === "other-owner") await client.accessToken.updateMany({ data: { userId: 2 } });
    assert.equal((await permission("write", { Authorization: `Bearer ${auth.token}` })).status, 403);
  });
}
for (const transition of ["secret", "member", "invitation", "custom-role", "organization"]) {
  test(`managed client ${transition} change is not hidden by an old accepted identity`, async () => {
    const auth = await managed(48);
    state.keepManagedSnapshot = true;
    if (transition === "secret")
      await client.platformOAuthClient.update({
        where: { id: "permission-client" },
        data: { secret: randomBytes(32).toString("hex") },
      });
    if (transition === "member")
      await client.membership.update({
        where: { userId_teamId: { userId: 1, teamId: 100 } },
        data: { role: "MEMBER" },
      });
    if (transition === "invitation")
      await client.membership.update({
        where: { userId_teamId: { userId: 1, teamId: 100 } },
        data: { accepted: false },
      });
    if (transition === "custom-role") {
      await client.role.create({ data: { id: "limited-client-role", name: "Limited", teamId: 100 } });
      await client.membership.update({
        where: { userId_teamId: { userId: 1, teamId: 100 } },
        data: { customRoleId: "limited-client-role" },
      });
    }
    if (transition === "organization")
      await client.platformOAuthClient.update({
        where: { id: "permission-client" },
        data: { organizationId: 200 },
      });
    assert.equal((await permission("write", auth.headers)).status, 403);
  });
}
test("client route identity, not a conflicting header, remains the selected credential", async () => {
  const auth = await managed();
  assert.equal(
    (
      await permission("client/permission-client", {
        ...auth.headers,
        "x-cal-client-id": "other-client",
        Cookie: await cookie(),
      })
    ).status,
    403
  );
  await client.platformOAuthClient.update({ where: { id: "permission-client" }, data: { permissions: 48 } });
  assert.equal(
    (await permission("client/permission-client", { ...auth.headers, "x-cal-client-id": "other-client" }))
      .status,
    200
  );
});
test("a permission guard without a preceding authenticator cannot trust cookies or client headers", async () => {
  const auth = await managed(48);
  assert.equal(
    (
      await permission("guard-only", {
        ...auth.headers,
        Cookie: await cookie(),
        "x-auth-method": "next-auth",
      })
    ).status,
    403
  );
});
test("existing native-session and configured-prefix API-key routes retain their own-user contract", async (t) => {
  assert.equal((await permission("write", { Cookie: await cookie() })).status, 200);
  state.config.set("api.keyPrefix", "fixture_");
  t.after(() => state.config.set("api.keyPrefix", "cal_"));
  const credential = await lifecycle.createApiKey(client, 1, { teamId: 10 }, "fixture_");
  assert.equal((await permission("write", { Authorization: `bearer ${credential}` })).status, 200);
});
test("a missing permission token is never included in the thrown error or serialized response", async () => {
  const { PermissionsGuard } = runtime.load(
    path.join(root, "apps/api/v2/src/modules/auth/guards/permissions/permissions.guard.ts")
  );
  const guard = runtime.module.get(PermissionsGuard);
  const canary = randomBytes(32).toString("hex");
  await assert.rejects(guard.getOAuthClientByAccessToken(canary, 1), (error) => {
    assert.ok(!String(error).includes(canary));
    assert.ok(!JSON.stringify(error).includes(canary));
    return true;
  });
});

test("explicit guest permission metadata still permits an anonymous route", async () => {
  assert.deepEqual(await permission("guest"), { status: 200, body: { permitted: true } });
});
for (const mode of ["client", "access"]) {
  test(`${mode} actual Atoms schedule controller enforces its declared read/write permissions`, async () => {
    const auth = await managed();
    const headers = mode === "client" ? auth.headers : { Authorization: `Bearer ${auth.token}` };
    const invoke = async (method, suffix) => {
      const response = await fetch(`${runtime.origin}/v2/atoms/schedules${suffix}`, {
        method,
        headers: { ...headers, "content-type": "application/json" },
        ...(method === "PATCH" ? { body: JSON.stringify({ name: "Fixture only" }) } : {}),
        signal: AbortSignal.timeout(10000),
      });
      return { status: response.status, body: await response.json() };
    };
    state.atomCalls = 0;
    assert.equal((await invoke("GET", "")).status, 200);
    assert.equal(state.atomCalls, 1);
    assert.equal((await invoke("PATCH", "/91")).status, 403);
    assert.equal(state.atomCalls, 1, "Denied write must not reach the fixture domain service");
    await client.platformOAuthClient.update({
      where: { id: "permission-client" },
      data: { permissions: 48 },
    });
    assert.equal((await invoke("PATCH", "/91")).status, 200);
    assert.equal(state.atomCalls, 2);
  });
}

for (const mode of ["client", "access"]) {
  test(`${mode} actual private-link controller authenticates before permission and preserves resource denial`, async () => {
    const auth = await managed(1);
    const headers = mode === "client" ? auth.headers : { Authorization: `Bearer ${auth.token}` };
    const invoke = async (method) => {
      const response = await fetch(`${runtime.origin}/v2/event-types/91/private-links`, {
        method,
        headers: { ...headers, "content-type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ fixture: true }) } : {}),
        signal: AbortSignal.timeout(10000),
      });
      return { status: response.status, body: await response.json() };
    };
    state.privateLinksAllowed = true;
    state.privateLinkCalls = 0;
    state.ownershipChecks = 0;
    assert.equal((await invoke("GET")).status, 200);
    assert.equal(state.privateLinkCalls, 1);
    assert.equal(state.ownershipChecks, 1);
    assert.equal((await invoke("POST")).status, 403);
    assert.equal(state.privateLinkCalls, 1);
    assert.equal(state.ownershipChecks, 1, "Missing permission must stop before the domain guard");
    await client.platformOAuthClient.update({ where: { id: "permission-client" }, data: { permissions: 3 } });
    assert.equal((await invoke("POST")).status, 201);
    assert.equal(state.privateLinkCalls, 2);
    state.privateLinksAllowed = false;
    assert.equal((await invoke("GET")).status, 403);
    assert.equal(state.privateLinkCalls, 2, "Permission success must not bypass resource denial");
  });
}
