// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { test } = require("node:test");
const root = path.resolve(__dirname, "../..");

test("actual Next configuration resolves and traces only the Cal monorepo", () => {
  for (const directory of [root, path.join(root, "apps/web")]) {
    for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
      assert.equal(
        fs.existsSync(path.join(directory, name)),
        false,
        "Run this build-config test in a clean candidate without deployed environment files"
      );
    }
  }
  const environment = Object.fromEntries(
    ["PATH", "HOME", "USER", "LANG"].filter((key) => process.env[key]).map((key) => [key, process.env[key]])
  );
  Object.assign(environment, {
    NEXTAUTH_SECRET: randomBytes(32).toString("hex"),
    CALENDSO_ENCRYPTION_KEY: randomBytes(16).toString("hex"),
    NEXT_PUBLIC_WEBAPP_URL: "http://127.0.0.1:38917",
    NEXTAUTH_URL: "http://127.0.0.1:38917/api/auth",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture",
    DATABASE_DIRECT_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture",
  });
  const script = `
    const loadConfig = require("next/dist/server/config").default;
    const { PHASE_PRODUCTION_BUILD } = require("next/constants");
    loadConfig(PHASE_PRODUCTION_BUILD, process.cwd(), { silent: true }).then(async (config) => {
      console.log("CAL_ROOT_RESULT=" + JSON.stringify({
        root: config.turbopack.root,
        trace: config.outputFileTracingRoot,
        redirects: await config.redirects(),
      }));
    }).catch(() => { console.error("Candidate config could not be loaded"); process.exitCode = 1; });
  `;
  const output = execFileSync(process.execPath, ["-e", script], {
    cwd: path.join(root, "apps/web"),
    env: environment,
    encoding: "utf8",
    timeout: 30000,
  });
  const line = output.split("\n").find((value) => value.startsWith("CAL_ROOT_RESULT="));
  assert.ok(line, "Actual Next config loader must return a root receipt");
  const result = JSON.parse(line.slice("CAL_ROOT_RESULT=".length));
  assert.equal(result.root, root);
  assert.equal(result.trace, root);
  for (const [source, destination] of [
    ["/onboarding/getting-started", "/getting-started"],
    ["/onboarding/personal/settings", "/getting-started/user-settings"],
    ["/onboarding/personal/calendar", "/getting-started/connected-calendar"],
    ["/onboarding/personal/profile", "/getting-started/user-profile"],
    ["/onboarding/teams/:path*", "/settings/enterprise/teams"],
    ["/onboarding/organization/:path*", "/settings/enterprise/teams"],
  ]) {
    const rules = result.redirects.filter((rule) => rule.source === source);
    assert.equal(rules.length, 1, `Exactly one compatibility rule for ${source}`);
    assert.equal(rules[0].destination, destination);
    assert.equal(rules[0].permanent, false);
  }
});

test("the normal Turbo application lane carries the server-only Authentik variables", () => {
  const turbo = JSON.parse(fs.readFileSync(path.join(root, "turbo.json"), "utf8"));
  for (const key of [
    "CAL_AUTHENTIK_ENABLED",
    "CAL_AUTHENTIK_ISSUER",
    "CAL_AUTHENTIK_CLIENT_ID",
    "CAL_AUTHENTIK_CLIENT_SECRET",
  ]) {
    assert.ok(turbo.globalEnv.includes(key));
    assert.ok(!key.startsWith("NEXT_PUBLIC_"));
  }
});
