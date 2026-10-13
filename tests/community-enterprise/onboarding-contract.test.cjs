// SPDX-License-Identifier: MIT
// Executes production route decisions and completion logic with explicit
// framework/transport doubles. The built-browser suite covers real UI requests.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const pathFile = "packages/features/onboarding/lib/onboarding-path.service.ts";
const authFile = "packages/features/auth/lib/onboardingUtils.ts";
const completionFile = "apps/web/components/getting-started/steps-views/UserProfile.tsx";
const source = (file) =>
  process.env.CAL_ONBOARDING_BASELINE === "true" && [pathFile, authFile].includes(file)
    ? execFileSync("git", ["show", `90b5d6ec1c9197bdbc07a29632db4584f7956fc7:${file}`], {
        cwd: root,
        encoding: "utf8",
      })
    : fs.readFileSync(path.join(root, file), "utf8");
function load(file, imports = {}) {
  const compiled = ts.transpileModule(source(file), {
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
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputText)(
    (name) => {
      if (name === "react/jsx-runtime") return require(name);
      assert.ok(Object.hasOwn(imports, name), `Unexpected production import: ${name}`);
      return imports[name];
    },
    module,
    module.exports
  );
  return module.exports;
}
function paths(enabled) {
  return load(pathFile, {
    "@calcom/features/di/containers/FeatureRepository": {
      getFeatureRepository: () => ({ checkIfFeatureIsEnabledGlobally: async () => enabled }),
    },
  }).OnboardingPathService;
}
for (const flag of [true, false]) {
  test(`old onboarding-v3 flag ${flag} cannot route staff to a purchase plan`, async () => {
    assert.equal(await paths(flag).getGettingStartedPath(), "/getting-started");
    assert.equal(await paths(flag).getGettingStartedPathWhenInvited(), "/getting-started");
  });
}
test("supported query parameters are encoded without changing the local base path", async () => {
  const value = await paths(true).getGettingStartedPathWithParams({
    from: "signup",
    token: "value&not-a-second-param",
  });
  const parsed = new URL(value, "https://fixture.invalid");
  assert.equal(parsed.pathname, "/getting-started");
  assert.equal(parsed.searchParams.get("token"), "value&not-a-second-param");
  assert.equal(await paths(true).getGettingStartedPathWithParams({}), "/getting-started");
});
function authFixture() {
  const f = {
    user: {
      completedOnboarding: false,
      createdDate: new Date("2026-01-01"),
      identityProvider: "CAL",
      emailVerified: true,
    },
    queries: [],
    profileOrg: null,
    member: false,
    emailFlag: false,
    onboardingFlag: true,
  };
  const { checkOnboardingRedirect } = load(authFile, {
    "@calcom/dayjs": require("dayjs"),
    "@calcom/features/flags/features.repository": {
      FeaturesRepository: class {
        async checkIfFeatureIsEnabledGlobally(name) {
          return name === "email-verification" ? f.emailFlag : f.onboardingFlag;
        }
      },
    },
    "@calcom/features/users/repositories/UserRepository": {
      UserRepository: class {
        async findById(query) {
          f.queries.push(query);
          return f.user;
        }
      },
    },
    "@calcom/features/profile/repositories/ProfileRepository": {
      ProfileRepository: {
        findFirstForUserId: async () => (f.profileOrg === null ? null : { organizationId: f.profileOrg }),
      },
    },
    "@calcom/features/membership/repositories/MembershipRepository": {
      MembershipRepository: { hasAnyTeamMembershipByUserId: async () => f.member },
    },
    "@calcom/prisma": { prisma: {} },
    "@calcom/features/onboarding/lib/onboarding-path.service": { OnboardingPathService: paths(true) },
  });
  f.check = (options) => checkOnboardingRedirect(7, options);
  return f;
}
for (const org of [null, 100, 200]) {
  test(`new staff get calendar setup independent of selected organization ${org}`, async () => {
    const f = authFixture();
    f.profileOrg = org;
    assert.equal(await f.check({ organizationId: org }), "/getting-started");
    assert.deepEqual(f.queries, [{ id: 7 }]);
  });
}
test("pending invitations do not send staff into the removed plan flow", async () => {
  const f = authFixture();
  f.member = true;
  assert.equal(await f.check(), "/getting-started");
});
test("completed and pre-onboarding-era accounts preserve their existing behavior", async () => {
  const f = authFixture();
  f.user.completedOnboarding = true;
  assert.equal(await f.check(), null);
  f.user.completedOnboarding = false;
  f.user.createdDate = new Date("2020-01-01");
  assert.equal(await f.check(), null);
  f.user = null;
  assert.equal(await f.check(), null);
});
test("email-verification policy is not weakened by removing billing", async () => {
  const f = authFixture();
  f.user.emailVerified = false;
  f.emailFlag = true;
  assert.equal(await f.check({ checkEmailVerification: true }), "/auth/verify-email");
  f.emailFlag = false;
  assert.equal(await f.check({ checkEmailVerification: true }), "/getting-started");
});
const { onboardingReturnPath } = load("packages/features/onboarding/lib/onboarding-return-path.ts");
for (const value of [
  null,
  "",
  "javascript:alert(1)",
  "https://other.invalid/",
  "//other.invalid/",
  "/\\other.invalid",
  "/onboarding/teams/details",
  "/onboarding/organization/billing",
  "/getting-started",
  "/settings/billing",
  "/settings/organizations/billing",
  "/teams/upgrade",
  "/teams/%75pgrade",
  "/teams/%255cother",
  "/teams/../onboarding/getting-started",
  "/teams/\nother",
  "/teams/%zz",
]) {
  test(`obsolete or unsafe completion hint falls back: ${String(value)}`, () => {
    assert.equal(onboardingReturnPath(value), "/event-types");
  });
}
for (const value of [
  "/teams/123?invitation=fixture",
  "/settings/enterprise/teams",
  "/bookings/upcoming",
  "/availability",
  "/event-types?tab=team",
]) {
  test(`local invitation/application return path is retained: ${value}`, () =>
    assert.equal(onboardingReturnPath(value), value));
}
test("retired chooser component only forwards to the supported setup", () => {
  const redirects = [];
  const { OnboardingView } = load("apps/web/modules/onboarding/getting-started/onboarding-view.tsx", {
    "@calcom/lib/hooks/useLocale": { useLocale: () => ({ t: (value) => value }) },
    "next/navigation": { useRouter: () => ({ replace: (value) => redirects.push(value) }) },
    react: { useEffect: (callback) => callback() },
  });
  const result = OnboardingView({ userEmail: "fixture@example.test" });
  assert.deepEqual(redirects, ["/getting-started"]);
  assert.equal(result.props.role, "status");
  assert.ok(!JSON.stringify(result).includes("plan"));
});
function completionFixture() {
  const f = { events: [], calls: [], destination: "/settings/billing", failAt: null, gate: null };
  const after = async (kind, value) => {
    f.calls.push([kind, value]);
    if (f.failAt === kind) throw new Error("fixture failure");
    if (kind === "create" && f.gate) await f.gate;
  };
  const client = {
    viewer: {
      eventTypes: { list: { useQuery: () => ({ data: f.events }) } },
      eventTypesHeavy: {
        create: { useMutation: () => ({ mutateAsync: (event) => after("create", event) }) },
      },
      me: { updateProfile: { useMutation: () => ({ mutateAsync: (input) => after("profile", input) }) } },
    },
    useUtils: () => ({
      viewer: {
        eventTypes: {
          list: {
            fetch: async () => {
              await after("read");
              return f.events;
            },
          },
        },
        me: { get: { refetch: () => after("refetch") } },
      },
    }),
  };
  const imports = {
    react: { useRef: (value) => ({ current: value }), useState: (value) => [value, () => {}] },
    "next/navigation": { useRouter: () => ({ push: (value) => f.calls.push(["navigate", value]) }) },
    "react-hook-form": {
      useForm: () => ({ setValue() {}, handleSubmit: (callback) => callback, getValues: () => "" }),
    },
    "posthog-js": { capture: (name) => f.calls.push(["telemetry", name]) },
    "@calcom/features/onboarding/lib/onboarding-return-path": { onboardingReturnPath },
    "@calcom/lib/hooks/useLocale": { useLocale: () => ({ t: (value) => value }) },
    "@calcom/lib/markdownIt": { md: { render: (value) => value } },
    "@calcom/lib/turndownService": (value) => value,
    "@calcom/lib/webstorage": {
      localStorage: { getItem: () => f.destination, removeItem: () => f.calls.push(["removeHint"]) },
    },
    "@calcom/trpc/react": { trpc: client },
    "@calcom/ui/components/toast": { showToast: (message, type) => f.calls.push(["toast", type]) },
  };
  for (const [file, name] of [
    ["avatar", "UserAvatar"],
    ["button", "Button"],
    ["editor", "Editor"],
    ["form", "Label"],
    ["image-uploader", "ImageUploader"],
  ])
    imports[`@calcom/ui/components/${file}`] = { [name]: () => null };
  const { default: UserProfile } = load(completionFile, imports);
  f.submit = UserProfile({ user: { id: 7, bio: "", avatar: null } }).props.onSubmit;
  return f;
}
test("completion waits for initial event writes before persisting completion or navigating", async () => {
  const f = completionFixture();
  let release;
  f.gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = f.submit({ bio: "fixture" });
  await new Promise(setImmediate);
  assert.equal(f.calls.filter(([kind]) => kind === "create").length, 3);
  assert.equal(
    f.calls.some(([kind]) => kind === "profile" || kind === "navigate"),
    false
  );
  await f.submit({ bio: "second click" });
  assert.equal(f.calls.filter(([kind]) => kind === "create").length, 3);
  release();
  await first;
  assert.deepEqual(f.calls.find(([kind]) => kind === "profile")[1], {
    bio: "fixture",
    completedOnboarding: true,
  });
  assert.deepEqual(
    f.calls.find(([kind]) => kind === "navigate"),
    ["navigate", "/event-types"]
  );
});
for (const failure of ["read", "create", "profile"]) {
  test(`failed ${failure} does not falsely complete or navigate`, async () => {
    const f = completionFixture();
    f.failAt = failure;
    await f.submit({ bio: "fixture" });
    assert.equal(
      f.calls.some(([kind]) => kind === "navigate" || kind === "telemetry"),
      false
    );
    assert.ok(f.calls.some(([kind, type]) => kind === "toast" && type === "error"));
    if (failure !== "profile")
      assert.equal(
        f.calls.some(([kind]) => kind === "profile"),
        false
      );
  });
}
test("existing event types are preserved and local invitation destinations still work", async () => {
  const f = completionFixture();
  f.events = [{ id: 100 }];
  f.destination = "/teams/123?invitation=fixture";
  await f.submit({ bio: "fixture" });
  assert.equal(
    f.calls.some(([kind]) => kind === "create"),
    false
  );
  assert.deepEqual(
    f.calls.find(([kind]) => kind === "navigate"),
    ["navigate", f.destination]
  );
});
