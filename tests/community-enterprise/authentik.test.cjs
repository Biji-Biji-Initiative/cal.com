// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const nativeProvider = require("next-auth/providers/authentik");
const nativeJwt = require("next-auth/jwt");
const ROOT = path.resolve(__dirname, "../..");
const IDENTITY = "packages/features/community-enterprise/identity/";

function compile(source, dependencies = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("require", "module", "exports", output)(
    (name) => {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Unmapped dependency: ${name}`);
      return dependencies[name];
    },
    module,
    module.exports
  );
  return module.exports;
}
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const configModule = compile(read(`${IDENTITY}AuthentikConfig.ts`), {
  "node:crypto": require("node:crypto"),
  "next-auth/providers/authentik": nativeProvider,
});
const identityModule = compile(read(`${IDENTITY}AuthentikIdentity.ts`), {
  "./AuthentikConfig": configModule,
});
const linkingModule = compile(read(`${IDENTITY}LinkAuthentikAccount.ts`), {
  "./AuthentikConfig": configModule,
  "node:crypto": require("node:crypto"),
});
const { readAuthentikConfig, authentikAccountId, createAuthentikProvider } = configModule;
const { authorizeAuthentikSignIn, refreshAuthentikToken } = identityModule;
const { linkAuthentikAccount } = linkingModule;
const config = {
  issuer: "https://identity.example.test/application/o/calendar",
  clientId: "fixture-client",
  clientSecret: "fixture-secret-not-live",
};
const WEB = "https://calendar.example.test";
function fixture() {
  const user = {
    id: 7,
    uuid: "user-uuid-7",
    locked: false,
    email: "local@example.test",
    name: "Local Name",
    username: "local",
    avatarUrl: null,
    role: "USER",
    locale: "en",
    movedToProfileId: null,
    teams: [
      {
        teamId: 100,
        role: "ADMIN",
        customRoleId: null,
        team: { id: 100, isOrganization: true, parentId: null },
      },
    ],
  };
  const accountId = authentikAccountId(config.issuer, "stable-subject");
  const fixture = {
    user,
    accountId,
    exists: true,
    bindingId: "binding-1",
    writes: [],
    queries: [],
    profiles: [
      {
        id: 20,
        uid: "profile-20",
        userId: 7,
        username: "local-team",
        organizationId: 100,
        organization: {
          id: 100,
          name: "Org",
          slug: "org",
          logoUrl: null,
          isOrganization: true,
          parentId: null,
          isPlatform: false,
        },
      },
    ],
  };
  fixture.db = {
    account: {
      async findUnique(query) {
        fixture.queries.push(query);
        const key = query.where.provider_providerAccountId;
        if (!fixture.exists || key.provider !== "authentik" || key.providerAccountId !== fixture.accountId)
          return null;
        return { id: fixture.bindingId, userId: fixture.user.id, type: "oauth", user: fixture.user };
      },
      async create(query) {
        fixture.writes.push(query);
        fixture.exists = true;
        fixture.bindingId = query.data.id;
        return { id: query.data.id };
      },
    },
    profile: {
      async findFirst({ where }) {
        return (
          fixture.profiles.find(
            (p) =>
              p.userId === where.userId &&
              (where.id === undefined || p.id === where.id) &&
              (where.uid === undefined || p.uid === where.uid)
          ) ?? null
        );
      },
    },
    user: {
      async findUnique({ where }) {
        return where.id === fixture.user.id ? fixture.user : null;
      },
      async findFirst() {
        return { ...fixture.user, metadata: {} };
      },
    },
  };
  fixture.login = {
    user: { id: 7 },
    account: { provider: "authentik", providerAccountId: accountId, type: "oauth" },
    profile: {
      sub: "stable-subject",
      iss: `${config.issuer}/`,
      email: "not-used-for-linking@example.test",
      name: "Provider Name",
    },
  };
  fixture.token = () => refreshAuthentikToken(fixture.db, config, { token: {}, ...fixture.login }, WEB);
  return fixture;
}

test("provider is disabled by default", () => {
  assert.equal(readAuthentikConfig({}), null);
});
test("partial enabled configuration is rejected", () => {
  assert.throws(() => readAuthentikConfig({ CAL_AUTHENTIK_ENABLED: "true" }));
});
test("configuration flag is not truthy-string based", () => {
  assert.throws(() => readAuthentikConfig({ CAL_AUTHENTIK_ENABLED: "1" }));
});
for (const issuer of [
  "http://identity.example.test",
  "https://user:password@identity.example.test",
  "https://identity.example.test?x=1",
  "javascript:alert(1)",
]) {
  test(`reject unsafe production issuer ${issuer.split(":")[0]}`, () => {
    assert.throws(() =>
      readAuthentikConfig({
        CAL_AUTHENTIK_ENABLED: "true",
        CAL_AUTHENTIK_ISSUER: issuer,
        CAL_AUTHENTIK_CLIENT_ID: "id",
        CAL_AUTHENTIK_CLIENT_SECRET: "secret",
        NODE_ENV: "production",
      })
    );
  });
}
test("issuer plus subject is stable and collision-separated", () => {
  assert.equal(authentikAccountId(config.issuer, "sub"), authentikAccountId(config.issuer, "sub"));
  assert.notEqual(
    authentikAccountId(config.issuer, "sub"),
    authentikAccountId(`${config.issuer}-other`, "sub")
  );
});
test("native provider enables PKCE, state, nonce and prohibits email linking", () => {
  const provider = createAuthentikProvider(config);
  const effective = { ...provider, ...provider.options };
  assert.deepEqual(effective.checks, ["pkce", "state", "nonce"]);
  assert.equal(effective.idToken, true);
  assert.equal(effective.allowDangerousEmailAccountLinking, false);
  assert.equal(
    effective.profile({ iss: config.issuer, sub: "sub" }).id,
    authentikAccountId(config.issuer, "sub")
  );
  assert.throws(() => effective.profile({ iss: "https://foreign.test", sub: "sub" }));
});
test("linked stable identity signs in without mutable-email matching", async () => {
  const f = fixture();
  assert.equal(await authorizeAuthentikSignIn(f.db, config, f.login), true);
  assert.equal(f.writes.length, 0);
});
test("unknown subject with same email is not linked or created", async () => {
  const f = fixture();
  f.exists = false;
  assert.equal(await authorizeAuthentikSignIn(f.db, config, f.login), false);
  assert.equal(f.writes.length, 0);
});
test("another local account cannot use the linked subject", async () => {
  const f = fixture();
  f.login.user.id = 9;
  assert.equal(await authorizeAuthentikSignIn(f.db, config, f.login), false);
});
test("locked accounts cannot sign in", async () => {
  const f = fixture();
  f.user.locked = true;
  assert.equal(await authorizeAuthentikSignIn(f.db, config, f.login), false);
});
test("claim and provider-account key must match", async () => {
  const f = fixture();
  f.login.profile.sub = "other";
  assert.equal(await authorizeAuthentikSignIn(f.db, config, f.login), false);
});
test("token uses current local identity and includes no provider tokens", async () => {
  const f = fixture();
  f.login.account.access_token = "do-not-expose";
  const token = await f.token();
  assert.equal(token.sub, "7");
  assert.equal(token.email, f.user.email);
  assert.equal(token.role, "USER");
  assert.equal(JSON.stringify(token).includes("do-not-expose"), false);
  assert.equal(token.upId, "usr-7");
});
test("client-update role, email, subject and impersonation are discarded", async () => {
  const f = fixture();
  let token = await f.token();
  token = { ...token, id: 9, role: "ADMIN", email: "attacker@example.test", impersonatedBy: { id: 9 } };
  const refreshed = await refreshAuthentikToken(f.db, config, { token }, WEB);
  assert.equal(refreshed.id, 7);
  assert.equal(refreshed.role, "USER");
  assert.equal(refreshed.email, f.user.email);
  assert.equal(refreshed.impersonatedBy, undefined);
});
test("same existing token is rejected after local account disable", async () => {
  const f = fixture();
  const token = await f.token();
  f.user.locked = true;
  await assert.rejects(refreshAuthentikToken(f.db, config, { token }, WEB));
});
test("unlink and relink cannot resurrect an old session", async () => {
  const f = fixture();
  const token = await f.token();
  f.bindingId = "new-binding";
  await assert.rejects(refreshAuthentikToken(f.db, config, { token }, WEB));
});
test("issuer reconfiguration invalidates prior issuer sessions", async () => {
  const f = fixture();
  const token = await f.token();
  await assert.rejects(
    refreshAuthentikToken(f.db, { ...config, issuer: "https://new.test" }, { token }, WEB)
  );
});
test("disabled provider invalidates existing native sessions", async () => {
  const f = fixture();
  const token = await f.token();
  await assert.rejects(refreshAuthentikToken(f.db, null, { token }, WEB));
});
test("profile switching is restricted to an accepted membership of this identity", async () => {
  const f = fixture();
  const token = await f.token();
  const updated = await refreshAuthentikToken(f.db, config, { token, requestedUpId: "prof-profile-20" }, WEB);
  assert.equal(updated.org.id, 100);
  assert.equal(updated.org.role, "ADMIN");
  f.user.teams = [];
  await assert.rejects(refreshAuthentikToken(f.db, config, { token: updated }, WEB));
});
test("foreign personal and malformed profile IDs are denied", async () => {
  const f = fixture();
  const token = await f.token();
  for (const upId of ["usr-9", "usr-7junk", "20junk", "prof-foreign", {}, true]) {
    await assert.rejects(refreshAuthentikToken(f.db, config, { token, requestedUpId: upId }, WEB));
  }
});
test("a custom organization role is not treated as built-in admin", async () => {
  const f = fixture();
  f.user.teams[0].customRoleId = "scoped-custom";
  const token = await f.token();
  const updated = await refreshAuthentikToken(f.db, config, { token, requestedUpId: "prof-profile-20" }, WEB);
  assert.equal(updated.org.role, "MEMBER");
});
test("local role change is seen by the next native refresh", async () => {
  const f = fixture();
  const token = await f.token();
  f.user.role = "ADMIN";
  assert.equal((await refreshAuthentikToken(f.db, config, { token }, WEB)).role, "ADMIN");
});
test("account-link operation defaults to dry run and writes only an Account row", async () => {
  const f = fixture();
  f.exists = false;
  const input = { userId: 7, expectedUserUuid: f.user.uuid, subject: "stable-subject" };
  assert.equal((await linkAuthentikAccount(f.db, config, input)).status, "would_link");
  assert.equal(f.writes.length, 0);
  assert.equal((await linkAuthentikAccount(f.db, config, input, true)).status, "linked");
  assert.equal(f.writes.length, 1);
  assert.equal((await linkAuthentikAccount(f.db, config, input, true)).status, "already_linked");
  assert.equal(f.writes.length, 1);
});
test("account linking refuses stale target UUID and cannot rebind a different user", async () => {
  const f = fixture();
  await assert.rejects(
    linkAuthentikAccount(
      f.db,
      config,
      { userId: 7, expectedUserUuid: "wrong", subject: "stable-subject" },
      true
    )
  );
  assert.equal(f.writes.length, 0);
});

// Execute the actual production callbacks rather than reimplementing them here.
function callbacks(f) {
  const source = read("packages/features/auth/lib/next-auth-options.ts");
  const ast = ts.createSourceFile("options.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((d) => d.name.getText(ast) === "getOptions")
  );
  assert.ok(declaration);
  const deps = {
    prisma: f.db,
    authentikConfig: config,
    refreshAuthentikToken,
    authorizeAuthentikSignIn,
    calcomAdapter: {},
    defaultCookies: () => ({}),
    WEBAPP_URL: WEB,
    providers: [createAuthentikProvider(config)],
    log: { debug() {}, warn() {}, error() {} },
    safeStringify: JSON.stringify,
    encode: nativeJwt.encode,
    userMetadata: { parse: (v) => v },
    isNumber: (v) => /^[0-9]+$/.test(v),
  };
  const prelude = Object.keys(deps)
    .map((name) => `const ${name}=require(${JSON.stringify(name)});`)
    .join("\n");
  return compile(`${prelude}\n${declaration.getText(ast)}`, deps).getOptions({
    getDubId: () => undefined,
    getTrackingData: () => ({}),
  });
}
test("production signIn/JWT/session callbacks execute the native branch", async () => {
  const f = fixture();
  const options = callbacks(f);
  assert.equal(await options.callbacks.signIn(f.login), true);
  const token = await options.callbacks.jwt({ token: {}, ...f.login });
  const session = await options.callbacks.session({ session: { user: {}, expires: "future" }, token });
  assert.equal(session.user.id, 7);
  assert.equal(session.user.role, "USER");
  assert.equal(session.authentik, undefined);
});
test("production JWT update does not fall into legacy client-identity merge", async () => {
  const f = fixture();
  const options = callbacks(f);
  const token = await options.callbacks.jwt({ token: {}, ...f.login });
  const updated = await options.callbacks.jwt({
    token,
    trigger: "update",
    session: { email: "wrong@example.test", role: "ADMIN", upId: "prof-profile-20" },
  });
  assert.equal(updated.email, f.user.email);
  assert.equal(updated.role, "USER");
  assert.equal(updated.upId, "prof-profile-20");
});
test("server-session path cannot return cached authorization after account lock", async () => {
  const f = fixture();
  const token = await f.token();
  class UserRepository {
    async enrichUserWithTheProfile({ user, upId }) {
      return { ...user, profile: { upId } };
    }
  }
  const { getServerSession } = compile(read("packages/features/auth/lib/getServerSession.ts"), {
    "node:process": process,
    "@calcom/features/community-enterprise/identity/AuthentikConfig": { readAuthentikConfig: () => config },
    "@calcom/features/community-enterprise/identity/AuthentikIdentity": identityModule,
    "@calcom/lib/constants": { WEBAPP_URL: WEB },
    "@calcom/features/users/repositories/UserRepository": { UserRepository },
    "@calcom/lib/getAvatarUrl": { getUserAvatarUrl: () => null },
    "@calcom/lib/logger": {
      __esModule: true,
      default: { getSubLogger: () => ({ debug() {}, warn() {}, error() {} }) },
    },
    "@calcom/prisma": { __esModule: true, default: f.db },
    "next-auth/jwt": { getToken: async () => token },
  });
  assert.equal((await getServerSession({ req: {} })).user.id, 7);
  f.user.locked = true;
  assert.equal(await getServerSession({ req: {} }), null);
  f.user.locked = false;
  f.exists = false;
  assert.equal(await getServerSession({ req: {} }), null);
});

// Exercise the real NextAuth 4 OAuth handler, OIDC discovery/JWKS, authorization
// code exchange, PKCE/state/nonce checks and encrypted session cookie. Only the
// external IdP is a loopback fixture; it is not a live Authentik deployment.
async function protocolAttempt(t, fault) {
  const http = require("node:http");
  const { createHash } = require("node:crypto");
  const { generateKeyPair, exportJWK, SignJWT } = require("jose");
  const { AuthHandler } = require(path.join(path.dirname(require.resolve("next-auth")), "core/index.js"));
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = { ...(await exportJWK(publicKey)), kid: "fixture-key", alg: "RS256", use: "sig" };
  let issuer,
    authorizationParameters,
    tokenRequests = 0;
  const server = http.createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    try {
      if (request.url.endsWith("/.well-known/openid-configuration")) {
        response.end(
          JSON.stringify({
            issuer: `${issuer}/`,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ["code"],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
            token_endpoint_auth_methods_supported: ["client_secret_basic"],
            code_challenge_methods_supported: ["S256"],
          })
        );
        return;
      }
      if (request.url.endsWith("/jwks")) {
        response.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      if (request.url.endsWith("/token")) {
        tokenRequests++;
        let body = "";
        for await (const chunk of request) body += chunk;
        const fields = new URLSearchParams(body);
        const proof = createHash("sha256")
          .update(fields.get("code_verifier") ?? "")
          .digest("base64url");
        assert.equal(proof, authorizationParameters.get("code_challenge"));
        assert.equal(fields.get("code"), "fixture-code");
        let signingKey = privateKey;
        if (fault === "signature") signingKey = (await generateKeyPair("RS256")).privateKey;
        const jwt = await new SignJWT({
          nonce: fault === "nonce" ? "wrong" : authorizationParameters.get("nonce"),
          email: "not-used-for-linking@example.test",
          name: "IdP Name",
        })
          .setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
          .setIssuer(`${issuer}/`)
          .setSubject(fault === "unlinked" ? "different-subject" : "stable-subject")
          .setAudience(fault === "audience" ? "another-client" : config.clientId)
          .setIssuedAt()
          .setExpirationTime("2m")
          .sign(signingKey);
        response.end(
          JSON.stringify({
            access_token: "fixture-access-token",
            token_type: "Bearer",
            expires_in: 120,
            id_token: jwt,
          })
        );
        return;
      }
      response.statusCode = 404;
      response.end("{}");
    } catch (error) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: "invalid_grant" }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  issuer = `http://127.0.0.1:${server.address().port}/application/o/calendar`;
  const oldIssuer = config.issuer;
  config.issuer = issuer;
  t.after(() => {
    config.issuer = oldIssuer;
  });
  const oldUrl = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = "http://127.0.0.1:38917";
  t.after(() => {
    if (oldUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = oldUrl;
  });
  const f = fixture();
  const options = callbacks(f);
  const errors = [];
  const { default: CalComAdapter } = compile(read("packages/features/auth/lib/next-auth-custom-adapter.ts"), {
    "@calcom/prisma/client": { Prisma: { PrismaClientKnownRequestError: class extends Error {} } },
  });
  const findUser = f.db.user.findUnique;
  f.db.user.findUnique = async (query) => {
    if (query.where.email !== undefined)
      throw new Error("Email-based resolution is forbidden for this native path");
    return findUser(query);
  };
  f.db.user.create = async () => {
    throw new Error("Unexpected automatic account creation");
  };
  options.adapter = CalComAdapter(f.db);
  options.secret = "fixture-nextauth-secret-not-a-real-secret-at-all";
  options.events = {};
  options.debug = false;
  options.logger = {
    error(code) {
      errors.push(code);
    },
    warn() {},
    debug() {},
  };
  const jar = {};
  async function request(action, method = "GET", body = {}, query = {}) {
    const result = await AuthHandler({
      options,
      req: {
        action,
        method,
        body,
        query,
        cookies: jar,
        providerId: ["signin", "callback"].includes(action) ? "authentik" : undefined,
        headers: { host: "127.0.0.1:38917", "x-forwarded-proto": "http" },
      },
    });
    for (const cookie of result.cookies ?? []) {
      if (cookie.options?.maxAge === 0) delete jar[cookie.name];
      else jar[cookie.name] = cookie.value;
    }
    return result;
  }
  const csrf = await request("csrf");
  assert.ok(csrf.body.csrfToken);
  const signin = await request("signin", "POST", {
    csrfToken: csrf.body.csrfToken,
    callbackUrl: "http://127.0.0.1:38917/event-types",
  });
  assert.ok(signin.redirect, `Expected authorize redirect; errors=${errors}`);
  const authorize = new URL(signin.redirect);
  assert.equal(authorize.origin, new URL(issuer).origin);
  authorizationParameters = authorize.searchParams;
  assert.equal(authorizationParameters.get("code_challenge_method"), "S256");
  assert.ok(authorizationParameters.get("nonce"));
  const result = await request(
    "callback",
    "GET",
    {},
    { code: "fixture-code", state: fault === "state" ? "wrong-state" : authorizationParameters.get("state") }
  );
  const current = await request("session");
  if (fault) {
    assert.ok(!current.body?.user, `Unexpected authenticated session for ${fault}`);
  } else {
    assert.equal(current.body.user.id, 7);
    assert.equal(current.body.user.role, "USER");
    assert.ok(Object.keys(jar).some((name) => name.includes("session-token")));
    assert.ok(!JSON.stringify(current.body).includes("fixture-access-token"));
    f.user.locked = true;
    const revoked = await request("session");
    assert.ok(!revoked.body?.user);
  }
  assert.equal(f.writes.length, 0);
  assert.equal(tokenRequests, fault === "state" ? 0 : 1);
  return { result, tokenRequests };
}
test("real OIDC exchange creates a native session and local lock revokes the existing cookie", async (t) => {
  await protocolAttempt(t);
});
for (const fault of ["state", "nonce", "audience", "signature", "unlinked"]) {
  test(`real OIDC exchange rejects ${fault}`, async (t) => {
    await protocolAttempt(t, fault);
  });
}

test("reviewed account link cannot rebind a subject already owned by another user", async () => {
  const f = fixture();
  f.db.account.findUnique = async () => ({ id: "other-binding", userId: 9, type: "oauth" });
  await assert.rejects(
    linkAuthentikAccount(
      f.db,
      config,
      { userId: 7, expectedUserUuid: f.user.uuid, subject: "stable-subject" },
      true
    )
  );
  assert.equal(f.writes.length, 0);
});
test("IdP group and administrator claims cannot mint a global Cal administrator", async () => {
  const f = fixture();
  f.login.profile.groups = ["admins"];
  f.login.profile.role = "ADMIN";
  const token = await f.token();
  assert.equal(token.role, "USER");
  assert.equal(token.groups, undefined);
});
