// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { after, afterEach, test } = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");

function compile(file, dependencies, globals = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  assert.deepEqual(output.diagnostics, []);
  new Function("require", "module", "exports", ...Object.keys(globals), output.outputText)(
    (name) => {
      assert.ok(Object.hasOwn(dependencies, name), `Unmapped dependency: ${name}`);
      return dependencies[name];
    },
    module,
    module.exports,
    ...Object.values(globals)
  );
  return module.exports;
}

const authentik = compile("packages/features/community-enterprise/identity/AuthentikConfig.ts", {
  "node:crypto": require("node:crypto"),
  "next-auth/providers/authentik": require("next-auth/providers/authentik"),
});
const staffPolicy = compile("packages/features/community-enterprise/identity/StaffLoginPolicy.ts", {});

async function protocolFixture(t, { disabled = false, discoveryError = false } = {}) {
  let issuer;
  let discoveryRequests = 0;
  const server = http.createServer((_request, response) => {
    discoveryRequests++;
    response.setHeader("Content-Type", "application/json");
    if (discoveryError) {
      response.statusCode = 503;
      response.end("{}");
      return;
    }
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
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  issuer = `http://127.0.0.1:${server.address().port}/application/o/cal`;
  const config = authentik.readAuthentikConfig({
    NODE_ENV: "test",
    CAL_AUTHENTIK_ENABLED: "true",
    CAL_AUTHENTIK_ISSUER: issuer,
    CAL_AUTHENTIK_CLIENT_ID: "fixture-native-client",
    CAL_AUTHENTIK_CLIENT_SECRET: "fixture-native-secret-not-live",
  });
  const appOrigin = "http://127.0.0.1:38917";
  const previousUrl = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = appOrigin;
  t.after(() => {
    if (previousUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = previousUrl;
  });
  const options = {
    providers: disabled ? [] : [authentik.createAuthentikProvider(config)],
    secret: "fixture-nextauth-secret-not-live-at-all",
    session: { strategy: "jwt" },
    pages: { signIn: "/auth/login", error: "/auth/error" },
    logger: { error() {}, warn() {}, debug() {} },
    callbacks: {
      signIn() {
        throw new Error("Initiation must not run account admission");
      },
      jwt() {
        throw new Error("Initiation must not manufacture a session");
      },
    },
  };
  // Only application option assembly is doubled; the production API wrapper,
  // staff dispatch, provider and public NextAuth HTTP handler all execute.
  const { default: handler } = compile("apps/web/pages/api/auth/[...nextauth].ts", {
    "node:process": {
      env: {
        CAL_AUTHENTIK_ENABLED: disabled ? "false" : "true",
        CAL_AUTHENTIK_ONLY: disabled ? "false" : "true",
      },
    },
    "next-auth": require("next-auth"),
    "@calcom/features/auth/lib/next-auth-options": { getOptions: () => options },
    "@calcom/features/community-enterprise/identity/StaffLoginPolicy": staffPolicy,
    "@calcom/lib/tracking": {
      getTrackingFromCookies() {
        throw new Error("Unexpected tracking operation");
      },
    },
  });
  const cookies = {};
  const request = async (action, method = "GET", body = {}) => {
    const headers = new Map();
    const res = {
      statusCode: 200,
      body: undefined,
      status(value) {
        this.statusCode = value;
        return this;
      },
      getHeader(name) {
        return headers.get(name.toLowerCase());
      },
      setHeader(name, value) {
        headers.set(name.toLowerCase(), value);
        return this;
      },
      json(value) {
        this.setHeader("Content-Type", "application/json");
        this.body = value;
      },
      send(value) {
        this.body = value;
      },
      end() {},
    };
    await handler(
      {
        method,
        query: { nextauth: action },
        body,
        cookies,
        headers: { host: "127.0.0.1:38917", "x-forwarded-proto": "http" },
      },
      res
    );
    for (const cookie of headers.get("set-cookie") ?? []) {
      const [pair] = cookie.split(";");
      const separator = pair.indexOf("=");
      cookies[pair.slice(0, separator)] = decodeURIComponent(pair.slice(separator + 1));
    }
    return { status: res.statusCode, body: res.body, headers, cookies: { ...cookies } };
  };
  return { request, issuer, appOrigin, discoveryRequests: () => discoveryRequests };
}

test("installed public NextAuth handler returns native JSON authorization with state, nonce and PKCE", async (t) => {
  const f = await protocolFixture(t);
  const csrf = await f.request(["csrf"]);
  assert.equal(csrf.status, 200);
  const signin = await f.request(["signin", "authentik"], "POST", {
    csrfToken: csrf.body.csrfToken,
    callbackUrl: `${f.appOrigin}/event-types`,
    json: "true",
  });
  assert.equal(signin.status, 200);
  assert.equal(signin.headers.get("content-type"), "application/json");
  assert.equal(signin.headers.has("location"), false);
  const url = new URL(signin.body.url);
  assert.equal(url.origin, new URL(f.issuer).origin);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), `${f.appOrigin}/api/auth/callback/authentik`);
  for (const name of ["state", "nonce", "code_challenge"]) {
    assert.equal(url.searchParams.getAll(name).length, 1);
    assert.ok(url.searchParams.get(name));
  }
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  for (const suffix of ["state", "nonce", "pkce.code_verifier"]) {
    assert.ok(Object.keys(signin.cookies).some((name) => name.endsWith(suffix)));
  }
  assert.equal(
    Object.keys(signin.cookies).some((name) => name.includes("session-token")),
    false
  );
  assert.equal(f.discoveryRequests(), 1);
});

for (const fault of ["csrf", "disabled", "discovery"]) {
  test(`installed public handler does not initiate valid authorization on ${fault} failure`, async (t) => {
    const f = await protocolFixture(t, {
      disabled: fault === "disabled",
      discoveryError: fault === "discovery",
    });
    const csrf = await f.request(["csrf"]);
    const result = await f.request(["signin", "authentik"], "POST", {
      csrfToken: fault === "csrf" ? "invalid" : csrf.body.csrfToken,
      callbackUrl: `${f.appOrigin}/event-types`,
      json: "true",
    });
    assert.equal(result.status, 200);
    assert.equal(new URL(result.body.url).origin, f.appOrigin);
    assert.equal(new URL(result.body.url).searchParams.has("state"), false);
    assert.equal(
      Object.keys(result.cookies).some((name) => name.includes("session-token")),
      false
    );
    assert.equal(f.discoveryRequests(), fault === "discovery" ? 1 : 0);
  });
}

const React = require("react");
const { JSDOM } = require("jsdom");
const { renderToString } = require("react-dom/server");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://cal.mereka.dev" });
const previousGlobals = new Map();
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, cleanup, fireEvent, render } = require("@testing-library/react");
afterEach(cleanup);
after(() => {
  dom.window.close();
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});
const translations = require(path.join(root, "packages/i18n/locales/en/common.json"));
const callbackUrl = "https://cal.mereka.dev/event-types";
const issuerOrigin = "https://identity.example.test";
const ready = { state: "ready", callbackUrl, issuerOrigin };
const configEnvironment = {
  NODE_ENV: "production",
  CAL_AUTHENTIK_ENABLED: "true",
  CAL_AUTHENTIK_ISSUER: `${issuerOrigin}/application/o/calendar/`,
  CAL_AUTHENTIK_CLIENT_ID: "fixture-client-not-for-props",
  CAL_AUTHENTIK_CLIENT_SECRET: "fixture-secret-not-for-props",
};
const returnPaths = compile("packages/features/onboarding/lib/onboarding-return-path.ts", {});
async function serverProps(query = {}, env = configEnvironment) {
  const { default: ServerPage, dynamic } = compile("apps/web/app/(use-page-wrapper)/auth/mereka/page.tsx", {
    "node:process": { env },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@calcom/features/community-enterprise/identity/AuthentikConfig": authentik,
    "@calcom/features/onboarding/lib/onboarding-return-path": returnPaths,
    "@calcom/lib/constants": { WEBAPP_URL: "https://cal.mereka.dev" },
    "~/auth/mereka-view": { __esModule: true, default: () => null },
  });
  assert.equal(dynamic, "force-dynamic");
  return (await ServerPage({ params: Promise.resolve({}), searchParams: Promise.resolve(query) })).props;
}

