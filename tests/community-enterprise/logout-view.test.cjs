// SPDX-License-Identifier: MIT
// Real React renders of the native logout component; only transport, navigation,
// translations and presentation boundaries are injected. No server is contacted.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, afterEach, test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { JSDOM } = require("jsdom");
const { renderToString } = require("react-dom/server");
const root = path.resolve(__dirname, "../..");
const translations = require(path.join(root, "packages/i18n/locales/en/common.json"));
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://cal.mereka.dev" });
const previous = new Map();
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, cleanup, fireEvent, render } = require("@testing-library/react");
afterEach(cleanup);
after(() => {
  dom.window.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});
const file = path.join(root, "apps/web/modules/auth/logout-view.tsx");
const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
  fileName: file,
  reportDiagnostics: true,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
});
assert.deepEqual(compiled.diagnostics, []);
const invalidJson = async () => {
  throw new SyntaxError("invalid JSON");
};
function response(body, status = 200, contentType = "application/json") {
  return {
    status,
    headers: new Headers(contentType === null ? {} : { "Content-Type": contentType }),
    json: async () => body,
  };
}

function fixture({ query = {}, strict = false, server = false, ignoreAbort = false } = {}) {
  const calls = [];
  const navigation = [];
  const timers = new Map();
  const legacyCalls = [];
  let nextTimer = 0;
  const callbackUrl = "https://cal.mereka.dev/auth/logout";
  const imports = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next-auth/react": {
      useSession: () => ({ status: "authenticated" }),
      signOut: () => {
        legacyCalls.push("signOut");
        return Promise.resolve({ url: callbackUrl });
      },
    },
    "next/navigation": { useRouter: () => ({ push: (url) => navigation.push(url) }) },
    "@calcom/lib/constants": { WEBSITE_URL: "https://mereka.example.test" },
    "@calcom/lib/hooks/useLocale": {
      useLocale: () => ({
        t: (key) => {
          assert.equal(typeof translations[key], "string");
          return key;
        },
      }),
    },
    "@calcom/ui/components/button": {
      Button: ({ children, loading, disabled, ...props }) =>
        React.createElement("button", { ...props, disabled: disabled || loading }, children),
    },
    "@coss/ui/icons": { CheckIcon: () => React.createElement("svg", { "data-testid": "logout-check" }) },
    "@components/ui/AuthContainer": {
      __esModule: true,
      default: ({ children }) => React.createElement("div", {}, children),
    },
  };
  const module = { exports: {} };
  const evaluate = new Function(
    "require,module,exports,window,fetch,setTimeout,clearTimeout",
    compiled.outputText
  );
  evaluate(
    (name) => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected production import ${name}`);
      return imports[name];
    },
    module,
    module.exports,
    server
      ? undefined
      : { location: { origin: "https://cal.mereka.dev", assign: (url) => navigation.push(url) } },
    (url, options) =>
      new Promise((resolve, reject) => {
        calls.push({ url, options, resolve, reject });
        if (!ignoreAbort)
          options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
            once: true,
          });
      }),
    (fn, delay) => {
      const id = ++nextTimer;
      timers.set(id, { fn, delay });
      return id;
    },
    (id) => timers.delete(id)
  );
  const Logout = module.exports.Logout;
  const element = (nextQuery) => {
    const child = React.createElement(Logout, { query: nextQuery });
    return strict ? React.createElement(React.StrictMode, {}, child) : child;
  };
  const view = server ? null : render(element(query));
  return {
    calls,
    navigation,
    timers,
    legacyCalls,
    callbackUrl,
    view,
    serverRender: () => renderToString(element(query)),
    rerender: (nextQuery) => view.rerender(element(nextQuery)),
    async respond(index, body, status = 200, contentType) {
      assert.ok(calls[index], `Expected request ${index}`);
      await act(async () => calls[index].resolve(response(body, status, contentType)));
    },
    async readyToVerify() {
      await this.respond(0, { csrfToken: "csrf-fixture-value" });
      await this.respond(1, { url: callbackUrl });
      assert.equal(calls[2]?.url, "/api/auth/session");
    },
    async success() {
      await this.readyToVerify();
      await this.respond(2, {});
    },
    async expire() {
      assert.equal(timers.size, 1);
      const [id, timer] = [...timers][0];
      assert.equal(timer.delay, 30_000);
      timers.delete(id);
      await act(async () => timer.fn());
    },
  };
}
function pending(f) {
  assert.equal(Boolean(f.view.queryByText("youve_been_logged_out")), false);
  assert.equal(Boolean(f.view.queryByTestId("logout-check")), false);
  assert.equal(f.view.getByTestId("logout-btn").disabled, true);
  assert.deepEqual(f.navigation, []);
}
function failed(f) {
  pending(f);
  assert.ok(f.view.getByRole("alert"));
  assert.equal(f.view.getByRole("button", { name: "try_again" }).disabled, false);
  assert.equal(f.timers.size, 0);
}

test("server rendering has no logout side effects or success claim", () => {
  const f = fixture({ server: true, query: { survey: "true" } });
  const html = f.serverRender();
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.legacyCalls, []);
  assert.deepEqual(f.navigation, []);
  assert.equal(f.timers.size, 0);
  assert.doesNotMatch(html, /youve_been_logged_out|logout-check/);
});
test("pending render cannot claim success, navigate or start a second attempt", () => {
  const f = fixture();
  pending(f);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/api/auth/csrf");
  f.rerender({});
  fireEvent.click(f.view.getByTestId("logout-btn"));
  assert.equal(f.calls.length, 1);
  pending(f);
});
test("StrictMode replays share one POST and still complete after fresh session proof", async () => {
  const f = fixture({ strict: true });
  await act(async () => {});
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.signal.aborted, false);
  await f.readyToVerify();
  pending(f);
  const post = f.calls[1];
  assert.equal(post.options.method, "POST");
  assert.equal(post.url, "/api/auth/signout");
  assert.equal(post.options.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(post.options.body), {
    csrfToken: "csrf-fixture-value",
    callbackUrl: f.callbackUrl,
    json: "true",
  });
  for (const call of f.calls) {
    assert.equal(call.options.cache, "no-store");
    assert.equal(call.options.credentials, "same-origin");
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.signal, f.calls[0].options.signal);
  }
  await f.respond(2, {});
  assert.ok(f.view.getByText("youve_been_logged_out"));
  assert.ok(f.view.getByTestId("logout-check"));
  assert.equal(f.view.getByTestId("logout-btn").disabled, false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.calls.length, 3);
  fireEvent.click(f.view.getByTestId("logout-btn"));
  assert.deepEqual(f.navigation, ["/auth/login"]);
});
for (const [label, body, status] of [
  ["still authenticated", { user: { id: 1 }, expires: "2099-01-01" }, 200],
  ["unavailable", {}, 503],
  ["other successful status", {}, 201],
  ["null", null, 200],
  ["array", [], 200],
  ["string", "", 200],
  ["nonempty object", { error: "unavailable" }, 200],
  ["inherited object", Object.create({ user: true }), 200],
]) {
  test(`session verification rejects ${label} without success or survey`, async () => {
    const f = fixture({ query: { survey: "true" } });
    await f.readyToVerify();
    await f.respond(2, body, status);
    failed(f);
  });
}
for (const [label, body, status] of [
  ["missing token", {}, 200],
  ["null", null, 200],
  ["blank token", { csrfToken: " " }, 200],
  ["wrong token type", { csrfToken: 123 }, 200],
  ["oversized token", { csrfToken: "x".repeat(513) }, 200],
  ["unavailable", { csrfToken: "fixture" }, 503],
]) {
  test(`CSRF response rejects ${label} before a POST`, async () => {
    const f = fixture();
    await f.respond(0, body, status);
    failed(f);
    assert.equal(f.calls.length, 1);
  });
}
for (const [label, body, status] of [
  ["CSRF refusal", { url: "https://cal.mereka.dev/api/auth/signout?csrf=true" }, 200],
  ["different origin", { url: "https://calendar.mereka.dev/auth/logout" }, 200],
  ["unexpected query", { url: "https://cal.mereka.dev/auth/logout?error=true" }, 200],
  ["missing URL", {}, 200],
  ["unavailable", { url: "https://cal.mereka.dev/auth/logout" }, 503],
  ["unexpected hash", { url: "https://cal.mereka.dev/auth/logout#done" }, 200],
  ["relative URL", { url: "/auth/logout" }, 200],
]) {
  test(`signout rejects ${label} before a session certificate`, async () => {
    const f = fixture();
    await f.respond(0, { csrfToken: "fixture" });
    await f.respond(1, body, status);
    failed(f);
    assert.equal(f.calls.length, 2);
  });
}
test("network rejection and invalid JSON are retryable failures", async () => {
  const f = fixture();
  await act(async () => f.calls[0].reject(new Error("network")));
  failed(f);
  fireEvent.click(f.view.getByRole("button", { name: "try_again" }));
  pending(f);
  assert.equal(f.calls.length, 2);
  assert.notEqual(f.calls[1].options.signal, f.calls[0].options.signal);
  await act(async () => f.calls[1].resolve({ ...response({}), json: invalidJson }));
  failed(f);
});
test("a malformed session response cannot certify logout", async () => {
  const f = fixture();
  await f.readyToVerify();
  await act(async () => f.calls[2].resolve({ ...response({}), json: invalidJson }));
  failed(f);
});
test("the whole-attempt deadline also bounds a stalled JSON body", async () => {
  const f = fixture({ ignoreAbort: true });
  await f.readyToVerify();
  let finish;
  await act(async () =>
    f.calls[2].resolve({
      ...response({}),
      json: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    })
  );
  pending(f);
  await f.expire();
  failed(f);
  await act(async () => finish({}));
  failed(f);
});
test("unmount before CSRF response cannot start a late POST", async () => {
  const f = fixture({ ignoreAbort: true });
  f.view.unmount();
  await act(async () => {});
  await f.respond(0, { csrfToken: "fixture" });
  assert.equal(f.calls.length, 1);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.navigation, []);
});
for (const stage of ["CSRF", "POST", "session"]) {
  test(`30-second whole-attempt deadline aborts stalled ${stage} and permits retry`, async () => {
    const f = fixture({ ignoreAbort: true });
    if (stage !== "CSRF") await f.respond(0, { csrfToken: "fixture" });
    if (stage === "session") await f.respond(1, { url: f.callbackUrl });
    const count = f.calls.length;
    await f.expire();
    failed(f);
    assert.equal(f.calls[0].options.signal.aborted, true);
    fireEvent.click(f.view.getByRole("button", { name: "try_again" }));
    pending(f);
    assert.equal(f.calls.length, count + 1);
    await f.respond(
      count - 1,
      stage === "CSRF" ? { csrfToken: "fixture" } : stage === "POST" ? { url: f.callbackUrl } : {}
    );
    assert.equal(f.calls.length, count + 1, "expired continuation must not issue another request");
    pending(f);
    await f.respond(count, { csrfToken: "fixture" });
    await f.respond(count + 1, { url: f.callbackUrl });
    await f.respond(count + 2, {});
    assert.ok(f.view.getByText("youve_been_logged_out"));
  });
}
for (const outcome of ["resolve", "reject"]) {
  test(`unmount aborts and ignores late ${outcome} without survey navigation`, async () => {
    const f = fixture({ ignoreAbort: true, query: { survey: "true" } });
    await f.readyToVerify();
    f.view.unmount();
    await act(async () => {});
    assert.equal(f.calls[0].options.signal.aborted, true);
    assert.equal(f.timers.size, 0);
    await act(async () =>
      outcome === "resolve"
        ? f.calls[2].resolve(response({}))
        : f.calls[2].reject(new Error("late rejection"))
    );
    assert.deepEqual(f.navigation, []);
  });
}
for (const [stage, index] of [
  ["CSRF", 0],
  ["POST", 1],
  ["session", 2],
]) {
  for (const contentType of ["text/plain", "text/html", null, "application/json-invalid"]) {
    test(`${stage} rejects parseable JSON with content type ${contentType}`, async () => {
      const f = fixture({ query: { survey: "true" } });
      if (index > 0) await f.respond(0, { csrfToken: "fixture" });
      if (index > 1) await f.respond(1, { url: f.callbackUrl });
      const body = index === 0 ? { csrfToken: "fixture" } : index === 1 ? { url: f.callbackUrl } : {};
      await f.respond(index, body, 200, contentType);
      failed(f);
      assert.equal(f.calls.length, index + 1);
    });
  }
}
test("a 512-character CSRF token and parameterized JSON media types remain supported", async () => {
  const f = fixture();
  const csrfToken = "x".repeat(512);
  await f.respond(0, { csrfToken }, 200, "Application/JSON; charset=utf-8");
  assert.equal(f.calls[1].options.body.get("csrfToken"), csrfToken);
  await f.respond(1, { url: f.callbackUrl }, 200, "application/json;charset=utf-8");
  pending(f);
  await f.respond(2, {}, 200, "application/json; charset=utf-8");
  assert.ok(f.view.getByText("youve_been_logged_out"));
  assert.equal(f.timers.size, 0);
});
test("survey waits for verification, uses latest query and navigates once", async () => {
  const f = fixture({ strict: true, query: { survey: "true" } });
  await f.readyToVerify();
  pending(f);
  f.rerender({ survey: "false" });
  await f.respond(2, {});
  assert.deepEqual(f.navigation, []);
  f.rerender({ survey: "true" });
  assert.deepEqual(f.navigation, ["https://mereka.example.test/cancellation"]);
  f.rerender({ survey: "true", passReset: "true" });
  assert.equal(f.navigation.length, 1);
});
for (const [query, copy] of [
  [{}, "hope_to_see_you_soon"],
  [{ emailChange: "true" }, "email_change"],
  [{ passReset: "true", emailChange: "true" }, "reset_your_password"],
]) {
  test(`success preserves ${copy} only after verified completion`, async () => {
    const f = fixture({ query });
    assert.equal(Boolean(f.view.queryByText(copy)), false);
    await f.success();
    assert.ok(f.view.getByText(copy));
  });
}
