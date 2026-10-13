// SPDX-License-Identifier: MIT
// Isolated production policy and entrypoint wiring tests. Native NextAuth, JWT
// cryptography, Prisma, browser rendering and the complete app build are separate.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const policyPath = "@calcom/features/community-enterprise/identity/StaffLoginPolicy";
const strict = { CAL_AUTHENTIK_ONLY: "true", CAL_AUTHENTIK_ENABLED: "true" };
const native = { provider: "authentik", type: "oauth" };
const marker = { authentik: { version: 1 } };

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}
function compile(source, modules = {}) {
  const transpiled = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });
  assert.equal(transpiled.diagnostics?.length ?? 0, 0);
  const module = { exports: {} };
  new Function("require", "module", "exports", transpiled.outputText)(
    (name) => {
      if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected test dependency: ${name}`);
      return modules[name];
    },
    module,
    module.exports
  );
  return module.exports;
}
const policy = compile(read("packages/features/community-enterprise/identity/StaffLoginPolicy.ts"));

test("default and explicit false preserve existing login policy", () => {
  assert.equal(policy.isAuthentikOnly({}), false);
  assert.equal(policy.isAuthentikOnly({ CAL_AUTHENTIK_ONLY: "false" }), false);
});
test("strict mode is explicit and requires the enabled native provider", () => {
  assert.equal(policy.isAuthentikOnly(strict), true);
  for (const enabled of [undefined, "false", "1"]) {
    assert.throws(() =>
      policy.isAuthentikOnly({ CAL_AUTHENTIK_ONLY: "true", CAL_AUTHENTIK_ENABLED: enabled })
    );
  }
});
for (const value of ["", "1", "0", "TRUE", " true", "false "]) {
  test(`invalid policy flag is not silently treated as disabled: ${JSON.stringify(value)}`, () => {
    assert.throws(() => policy.isAuthentikOnly({ ...strict, CAL_AUTHENTIK_ONLY: value }));
  });
}
test("provider selection is exact and does not mutate the original list", () => {
  const providers = [
    { id: "credentials" },
    { id: "authentik", options: { id: "authentik" } },
    { id: "google" },
  ];
  assert.deepEqual(policy.selectAuthentikProvider(providers), [providers[1]]);
  assert.equal(providers.length, 3);
});
for (const providers of [
  [],
  [{ id: "google" }],
  [{ id: "authentik" }, { id: "authentik" }],
  [{ id: "authentik", options: { id: "google" } }],
]) {
  test(`missing, duplicate or overridden native provider fails: ${JSON.stringify(providers)}`, () => {
    assert.throws(() => policy.selectAuthentikProvider(providers));
  });
}
for (const account of [
  null,
  undefined,
  { provider: "credentials", type: "credentials" },
  { provider: "email", type: "email" },
  { provider: "google", type: "oauth" },
  { provider: "azure-ad", type: "oauth" },
  { provider: "authentik", type: "credentials" },
]) {
  test(`alternate sign-in cannot reach native account callbacks: ${account?.provider ?? "missing"}/${account?.type ?? "missing"}`, async () => {
    let calls = 0;
    const result = await policy.restrictStaffSignIn(async () => {
      calls++;
      return true;
    })({ account });
    assert.equal(result, false);
    assert.equal(calls, 0);
  });
}
test("native sign-in retains downstream denial and redirect decisions", async () => {
  for (const decision of [true, false, "/auth/error?error=AccessDenied"]) {
    let received;
    const input = { account: native, profile: { sub: "subject" } };
    const result = await policy.restrictStaffSignIn((context) => {
      received = context;
      return decision;
    })(input);
    assert.equal(result, decision);
    assert.equal(received, input);
  }
});
for (const provider of ["credentials", "google", "azure-ad", "email"]) {
  test(`an existing native cookie cannot sponsor another login: ${provider}`, async () => {
    let called = false;
    await assert.rejects(
      policy.restrictStaffJwt(async () => {
        called = true;
        return marker;
      })({
        token: marker,
        account: { provider, type: "oauth" },
      })
    );
    assert.equal(called, false);
  });
}
test("a client update cannot manufacture native provenance on a legacy token", async () => {
  let called = false;
  await assert.rejects(
    policy.restrictStaffJwt(async () => {
      called = true;
      return marker;
    })({
      token: { sub: "7" },
      session: marker,
      trigger: "update",
    })
  );
  assert.equal(called, false);
});
test("unmarked output from the downstream JWT callback is rejected", async () => {
  await assert.rejects(policy.restrictStaffJwt(() => ({ sub: "7" }))({ token: {}, account: native }));
});
test("native login and refresh delegate without trusting the marker as validation", async () => {
  const valid = { sub: "7", ...marker };
  for (const input of [{ token: {}, account: native }, { token: valid }]) {
    let received;
    const result = await policy.restrictStaffJwt((context) => {
      received = context;
      return valid;
    })(input);
    assert.equal(result, valid);
    assert.equal(received, input);
  }
  // The native validator, not this presence check, must reject malformed/expired bindings.
  await assert.rejects(
    policy.restrictStaffJwt(() => {
      throw new Error("native binding rejected");
    })({
      token: { authentik: null },
    }),
    /native binding rejected/
  );
});
test("inherited marker is not native session provenance", () => {
  assert.equal(policy.hasAuthentikMarker(Object.create(marker)), false);
  for (const token of [null, undefined, false, "authentik", {}, { authentik: undefined }]) {
    assert.equal(policy.hasAuthentikMarker(token), false);
  }
});

function authRoute(env, overrides = {}) {
  const calls = { signIn: 0, jwt: 0 };
  const options = {
    providers: [{ id: "credentials" }, { id: "authentik" }, { id: "google" }],
    session: { strategy: "jwt" },
    callbacks: {
      signIn: async () => {
        calls.signIn++;
        return true;
      },
      jwt: async () => {
        calls.jwt++;
        return marker;
      },
      session: () => "unchanged session callback",
    },
    ...overrides,
  };
  let captured;
  const handler = compile(read("apps/web/pages/api/auth/[...nextauth].ts"), {
    "node:process": { env },
    "next-auth": {
      __esModule: true,
      default: (_req, _res, value) => {
        captured = value;
        return "dispatched";
      },
    },
    "@calcom/features/auth/lib/next-auth-options": { getOptions: () => options },
    [policyPath]: policy,
    "@calcom/lib/tracking": { getTrackingFromCookies: () => ({}) },
  }).default;
  return { handler, calls, options, effective: () => captured };
}
test("actual auth entrypoint preserves mixed mode without rewriting native options", () => {
  const f = authRoute({});
  assert.equal(f.handler({ cookies: {}, query: {} }, {}), "dispatched");
  assert.equal(f.effective(), f.options);
});
test("actual auth entrypoint filters all alternative providers and wraps both callbacks", async () => {
  const f = authRoute(strict);
  f.handler({ cookies: {}, query: {} }, {});
  const options = f.effective();
  assert.deepEqual(
    options.providers.map((p) => p.id),
    ["authentik"]
  );
  assert.equal(f.options.providers.length, 3);
  assert.equal(options.callbacks.session, f.options.callbacks.session);
  assert.equal(await options.callbacks.signIn({ account: { provider: "google", type: "oauth" } }), false);
  await assert.rejects(options.callbacks.jwt({ token: { sub: "7" } }));
  assert.equal(f.calls.signIn, 0);
  assert.equal(f.calls.jwt, 0);
  assert.equal(await options.callbacks.signIn({ account: native }), true);
  assert.equal(await options.callbacks.jwt({ token: {}, account: native }), marker);
});
test("actual auth entrypoint refuses missing native callbacks rather than accepting opaque JWTs", () => {
  for (const callbacks of [undefined, {}, { signIn: () => true }, { jwt: () => marker }]) {
    const f = authRoute(strict, { callbacks });
    assert.throws(() => f.handler({ cookies: {}, query: {} }, {}));
    assert.equal(f.effective(), undefined);
  }
});

for (const route of ["setup", "signup", "forgot-password", "reset-password"]) {
  const file = `apps/web/app/api/auth/${route}/route.ts`;
  const source = read(file);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((decl) => decl.name.getText(ast) === "POST")
  );
  test(`actual ${route} POST export denies before executing account operations, including invite bodies`, async () => {
    assert.ok(
      ast.statements.some((node) => ts.isImportDeclaration(node) && node.moduleSpecifier.text === policyPath)
    );
    let calls = 0;
    const env = { ...strict };
    const business = async (...args) => {
      calls++;
      return Response.json({ args: args.length });
    };
    const dependencies = {
      process: { env },
      restrictLocalAccountRoute: policy.restrictLocalAccountRoute,
      defaultResponderForAppDir: (handler) => {
        assert.equal(handler, business);
        return handler;
      },
      handler: business,
    };
    const prelude = Object.keys(dependencies)
      .map((key) => `const ${key}=require(${JSON.stringify(key)});`)
      .join("\n");
    const { POST } = compile(prelude + "\n" + declaration.getText(ast), dependencies);
    const request = {
      json: () => {
        throw new Error("Body must not be parsed");
      },
      inviteToken: "existing-invite",
    };
    const response = await POST(request, { params: Promise.resolve({}) });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal((await response.json()).code, "AUTHENTIK_ONLY");
    assert.equal(calls, 0);
    env.CAL_AUTHENTIK_ONLY = "false";
    const allowed = await POST(request, { params: Promise.resolve({}) });
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).args, 2);
    assert.equal(calls, 1);
  });
}

function serverSession(env, initialToken) {
  let token = initialToken;
  const f = { reads: 0, refreshes: 0, rejectRefresh: false };
  const user = { id: 7, email: "staff@example.test", role: "USER", locked: false };
  const getServerSession = compile(read("packages/features/auth/lib/getServerSession.ts"), {
    "node:process": { env },
    [policyPath]: policy,
    "next-auth/jwt": { getToken: async () => token },
    "@calcom/features/community-enterprise/identity/AuthentikConfig": { readAuthentikConfig: () => ({}) },
    "@calcom/features/community-enterprise/identity/AuthentikIdentity": {
      refreshAuthentikToken: async (_db, _config, input) => {
        f.refreshes++;
        if (f.rejectRefresh) throw new Error("Native authority rejected");
        return input.token;
      },
    },
    "@calcom/features/users/repositories/UserRepository": {
      UserRepository: class {
        async enrichUserWithTheProfile({ user }) {
          return { ...user, profile: {} };
        }
      },
    },
    "@calcom/lib/constants": { WEBAPP_URL: "https://calendar.example.test" },
    "@calcom/lib/getAvatarUrl": { getUserAvatarUrl: () => null },
    "@calcom/lib/logger": {
      __esModule: true,
      default: { getSubLogger: () => ({ debug() {}, warn() {}, error() {} }) },
    },
    "@calcom/prisma": {
      __esModule: true,
      default: {
        user: {
          findUnique: async () => {
            f.reads++;
            return user;
          },
        },
      },
    },
  }).getServerSession;
  return {
    f,
    user,
    replaceToken: (value) => {
      token = value;
    },
    run: () => getServerSession({ req: {} }),
  };
}
test("actual server-session helper rejects legacy cookies before database lookup", async () => {
  const f = serverSession(strict, { sub: "7", email: "staff@example.test" });
  assert.equal(await f.run(), null);
  assert.equal(f.f.reads, 0);
  assert.equal(f.f.refreshes, 0);
});
test("actual server-session helper retains anonymous access as an absent staff session", async () => {
  const f = serverSession(strict, null);
  assert.equal(await f.run(), null);
  assert.equal(f.f.reads, 0);
});
test("actual server-session helper still invokes the native authority validator every time", async () => {
  const f = serverSession(strict, { sub: "7", email: "staff@example.test", ...marker });
  assert.equal((await f.run()).user.id, 7);
  assert.equal(f.f.refreshes, 1);
  f.f.rejectRefresh = true;
  assert.equal(await f.run(), null);
  assert.equal(f.f.refreshes, 2);
  assert.equal(f.f.reads, 1);
});
test("disabled strict mode preserves existing legacy-session behavior", async () => {
  const f = serverSession({}, { sub: "7", email: "staff@example.test" });
  assert.equal((await f.run()).user.id, 7);
  f.user.locked = true;
  assert.equal(await f.run(), null);
});

function loginProps(env, { hasUser = true, session = null } = {}) {
  const f = { jwtChecks: 0, csrfCalls: 0 };
  const getServerSideProps = compile(read("apps/web/server/lib/auth/login/getServerSideProps.tsx"), {
    "node:process": { env },
    [policyPath]: policy,
    "@calcom/features/auth/lib/getServerSession": { getServerSession: async () => session },
    "@calcom/features/community-enterprise/identity/AuthentikConfig": { readAuthentikConfig: () => ({}) },
    "@calcom/lib/constants": { WEBSITE_URL: "https://calendar.example.test" },
    "@calcom/lib/getSafeRedirectUrl": { getSafeRedirectUrl: (url) => (url === "/event-types" ? url : null) },
    "@calcom/prisma": {
      __esModule: true,
      default: { user: { findFirst: async () => (hasUser ? { id: 7 } : null) } },
    },
    "@server/lib/constants": { IS_GOOGLE_LOGIN_ENABLED: true },
    jose: {
      jwtVerify: async () => {
        f.jwtChecks++;
        throw new Error("Invalid local TOTP token");
      },
    },
    "next-auth/react": {
      getCsrfToken: async () => {
        f.csrfCalls++;
        return "test-csrf";
      },
    },
  }).getServerSideProps;
  return { f, run: (query = {}) => getServerSideProps({ req: {}, query }) };
}
test("actual login props do not expose public first-admin setup in strict mode", async () => {
  const f = loginProps(strict, { hasUser: false });
  const result = await f.run();
  assert.equal(result.redirect, undefined);
  assert.equal(result.props.isAuthentikOnlyLogin, true);
  assert.equal(result.props.isAuthentikLoginEnabled, true);
  assert.equal(result.props.isGoogleLoginEnabled, false);
  assert.equal(result.props.isOutlookLoginEnabled, false);
});
test("actual login props preserve first-run setup in mixed mode", async () => {
  assert.equal((await loginProps({}, { hasUser: false }).run()).redirect.destination, "/auth/setup");
});
test("strict login does not process a legacy local-TOTP query", async () => {
  const f = loginProps(strict);
  const result = await f.run({ totp: "invalid-local-token" });
  assert.equal(result.props.totpEmail, null);
  assert.equal(f.f.jwtChecks, 0);
});
test("mixed login preserves its local-TOTP verification", async () => {
  const f = loginProps({});
  const result = await f.run({ totp: "invalid-local-token" });
  assert.ok(result.redirect.destination.startsWith("/auth/error"));
  assert.equal(f.f.jwtChecks, 1);
});
test("authenticated strict login retains the existing safe redirect", async () => {
  const f = loginProps(strict, { session: { user: { id: 7 } } });
  assert.equal((await f.run({ callbackUrl: "/event-types" })).redirect.destination, "/event-types");
  assert.equal(f.f.csrfCalls, 0);
});

function renderLogin(only) {
  // Execute the production component's JSX decisions with a record-only runtime.
  // This is not React hydration, a browser test, or a replacement for either.
  const file = "apps/web/modules/auth/login-view.tsx";
  const source = read(file);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "Login"
  );
  assert.ok(declaration);
  const jsx = (type, props) => ({ type, props });
  const schema = new Proxy(() => schema, { get: () => schema });
  const components = [
    "BackgroundGrid",
    "FormProvider",
    "Button",
    "Input",
    "Field",
    "FieldLabel",
    "Separator",
    "Link",
    "GoogleIcon",
    "MicrosoftIcon",
    "LastUsed",
    "InputGroup",
    "InputGroupAddon",
    "InputGroupInput",
    "Eye",
    "EyeOff",
    "TwoFactor",
    "BackupCode",
    "Alert",
    "Icon",
    "AddToHomescreen",
  ];
  const dependencies = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    process: { env: {} },
    useCompatSearchParams: () => new URLSearchParams(),
    useLocale: () => ({ t: (key) => key }),
    useRouter: () => ({ push() {} }),
    useState: (value) => [value, () => {}],
    useLastUsed: () => ["google", () => {}],
    z: schema,
    zodResolver: () => null,
    useForm: () => ({
      register: () => ({}),
      formState: { errors: {}, isSubmitting: false },
      handleSubmit: (fn) => fn,
      setValue() {},
    }),
    getSafeRedirectUrl: () => "https://calendar.example.test/",
    WEBAPP_URL: "https://calendar.example.test",
    WEBSITE_URL: "https://calendar.example.test",
    emailRegex: /@/,
    ErrorCode: {},
  };
  for (const name of components) dependencies[name] = name;
  const prelude = Object.keys(dependencies)
    .filter((key) => !key.includes("/"))
    .map((key) => `const ${key}=require(${JSON.stringify(key)});`)
    .join("\n");
  const componentSource = prelude + "\n" + declaration.getText(ast);
  const output = ts.transpileModule(componentSource, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  assert.equal(output.diagnostics?.length ?? 0, 0);
  const module = { exports: {} };
  new Function("require", "module", "exports", output.outputText)(
    (name) => {
      assert.ok(Object.hasOwn(dependencies, name), name);
      return dependencies[name];
    },
    module,
    module.exports
  );
  const tree = module.exports.default({
    csrfToken: "fixture",
    isGoogleLoginEnabled: true,
    isOutlookLoginEnabled: true,
    isAuthentikLoginEnabled: true,
    isAuthentikOnlyLogin: only,
    totpEmail: "stale@example.test",
  });
  const nodes = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== "object") return;
    nodes.push(node);
    walk(node.props?.children);
  };
  walk(tree);
  return nodes;
}
test("strict login JSX contains Authentik but no local form, social login or signup", () => {
  const nodes = renderLogin(true);
  const ids = nodes.map((node) => node.props?.["data-testid"]);
  assert.ok(ids.includes("authentik"));
  for (const forbidden of ["login-form", "google", "microsoft"]) assert.ok(!ids.includes(forbidden));
  assert.ok(!nodes.some((node) => node.type === "Link"));
  assert.ok(!nodes.some((node) => node.type === "Separator"));
});
test("mixed login JSX preserves the local authentication form", () => {
  assert.ok(renderLogin(false).some((node) => node.props?.["data-testid"] === "login-form"));
});
test("the regular Turbo lane receives the server-only policy flag", () => {
  const config = JSON.parse(read("turbo.json"));
  assert.equal(config.globalEnv.filter((key) => key === "CAL_AUTHENTIK_ONLY").length, 1);
  assert.ok(!config.globalEnv.includes("NEXT_PUBLIC_CAL_AUTHENTIK_ONLY"));
});

test("provider filtering preserves native fields with unrelated email options", () => {
  const nativeProvider = {
    id: "authentik",
    type: "oauth",
    name: "Authentik",
    options: { clientId: "fixture" },
  };
  const providers = [{ id: "email", options: { maxAge: 900, from: "test@example.test" } }, nativeProvider];
  const selected = policy.selectAuthentikProvider(providers);
  assert.equal(selected[0], nativeProvider);
  assert.equal(selected[0].type, "oauth");
  assert.equal(selected[0].options.clientId, "fixture");
});
test("malformed selected-provider options cannot hide a provider override", () => {
  for (const options of ["authentik", true, 123, () => ({ id: "google" })]) {
    assert.throws(() => policy.selectAuthentikProvider([{ id: "authentik", options }]));
  }
});