test("server entry supplies only safe public props and canonical default", async () => {
  const props = await serverProps();
  assert.deepEqual(props, ready);
  assert.equal(JSON.stringify(props).includes(configEnvironment.CAL_AUTHENTIK_CLIENT_SECRET), false);
  assert.equal(JSON.stringify(props).includes(configEnvironment.CAL_AUTHENTIK_CLIENT_ID), false);
});
for (const rd of ["/teams/123?accept=true#invite", "https://cal.mereka.dev/settings/profile"]) {
  test(`server preserves a validated workspace return ${rd.startsWith("/") ? "relative" : "absolute"}`, async () => {
    assert.deepEqual(await serverProps({ rd }), { ...ready, callbackUrl: new URL(rd, callbackUrl).href });
  });
}
for (const env of [
  {},
  { CAL_AUTHENTIK_ENABLED: "false" },
  { ...configEnvironment, CAL_AUTHENTIK_CLIENT_SECRET: undefined },
  { ...configEnvironment, CAL_AUTHENTIK_ISSUER: "http://unsafe.example.test" },
  { ...configEnvironment, CAL_AUTHENTIK_ENABLED: "TRUE" },
]) {
  test("server rejects disabled or malformed native configuration without public config", async () => {
    assert.deepEqual(await serverProps({}, env), { state: "unavailable" });
  });
}
for (const rd of [
  "",
  ["/teams", "/settings"],
  "/" + "x".repeat(2048),
  "//identity.example.test/event-types",
  "https://outside.example.test/teams",
  "http://cal.mereka.dev/teams",
  "https://cal.mereka.dev:444/teams",
  "https://user@cal.mereka.dev/teams",
  "teams",
  "/teams\\other",
  "/teams/\nother",
  "/teams/%0aother",
  "/teams/%255cother",
  "/teams/%",
  "/auth/mereka",
  "/auth/login",
  "/auth/logout",
  "/api/auth/signin/authentik",
  "/getting-started",
  "/settings/billing",
  "/pricing",
  "/unknown",
]) {
  test(`server explicitly rejects invalid rd case ${JSON.stringify(rd).slice(0, 65)}`, async () => {
    assert.deepEqual(await serverProps({ rd }), { state: "invalid-callback" });
  });
}

