// SPDX-License-Identifier: MIT
// Executes production services/strategies with explicit framework and DB doubles.
// It does not substitute for native Nest, PostgreSQL, crypto or deployment tests.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const identityRoot = "packages/features/community-enterprise/identity/";
const serviceRoot = "apps/api/v2/src/modules/auth/services/";
const strategyRoot = "apps/api/v2/src/modules/auth/strategies/";
function load(relative, imports = {}) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const result = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      experimentalDecorators: true,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputText)(
    (name) => {
      if (!Object.hasOwn(imports, name)) throw new Error(`Unexpected import ${name} from ${relative}`);
      return imports[name];
    },
    module,
    module.exports
  );
  return module.exports;
}
class UnauthorizedException extends Error {
  status = 401;
}
class InternalServerErrorException extends Error {
  status = 500;
}
class Logger {}
const common = {
  Injectable: () => (klass) => klass,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
};
const configModule = load(`${identityRoot}AuthentikConfig.ts`, {
  "node:crypto": require("node:crypto"),
  "next-auth/providers/authentik": { default: (value) => value },
});
const identity = load(`${identityRoot}AuthentikIdentity.ts`, { "./AuthentikConfig": configModule });
const policy = load(`${identityRoot}StaffLoginPolicy.ts`);
const credentials = load(`${serviceRoot}credential-policy.ts`);
const { clientSecretsMatch } = load(`${serviceRoot}client-secret.ts`, {
  "node:crypto": require("node:crypto"),
});
const runtime = { env: {} };
const { NextAuthSessionService } = load(`${serviceRoot}next-auth-session.service.ts`, {
  "node:process": runtime,
  "@/modules/prisma/prisma-write.service": {},
  "@/modules/users/services/users.service": {},
  "@nestjs/common": common,
  "@nestjs/config": {},
  "@calcom/platform-libraries": { ...configModule, ...identity, ...policy },
  "./credential-policy": credentials,
});
function fixture() {
  const issuer = "https://identity.example.test/application/o/calendar";
  runtime.env = {
    CAL_AUTHENTIK_ENABLED: "true",
    CAL_AUTHENTIK_ONLY: "true",
    CAL_AUTHENTIK_ISSUER: issuer,
    NODE_ENV: "production",
  };
  const profile = (id, org) => ({
    id,
    uid: `profile-${id}`,
    userId: 7,
    organizationId: org,
    username: "staff",
    organization: {
      id: org,
      name: "Org",
      slug: `org-${org}`,
      isPlatform: false,
      isOrganization: true,
      parentId: null,
      logoUrl: null,
    },
  });
  const f = {
    user: {
      id: 7,
      uuid: "fixture-uuid",
      email: "current@example.test",
      role: "USER",
      locked: false,
      movedToProfileId: null,
      name: "Staff",
      username: "staff",
      avatarUrl: null,
      locale: "en",
    },
    memberships: [
      { teamId: 100, role: "MEMBER", accepted: true, customRoleId: null },
      { teamId: 200, role: "ADMIN", accepted: true, customRoleId: null },
    ],
    profiles: [profile(10, 100), profile(20, 200)],
    bindingId: "link-row-1",
    exists: true,
    queries: [],
    transactions: [],
    databaseFailure: false,
  };
  const accountId = configModule.authentikAccountId(issuer, "staff-subject");
  f.token = {
    sub: "7",
    email: "formerly@example.test",
    upId: "usr-7",
    role: "ADMIN",
    authentik: { version: 1, issuer, accountId, bindingId: f.bindingId, userId: 7 },
  };
  const activeTeams = () =>
    f.memberships
      .filter((m) => m.accepted)
      .map((m) => ({ ...m, team: { id: m.teamId, isOrganization: true, parentId: null } }));
  f.tx = {
    account: {
      async findUnique(query) {
        f.queries.push(["account", query]);
        if (!f.exists || query.where.provider_providerAccountId.providerAccountId !== accountId) return null;
        return { id: f.bindingId, type: "oauth", userId: 7, user: { ...f.user, teams: activeTeams() } };
      },
    },
    profile: {
      async findFirst({ where }) {
        return (
          f.profiles.find(
            (p) =>
              p.userId === where.userId &&
              (where.id === undefined || p.id === where.id) &&
              (where.uid === undefined || p.uid === where.uid)
          ) ?? null
        );
      },
    },
    user: {
      async findUnique(query) {
        f.queries.push(["user", query]);
        assert.deepEqual(query.where, { id: 7 });
        assert.deepEqual(query.include.profiles.where.organization, {
          isOrganization: true,
          parentId: null,
          members: { some: { userId: 7, accepted: true } },
        });
        return f.user.deleted
          ? null
          : {
              ...f.user,
              movedToProfile: f.profiles.find((p) => p.id === f.user.movedToProfileId) ?? null,
              profiles: f.profiles.filter((p) =>
                f.memberships.some((m) => m.accepted && m.teamId === p.organizationId)
              ),
            };
      },
    },
  };
  const primary = {
    prisma: {
      async $transaction(next, options) {
        f.transactions.push(options);
        if (f.databaseFailure) throw new Error("primary unavailable");
        return next(f.tx);
      },
    },
  };
  f.service = new NextAuthSessionService(
    primary,
    { get: () => "https://calendar.example.test" },
    {
      getUserMainOrgId: (user) =>
        user.movedToProfile?.organizationId ?? user.profiles?.[0]?.organizationId ?? null,
    }
  );
  return f;
}
for (const sub of [undefined, null, "", "0", "-1", "7junk", "07", "7.0", "1e2", "9007199254740992", 7]) {
  test(`reject invalid signed subject ${String(sub)}`, async () => {
    const f = fixture();
    await assert.rejects(f.service.resolve({ ...f.token, sub }));
    assert.equal(f.transactions.length, 0);
  });
}
test("session identity is its signed ID, never its previous email or role", async () => {
  const f = fixture();
  const result = await f.service.resolve(f.token);
  assert.equal(result.user.id, 7);
  assert.equal(result.user.email, f.user.email);
  assert.equal(result.user.role, "USER");
  assert.equal(result.organizationId, null);
  assert.equal(f.queries.filter(([kind]) => kind === "account").length, 1);
});
test("API issuer configuration does not require an OAuth client secret", async () => {
  const f = fixture();
  assert.deepEqual(configModule.readAuthentikSessionConfig(runtime.env), {
    issuer: runtime.env.CAL_AUTHENTIK_ISSUER,
  });
  assert.throws(() => configModule.readAuthentikConfig(runtime.env), /Incomplete/);
  assert.equal((await f.service.resolve(f.token)).user.id, 7);
});
test("identity, user and memberships use one bounded primary snapshot", async () => {
  const f = fixture();
  await f.service.resolve(f.token);
  assert.deepEqual(f.transactions, [{ isolationLevel: "RepeatableRead", maxWait: 2000, timeout: 5000 }]);
});
for (const mode of ["locked", "deleted", "unlinked", "rebound", "issuer", "disabled", "malformed"]) {
  test(`same native cookie loses API authority after ${mode}`, async () => {
    const f = fixture();
    await f.service.resolve(f.token);
    if (mode === "locked") f.user.locked = true;
    if (mode === "deleted") f.user.deleted = true;
    if (mode === "unlinked") f.exists = false;
    if (mode === "rebound") f.bindingId = "replacement-row";
    if (mode === "issuer")
      runtime.env.CAL_AUTHENTIK_ISSUER = "https://other.example.test/application/o/calendar";
    if (mode === "disabled") {
      runtime.env.CAL_AUTHENTIK_ENABLED = "false";
      runtime.env.CAL_AUTHENTIK_ONLY = "false";
    }
    if (mode === "malformed") f.token.authentik = {};
    await assert.rejects(f.service.resolve(f.token));
  });
}
test("strict API rejects unmarked legacy sessions before database access", async () => {
  const f = fixture();
  await assert.rejects(f.service.resolve({ sub: "7", email: f.user.email }));
  assert.equal(f.transactions.length, 0);
});
test("mixed mode accepts a valid legacy subject but does not fall back to email", async () => {
  const f = fixture();
  runtime.env.CAL_AUTHENTIK_ONLY = "false";
  assert.equal((await f.service.resolve({ sub: "7", email: "someone-else@example.test" })).user.id, 7);
  await assert.rejects(f.service.resolve({ email: f.user.email }));
});
test("mixed mode still validates native markers", async () => {
  const f = fixture();
  runtime.env.CAL_AUTHENTIK_ONLY = "false";
  f.bindingId = "new-row";
  await assert.rejects(f.service.resolve(f.token));
});
test("native organization is the validated selected profile, not the default organization", async () => {
  const f = fixture();
  f.token.upId = "prof-profile-20";
  const result = await f.service.resolve(f.token);
  assert.equal(result.organizationId, 200);
  f.memberships[1].accepted = false;
  await assert.rejects(f.service.resolve(f.token));
});
test("removed legacy organization profile cannot remain an authorization context", async () => {
  const f = fixture();
  runtime.env.CAL_AUTHENTIK_ONLY = "false";
  f.user.movedToProfileId = 20;
  f.memberships[1].accepted = false;
  const result = await f.service.resolve({ sub: "7" });
  assert.equal(result.user.movedToProfile, null);
  assert.equal(result.organizationId, 100);
});
test("empty accepted memberships do not retain stale organization IDs", async () => {
  const f = fixture();
  runtime.env.CAL_AUTHENTIK_ONLY = "false";
  f.memberships = [];
  f.user.movedToProfileId = 20;
  const result = await f.service.resolve({ sub: "7" });
  assert.equal(result.organizationId, null);
});
test("database failure never falls back to a stale user or token", async () => {
  const f = fixture();
  f.databaseFailure = true;
  await assert.rejects(f.service.resolve(f.token), /primary unavailable/);
});

