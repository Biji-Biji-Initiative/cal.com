// SPDX-License-Identifier: MIT
// Actual setup, username field, React Hook Form, Zod and route execution.
// Only network/session, translations and presentation boundaries are doubled.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, afterEach, test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "../..");
const translations = require(path.join(root, "packages/i18n/locales/en/common.json"));
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://cal.mereka.dev" });
const previous = new Map();
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  FileList: dom.window.FileList,
  Blob: dom.window.Blob,
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
function load(relative, imports, globals = {}) {
  const file = path.join(root, relative);
  const result = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const module = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), result.outputText)(
    (name) => {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return require(name);
      assert.ok(Object.hasOwn(imports, name), `Unexpected production import ${name}`);
      return imports[name];
    },
    module,
    module.exports,
    ...Object.values(globals)
  );
  return module.exports;
}
const locale = {
  useLocale: () => ({
    t: (key) => {
      assert.equal(typeof translations[key], "string", `Missing English translation ${key}`);
      return key;
    },
  }),
};
const Button = ({ children, loading, disabled, EndIcon, color, ...props }) =>
  React.createElement("button", { ...props, disabled: disabled || loading }, children);
const TextField = React.forwardRef(({ addOnLeading, containerClassName, ...props }, ref) =>
  React.createElement("input", { ...props, ref })
);
const passthrough = ({ children }) => React.createElement("div", {}, children);