function authorization(overrides = {}, origin = issuerOrigin) {
  const url = new URL("/application/o/authorize/", origin);
  for (const [key, value] of Object.entries({
    client_id: "fixture-client",
    response_type: "code",
    redirect_uri: "https://cal.mereka.dev/api/auth/callback/authentik",
    state: "fixture-state",
    nonce: "fixture-nonce",
    code_challenge: "fixture-challenge",
    code_challenge_method: "S256",
    ...overrides,
  })) {
    if (value !== null) url.searchParams.set(key, value);
  }
  return url.href;
}
function jsonResponse(body, { status = 200, contentType = "application/json", text, headers = {} } = {}) {
  const response = new Response(text ?? JSON.stringify(body), {
    status,
    headers: { ...(contentType === null ? {} : { "Content-Type": contentType }), ...headers },
  });
  if (contentType === null) response.headers.delete("Content-Type");
  return response;
}
function fixture({
  props = ready,
  strict = false,
  server = false,
  origin = "https://cal.mereka.dev",
  framed = false,
  ignoreAbort = false,
} = {}) {
  const calls = [];
  const navigation = [];
  const timers = new Map();
  let nextTimer = 0;
  const browser = { location: { origin, assign: (url) => navigation.push(url) } };
  browser.self = browser;
  browser.top = framed ? {} : browser;
  const { default: Entry } = compile(
    "apps/web/modules/auth/mereka-view.tsx",
    {
      react: React,
      "react/jsx-runtime": require("react/jsx-runtime"),
      "@calcom/lib/hooks/useLocale": {
        useLocale: () => ({
          t: (key) => {
            assert.equal(typeof translations[key], "string");
            return key;
          },
        }),
      },
      "@calcom/ui/components/button": {
        Button: ({ children, ...buttonProps }) => React.createElement("button", buttonProps, children),
      },
      "@components/ui/AuthContainer": {
        __esModule: true,
        default: ({ children }) => React.createElement("div", {}, children),
      },
    },
    {
      window: browser,
      fetch: (url, init) =>
        new Promise((resolve, reject) => {
          calls.push({ url, init, resolve, reject });
          if (!ignoreAbort)
            init.signal.addEventListener("abort", () => reject(new Error("Aborted transport")), {
              once: true,
            });
        }),
      setTimeout: (fn, delay) => {
        const id = ++nextTimer;
        timers.set(id, { fn, delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    }
  );
  const element = (value) =>
    strict
      ? React.createElement(React.StrictMode, {}, React.createElement(Entry, value))
      : React.createElement(Entry, value);
  const view = server ? { html: renderToString(element(props)) } : render(element(props));
  const settle = async () => {
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
  };
  const reply = async (index, body, options) => {
    await act(async () => {
      calls[index].resolve(body instanceof Response ? body : jsonResponse(body, options));
    });
    await settle();
  };
  const advanceToPost = async () => {
    await reply(0, { csrfToken: "fixture-csrf" });
    assert.equal(calls.length, 2);
  };
  const expire = async () => {
    assert.equal(timers.size, 1);
    const { fn, delay } = [...timers.values()][0];
    assert.equal(delay, 30_000);
    await act(async () => fn());
    await settle();
  };
  return {
    calls,
    navigation,
    timers,
    view,
    settle,
    reply,
    advanceToPost,
    expire,
    rerender: (value) => view.rerender(element(value)),
  };
}

test("actual StrictMode render initiates once after render, uses native public form, and navigates once", async () => {
  const f = fixture({ strict: true });
  assert.equal(f.calls.length, 1);
  assert.equal(f.view.getByRole("status").textContent, "mereka_sign_in_pending");
  assert.equal(f.navigation.length, 0);
  await f.advanceToPost();
  assert.equal(f.calls[0].url, "/api/auth/csrf");
  assert.equal(f.calls[1].url, "/api/auth/signin/authentik");
  assert.equal(f.calls[1].init.method, "POST");
  assert.deepEqual(Object.fromEntries(f.calls[1].init.body), {
    csrfToken: "fixture-csrf",
    callbackUrl,
    json: "true",
  });
  for (const { init } of f.calls) {
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.equal(init.signal, f.calls[0].init.signal);
  }
  await f.reply(1, { url: authorization() });
  assert.deepEqual(f.navigation, [authorization()]);
  assert.equal(f.timers.size, 0);
  assert.equal(f.view.queryByRole("alert"), null);
  assert.equal(f.view.queryByText(/signed.in|success/i), null);
});
test("SSR does not initiate or schedule work", () => {
  const f = fixture({ server: true });
  assert.match(f.view.html, /mereka_sign_in_pending/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.timers.size, 0);
});
for (const props of [{ state: "unavailable" }, { state: "invalid-callback" }]) {
  test(`actual render ${props.state} never starts requests or offers retry`, () => {
    const f = fixture({ props });
    assert.ok(f.view.getByRole("alert"));
    assert.equal(f.calls.length, 0);
    assert.equal(f.view.queryByText("try_again"), null);
  });
}
for (const options of [{ origin: "https://calendar.mereka.dev" }, { framed: true }]) {
  test("noncanonical or framed render fails closed before requests", () => {
    const f = fixture(options);
    assert.ok(f.view.getByRole("alert"));
    assert.equal(f.calls.length, 0);
  });
}
for (const stage of [0, 1]) {
  test(`rejected ${stage ? "signin" : "csrf"} fetch becomes a terminal, retryable error`, async () => {
    const f = fixture();
    if (stage) await f.advanceToPost();
    await act(async () => f.calls[stage].reject(new Error("Transport unavailable")));
    await f.settle();
    assert.ok(f.view.getByRole("alert"));
    assert.ok(f.view.getByText("try_again"));
    assert.equal(f.calls[stage].init.signal.aborted, true);
    assert.deepEqual(f.navigation, []);
  });
  for (const options of [
    { status: 503 },
    { status: 302 },
    { contentType: "text/plain" },
    { contentType: "text/html" },
    { contentType: null },
    { text: "{" },
  ]) {
    test(`response failure at ${stage ? "signin" : "csrf"}: ${JSON.stringify(options)}`, async () => {
      const f = fixture();
      if (stage) await f.advanceToPost();
      await f.reply(stage, stage ? { url: authorization() } : { csrfToken: "fixture-csrf" }, options);
      assert.ok(f.view.getByRole("alert"));
      assert.equal(f.calls.length, stage + 1);
      assert.deepEqual(f.navigation, []);
      assert.equal(f.timers.size, 0);
    });
  }
  test(`oversized declared ${stage ? "signin" : "csrf"} response stops immediately`, async () => {
    const f = fixture();
    if (stage) await f.advanceToPost();
    await f.reply(stage, {}, { headers: { "Content-Length": "999999" } });
    assert.ok(f.view.getByRole("alert"));
    assert.equal(f.calls.length, stage + 1);
    assert.deepEqual(f.navigation, []);
  });
  test(`streamed ${stage ? "signin" : "csrf"} byte cap cancels body without content length`, async () => {
    const f = fixture();
    if (stage) await f.advanceToPost();
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("é".repeat(stage ? 9000 : 2200)));
      },
      cancel() {
        cancelled = true;
      },
    });
    await f.reply(stage, new Response(stream, { headers: { "Content-Type": "application/json" } }));
    assert.ok(f.view.getByRole("alert"));
    assert.equal(cancelled, true);
    assert.equal(f.calls.length, stage + 1);
    assert.deepEqual(f.navigation, []);
  });
  test(`cumulative ${stage ? "signin" : "csrf"} byte cap includes every chunk`, async () => {
    const f = fixture();
    if (stage) await f.advanceToPost();
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < (stage ? 17 : 5); i++) controller.enqueue(new Uint8Array(1024).fill(32));
      },
      cancel() {
        cancelled = true;
      },
    });
    await f.reply(stage, new Response(stream, { headers: { "Content-Type": "application/json" } }));
    assert.ok(f.view.getByRole("alert"));
    assert.equal(cancelled, true);
    assert.deepEqual(f.navigation, []);
  });
  for (const phase of ["headers", "body"]) {
    test(`deadline bounds stalled ${stage ? "signin" : "csrf"} ${phase} and suppresses late work`, async () => {
      const f = fixture({ ignoreAbort: true });
      if (stage) await f.advanceToPost();
      if (phase === "body") {
        await f.reply(
          stage,
          new Response(new ReadableStream({ start() {} }), {
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      await f.expire();
      assert.ok(f.view.getByRole("alert"));
      assert.equal(f.calls[stage].init.signal.aborted, true);
      if (phase === "headers") await f.reply(stage, stage ? { url: authorization() } : { csrfToken: "late" });
      assert.equal(f.calls.length, stage + 1);
      assert.deepEqual(f.navigation, []);
    });
  }
}
test("deadline remains bounded when the response reader ignores cancellation", async () => {
  const f = fixture({ ignoreAbort: true });
  let cancelled = false;
  await act(async () =>
    f.calls[0].resolve({
      status: 200,
      headers: new Headers({ "Content-Type": "application/json" }),
      body: {
        getReader: () => ({
          read: () => new Promise(() => {}),
          cancel: () => {
            cancelled = true;
            return new Promise(() => {});
          },
        }),
      },
    })
  );
  await f.expire();
  assert.equal(cancelled, true);
  assert.ok(f.view.getByRole("alert"));
  assert.deepEqual(f.navigation, []);
});
test("JSON UTF-8 media parameters and chunk boundaries preserve a valid native response", async () => {
  const f = fixture();
  await f.reply(0, { csrfToken: "fixture-csrf" }, { contentType: "Application/JSON; charset=utf-8" });
  const encoded = new TextEncoder().encode(JSON.stringify({ url: authorization() }));
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded.slice(0, 17));
      controller.enqueue(encoded.slice(17));
      controller.close();
    },
  });
  await f.reply(1, new Response(stream, { headers: { "Content-Type": "application/json; charset=utf-8" } }));
  assert.deepEqual(f.navigation, [authorization()]);
});
test("parseable native error on an issuer sharing the app origin is still rejected", async () => {
  const f = fixture({ props: { ...ready, issuerOrigin: "https://cal.mereka.dev" } });
  await f.advanceToPost();
  await f.reply(1, { url: "https://cal.mereka.dev/api/auth/error?error=OAuthSignin" });
  assert.ok(f.view.getByRole("alert"));
  assert.deepEqual(f.navigation, []);
});
test("missing client ID cannot be mistaken for native authorization", async () => {
  const f = fixture();
  await f.advanceToPost();
  await f.reply(1, { url: authorization({ client_id: null }) });
  assert.ok(f.view.getByRole("alert"));
  assert.deepEqual(f.navigation, []);
});
test("authorization normalization cannot expand beyond the URL cap", async () => {
  const f = fixture();
  await f.advanceToPost();
  const url = `${issuerOrigin}/${"é".repeat(1400)}?${new URL(authorization()).searchParams}`;
  assert.ok(url.length < 8192);
  assert.ok(new URL(url).href.length > 8192);
  await f.reply(1, { url });
  assert.ok(f.view.getByRole("alert"));
  assert.deepEqual(f.navigation, []);
});
for (const body of [{}, null, [], { csrfToken: null }, { csrfToken: " " }, { csrfToken: "x".repeat(513) }]) {
  test("invalid native CSRF body cannot reach POST", async () => {
    const f = fixture();
    await f.reply(0, body);
    assert.ok(f.view.getByRole("alert"));
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.navigation, []);
  });
}
for (const url of [
  "/api/auth/signin?csrf=true",
  "https://cal.mereka.dev/api/auth/error?error=OAuthSignin",
  authorization({}, "https://outside.example.test"),
  authorization({ nonce: null }),
  authorization({ state: "" }),
  authorization({ code_challenge: null }),
  authorization({ code_challenge_method: "plain" }),
  authorization({ response_type: "token" }),
  authorization({ redirect_uri: "https://outside.example.test/api/auth/callback/authentik" }),
  authorization({ state: "x".repeat(513) }),
  `${authorization()}&state=duplicate`,
  `${authorization()}#fragment`,
  authorization().replace("https://identity", "https://user@identity"),
  "https://identity.example.test/" + "x".repeat(8192),
]) {
  test(`invalid native authorization response case ${url.slice(0, 70)}`, async () => {
    const f = fixture();
    await f.advanceToPost();
    await f.reply(1, { url });
    assert.ok(f.view.getByRole("alert"));
    assert.deepEqual(f.navigation, []);
  });
}
for (const body of [{}, null, [], { url: null }]) {
  test("invalid signin JSON shape is not a successful initiation", async () => {
    const f = fixture();
    await f.advanceToPost();
    await f.reply(1, body);
    assert.ok(f.view.getByRole("alert"));
    assert.deepEqual(f.navigation, []);
  });
}
for (const stage of [0, 1]) {
  test(`unmount at ${stage ? "signin" : "csrf"} aborts and ignores late resolution`, async () => {
    const f = fixture({ ignoreAbort: true });
    if (stage) await f.advanceToPost();
    f.view.unmount();
    await f.settle();
    assert.equal(f.calls[stage].init.signal.aborted, true);
    await f.reply(stage, stage ? { url: authorization() } : { csrfToken: "late" });
    assert.equal(f.calls.length, stage + 1);
    assert.deepEqual(f.navigation, []);
  });
}
test("changed callback cancels old ownership and initiates only the new callback", async () => {
  const f = fixture({ ignoreAbort: true });
  await f.advanceToPost();
  const next = { ...ready, callbackUrl: "https://cal.mereka.dev/teams" };
  f.rerender(next);
  await f.settle();
  assert.equal(f.calls[1].init.signal.aborted, true);
  assert.equal(f.calls.length, 3);
  await f.reply(1, { url: authorization() });
  assert.deepEqual(f.navigation, []);
  await f.reply(2, { csrfToken: "new-csrf" });
  assert.equal(f.calls[3].init.body.get("callbackUrl"), next.callbackUrl);
  await f.reply(3, { url: authorization({ state: "new-state" }) });
  assert.deepEqual(f.navigation, [authorization({ state: "new-state" })]);
});
test("changed issuer aborts old initiation and validates the replacement origin", async () => {
  const f = fixture({ ignoreAbort: true });
  await f.advanceToPost();
  f.rerender({ ...ready, issuerOrigin: "https://new-identity.example.test" });
  await f.settle();
  await f.reply(1, { url: authorization() });
  assert.deepEqual(f.navigation, []);
  await f.reply(2, { csrfToken: "new-csrf" });
  const replacement = authorization({}, "https://new-identity.example.test");
  await f.reply(3, { url: replacement });
  assert.deepEqual(f.navigation, [replacement]);
});
test("changing to disabled state cancels initiation without retry", async () => {
  const f = fixture({ ignoreAbort: true });
  f.rerender({ state: "unavailable" });
  await f.settle();
  assert.equal(f.calls[0].init.signal.aborted, true);
  await f.reply(0, { csrfToken: "late" });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.navigation, []);
});
test("explicit retry owns a new attempt and ignores old late success", async () => {
  const f = fixture({ strict: true, ignoreAbort: true });
  await f.advanceToPost();
  await f.expire();
  await act(async () => {
    const retry = f.view.getByText("try_again");
    fireEvent.click(retry);
    fireEvent.click(retry);
  });
  assert.equal(f.calls.length, 3);
  assert.notEqual(f.calls[0].init.signal, f.calls[2].init.signal);
  await f.reply(1, { url: authorization() });
  assert.deepEqual(f.navigation, []);
  await f.reply(2, { csrfToken: "retry-csrf" });
  const replacement = authorization({ state: "retry-state" });
  await f.reply(3, { url: replacement });
  assert.deepEqual(f.navigation, [replacement]);
});
test("manual login exit cancels pending initiation and cannot be overwritten", async () => {
  const f = fixture({ ignoreAbort: true });
  await f.advanceToPost();
  fireEvent.click(f.view.getByText("go_back_login"));
  await f.settle();
  assert.equal(f.calls[1].init.signal.aborted, true);
  await f.reply(1, { url: authorization() });
  assert.deepEqual(f.navigation, ["/auth/login"]);
});