class Strategy {
  success(user) {
    this.outcome = { user };
  }
  error(error) {
    this.outcome = { error };
  }
}
const methods = {
  API_KEY: "API_KEY",
  ACCESS_TOKEN: "ACCESS_TOKEN",
  NEXT_AUTH: "NEXT_AUTH",
  THIRD_PARTY_ACCESS_TOKEN: "THIRD_PARTY_ACCESS_TOKEN",
  OAUTH_CLIENT: "OAUTH_CLIENT",
};
function strategyFixture() {
  const f = fixture();
  f.bearerCalls = [];
  f.thirdCalls = [];
  f.keyData = { userId: 7, teamId: null, expiresAt: null };
  f.nextToken = f.token;
  f.authSecret = "fixture-secret";
  f.decodeCalls = 0;
  const config = { get: (key) => (key === "api.keyPrefix" ? "custom_" : f.authSecret) };
  const repositories = {
    findByIdWithProfile: async () => ({ ...f.user }),
    findByEmailWithProfile: async () => ({ id: 9, role: "ADMIN", locked: false }),
  };
  const apiImports = {
    "@/modules/auth/services/next-auth-session.service": { NextAuthSessionService },
    "@/modules/auth/services/credential-policy": credentials,
    "@/modules/auth/services/client-secret": { clientSecretsMatch },
    "@/lib/api-key": {
      isApiKey: (value, prefix) => value.startsWith(prefix),
      stripApiKey: (value, prefix) => value.slice(prefix.length),
      sha256Hash: (value) => value,
    },
    "@/lib/enums/auth-methods": { AuthMethods: methods },
    "@/lib/is-origin-allowed/is-origin-allowed": { isOriginAllowed: () => true },
    "@/lib/passport/strategies/types": { BaseStrategy: Strategy },
    "@/modules/prisma/prisma-write.service": {},
    "@/modules/memberships/memberships.repository": {},
    "@calcom/platform-libraries": {
      authenticateApiKey: async (database, key, prefix) => {
        // This suite checks the strategy delegation. The real service, crypto,
        // expiry and database behavior run in postgres-api-auth.test.cjs.
        f.keyDelegation = { database, key, prefix };
        if (f.keyAuthenticationError) throw f.keyAuthenticationError;
        return { user: f.user, teamId: f.keyData.teamId };
      },
    },
    "@/modules/oauth-clients/oauth-client.repository": {},
    "@/modules/oauth-clients/services/oauth-flow.service": {},
    "@/modules/tokens/tokens.repository": {},
    "@/modules/tokens/tokens.service": {},
    "@/modules/users/services/users.service": {},
    "@/modules/users/users.repository": {},
    "@nestjs/common": common,
    "@nestjs/config": {},
    "@nestjs/passport": { PassportStrategy: (base) => base },
    "next-auth/jwt": {
      getToken: async () => {
        f.decodeCalls++;
        return f.nextToken;
      },
    },
    "@calcom/platform-constants": {
      INVALID_ACCESS_TOKEN: "invalid",
      X_CAL_CLIENT_ID: "client",
      X_CAL_SECRET_KEY: "secret",
    },
  };
  const { ApiAuthStrategy } = load(`${strategyRoot}api-auth/api-auth.strategy.ts`, apiImports);
  f.api = new ApiAuthStrategy(config, {}, {}, {}, repositories, { prisma: f.tx }, {}, {}, {}, f.service);
  const { NextAuthStrategy } = load(`${strategyRoot}next-auth/next-auth.strategy.ts`, {
    "@/lib/passport/strategies/types": { NextAuthPassportStrategy: Strategy },
    "@/modules/auth/services/next-auth-session.service": { NextAuthSessionService },
    "@nestjs/common": common,
    "@nestjs/config": {},
    "@nestjs/passport": { PassportStrategy: (base) => base },
    "next-auth/jwt": {
      getToken: async () => {
        f.decodeCalls++;
        return f.nextToken;
      },
    },
  });
  f.direct = new NextAuthStrategy(f.service, config);
  f.request = (authorization, allowedAuthMethods) => ({
    params: {},
    allowedAuthMethods,
    get: (header) => (header === "Authorization" ? authorization : undefined),
  });
  return f;
}
for (const name of ["api", "direct"]) {
  test(`actual ${name} strategy uses the shared identity resolver`, async () => {
    const f = strategyFixture();
    await f[name].authenticate(f.request(undefined, ["NEXT_AUTH"]));
    assert.equal(f[name].outcome.user.id, 7);
    assert.equal(f[name].outcome.user.role, "USER");
    f.exists = false;
    await f[name].authenticate(f.request(undefined, ["NEXT_AUTH"]));
    assert.ok(f[name].outcome.error);
  });
  test(`actual ${name} strategy denies a legacy session in strict mode`, async () => {
    const f = strategyFixture();
    f.nextToken = { sub: "7", email: "old@example.test" };
    await f[name].authenticate(f.request(undefined, ["NEXT_AUTH"]));
    assert.ok(f[name].outcome.error);
  });
}
for (const [token, allowed, succeeds] of [
  ["custom_key", ["API_KEY"], true],
  ["custom_key", ["ACCESS_TOKEN"], false],
  ["opaque-token", ["API_KEY"], false],
  ["opaque-token", ["ACCESS_TOKEN"], true],
  ["custom_key", ["NEXT_AUTH"], false],
  ["opaque-token", ["NEXT_AUTH"], false],
]) {
  test(`actual dispatch respects ${allowed[0]} for ${token}`, async () => {
    const f = strategyFixture();
    f.api.authenticateBearerToken = async (value, request) => {
      f.bearerCalls.push([value, request.authMethod]);
      f.api.success(f.user);
    };
    await f.api.authenticate(f.request(`Bearer ${token}`, allowed));
    assert.equal(Boolean(f.api.outcome.user), succeeds);
    assert.equal(f.bearerCalls.length, succeeds ? 1 : 0);
  });
}
test("explicit external-token allowance invokes its verifier only for non-key tokens", async () => {
  const f = strategyFixture();
  f.api.validateThirdPartyAccessToken = async () => {
    f.thirdCalls.push(true);
    return { success: true, data: f.user };
  };
  await f.api.authenticate(f.request("Bearer opaque", ["THIRD_PARTY_ACCESS_TOKEN"]));
  assert.ok(f.api.outcome.user);
  await f.api.authenticate(f.request("Bearer custom_key", ["THIRD_PARTY_ACCESS_TOKEN"]));
  assert.ok(f.api.outcome.error);
  assert.equal(f.thirdCalls.length, 1);
});
for (const value of [
  "",
  "Basic foo",
  "Bearer ",
  "Bearer token extra",
  "Bearer token,other",
  "Bearer token\r\n",
  " token",
]) {
  test(`malformed authorization does not downgrade to native cookie: ${JSON.stringify(value)}`, async () => {
    const f = strategyFixture();
    await f.api.authenticate(f.request(value));
    assert.equal(f.api.outcome.error.status, 401);
    assert.equal(f.transactions.length, 0);
  });
}
test("bearer scheme is case-insensitive", async () => {
  const f = strategyFixture();
  f.api.authenticateBearerToken = async () => f.api.success(f.user);
  await f.api.authenticate(f.request("bearer custom_key", ["API_KEY"]));
  assert.ok(f.api.outcome.user);
});
test("API key strategy delegates the exact credential and prefix to its primary authority service", async () => {
  const f = strategyFixture();
  const request = f.request();
  assert.equal((await f.api.apiKeyStrategy("custom_key", request)).id, 7);
  assert.deepEqual(f.keyDelegation, { database: f.tx, key: "custom_key", prefix: "custom_" });
  assert.equal(request.organizationId, f.keyData.teamId);
  f.keyAuthenticationError = Object.assign(new Error("private authority reason"), {
    code: "forbidden_error",
  });
  await assert.rejects(
    f.api.apiKeyStrategy("custom_key", request),
    (error) => error.status === 401 && !error.message.includes("private authority reason")
  );
});

