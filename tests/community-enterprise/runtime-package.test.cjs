// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { test } = require("node:test");
const { validateRuntime } = require("../../scripts/enterprise-runtime-entrypoint.cjs");
const { validateTree } = require("../../scripts/prepare-enterprise-runtime.cjs");
const receipt = {
  schemaVersion: 1,
  sourceSha: "a".repeat(40),
  publicOrigin: "https://cal-enterprise.example.test",
};
const environment = () => ({
  NEXT_PUBLIC_WEBAPP_URL: receipt.publicOrigin,
  NEXTAUTH_URL: `${receipt.publicOrigin}/api/auth`,
  DATABASE_URL: "postgresql://fixture:fixture@localhost/calcom_enterprise",
  DATABASE_DIRECT_URL: "postgresql://fixture:fixture@localhost/calcom_enterprise",
  CAL_ENTERPRISE_EXPECTED_DATABASE: "calcom_enterprise",
  NEXTAUTH_SECRET: "n".repeat(32),
  CALENDSO_ENCRYPTION_KEY: "e".repeat(32),
  CAL_AUTHENTIK_ENABLED: "true",
  CAL_AUTHENTIK_ONLY: "true",
  CAL_AUTHENTIK_ISSUER: "https://identity.example.test/application/o/cal-enterprise",
  CAL_AUTHENTIK_CLIENT_ID: "fixture-client",
  CAL_AUTHENTIK_CLIENT_SECRET: "fixture-client-secret",
});
test("web preflight accepts the exact configured artifact without returning secret values", () => {
  assert.deepEqual(validateRuntime(environment(), receipt, "web"), {
    sourceSha: receipt.sourceSha,
    publicOrigin: receipt.publicOrigin,
    operation: "web",
  });
});
for (const [name, value] of [
  ["NEXT_PUBLIC_WEBAPP_URL", "http://localhost:3000"],
  ["NEXT_PUBLIC_WEBAPP_URL", `${receipt.publicOrigin}/other`],
  ["NEXTAUTH_URL", "https://foreign.example.test/api/auth"],
  ["CAL_AUTHENTIK_ENABLED", "false"],
  ["CAL_AUTHENTIK_ONLY", "false"],
  ["CAL_AUTHENTIK_ONLY", undefined],
  ["NEXTAUTH_SECRET", "short"],
  ["CALENDSO_ENCRYPTION_KEY", ""],
  ["CAL_AUTHENTIK_CLIENT_SECRET", ""],
  ["DATABASE_URL", "mysql://localhost/calcom_enterprise"],
]) {
  test(`web preflight rejects mismatched or missing ${name}`, () => {
    assert.throws(() => validateRuntime({ ...environment(), [name]: value }, receipt, "web"));
  });
}
test("explicit migration mode requires the intended database", () => {
  assert.equal(validateRuntime(environment(), receipt, "migrate").operation, "migrate");
  assert.throws(() =>
    validateRuntime({ ...environment(), CAL_ENTERPRISE_EXPECTED_DATABASE: "legacy" }, receipt, "migrate")
  );
  assert.throws(() =>
    validateRuntime(
      { ...environment(), DATABASE_DIRECT_URL: "postgresql://localhost/legacy" },
      receipt,
      "migrate"
    )
  );
});
test("invalid build identities and arbitrary operation names are refused", () => {
  assert.throws(() => validateRuntime(environment(), { ...receipt, sourceSha: "latest" }, "web"));
  assert.throws(() => validateRuntime(environment(), receipt, "shell"));
});
test("runtime context rejects escaping symlinks and environment files", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cal-enterprise-context-"));
  try {
    await fs.writeFile(path.join(directory, "valid.json"), "{}");
    await validateTree(directory);
    await fs.symlink("/etc/passwd", path.join(directory, "escape"));
    await assert.rejects(validateTree(directory));
    await fs.unlink(path.join(directory, "escape"));
    await fs.writeFile(path.join(directory, ".env.production"), "NOT_A_REAL_SECRET=fixture");
    await assert.rejects(validateTree(directory));
  } finally {
    await fs.rm(directory, { recursive: true });
  }
});

test("web and shared authentication use the same patched NextAuth release", async () => {
  const root = path.resolve(__dirname, "../..");
  const web = JSON.parse(await fs.readFile(path.join(root, "apps/web/package.json"), "utf8"));
  const auth = JSON.parse(await fs.readFile(path.join(root, "packages/features/auth/package.json"), "utf8"));
  assert.equal(web.dependencies["next-auth"], auth.dependencies["next-auth"]);
  const atLeast = (actual, minimum) => {
    assert.match(actual, /^\d+\.\d+\.\d+$/);
    const a = actual.split(".").map(Number),
      b = minimum.split(".").map(Number);
    return a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2])));
  };
  assert.ok(atLeast(web.dependencies["next-auth"], "4.24.15"));
  assert.ok(atLeast(web.dependencies.next, "16.3.6"));
  assert.ok(atLeast(web.dependencies.handlebars, "4.7.10"));
});