function publicWelcomeRoot(session, onboardingPath = null) {
  const calls = [];
  const legacyRequest = { fixture: "public-welcome-request" };
  const Welcome = () => null;
  const { default: Page } = compile("apps/web/app/page.tsx", {
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/headers": { headers: async () => ({}), cookies: async () => ({}) },
    "next/navigation": {
      redirect(destination) {
        calls.push({ operation: "redirect", destination });
        const error = new Error("Unexpected public-root redirect");
        error.destination = destination;
        throw error;
      },
    },
    "@calcom/features/auth/lib/getServerSession": {
      async getServerSession(options) {
        assert.deepEqual(options, { req: legacyRequest });
        calls.push({ operation: "session" });
        return session;
      },
    },
    "@calcom/features/auth/lib/onboardingUtils": {
      async checkOnboardingRedirect(userId, options) {
        calls.push({ operation: "onboarding", userId, options });
        return onboardingPath;
      },
    },
    "@lib/buildLegacyCtx": { buildLegacyRequest: () => legacyRequest },
    "~/auth/public-welcome-view": { __esModule: true, default: Welcome },
  });
  return { page: () => Page(), calls, Welcome };
}

test("public welcome anonymous root stays public", async () => {
  // Only session, onboarding and legacy-request boundaries are doubled; the
  // actual server page chooses whether to render or redirect.
  const f = publicWelcomeRoot(null);
  const result = await f.page();
  assert.equal(result.type, f.Welcome);
  assert.deepEqual(f.calls, [{ operation: "session" }]);
});