test("invalid expiry values fail closed; only explicit null means never expires", () => {
  const now = 1000;
  for (const value of [undefined, new Date("invalid"), new Date(999), new Date(1000), "tomorrow", false]) {
    assert.equal(credentials.isUsableApiKeyExpiry(value, now), false);
  }
  assert.equal(credentials.isUsableApiKeyExpiry(null, now), true);
  assert.equal(credentials.isUsableApiKeyExpiry(new Date(1001), now), true);
});
test("locked users are not accepted by the shared success presenter for any method", () => {
  const f = strategyFixture();
  f.user.locked = true;
  assert.throws(() => f.api.getSuccessUser(f.user), /unavailable/);
});

test("configured legacy and native flags fail closed when malformed", async () => {
  const f = fixture();
  runtime.env.CAL_AUTHENTIK_ONLY = "yes";
  await assert.rejects(f.service.resolve(f.token));
  assert.equal(f.transactions.length, 0);
});
test("null native provenance is validated and denied instead of becoming legacy auth", async () => {
  const f = fixture();
  runtime.env.CAL_AUTHENTIK_ONLY = "false";
  f.token.authentik = null;
  await assert.rejects(f.service.resolve(f.token));
});
test("signed subject and native binding cannot identify different users", async () => {
  const f = fixture();
  f.token.authentik.userId = 9;
  await assert.rejects(f.service.resolve(f.token));
});
test("current database role changes are seen without replacing the token", async () => {
  const f = fixture();
  f.user.role = "ADMIN";
  assert.equal((await f.service.resolve(f.token)).user.role, "ADMIN");
  f.user.role = "USER";
  assert.equal((await f.service.resolve(f.token)).user.role, "USER");
});
test("native API strategy replaces a caller's organization context", async () => {
  const f = strategyFixture();
  const request = f.request(undefined, ["NEXT_AUTH"]);
  request.organizationId = 999;
  f.token.upId = "prof-profile-20";
  await f.api.authenticate(request);
  assert.equal(request.organizationId, 200);
});
test("rejected bearer credentials cannot fall back to a valid native cookie", async () => {
  const f = strategyFixture();
  f.api.authenticateBearerToken = async () => {
    throw new UnauthorizedException("denied");
  };
  f.api.validateThirdPartyAccessToken = async () => ({ success: false });
  await f.api.authenticate(f.request("Bearer opaque-token"));
  assert.ok(f.api.outcome.error);
  assert.equal(f.transactions.length, 0);
});
test("a primary outage does not cause another strategy to authenticate the same native cookie", async () => {
  const f = strategyFixture();
  f.databaseFailure = true;
  await f.api.authenticate(f.request(undefined, ["NEXT_AUTH"]));
  assert.ok(f.api.outcome.error);
  assert.ok(!f.api.outcome.user);
});
test("Nest auth module registers the shared service and its authoritative database dependency", () => {
  let definition;
  const dependencies = {
    "@nestjs/common": {
      Module: (value) => {
        definition = value;
        return (klass) => klass;
      },
    },
    "@nestjs/passport": { PassportModule: class PassportModule {} },
    "@/modules/auth/services/next-auth-session.service": { NextAuthSessionService },
  };
  const modules = {
    "@/modules/prisma/prisma.module": "PrismaModule",
    "@/modules/api-keys/api-keys.module": "ApiKeysModule",
    "@/modules/auth/guards/api-auth/api-auth.guard": "ApiAuthGuard",
    "@/modules/auth/guards/next-auth/next-auth.guard": "NextAuthGuard",
    "@/modules/auth/strategies/api-auth/api-auth.strategy": "ApiAuthStrategy",
    "@/modules/auth/strategies/next-auth/next-auth.strategy": "NextAuthStrategy",
    "@/modules/deployments/deployments.module": "DeploymentsModule",
    "@/modules/memberships/memberships.module": "MembershipsModule",
    "@/modules/oauth-clients/services/oauth-flow.service": "OAuthFlowService",
    "@/modules/redis/redis.module": "RedisModule",
    "@/modules/tokens/tokens.module": "TokensModule",
    "@/modules/users/users.module": "UsersModule",
  };
  for (const [modulePath, name] of Object.entries(modules)) dependencies[modulePath] = { [name]: { name } };
  load("apps/api/v2/src/modules/auth/auth.module.ts", dependencies);
  assert.ok(definition.providers.includes(NextAuthSessionService));
  assert.ok(definition.imports.includes(dependencies["@/modules/prisma/prisma.module"].PrismaModule));
});
test("platform library exports the exact shared validators instead of an API-local substitute", () => {
  const file = path.join(root, "packages/platform/libraries/index.ts");
  const ast = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const exported = new Map(
    ast.statements
      .filter(ts.isExportDeclaration)
      .filter((node) => node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause))
      .flatMap((node) =>
        node.exportClause.elements.map((entry) => [entry.name.text, node.moduleSpecifier.text])
      )
  );
  assert.equal(
    exported.get("refreshAuthentikToken"),
    "@calcom/features/community-enterprise/identity/AuthentikIdentity"
  );
  assert.equal(
    exported.get("readAuthentikSessionConfig"),
    "@calcom/features/community-enterprise/identity/AuthentikConfig"
  );
  assert.equal(
    exported.get("isAuthentikOnly"),
    "@calcom/features/community-enterprise/identity/StaffLoginPolicy"
  );
});

