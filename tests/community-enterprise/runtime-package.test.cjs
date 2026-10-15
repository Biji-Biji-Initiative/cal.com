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

async function sourceFixture(run) {
  const { execFileSync } = require("node:child_process");
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "cal-enterprise-source-"));
  const directory = path.join(base, "source");
  await fs.mkdir(directory);
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.test",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.test",
      },
    }).trim();
  const write = async (name, data = "fixture") => {
    const file = path.join(directory, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  };
  try {
    git("init", "--initial-branch=fixture");
    await write(".gitignore", "node_modules/\napps/web/.next/\n");
    for (const name of [
      "yarn.lock",
      "scripts/enterprise-runtime-entrypoint.cjs",
      "scripts/check-enterprise-migration.sql",
      "Dockerfile.enterprise-preview",
      "packages/prisma/schema.prisma",
      "packages/prisma/migrations/fixture/migration.sql",
      "apps/web/public/fixture.txt",
    ])
      await write(name);
    git("add", ".");
    git("commit", "-m", "fixture source");
    const source = git("rev-parse", "HEAD");
    await write("apps/web/.next/standalone/apps/web/.next/BUILD_ID", "fixture-build");
    await write("apps/web/.next/build-manifest.json", "{}");
    await write("apps/web/.next/static/fixture.js");
    await write("node_modules/prisma/package.json", '{"version":"6.16.1"}');
    await write("node_modules/prisma/build/index.js");
    await write("node_modules/@prisma/engines/package.json", '{"version":"6.16.1"}');
    const hash = (data) => require("node:crypto").createHash("sha256").update(data).digest("hex");
    const receiptPath = path.join(base, "receipt.json");
    await fs.writeFile(
      receiptPath,
      JSON.stringify({
        source,
        public_origin: "https://cal-enterprise.example.test",
        build_id: "fixture-build",
        manifest_sha256: hash("{}"),
        lock_before: hash("fixture"),
        lock_after: hash("fixture"),
        results: Object.fromEntries(
          ["install", "generate", "app-registry", "trpc", "assets", "web-build"].map((name) => [
            name,
            { exit_code: 0 },
          ])
        ),
      })
    );
    await run({ directory, source, git, write, receiptPath, output: path.join(base, "context") });
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
}

function preparerFor(directory, { duringTrace, duringNotices } = {}) {
  const nativeRequire = require;
  const fixtureRequire = (name) => {
    if (name === "next/dist/compiled/@vercel/nft")
      return {
        nodeFileTrace: async () => {
          if (duringTrace) await duringTrace();
          return { fileList: new Set(), warnings: new Set() };
        },
      };
    if (name === "./retain-enterprise-notices.cjs")
      return {
        retainNotices: async (output) => {
          if (duringNotices) await duringNotices(output);
          return 0;
        },
      };
    return nativeRequire(name);
  };
  fixtureRequire.resolve = (name, options) => nativeRequire.resolve(name, options);
  const loaded = { exports: {} };
  const code = require("node:fs").readFileSync(
    path.resolve(__dirname, "../../scripts/prepare-enterprise-runtime.cjs"),
    "utf8"
  );
  // Execute the real preparer with real Git/filesystem/tar; only the expensive
  // dependency trace and notice collection are explicit miniature-fixture seams.
  new Function("require", "module", "exports", "__dirname", code)(
    fixtureRequire,
    loaded,
    loaded.exports,
    path.join(directory, "scripts")
  );
  return loaded.exports;
}

test("packaging accepts a clean exact source and ignores generated build outputs", async () => {
  await sourceFixture(async ({ directory, source, receiptPath, output }) => {
    const { prepare, validateSource } = preparerFor(directory);
    assert.equal(validateSource(directory, source), source);
    await prepare(output, receiptPath);
    assert.equal(
      JSON.parse(await fs.readFile(path.join(output, "enterprise-build.json"), "utf8")).sourceSha,
      source
    );
  });
});
for (const kind of ["tracked", "staged", "untracked"]) {
  test(`packaging refuses ${kind} source before creating its output`, async () => {
    await sourceFixture(async ({ directory, write, git, receiptPath, output }) => {
      const filename =
        kind === "untracked" ? "unpublished-provider.ts" : "scripts/enterprise-runtime-entrypoint.cjs";
      await write(filename, "uncommitted fixture change");
      if (kind === "staged") git("add", filename);
      await assert.rejects(preparerFor(directory).prepare(output, receiptPath), /Uncommitted source changes/);
      await assert.rejects(fs.stat(output), { code: "ENOENT" });
    });
  });
}
test("packaging refuses wrong and malformed source identities", async () => {
  await sourceFixture(async ({ directory }) => {
    const { validateSource } = preparerFor(directory);
    for (const value of [undefined, null, "latest", "", "A".repeat(40)])
      assert.throws(() => validateSource(directory, value), /Invalid source revision/);
    assert.throws(() => validateSource(directory, "a".repeat(40)), /Wrong source revision/);
  });
});
for (const committed of [false, true]) {
  test(`source ${committed ? "commit" : "edit"} during preparation prevents a completion manifest`, async () => {
    await sourceFixture(async ({ directory, write, git, receiptPath, output }) => {
      const { prepare } = preparerFor(directory, {
        duringTrace: async () => {
          await write("scripts/enterprise-runtime-entrypoint.cjs", "changed during copy");
          if (committed) {
            git("add", ".");
            git("commit", "-m", "new source");
          }
        },
      });
      await assert.rejects(
        prepare(output, receiptPath),
        committed ? /Wrong source revision/ : /Uncommitted source changes/
      );
      await assert.rejects(fs.stat(path.join(output, "enterprise-build.json")), { code: "ENOENT" });
    });
  });
}
test("invalid runtime context does not retain a completion manifest", async () => {
  await sourceFixture(async ({ directory, receiptPath, output }) => {
    const { prepare } = preparerFor(directory, {
      duringNotices: (target) => fs.writeFile(path.join(target, ".env"), "FIXTURE_ONLY=not-a-secret"),
    });
    await assert.rejects(prepare(output, receiptPath), /Environment or Git data/);
    await assert.rejects(fs.stat(path.join(output, "enterprise-build.json")), { code: "ENOENT" });
  });
});