function fixture({ username = null, hideUsername = false, queryUsername = "", organization = null } = {}) {
  const initialUser = { username, name: "Fresh Staff", organization, defaultScheduleId: null };
  let me;
  const coldQuery = new Promise(() => {});
  const listeners = new Set();
  const mutations = [],
    reads = [],
    availability = [],
    sessionUpdates = [],
    toasts = [],
    timers = new Map();
  const navigation = [];
  let nextCalls = 0,
    invalidations = 0,
    timerId = 0;
  const setMe = (value) => {
    me = value;
    for (const listener of listeners) listener();
  };
  const trpc = {
    viewer: {
      me: {
        get: {
          useSuspenseQuery: (_input, options) => {
            if (me === undefined && options?.initialData) me = options.initialData;
            const value = React.useSyncExternalStore(
              (listener) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
              },
              () => me,
              () => me
            );
            if (value === undefined) throw coldQuery;
            return [value];
          },
        },
        updateProfile: {
          useMutation: (options) => {
            const [isPending, setPending] = React.useState(false);
            return {
              isPending,
              mutate: (data) => {
                setPending(true);
                new Promise((resolve, reject) => mutations.push({ data, resolve, reject }))
                  .then(() => options.onSuccess?.())
                  .catch((error) => options.onError?.(error))
                  .finally(() => setPending(false));
              },
            };
          },
        },
      },
    },
    useUtils: () => ({
      viewer: {
        me: {
          invalidate: async () => {
            invalidations++;
          },
          get: {
            invalidate: async () => {
              invalidations++;
            },
            fetch: async () => {
              const value = await new Promise((resolve, reject) => reads.push({ resolve, reject }));
              setMe(value);
              return value;
            },
          },
        },
      },
    }),
  };
  const debounce = load(
    "packages/lib/hooks/useDebounce.ts",
    {},
    {
      setTimeout: (fn, delay) => {
        const id = ++timerId;
        timers.set(id, { fn, delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    }
  );
  const shared = {
    "@calcom/lib/hooks/useLocale": locale,
    "@calcom/trpc/react": { trpc },
    "@calcom/ui/components/button": { Button },
    "@calcom/ui/components/form": { Input: TextField, TextField },
  };
  const field = load("apps/web/components/ui/UsernameAvailability/UsernameTextfield.tsx", {
    ...shared,
    classnames: require("classnames"),
    lodash: { noop: () => {} },
    "next-auth/react": {
      useSession: () => ({
        update: (data) => new Promise((resolve) => sessionUpdates.push({ data, resolve })),
      }),
    },
    "@calcom/features/components/controlled-dialog": {
      Dialog: ({ open, children }) => (open ? children : null),
    },
    "@calcom/lib/fetchUsername": {
      fetchUsername: (value, org) => new Promise((resolve) => availability.push({ value, org, resolve })),
    },
    "@calcom/lib/hooks/useDebounce": debounce,
    "@calcom/ui/components/dialog": {
      DialogContent: passthrough,
      DialogFooter: passthrough,
      DialogClose: Button,
    },
    "@calcom/ui/components/tooltip": { Tooltip: passthrough },
    "@coss/ui/icons": { CheckIcon: () => React.createElement("span", { "data-testid": "available-check" }) },
  });
  let dynamicCount = 0;
  const usernameField = load("apps/web/components/ui/UsernameAvailability/index.tsx", {
    ...shared,
    "react-hook-form": require("react-hook-form"),
    "@calcom/lib/constants": { IS_SELF_HOSTED: true, WEBSITE_URL: "https://cal.mereka.dev" },
    "@lib/hooks/useRouterQuery": {
      __esModule: true,
      default: () => ({ username: queryUsername, setQuery: () => {} }),
    },
    "next/navigation": {
      useSearchParams: () => new URLSearchParams(queryUsername ? { username: queryUsername } : {}),
    },
    "next/dynamic": {
      __esModule: true,
      default: () =>
        ++dynamicCount === 1
          ? () => {
              throw new Error("Self-hosted setup must use the native username field");
            }
          : field.UsernameTextfield,
    },
  });
  const settings = load("apps/web/components/getting-started/steps-views/UserSettings.tsx", {
    ...shared,
    "@hookform/resolvers/zod": require("@hookform/resolvers/zod"),
    "react-hook-form": require("react-hook-form"),
    zod: require("zod"),
    "@calcom/dayjs": { __esModule: true, default: () => ({ tz: () => ({ format: () => "10:00 am" }) }) },
    "@calcom/features/bookings/lib": {
      useTimePreferences: () => ({ timezone: "Asia/Kuala_Lumpur", setTimezone: () => {} }),
    },
    "@calcom/web/modules/timezone/components/TimezoneSelect": { TimezoneSelect: () => null },
    "@calcom/lib/constants": { FULL_NAME_LENGTH_MAX_LIMIT: 100 },
    "@calcom/ui/components/toast": { showToast: (...args) => toasts.push(args) },
    "@components/ui/UsernameAvailability": usernameField,
  });
  const view = render(
    React.createElement(
      React.Suspense,
      { fallback: "initial-user-loading" },
      React.createElement(settings.UserSettings, {
        user: initialUser,
        hideUsername,
        nextStep: () => {
          nextCalls++;
        },
      })
    )
  );
  const f = {
    view,
    mutations,
    reads,
    availability,
    sessionUpdates,
    toasts,
    navigation,
    get nextCalls() {
      return nextCalls;
    },
    get invalidations() {
      return invalidations;
    },
    button: () => view.getByTestId("connect-calendar-button"),
    async submit() {
      await act(async () => fireEvent.submit(view.container.querySelector("form")));
    },
    async enter() {
      // JSDOM does not implement keyboard implicit submission; dispatch its resulting native submit too.
      await act(async () => {
        fireEvent.keyDown(view.getByLabelText("full_name"), { key: "Enter", code: "Enter" });
        fireEvent.submit(view.container.querySelector("form"));
      });
    },
    async draft(value = "chosen-handle") {
      await act(async () => fireEvent.change(view.getByTestId("username-input"), { target: { value } }));
    },
    async check(available = true) {
      await act(async () => {
        for (const [id, timer] of timers) {
          assert.equal(timer.delay, 600);
          timers.delete(id);
          timer.fn();
        }
      });
      assert.equal(availability.length, 1);
      await act(async () => availability[0].resolve({ data: { available } }));
    },
    async save() {
      await act(async () => fireEvent.click(view.getAllByTestId("update-username-btn")[0]));
      await act(async () => fireEvent.click(view.getByTestId("save-username")));
    },
    async ack(index = 0) {
      await act(async () => mutations[index].resolve({}));
    },
    async refresh(savedUsername = "chosen-handle") {
      assert.equal(reads.length, 1);
      await act(async () => reads[0].resolve({ ...me, username: savedUsername }));
    },
    async beginSave() {
      await f.draft();
      await f.check();
      await f.save();
    },
  };
  return f;
}
async function blocked(f) {
  assert.equal(f.button().disabled, true);
  const count = f.mutations.length;
  await f.submit();
  await f.enter();
  assert.equal(
    f.mutations.length,
    count,
    "Submit/Enter cannot issue a profile write without the prerequisite"
  );
  assert.equal(f.nextCalls, 0);
}
test("missing username is visible and blocks actual form submission", async () => {
  const f = fixture();
  assert.ok(f.view.getByTestId("username-input"));
  assert.ok(f.view.getByText("onboarding_username_required"));
  await blocked(f);
});
test("signup hide hint cannot conceal a required missing username", async () => {
  const f = fixture({ hideUsername: true });
  assert.ok(f.view.getByTestId("username-input"));
  await blocked(f);
});
for (const [name, available] of [
  ["available but unsaved", true],
  ["taken", false],
]) {
  test(`${name} username cannot advance`, async () => {
    const f = fixture();
    await f.draft();
    await blocked(f);
    await f.check(available);
    await blocked(f);
    assert.equal(Boolean(f.view.queryByTestId("available-check")), available);
  });
}
test("a query-string username hint is not a saved username", async () => {
  const f = fixture({ queryUsername: "draft-hint" });
  assert.equal(f.view.getByTestId("username-input").value, "draft-hint");
  await blocked(f);
});
test("username save pending and server rejection cannot advance", async () => {
  const f = fixture();
  await f.beginSave();
  await blocked(f);
  assert.deepEqual(f.mutations[0].data, { username: "chosen-handle" });
  await act(async () => f.mutations[0].reject(new Error("Username was taken")));
  assert.ok(
    f.toasts.some(([message, status]) => message === "error_updating_settings" && status === "error")
  );
  assert.equal(f.reads.length, 0);
  await blocked(f);
});
test("save acknowledgment waits for the persisted username read", async () => {
  const f = fixture();
  await f.beginSave();
  await f.ack();
  assert.equal(f.reads.length, 1);
  assert.equal(f.sessionUpdates.length, 0);
  await blocked(f);
});
for (const savedUsername of [null, "", "   "]) {
  test(`readback ${JSON.stringify(savedUsername)} keeps setup blocked`, async () => {
    const f = fixture();
    await f.beginSave();
    await f.ack();
    await f.refresh(savedUsername);
    await blocked(f);
  });
}
test("failed saved-user read leaves setup blocked with an error", async () => {
  const f = fixture();
  await f.beginSave();
  await f.ack();
  await act(async () => f.reads[0].reject(new Error("Read unavailable")));
  assert.ok(
    f.toasts.some(([message, status]) => message === "error_updating_settings" && status === "error")
  );
  await blocked(f);
});
test("fresh saved username unlocks Continue before best-effort session refresh finishes", async () => {
  const f = fixture();
  await f.beginSave();
  await f.ack();
  await f.refresh("server-normalized-handle");
  assert.equal(f.button().disabled, false);
  assert.equal(f.sessionUpdates.length, 1);
  await f.submit();
  assert.deepEqual(f.mutations[1].data, { name: "Fresh Staff", timeZone: "Asia/Kuala_Lumpur" });
  assert.equal(f.nextCalls, 0);
  assert.equal(f.button().disabled, true);
  await f.ack(1);
  assert.equal(f.nextCalls, 1);
});
for (const hideUsername of [false, true]) {
  test(`existing saved handle is preserved with hideUsername=${hideUsername}`, async () => {
    const f = fixture({ username: "existing-handle", hideUsername });
    assert.equal(Boolean(f.view.queryByTestId("username-input")), !hideUsername);
    assert.equal(f.view.queryByText("initial-user-loading"), null);
    assert.equal(f.reads.length, 0, "Fresh server data seeds the cold query without a blocking initial read");
    assert.equal(f.button().disabled, false);
    await f.enter();
    assert.deepEqual(f.mutations[0].data, { name: "Fresh Staff", timeZone: "Asia/Kuala_Lumpur" });
    await f.ack();
    assert.equal(f.nextCalls, 1);
  });
}
test("an existing effective organization handle keeps its field disabled and Continue usable", async () => {
  const f = fixture({ username: "organization-profile-handle", organization: { id: 42 } });
  assert.equal(f.view.getByTestId("username-input").disabled, true);
  assert.equal(f.button().disabled, false);
  await f.submit();
  assert.deepEqual(f.mutations[0].data, { name: "Fresh Staff", timeZone: "Asia/Kuala_Lumpur" });
  await f.ack();
  assert.equal(f.nextCalls, 1);
});
test("pending profile submission rejects duplicate Enter and failed submission can retry", async () => {
  const f = fixture({ username: "existing-handle" });
  await f.submit();
  assert.equal(f.button().disabled, true);
  await f.enter();
  assert.equal(f.mutations.length, 1);
  await act(async () => f.mutations[0].reject(new Error("Profile write unavailable")));
  assert.equal(f.nextCalls, 0);
  assert.equal(f.button().disabled, false);
  await f.submit();
  assert.equal(f.mutations.length, 2);
  await f.ack(1);
  assert.equal(f.nextCalls, 1);
});
test("an unsaved rename preserves the already saved handle prerequisite", async () => {
  const f = fixture({ username: "existing-handle" });
  await f.draft("unsaved-new-handle");
  assert.equal(f.button().disabled, false);
  await f.submit();
  assert.deepEqual(f.mutations[0].data, { name: "Fresh Staff", timeZone: "Asia/Kuala_Lumpur" });
  await f.ack();
  assert.equal(f.nextCalls, 1);
});
for (const invalidName of ["", "x".repeat(101)]) {
  test(`real form/Zod rejects name length ${invalidName.length} despite saved username`, async () => {
    const f = fixture({ username: "existing-handle" });
    await act(async () =>
      fireEvent.change(f.view.getByLabelText("full_name"), { target: { value: invalidName } })
    );
    await f.submit();
    assert.equal(f.mutations.length, 0);
    assert.ok(f.view.getByTestId("required"));
  });
}

async function route({
  step,
  username = null,
  session = { user: { id: 1 } },
  missingUser = false,
  missingTeams = false,
} = {}) {
  let reads = 0;
  const user = missingUser ? null : { username, name: "Fresh Staff" };
  const page = load("apps/web/app/(use-page-wrapper)/getting-started/[[...step]]/page.tsx", {
    "app/_trpc/context": {
      createRouterCaller: async () => ({
        get: async () => {
          reads++;
          return user;
        },
      }),
    },
    "app/_utils": { _generateMetadata: () => ({}) },
    "next/headers": { headers: async () => ({}), cookies: async () => ({}) },
    "next/navigation": {
      redirect: (url) => {
        throw Object.assign(new Error("redirect"), { url });
      },
    },
    "@calcom/features/auth/lib/getServerSession": { getServerSession: async () => session },
    "@calcom/features/users/repositories/UserRepository": {
      UserRepository: class {
        async findUserTeams() {
          return missingTeams ? null : { teams: [] };
        }
      },
    },
    "@calcom/lib/constants": { APP_NAME: "Mereka Calendar" },
    "@calcom/prisma": {},
    "@calcom/trpc/server/routers/viewer/me/_router": { meRouter: {} },
    "@lib/buildLegacyCtx": { buildLegacyRequest: () => ({}) },
    "~/getting-started/[[...step]]/onboarding-view": { __esModule: true, default: passthrough },
  });
  try {
    const element = await page.default({
      params: Promise.resolve({ step }),
      searchParams: Promise.resolve({}),
    });
    return { user: element.props.user, reads };
  } catch (error) {
    if (error.url) return { redirect: error.url, reads };
    throw error;
  }
}
for (const step of [undefined, ["user-settings"], "user-settings"]) {
  test(`initial setup admits a username-less user: ${JSON.stringify(step)}`, async () => {
    const result = await route({ step });
    assert.equal(result.redirect, undefined);
    assert.equal(result.user.username, null);
  });
}
for (const step of ["connected-calendar", "connected-video", "setup-availability", "user-profile"]) {
  test(`direct ${step} requires a saved username`, async () => {
    assert.equal((await route({ step: [step] })).redirect, "/getting-started/user-settings");
    const result = await route({ step: [step], username: "effective-profile-handle" });
    assert.equal(result.redirect, undefined);
    assert.equal(result.user.username, "effective-profile-handle");
  });
}
test("valid multi-segment later-step URL follows the existing first-step selection", async () => {
  assert.equal(
    (await route({ step: ["connected-calendar", "user-profile"] })).redirect,
    "/getting-started/user-settings"
  );
});
test("string later-step and blank saved handles cannot bypass the server prerequisite", async () => {
  assert.equal(
    (await route({ step: "connected-calendar", username: "   " })).redirect,
    "/getting-started/user-settings"
  );
});
for (const step of [["unknown"], ["connected-calendar", "unknown"], [], "unknown"]) {
  test(`invalid-step fallback is preserved: ${JSON.stringify(step)}`, async () => {
    assert.equal((await route({ step })).redirect, undefined);
  });
}
for (const options of [
  { session: null },
  { session: { user: {} } },
  { missingUser: true },
  { missingTeams: true },
]) {
  test(`existing authentication/data guard is preserved: ${JSON.stringify(options)}`, async () => {
    assert.equal((await route({ step: ["connected-calendar"], ...options })).redirect, "/auth/login");
  });
}
test("app installation uses session identity and a fresh database username, not session username", () => {
  const installation = fs.readFileSync(
    path.join(root, "apps/web/lib/apps/installation/[[...step]]/getServerSideProps.ts"),
    "utf8"
  );
  const repository = fs.readFileSync(
    path.join(root, "packages/features/users/repositories/UserRepository.ts"),
    "utf8"
  );
  assert.match(installation, /const user = await getUser\(sessionId\);\s*if \(!user\?\.username/);
  assert.match(installation, /const userAdminTeams = await userRepo\.getUserAdminTeams\(\{ userId \}\)/);
  assert.match(
    repository,
    /async getUserAdminTeams\([\s\S]*?prismaClient\.user\.findUnique\([\s\S]*?username: true/
  );
});
for (const [step, skip, next] of [
  ["connected-calendar", "connect_calendar_later", "connected-video"],
  ["connected-video", "set_up_later", "setup-availability"],
]) {
  test(`saved-user wizard retains optional ${step} skip`, async () => {
    assert.equal((await route({ step: [step], username: "saved-handle" })).redirect, undefined);
    const navigation = [],
      events = [];
    const wizard = load("apps/web/modules/getting-started/[[...step]]/onboarding-view.tsx", {
      "@calcom/lib/hooks/useLocale": locale,
      "@calcom/lib/hooks/useParamsWithFallback": { useParamsWithFallback: () => ({ step: [step] }) },
      "@calcom/ui/classNames": { __esModule: true, default: require("classnames") },
      "@calcom/ui/components/button": { Button },
      "@calcom/ui/components/card": { StepCard: passthrough },
      "@calcom/ui/components/form": { Steps: () => null },
      "@components/getting-started/steps-views/ConnectCalendars": { ConnectedCalendars: () => null },
      "@components/getting-started/steps-views/ConnectedVideoStep": { ConnectedVideoStep: () => null },
      "@components/getting-started/steps-views/SetupAvailability": { SetupAvailability: () => null },
      "@components/getting-started/steps-views/UserSettings": { UserSettings: () => null },
      "@components/getting-started/steps-views/UserProfile": { __esModule: true, default: () => null },
      "@coss/ui/icons": { LoaderIcon: () => null },
      "next/navigation": {
        usePathname: () => `/getting-started/${step}`,
        useRouter: () => ({ push: (url) => navigation.push(url) }),
      },
      "next-auth/react": { signOut: () => {} },
      "posthog-js": { __esModule: true, default: { capture: (...args) => events.push(args) } },
      sonner: { Toaster: () => null },
      zod: require("zod"),
    });
    const view = render(React.createElement(wizard.default, { user: { username: "saved-handle" } }));
    assert.equal(view.getByTestId("skip-step").textContent, skip);
    await act(async () => fireEvent.click(view.getByTestId("skip-step")));
    assert.deepEqual(navigation, [`/getting-started/${next}`]);
    assert.equal(events[0][1].was_skipped, true);
  });
}