for (const name of ["api", "direct"]) {
  test(`actual ${name} strategy requires an explicit session secret before decoding`, async () => {
    const f = strategyFixture();
    f.authSecret = undefined;
    await f[name].authenticate(f.request(undefined, ["NEXT_AUTH"]));
    assert.ok(f[name].outcome.error);
    assert.equal(f.decodeCalls, 0);
    assert.equal(f.transactions.length, 0);
  });
}
test("the existing database test module registers the new constructor dependency", () => {
  const file = path.join(root, strategyRoot, "api-auth/api-auth.strategy.e2e-spec.ts");
  const ast = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  let registered = false;
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(ast) === "providers" &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      registered = node.initializer.elements.some((entry) => entry.getText(ast) === "NextAuthSessionService");
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(registered);
});
test("the existing enterprise command includes this regression suite once", () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts;
  assert.equal(
    scripts["test:community-enterprise"].split("tests/community-enterprise/api-session-boundary.test.cjs")
      .length,
    2
  );
});

test("unexpected primary errors do not become a successful key or expose a fallback identity", async () => {
  const f = strategyFixture();
  f.keyAuthenticationError = new Error("primary unavailable");
  await assert.rejects(f.api.apiKeyStrategy("custom_key", f.request()), /primary unavailable/);
});