test("public welcome missing identity stays public", async () => {
  for (const session of [undefined, {}, { user: {} }, { user: { id: 0 } }]) {
    const f = publicWelcomeRoot(session);
    assert.equal((await f.page()).type, f.Welcome);
    assert.deepEqual(f.calls, [{ operation: "session" }]);
  }
});

for (const onboardingPath of [null, "/getting-started"]) {
  test(`public welcome preserves signed-in ${onboardingPath ? "first setup" : "dashboard"}`, async () => {
    const f = publicWelcomeRoot({ user: { id: 7, profile: { organizationId: 42 } } }, onboardingPath);
    const destination = onboardingPath || "/event-types";
    await assert.rejects(f.page, (error) => error.destination === destination);
    assert.deepEqual(f.calls, [
      { operation: "session" },
      {
        operation: "onboarding",
        userId: 7,
        options: { checkEmailVerification: true, organizationId: 42 },
      },
      { operation: "redirect", destination },
    ]);
  });
}

test("public welcome renders passive Cal UI and an explicit non-prefetching Mereka link", async () => {
  const sideEffects = [];
  const { default: Welcome } = compile(
    "apps/web/modules/auth/public-welcome-view.tsx",
    {
      "react/jsx-runtime": require("react/jsx-runtime"),
      "@calcom/lib/hooks/useLocale": {
        useLocale: () => ({
          t: (key, values = {}) => {
            assert.equal(typeof translations[key], "string");
            return translations[key].replace(/\{\{(\w+)\}\}/g, (_match, name) => values[name]);
          },
        }),
      },
      "@calcom/ui/components/button": {
        buttonClasses: (options) => {
          assert.deepEqual(options, { color: "primary", size: "lg" });
          return "native-cal-primary-button";
        },
      },
      "@components/ui/AuthContainer": {
        __esModule: true,
        default: ({ children, showLogo }) => {
          assert.equal(showLogo, undefined);
          return React.createElement("div", { "data-testid": "native-cal-auth-container" }, children);
        },
      },
    },
    {
      fetch: () => sideEffects.push("unexpected-fetch"),
      window: { location: { assign: () => sideEffects.push("unexpected-navigation") } },
    }
  );
  const html = renderToString(React.createElement(Welcome));
  assert.match(html, /Welcome to Cal/);
  assert.deepEqual(sideEffects, []);
  const view = render(React.createElement(React.StrictMode, {}, React.createElement(Welcome)));
  await act(async () => Promise.resolve());
  assert.ok(view.getByRole("heading", { level: 1, name: "Welcome to Cal" }));
  assert.ok(view.getByText("Manage your bookings and availability with your Mereka account."));
  const link = view.getByRole("link", { name: "Sign in with Mereka" });
  assert.equal(link.tagName, "A");
  assert.equal(link.getAttribute("href"), "/auth/mereka?rd=%2Fevent-types");
  assert.equal(view.getAllByRole("link").length, 1);
  assert.equal(link.onclick, null);
  assert.equal(view.queryByText("Select plan"), null);
  assert.deepEqual(sideEffects, []);
});