for (const [expected, supplied, matches] of [
  ["same-secret", "same-secret", true],
  ["same-secret", "different-secret", false],
  ["same-secret", "same-secret ", false],
  ["", "", false],
  [null, "null", false],
  [undefined, "", false],
  [123, "123", false],
  ["\ud800", "\ud801", false],
  ["\u00e9", "e\u0301", false],
  ["a\u0000b", "a\u0000b", true],
]) {
  test(`exact constant-time client-secret comparison case ${JSON.stringify([expected, supplied])}`, () => {
    assert.equal(clientSecretsMatch(expected, supplied), matches);
  });
}
test("production OAuth branch rejects the wrong secret before selecting any owner", async () => {
  const f = strategyFixture();
  f.api.oauthRepository = {
    getOAuthClient: async () => ({ secret: "synthetic-secret", organizationId: 100 }),
  };
  let ownerLookups = 0;
  f.api.membershipsRepository = {
    findPlatformOwnerUserId: async () => {
      ownerLookups++;
      return 7;
    },
  };
  await assert.rejects(
    f.api.oAuthClientStrategy("fixture-client", "wrong-secret", f.request()),
    (error) => error.status === 401
  );
  assert.equal(ownerLookups, 0);
  assert.equal((await f.api.oAuthClientStrategy("fixture-client", "synthetic-secret", f.request())).id, 7);
  assert.equal(ownerLookups, 1);
});
