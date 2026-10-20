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
function bridgeEnvironment() {
  const env = { ...environment(), CAL_AUTHENTIK_ENABLED: "false", CAL_AUTHENTIK_ONLY: "false" };
  delete env.CAL_AUTHENTIK_ISSUER;
  delete env.CAL_AUTHENTIK_CLIENT_ID;
  delete env.CAL_AUTHENTIK_CLIENT_SECRET;
  return env;
}
test("only the explicit bridge pair admits web without a native provider", () => {
  assert.deepEqual(validateRuntime(bridgeEnvironment(), receipt, "web"), {
    sourceSha: receipt.sourceSha,
    publicOrigin: receipt.publicOrigin,
    operation: "web",
  });
  for (const enabled of [undefined, "true", "false", "", "FALSE"]) {
    for (const only of [undefined, "true", "false", "", "FALSE"]) {
      if (enabled === "false" && only === "false") continue;
      assert.throws(() =>
        validateRuntime(
          { ...bridgeEnvironment(), CAL_AUTHENTIK_ENABLED: enabled, CAL_AUTHENTIK_ONLY: only },
          receipt,
          "web"
        )
      );
    }
  }
});
test("bridge admission refuses every present native provider field, including empty values", () => {
  for (const field of ["CAL_AUTHENTIK_ISSUER", "CAL_AUTHENTIK_CLIENT_ID", "CAL_AUTHENTIK_CLIENT_SECRET"]) {
    for (const value of ["", "fixture"]) {
      assert.throws(() => validateRuntime({ ...bridgeEnvironment(), [field]: value }, receipt, "web"));
    }
  }
  for (const [field, value] of [
    ["NEXTAUTH_URL", receipt.publicOrigin],
    ["NEXT_PUBLIC_WEBAPP_URL", "https://foreign.example.test"],
    ["NEXTAUTH_SECRET", "short"],
    ["CALENDSO_ENCRYPTION_KEY", ""],
    ["DATABASE_URL", "mysql://localhost/calcom_enterprise"],
  ]) {
    assert.throws(() => validateRuntime({ ...bridgeEnvironment(), [field]: value }, receipt, "web"));
  }
  assert.equal(validateRuntime(bridgeEnvironment(), receipt, "migrate").operation, "migrate");
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
    await write("package.json", JSON.stringify({ packageManager: "yarn@4.12.0" }));
    await write(".yarnrc.yml", "nodeLinker: node-modules\n");
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

function gitNativeRecords(directory, revision) {
  const output = require("node:child_process")
    .execFileSync(
      "git",
      [
        "-C",
        directory,
        "ls-tree",
        "-rlz",
        "--full-tree",
        revision,
        "--",
        "apps",
        "packages",
        "package.json",
        "yarn.lock",
        ".yarnrc.yml",
        ".yarn",
      ],
      { maxBuffer: 8 * 1024 * 1024 }
    )
    .toString();
  return Object.fromEntries(
    output
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const [metadata, name] = line.split("\t");
        const [mode, kind, blob, bytes] = metadata.trim().split(/\s+/);
        assert.equal(kind, "blob");
        return [name, { mode, blob, bytes: Number(bytes) }];
      })
  );
}
function fixtureNativePolicy(directory) {
  const { execFileSync } = require("node:child_process");
  const hash = (data) => require("node:crypto").createHash("sha256").update(data).digest("hex");
  const records = gitNativeRecords(directory, "HEAD");
  const read = (name) => execFileSync("git", ["-C", directory, "show", `HEAD:${name}`]);
  const requiredSources = Object.fromEntries(
    Object.entries(records).filter(([name]) => name.startsWith("apps/") || name.startsWith("packages/"))
  );
  const nativeMigrations = Object.fromEntries(
    Object.entries(requiredSources)
      .filter(([name]) => name.endsWith(".sql"))
      .map(([name, record]) => [name, { bytes: record.bytes, sha256: hash(read(name)) }])
  );
  return {
    schemaVersion: 1,
    nativeCommit: "1c193cca8682b33b9866c792186033f7ef886682",
    nativeTree: "0".repeat(40),
    requiredSourceCount: Object.keys(requiredSources).length,
    requiredSources,
    nativeSchemaSha256: hash(read("packages/prisma/schema.prisma")),
    nativeMigrationCount: Object.keys(nativeMigrations).length,
    nativeMigrations,
    forbiddenActiveMigrations: [],
    reviewedSourcePorts: {},
    reviewedAdditionalMigrations: {},
    rootDependencyClosure: {
      packageManager: "yarn@4.12.0",
      generatedArtifacts: [],
      files: Object.fromEntries(
        ["package.json", "yarn.lock", ".yarnrc.yml"].map((name) => [
          name,
          { ...records[name], sha256: hash(read(name)) },
        ])
      ),
    },
  };
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
  const fixturePolicy = fixtureNativePolicy(directory);
  const code = require("node:fs").readFileSync(
    path.resolve(__dirname, "../../scripts/prepare-enterprise-runtime.cjs"),
    "utf8"
  );
  // Real Git/filesystem/tar and native source validator. This existing miniature
  // fixture substitutes the trusted policy and expensive trace/notices, and is
  // not evidence that this reduced repository satisfies the full native policy.
  new Function(
    "require",
    "module",
    "exports",
    "__dirname",
    "fixturePolicy",
    `${code}\nreadNativePolicy = () => fixturePolicy;`
  )(fixtureRequire, loaded, loaded.exports, path.join(directory, "scripts"), fixturePolicy);
  return { ...loaded.exports, fixturePolicy };
}

test("native baseline pins the complete native source and refuses the reduced programme metadata", async () => {
  const {
    parseNativePolicy,
    validateNativeRecords,
    validateNativeBaseline,
  } = require("../../scripts/prepare-enterprise-runtime.cjs");
  const root = path.resolve(__dirname, "../..");
  const raw = await fs.readFile(path.join(root, "scripts/native-calcom-baseline.json"), "utf8");
  const policy = parseNativePolicy(raw);
  assert.equal(policy.requiredSourceCount, 9430);
  assert.equal(policy.nativeMigrationCount, 588);
  assert.equal(policy.rootDependencyClosure, null);
  assert.deepEqual(policy.reviewedSourcePorts, {});
  assert.deepEqual(policy.reviewedAdditionalMigrations, {});
  const native = gitNativeRecords(root, policy.nativeCommit);
  const digest = validateNativeRecords(policy, native);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.throws(
    () => validateNativeRecords(policy, gitNativeRecords(root, "HEAD")),
    /Missing or changed full-native source/
  );
  await assert.rejects(
    validateNativeBaseline(root),
    /ENOENT|Missing or changed full-native|wrong type, mode or size|checksum mismatch/
  );
  for (const change of ["missing", "noop", "mode", "extra-sql"]) {
    const records = structuredClone(native);
    const name = "packages/prisma/schema.prisma";
    if (change === "missing") delete records[name];
    if (change === "noop") records[name].blob = "0".repeat(40);
    if (change === "mode") records[name].mode = "120000";
    if (change === "extra-sql") records[policy.forbiddenActiveMigrations[0]] = native[name];
    assert.throws(
      () => validateNativeRecords(policy, records),
      /full-native source|Unapproved active migration/
    );
  }
  const { execFileSync } = require("node:child_process");
  const script = String.raw`
import copy,importlib.util,json,pathlib,sys
root=pathlib.Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('publisher',root/'scripts/publish-enterprise-prebuilt.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
policy=m.native_policy();records=json.load(sys.stdin)
assert m.native_records(policy,records)==sys.argv[2]
raw=(root/'scripts/native-calcom-baseline.json').read_bytes();name=next(iter(policy['requiredSources']))
entry=m.native_canonical({name:policy['requiredSources'][name]})[1:-1]
assert raw.count(entry)==1
try:m.parse_native_policy(raw.replace(entry,entry+b','+entry,1))
except m.Refused as error:assert str(error)=='Duplicate JSON key'
else:raise AssertionError('duplicate native path admitted')
bad=copy.deepcopy(policy);name='packages/prisma/schema.prisma'
bad['reviewedSourcePorts'][name]={**bad['requiredSources'][name],'nativeBlob':bad['requiredSources'][name]['blob'],'mode':[],'sha256':'a'*64}
try:m.parse_native_policy(m.native_canonical(bad)+b'\n')
except m.Refused as error:assert str(error)=='Unsupported native source mode'
else:raise AssertionError('non-string override mode admitted')
try:m.native_proof(policy)
except m.Refused as error:assert 'Root dependency closure is not reviewed' in str(error)
else:raise AssertionError('unreviewed root dependency closure admitted')
print('native-policy-and-records-match')`;
  assert.equal(
    execFileSync("python3", ["-B", "-c", script, root, digest], {
      input: JSON.stringify(native),
      encoding: "utf8",
      timeout: 20000,
    }).trim(),
    "native-policy-and-records-match"
  );
});

test("native baseline policy refuses duplicate paths, malformed ledgers and unreviewed exemptions", async () => {
  const { parseNativePolicy } = require("../../scripts/prepare-enterprise-runtime.cjs");
  const raw = await fs.readFile(path.resolve(__dirname, "../../scripts/native-calcom-baseline.json"), "utf8");
  const original = JSON.parse(raw);
  const canonical = (value) =>
    JSON.stringify(value, (_key, item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, item[key]])
          )
        : item
    ) + "\n";
  assert.throws(
    () => parseNativePolicy(raw.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')),
    /duplicate keys/
  );
  const [name, row] = Object.entries(original.requiredSources)[0];
  const entry = `${JSON.stringify(name)}:${JSON.stringify(row, Object.keys(row).sort())}`;
  assert.equal(raw.split(entry).length, 2);
  assert.throws(() => parseNativePolicy(raw.replace(entry, `${entry},${entry}`)), /duplicate keys/);
  for (const change of [
    "unsupported-mode",
    "unknown-override",
    "wrong-preimage",
    "symlink-override",
    "path-escape",
    "null-ledger",
    "root-incomplete",
    "ignored-exemption",
  ]) {
    const policy = structuredClone(original);
    const name = "packages/prisma/schema.prisma";
    const row = {
      ...policy.requiredSources[name],
      nativeBlob: policy.requiredSources[name].blob,
      sha256: "a".repeat(64),
    };
    if (change === "unsupported-mode") row.mode = "100664";
    if (change === "wrong-preimage") row.nativeBlob = "0".repeat(40);
    if (change === "symlink-override") {
      row.mode = "120000";
    }
    policy.reviewedSourcePorts[
      change === "unknown-override"
        ? "apps/unknown.ts"
        : change === "path-escape"
          ? "packages/../escape"
          : name
    ] = row;
    if (change === "null-ledger") policy.reviewedSourcePorts = null;
    if (change === "root-incomplete")
      policy.rootDependencyClosure = { packageManager: "yarn@4.12.0", files: {}, generatedArtifacts: [] };
    if (change === "ignored-exemption")
      policy.rootDependencyClosure = {
        packageManager: "yarn@4.12.0",
        files: Object.fromEntries(
          ["package.json", "yarn.lock", ".yarnrc.yml"].map((key) => [
            key,
            { ...policy.requiredSources[name], sha256: "a".repeat(64) },
          ])
        ),
        generatedArtifacts: [".yarn/patches"],
      };
    assert.throws(() => parseNativePolicy(canonical(policy)), /Invalid|Unsupported|Incomplete|wrong/);
  }
});

for (const mutation of [
  "source-bytes",
  "source-missing",
  "source-alias",
  "ancestor-alias",
  "link-escape",
  "extra-sql",
  "root-pending",
  "root-lock",
  "root-patch",
  "generated-cache-file",
  "generated-state-directory",
]) {
  test(`native baseline actual filesystem refuses ${mutation}`, async () => {
    await sourceFixture(async ({ directory, write }) => {
      const preparer = preparerFor(directory);
      await preparer.validateNativeBaseline(directory);
      const name = "apps/web/public/fixture.txt";
      if (mutation === "source-bytes") await write(name, "changed");
      if (mutation === "source-missing") await fs.unlink(path.join(directory, name));
      if (mutation === "source-alias") {
        await fs.unlink(path.join(directory, name));
        await fs.symlink("../../../../yarn.lock", path.join(directory, name));
      }
      if (mutation === "ancestor-alias") {
        await fs.rename(
          path.join(directory, "apps/web/public"),
          path.join(directory, "apps/web/actual-public")
        );
        await fs.symlink("actual-public", path.join(directory, "apps/web/public"));
      }
      if (mutation === "link-escape") {
        const target = "../../../../outside";
        const blob = require("node:crypto")
          .createHash("sha1")
          .update(`blob ${Buffer.byteLength(target)}\0${target}`)
          .digest("hex");
        preparer.fixturePolicy.requiredSources["packages/prisma/.env"] = {
          blob,
          bytes: Buffer.byteLength(target),
          mode: "120000",
        };
        await fs.symlink(target, path.join(directory, "packages/prisma/.env"));
      }
      if (mutation === "extra-sql")
        await write(
          "packages/prisma/migrations/20260319000000_drop_workflow_tables/migration.sql",
          "-- forbidden fixture\n"
        );
      if (mutation === "root-pending") preparer.fixturePolicy.rootDependencyClosure = null;
      if (mutation === "root-lock") await write("yarn.lock", "altered lock");
      if (mutation === "root-patch") await write(".yarn/patches/unknown.patch", "unreviewed patch");
      if (mutation === "generated-cache-file") {
        preparer.fixturePolicy.rootDependencyClosure.generatedArtifacts = [".yarn/cache"];
        await write(".yarn/cache", "not a cache directory");
      }
      if (mutation === "generated-state-directory") {
        preparer.fixturePolicy.rootDependencyClosure.generatedArtifacts = [".yarn/install-state.gz"];
        await fs.mkdir(path.join(directory, ".yarn/install-state.gz"), { recursive: true });
      }
      await assert.rejects(
        preparer.validateNativeBaseline(directory),
        /Native|native|ENOENT|Unapproved|Root dependency|Dependency|Unreviewed|Unsupported generated/
      );
    });
  });
}

test("legacy builder admits the native baseline before any install or compile command", async () => {
  const recipe = await fs.readFile(path.resolve(__dirname, "../../Dockerfile"), "utf8");
  const guard = recipe.indexOf("RUN node scripts/prepare-enterprise-runtime.cjs --check-native-baseline");
  assert.ok(guard > recipe.indexOf("COPY packages ./packages"));
  for (const command of ["RUN yarn", "RUN npx", "RUN npm"]) {
    const position = recipe.indexOf(command);
    if (position >= 0) assert.ok(guard < position);
  }
  const { spawnSync } = require("node:child_process");
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, "../../scripts/prepare-enterprise-runtime.cjs"), "--check-native-baseline"],
    { encoding: "utf8", timeout: 20000 }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ENOENT|Native source|full-native source/);
  assert.doesNotMatch(result.stdout, /Preparing|Tracing|verified/);
});

test("native baseline hashes a public literal symlink without following its missing environment target", async () => {
  await sourceFixture(async ({ directory }) => {
    const preparer = preparerFor(directory);
    const target = "../../.env";
    const blob = require("node:crypto")
      .createHash("sha1")
      .update(`blob ${Buffer.byteLength(target)}\0${target}`)
      .digest("hex");
    preparer.fixturePolicy.requiredSources["packages/prisma/.env"] = {
      blob,
      bytes: Buffer.byteLength(target),
      mode: "120000",
    };
    await fs.symlink(target, path.join(directory, "packages/prisma/.env"));
    await assert.rejects(fs.stat(path.join(directory, "packages/prisma/.env")), { code: "ENOENT" });
    const proof = await preparer.validateNativeBaseline(directory);
    assert.equal(proof.migrationCount, 1);
    assert.match(proof.sourceClosureSha256, /^[a-f0-9]{64}$/);
  });
});

for (const mutation of ["clean", "source-noop", "wrong-policy", "root-lock", "extra-sql"]) {
  test(`native baseline publisher reads actual source Git objects: ${mutation}`, async () => {
    await sourceFixture(async ({ directory, write, git }) => {
      const policy = fixtureNativePolicy(directory);
      const canonical = (value) =>
        JSON.stringify(value, (_key, item) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? Object.fromEntries(
                Object.keys(item)
                  .sort()
                  .map((key) => [key, item[key]])
              )
            : item
        ) + "\n";
      await write("scripts/native-calcom-baseline.json", canonical(policy));
      if (mutation === "source-noop") await write("apps/web/public/fixture.txt", "changed source");
      if (mutation === "wrong-policy")
        await write(
          "scripts/native-calcom-baseline.json",
          canonical({ ...policy, rootDependencyClosure: null })
        );
      if (mutation === "root-lock") await write("yarn.lock", "changed dependency");
      if (mutation === "extra-sql")
        await write(
          "packages/prisma/migrations/20260319000000_drop_workflow_tables/migration.sql",
          "-- unapproved SQL fixture\n"
        );
      git("add", ".");
      git("commit", "-m", "bound native policy fixture");
      const script = String.raw`
import importlib.util,json,pathlib,sys
root=pathlib.Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('publisher',root/'scripts/publish-enterprise-prebuilt.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
# Only policy trust is a miniature fixture; Git/source/root/schema/SQL checks run.
policy=json.load(sys.stdin);m.native_policy=lambda:policy
expected={'source-noop':'Missing or changed full-native source','wrong-policy':'Application native policy differs',
          'root-lock':'Dependency companion differs','extra-sql':'Unapproved active migration set'}
try:
 proof=m.native_source_baseline(pathlib.Path(sys.argv[2]),sys.argv[3])
 assert sys.argv[4]=='clean' and proof==m.native_proof(policy)
except m.Refused as error:
 assert sys.argv[4]!='clean' and expected[sys.argv[4]] in str(error), 'wrong refusal class'
print('actual-git-binding-control-passed')`;
      const result = require("node:child_process").execFileSync(
        "python3",
        ["-B", "-c", script, path.resolve(__dirname, "../.."), directory, git("rev-parse", "HEAD"), mutation],
        { input: JSON.stringify(policy), encoding: "utf8", timeout: 20000 }
      );
      assert.equal(result.trim(), "actual-git-binding-control-passed");
    });
  });
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

// The image, scanner/native receipts, provider transport and registry are explicit
// fixtures. Production admission, OCI/layer parsing, source reads and digest checks run.
const prebuiltFixture = String.raw`
import copy, datetime as dt, gzip, importlib.util, io, json, os, pathlib, subprocess, sys, tarfile, tempfile, types
root=pathlib.Path(sys.argv[1]); scenario=sys.argv[2]
spec=importlib.util.spec_from_file_location('publisher',root/'scripts/publish-enterprise-prebuilt.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
source=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()
if scenario=='tree-as-source':source=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD^{tree}'],text=True).strip()
now=dt.datetime.now(dt.timezone.utc); timestamp=now.isoformat(timespec='seconds').replace('+00:00','Z')
def encoded(v): return json.dumps(v,separators=(',',':')).encode()
def response(code=0,out=b'',err=b''): return types.SimpleNamespace(returncode=code,stdout=out,stderr=err)
if scenario.startswith('fragment-i18next-client'):
 package_root='calcom/node_modules/next-i18next'
 parent_name='next-i18next'
 relative='dist/commonjs/createClient/package.json'
 marker={'name':'next-i18next-create-client','main':'./node.js','browser':'./browser.js'}
 if scenario=='fragment-i18next-client-wrong-name':marker['name']='another-client'
 if scenario=='fragment-i18next-client-wrong-path':relative='dist/esm/createClient/package.json'
 if scenario=='fragment-i18next-client-wrong-root':package_root='calcom/node_modules/another-package'
 if scenario=='fragment-i18next-client-root-prefix':package_root+='-extra'
 if scenario=='fragment-i18next-client-wrong-parent':parent_name='another-package'
 if scenario=='fragment-i18next-client-main-change':marker['main']='./other.js'
 if scenario=='fragment-i18next-client-main-escape':marker['main']='../../../../outside.js'
 if scenario=='fragment-i18next-client-browser-change':marker['browser']='./other.js'
 if scenario=='fragment-i18next-client-browser-escape':marker['browser']='../../../../outside.js'
 if scenario=='fragment-i18next-client-main-absolute':marker['main']='/node.js'
 if scenario=='fragment-i18next-client-main-missing':marker.pop('main')
 if scenario=='fragment-i18next-client-browser-missing':marker.pop('browser')
 if scenario=='fragment-i18next-client-extra-module':marker['module']='./node.js'
 if scenario=='fragment-i18next-client-extra-private':marker['private']=True
 if scenario=='fragment-i18next-client-extra-script':marker['scripts']={'prepare':'fixture-only-never-executed'}
 parent=package_root+'/package.json'
 files={parent:encoded({'name':parent_name,'version':'15.4.2'}),package_root+'/'+relative:encoded(marker)}
 if scenario=='fragment-i18next-client-nearer-parent':
  files[package_root+'/dist/commonjs/package.json']=encoded({'name':'next-i18next','version':'15.4.2'})
 if scenario=='fragment-i18next-client':
  assert m.node_inventory(files,m.time.monotonic()+5)=={parent:('next-i18next','15.4.2')}, 'marker invented an installed occurrence or version'
 else:
  try:m.node_inventory(files,m.time.monotonic()+5)
  except m.Refused as error:
   expected='Unsupported nested module descriptor' if scenario.endswith('-extra-script') else 'Contradictory module descriptor identity'
   assert str(error)==expected, 'unexpected marker refusal'
  else:raise AssertionError('altered internal marker accepted')
 print('fixture-control-passed');sys.exit(0)
if scenario=='fragment-semantic-deadline':
 try:m.node_inventory({'calcom/node_modules/next/package.json':encoded({'name':'next','version':'1.0.0'})},m.time.monotonic()-1)
 except m.Refused:print('fixture-control-passed');sys.exit(0)
 raise AssertionError('expired semantic deadline accepted')
with tempfile.TemporaryDirectory(prefix='cal-prebuilt-fixture-') as temp:
 d=pathlib.Path(temp)/'bundle'; d.mkdir()
 checkout=root
 publisher_sha=source
 if scenario=='source-revision':
  checkout=pathlib.Path(temp)/'recipe-fixture';checkout.mkdir()
  env={**os.environ,'GIT_AUTHOR_NAME':'Fixture','GIT_AUTHOR_EMAIL':'fixture@example.test','GIT_COMMITTER_NAME':'Fixture','GIT_COMMITTER_EMAIL':'fixture@example.test'}
  def git(*args):return subprocess.check_output(['git','-C',str(checkout),'-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false',*args],env=env,stderr=subprocess.PIPE,text=True).strip()
  git('init','--initial-branch=fixture')
  for file in m.RECIPES.values():
   p=checkout/file;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(m.git_bytes(root,source,file))
  git('add','.');git('commit','-m','fixture application recipes');source=git('rev-parse','HEAD')
  (checkout/'Dockerfile.enterprise-preview').write_text('publisher revision differs from application')
  git('add','.');git('commit','-m','fixture publisher revision');publisher_sha=git('rev-parse','HEAD')
 build={'schemaVersion':1,'sourceSha':source,'publicOrigin':m.ORIGIN,'buildId':'fixture-build','buildManifestSha256':m.sha(b'{}'),
        'migrationEngineVersion':'6.16.1','operationsTraceFiles':743,'copiedLicenseNotices':760,'traceWarnings':[]}
 # Explicit trusted-policy/source-binding doubles for miniature OCI/provider cases.
 # Separate guard tests exercise the production native parser and Git boundary.
 schema=b'native schema fixture'; sql=b'-- native migration fixture\n'
 migration='packages/prisma/migrations/20260101000000_fixture/migration.sql'
 def record(data):return {'mode':'100644','blob':__import__('hashlib').sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest(),'bytes':len(data)}
 policy={'schemaVersion':1,'nativeCommit':m.NATIVE_COMMIT,'nativeTree':'0'*40,
  'requiredSourceCount':2,'requiredSources':{'packages/prisma/schema.prisma':record(schema),migration:record(sql)},
  'nativeSchemaSha256':m.sha(schema),'nativeMigrationCount':1,'nativeMigrations':{migration:{'bytes':len(sql),'sha256':m.sha(sql)}},
  'forbiddenActiveMigrations':[],'reviewedSourcePorts':{},'reviewedAdditionalMigrations':{},
  'rootDependencyClosure':{'packageManager':'yarn@4.12.0','files':{},'generatedArtifacts':[]}}
 m.native_policy=lambda:policy
 proof=m.native_proof(policy)
 m.native_source_baseline=lambda _checkout,_source:proof
 build['nativeBaseline']=proof
 if scenario=='native-proof-forged':build['nativeBaseline']={**proof,'sourceClosureSha256':'0'*64}
 if scenario=='native-proof-missing':build.pop('nativeBaseline')
 if scenario=='native-proof-bool':build['nativeBaseline']={**proof,'migrationCount':True}
 for key,file in m.RECIPES.items(): build[key]=m.sha(m.git_bytes(checkout,source,file))
 config={'os':'linux','architecture':'amd64','config':{'User':'1000:1000','WorkingDir':'/calcom',
  'Entrypoint':['node','/calcom/scripts/enterprise-runtime-entrypoint.cjs'],'Cmd':['web'],'Env':['NODE_ENV=production'],
  'Labels':{'org.opencontainers.image.source':'https://github.com/'+m.REPOSITORY,'org.opencontainers.image.revision':source,
   'io.mereka.cal.build-id':build['buildId'],'io.mereka.cal.dockerfile-sha256':build['dockerfileSha256'],
   'io.mereka.cal.entrypoint-sha256':build['entrypointSha256'],'io.mereka.cal.distribution':'community-enterprise-preview'}},
  'rootfs':{'type':'layers','diff_ids':[]}}
 if scenario=='wrong-platform': config['architecture']='arm64'
 if scenario=='root-user': config['config']['User']='0'
 if scenario=='wrong-entrypoint': config['config']['Entrypoint']=['yarn','start']
 if scenario=='wrong-label': config['config']['Labels']['org.opencontainers.image.revision']='0'*40
 if scenario=='secret-env': config['config']['Env'].append('NEXTAUTH_SECRET=fixture-only-must-not-print')
 if scenario in ['distroless-home','wrong-home','duplicate-home']:
  config['config']['Env']+=['PATH=/nodejs/bin','HOME='+('/root' if scenario=='wrong-home' else '/home/node')]
 if scenario=='duplicate-home':config['config']['Env'].append('HOME=/home/node')
 if scenario in ['distroless-certificate','distroless-certificate-actual-shape','certificate-alternate-path','certificate-regex-dot','duplicate-certificate','certificate-unknown-name']:
  certificate='/etc/ssl/certs/ca-certificates.crt'
  config['config']['Env'].append('SSL_CERT_FILE='+certificate)
 if scenario=='distroless-certificate-actual-shape':
  config['config']['Env']=['PATH=/nodejs/bin','SSL_CERT_FILE='+certificate,'HOME=/home/node','NODE_ENV=production',
   'NEXT_TELEMETRY_DISABLED=1','CHECKPOINT_DISABLE=1','PRISMA_HIDE_UPDATE_MESSAGE=1','PRISMA_GENERATE_SKIP_AUTOINSTALL=true','HOSTNAME=0.0.0.0','PORT=3000']
 if scenario=='certificate-alternate-path':config['config']['Env'][-1]='SSL_CERT_FILE=/tmp/fixture-certificate.crt'
 if scenario=='certificate-regex-dot':config['config']['Env'][-1]='SSL_CERT_FILE=/etc/ssl/certs/ca-certificatesXcrt'
 if scenario=='duplicate-certificate':config['config']['Env'].append('SSL_CERT_FILE='+certificate)
 if scenario=='certificate-unknown-name':config['config']['Env'].append('SSL_CERT_OTHER='+certificate)
 layer_files={'calcom/ops/packages/prisma/schema.prisma':schema,'calcom/ops/'+migration:sql,'calcom/enterprise-build.json':encoded(build),'calcom/apps/web/.next/BUILD_ID':b'fixture-build',
              'calcom/apps/web/.next/build-manifest.json':b'{}'}
 for key,file in m.RECIPES.items():
  if key in ['entrypointSha256','migrationPreflightSha256']:layer_files['calcom/'+file]=m.git_bytes(checkout,source,file)
 if scenario=='wrong-shipped-build': layer_files['calcom/apps/web/.next/BUILD_ID']=b'other-build'
 if scenario=='wrong-shipped-recipe': layer_files['calcom/scripts/enterprise-runtime-entrypoint.cjs']=b'changed'
 if scenario=='missing-shipped-manifest':layer_files.pop('calcom/enterprise-build.json')
 for file,name in m.REQUIRED.items():layer_files[file]=encoded({'name':name,'version':'1.0.0'})
 app='calcom/apps/web/package.json'
 layer_files[app]=encoded({'name':'@calcom/web','version':'6.2.0'})
 if scenario=='app-manifest':
  for i in range(770):layer_files['calcom/node_modules/fixture-dependency-'+str(i)+'/package.json']=encoded({'name':'fixture-dependency-'+str(i),'version':'1.0.0'})
 if scenario=='app-manifest-missing':layer_files.pop(app)
 if scenario=='app-manifest-name-missing':layer_files[app]=encoded({'version':'6.2.0'})
 if scenario=='app-manifest-name-wrong':layer_files[app]=encoded({'name':'@calcom/another','version':'6.2.0'})
 if scenario=='app-manifest-version-missing':layer_files[app]=encoded({'name':'@calcom/web'})
 if scenario=='app-manifest-version-empty':layer_files[app]=encoded({'name':'@calcom/web','version':''})
 if scenario=='app-manifest-version-type':layer_files[app]=encoded({'name':'@calcom/web','version':620})
 if scenario=='app-manifest-version-mismatch':layer_files[app]=encoded({'name':'@calcom/web','version':'6.2.1'})
 if scenario=='app-manifest-duplicate-field':layer_files[app]=b'{"name":"@calcom/web","name":"@calcom/web","version":"6.2.0"}'
 if scenario=='app-manifest-wrong-path':layer_files['calcom/apps/other/package.json']=layer_files.pop(app)
 if scenario=='app-manifest-unexpected-outside':layer_files['calcom/apps/other/package.json']=encoded({'name':'@calcom/other','version':'1.0.0'})
 if scenario=='ambiguous-package':layer_files['calcom/node_modules/extra/package.json']=encoded({'name':'extra'})
 if scenario=='module-marker':layer_files['calcom/node_modules/next/esm/package.json']=encoded({'type':'module'})
 fragment='calcom/node_modules/next/esm/package.json'
 fragment_cases={
  'fragment-name-only':{'name':'next/esm','main':'./index.js'},
  'fragment-version-only':{'version':'1.0.0','type':'module'},
  'fragment-type-side-effects':{'type':'module','sideEffects':['./fixture.css']},
  'fragment-contradictory-name':{'name':'other','main':'./index.js'},
  'fragment-contradictory-version':{'version':'2.0.0','type':'module'},
  'fragment-invalid-type':{'type':['module']},
  'fragment-unknown-fields':{'type':'module','scripts':{'prepare':'fixture-only-no-execution'}},
  'fragment-target-escape':{'main':'../../../../outside.js'},
  'fragment-no-module-hint':{'name':'next/esm'},
 }
 if scenario in fragment_cases:layer_files[fragment]=encoded(fragment_cases[scenario])
 if scenario=='fragment-duplicate-field':layer_files[fragment]=b'{"type":"module","type":"commonjs"}'
 if scenario=='fragment-standalone-marker':layer_files['calcom/node_modules/orphan/package.json']=encoded({'type':'module'})
 if scenario=='fragment-standalone-incomplete':layer_files['calcom/node_modules/orphan/esm/package.json']=encoded({'name':'orphan','main':'./index.js'})
 if scenario=='fragment-cross-namespace':layer_files['calcom/node_modules/next/node_modules/orphan/esm/package.json']=encoded({'type':'module'})
 if scenario=='fragment-sibling-prefix':layer_files['calcom/node_modules/nextish/esm/package.json']=encoded({'type':'module'})
 if scenario in ['fragment-complete-nested','fragment-complete-missing-scan','fragment-nearest-parent','fragment-ambiguous-parent']:
  layer_files['calcom/node_modules/next/embedded/package.json']=encoded({'name':'embedded','version':'2.0.0'})
 if scenario in ['fragment-nearest-parent','fragment-ambiguous-parent']:
  layer_files['calcom/node_modules/next/embedded/esm/package.json']=encoded({'version':'2.0.0' if scenario=='fragment-nearest-parent' else '1.0.0','type':'module'})
 if scenario in ['fragment-next-bundle','fragment-next-bundle-subpath','fragment-next-bundle-wrong-name']:
  bundle='@fixture/bundle/subpath' if scenario=='fragment-next-bundle-subpath' else 'fixture-bundle'
  label='@fixture/bundle' if scenario=='fragment-next-bundle-subpath' else 'other' if scenario=='fragment-next-bundle-wrong-name' else 'fixture-bundle'
  layer_files['calcom/node_modules/next/dist/compiled/'+bundle+'/package.json']=encoded({'name':label,'main':'index','author':{'name':'Fixture Author'},'license':'MIT'})
 if scenario in ['fragment-spoofed-install-root','fragment-nested-next-parent']:
  owner='calcom/node_modules/not-next' if scenario=='fragment-spoofed-install-root' else 'calcom/node_modules/next/embedded'
  layer_files[owner+'/package.json']=encoded({'name':'next','version':'2.0.0'})
  layer_files[owner+'/dist/compiled/fixture-bundle/package.json']=encoded({'name':'fixture-bundle','main':'index'})
 if scenario=='fragment-shapes75':
  shapes=[(1,{'type':'module','sideEffects':['./fixture.css']}),(8,{'type':'module','sideEffects':False}),
   (5,{'main':'./index.js','module':'./index.mjs','types':'./index.d.ts','type':'module','sideEffects':False}),
   (4,{'main':'./index.js','browser':'./browser.js'}),(1,{'version':'1.0.0','type':'module'}),
   (1,{'name':'next/fixture','private':True,'type':'module'}),
   (2,{'name':'next/fixture','main':'./index.js','module':'./index.mjs','exports':{'.':{'import':'./index.mjs','require':'./index.js'}},'private':True,'sideEffects':False,'type':'module'}),
   (1,{'main':'./index.js','module':'./index.mjs','react-native':'./native.js','type':'module'}),
   (9,{'name':'fixture','main':'index','license':'MIT'}),(30,{'name':'fixture','main':'index','author':'Fixture Author','license':'MIT'}),
   (1,{'name':'fixture','main':'index','author':'Fixture Author'}),(10,{'name':'fixture','main':'index','author':{'name':'Fixture Author'},'license':'MIT'}),
   (1,{'name':'next/fixture','browser':'./browser.js','main':'./index.js'}),
   (1,{'main':'./index.js','module':'./index.mjs','types':'./index.d.ts','sideEffects':['./fixture.css']})]
  number=0
  for count,shape in shapes:
   for _ in range(count):
    descriptor=copy.deepcopy(shape);location='descriptor-'+str(number)
    compiled=descriptor.get('name')=='fixture'
    if 'name' in descriptor:descriptor['name']=location if compiled else 'next/'+location
    location=('dist/compiled/' if compiled else 'modules/')+location
    layer_files['calcom/node_modules/next/'+location+'/package.json']=encoded(descriptor);number+=1
  assert number==75
 layer_files['var/lib/dpkg/status']=b'Package: fixture-os\nStatus: install ok installed\nVersion: 1.0\nArchitecture: amd64\n\n'
 status_path='var/lib/dpkg/status.d/fixture-os';os_version='2:1.0-3+deb13u1' if scenario=='status-d-epoch' else '1.0'
 if scenario.startswith('status-d-'):
  layer_files.pop('var/lib/dpkg/status')
  layer_files[status_path]=('Package: fixture-os\nVersion: '+os_version+'\nArchitecture: amd64\n\n').encode()
 if scenario=='status-d-explicit':layer_files[status_path]=b'Package: fixture-os\nVersion: 1.0\nStatus: install ok installed\n'
 if scenario=='status-d-md5sums':layer_files[status_path+'.md5sums']=b'not a control record\n'
 if scenario=='status-d-only-md5sums':
  layer_files.pop(status_path);layer_files[status_path+'.md5sums']=b'not a control record\n'
 if scenario=='status-d-multiple-records':layer_files[status_path]+=b'Package: fixture-old\nVersion: 1.0\nStatus: deinstall ok config-files\n'
 if scenario=='status-d-uninstalled-record':layer_files[status_path+'-old']=b'Package: fixture-old\nVersion: 1.0\nStatus: deinstall ok config-files\n'
 if scenario=='status-d-replaced':layer_files[status_path]=b'Package: fixture-os\nVersion: 0.0\n'
 if scenario=='status-d-whiteout-replacement':layer_files[status_path+'-old']=b'Package: fixture-old\nVersion: 1.0\n'
 if scenario=='status-d-transition':
  layer_files.pop(status_path);layer_files['var/lib/dpkg/status']=b'Package: fixture-old\nStatus: install ok installed\nVersion: 1.0\n'
 if scenario=='status-d-duplicate-field':layer_files[status_path]=b'Package: fixture-os\nPackage: fixture-os\nVersion: 1.0\n'
 if scenario=='status-d-case-duplicate-field':layer_files[status_path]=b'Package: fixture-os\npackage: fixture-os\nVersion: 1.0\n'
 if scenario=='status-d-duplicate-package':layer_files[status_path+'-copy']=layer_files[status_path]
 if scenario=='status-d-missing-version':layer_files[status_path]=b'Package: fixture-os\n'
 if scenario=='status-d-identity-continuation':layer_files[status_path]=b'Package: fixture-os\n extra\nVersion: 1.0\n'
 if scenario=='status-d-mixed':layer_files['var/lib/dpkg/status']=b'Package: fixture-os\nStatus: install ok installed\nVersion: 1.0\n'
 if scenario=='combined-missing-status':layer_files['var/lib/dpkg/status']=b'Package: fixture-os\nVersion: 1.0\n'
 extra='calcom/node_modules/next/node_modules/extra/package.json'
 if scenario in ['nested-copy-missing','nested-copy-included','removed-copy','opaque-copy']:
  layer_files[extra]=encoded({'name':'extra','version':'2.0.0'})
 native_schema='calcom/ops/packages/prisma/schema.prisma';native_sql='calcom/ops/'+migration
 if scenario=='native-schema-wrong':layer_files[native_schema]=b'wrong schema'
 if scenario=='native-schema-missing':layer_files.pop(native_schema)
 if scenario=='native-sql-wrong':layer_files[native_sql]=b'wrong SQL'
 if scenario=='native-sql-missing':layer_files.pop(native_sql)
 if scenario=='native-sql-extra':layer_files['calcom/ops/packages/prisma/migrations/20260319000000_drop_workflow_tables/migration.sql']=b'-- unapproved migration fixture\n'
 if scenario=='native-sql-renamed':layer_files[native_sql.replace('_fixture/','_renamed/')]=layer_files.pop(native_sql)
 layers=[layer_files]
 if scenario=='native-schema-whiteout':layers.append({'calcom/ops/packages/prisma/.wh.schema.prisma':b''})
 if scenario=='native-sql-whiteout':layers.append({'calcom/ops/packages/prisma/migrations/.wh.20260101000000_fixture':b''})
 if scenario=='native-sql-opaque':layers.append({'calcom/ops/packages/prisma/migrations/.wh..wh..opq':b''})
 if scenario=='native-schema-replacement':layers.append({native_schema:schema})
 if scenario=='native-sql-replacement':layers.append({native_sql:sql})
 if scenario=='native-sql-stale-lower':layers.append({native_sql:b'changed SQL'})
 if scenario=='native-extra-removed':
  layer_files['calcom/ops/packages/prisma/migrations/extra.sql']=b'not active in final layer'
  layers.append({'calcom/ops/packages/prisma/migrations/.wh.extra.sql':b''})
 if scenario=='app-manifest-whiteout':layers.append({'calcom/apps/web/.wh.package.json':b''})
 if scenario=='app-manifest-ancestor-replaced':layers.append({'calcom/apps/web':b'replaced-directory'})
 if scenario in ['app-manifest-whiteout-replacement','app-manifest-replacement-stale-scan']:
  layers.append({app:encoded({'name':'@calcom/web','version':'6.2.1'}),'calcom/apps/web/.wh.package.json':b''})
 if scenario=='status-d-replaced':layers.append({status_path:b'Package: fixture-os\nVersion: 1.0\n'})
 if scenario=='status-d-whiteout-replacement':layers.append({status_path:layer_files[status_path],'var/lib/dpkg/status.d/.wh..wh..opq':b''})
 if scenario=='status-d-whiteout':layers.append({'var/lib/dpkg/status.d/.wh.fixture-os':b''})
 if scenario=='status-d-opaque':layers.append({'var/lib/dpkg/status.d/.wh..wh..opq':b''})
 if scenario=='status-d-nondirectory':layers.append({'var/lib/dpkg/status.d':b'replaced-directory'})
 if scenario=='status-d-transition':layers.append({'var/lib/dpkg/.wh.status':b'',status_path:b'Package: fixture-os\nVersion: 1.0\n'})
 if scenario=='whiteout':layers.append({'calcom/.wh.enterprise-build.json':b''})
 if scenario=='removed-copy':layers.append({'calcom/node_modules/next/node_modules/.wh.extra':b''})
 if scenario=='opaque-copy':layers.append({'calcom/node_modules/next/node_modules/.wh..wh..opq':b''})
 if scenario in ['replaced-copy','replaced-copy-old-scan']:
  layers.append({'calcom/node_modules/next/package.json':encoded({'name':'next','version':'2.0.0'})})
 if scenario=='same-layer-opaque-replacement':
  layers[0][extra]=encoded({'name':'extra','version':'0.0.0'})
  layers.append({extra:encoded({'name':'extra','version':'2.0.0'}),'calcom/node_modules/next/node_modules/.wh..wh..opq':b''})
 alias_scenarios={'package-alias','alias-next-hashed','alias-absolute','alias-chain','alias-depth40','alias-depth41',
  'alias-cycle','alias-escape','alias-dangling','alias-file','alias-hardlink','alias-package-json','alias-target-marker',
  'alias-outside-inventory','alias-componentwise-escape','alias-replaced-ancestor','alias-whiteout-target',
  'alias-opaque-target','alias-removed','alias-whiteout-replacement','alias-duplicate-coverage','alias-dpkg-ancestor'}
 alias_entries={}
 if scenario in alias_scenarios:alias_entries['calcom/node_modules/alias']=(tarfile.SYMTYPE,'next')
 if scenario=='alias-next-hashed':
  alias_entries={'calcom/apps/web/.next/node_modules/next-hashed':(tarfile.SYMTYPE,'../../../../node_modules/next')}
 if scenario=='alias-absolute':alias_entries['calcom/node_modules/alias']=(tarfile.SYMTYPE,'/calcom/node_modules/next')
 if scenario in ['alias-chain','alias-cycle']:
  alias_entries={'calcom/node_modules/alias':(tarfile.SYMTYPE,'second'),'calcom/node_modules/second':(tarfile.SYMTYPE,'next' if scenario=='alias-chain' else 'alias')}
 if scenario in ['alias-depth40','alias-depth41']:
  count=40 if scenario=='alias-depth40' else 41
  alias_entries={'calcom/node_modules/link'+str(i):(tarfile.SYMTYPE,'link'+str(i+1) if i<count-1 else 'next') for i in range(count)}
 if scenario=='alias-escape':alias_entries['calcom/node_modules/alias']=(tarfile.SYMTYPE,'../../../outside')
 if scenario=='alias-dangling':alias_entries['calcom/node_modules/alias']=(tarfile.SYMTYPE,'missing')
 if scenario=='alias-file':alias_entries['calcom/node_modules/alias']=(tarfile.SYMTYPE,'next/package.json')
 if scenario=='alias-hardlink':alias_entries['calcom/node_modules/alias']=(tarfile.LNKTYPE,'calcom/node_modules/next')
 if scenario=='alias-package-json':
  alias_entries={'calcom/node_modules/alias/package.json':(tarfile.SYMTYPE,'../../next/package.json')}
 if scenario=='alias-target-marker':layers[0]['calcom/node_modules/next/package.json']=encoded({'type':'module'})
 if scenario=='alias-outside-inventory':
  alias_entries['calcom/node_modules/alias']=(tarfile.SYMTYPE,'../packages/shared')
  layers[0]['calcom/packages/shared/package.json']=encoded({'name':'@calcom/shared','version':'1.0.0'})
 if scenario=='alias-componentwise-escape':
  alias_entries={'calcom/node_modules/alias':(tarfile.SYMTYPE,'../jump/../../outside'),'calcom/jump':(tarfile.SYMTYPE,'/calcom')}
 if scenario=='alias-replaced-ancestor':
  alias_entries['calcom/node_modules/alias']=(tarfile.SYMTYPE,'target')
  layers[0]['calcom/node_modules/target/package.json']=encoded({'name':'target','version':'1.0.0'})
  layers.append({'calcom/node_modules/target':b'replaced directory'})
 if scenario=='alias-whiteout-target':layers.append({'calcom/node_modules/.wh.next':b''})
 if scenario=='alias-opaque-target':layers.append({'calcom/node_modules/next/.wh..wh..opq':b''})
 if scenario=='alias-removed':layers.append({'calcom/node_modules/.wh.alias':b''})
 if scenario=='alias-whiteout-replacement':
  layers.append({'calcom/node_modules/next/package.json':encoded({'name':'next','version':'2.0.0'}),'calcom/node_modules/.wh.next':b''})
 if scenario=='alias-dpkg-ancestor':
  layers.append({});alias_entries={'var/lib/dpkg':(tarfile.SYMTYPE,'../dpkg-target')}
 if scenario in ['status-d-alias','status-d-hardlink','status-d-alias-ancestor']:
  layer_files.pop(status_path)
  alias_entries={status_path:(tarfile.SYMTYPE if scenario!='status-d-hardlink' else tarfile.LNKTYPE,'fixture-control')}
  if scenario=='status-d-alias-ancestor':
   layer_files[status_path]=b'Package: fixture-os\nVersion: 1.0\n'
   alias_entries={'var/lib/dpkg/status.d':(tarfile.SYMTYPE,'../elsewhere')}
 if scenario in ['app-manifest-symlink','app-manifest-hardlink']:
  layer_files.pop(app);alias_entries={app:(tarfile.SYMTYPE if scenario.endswith('-symlink') else tarfile.LNKTYPE,'../../../node_modules/next/package.json')}
 if scenario=='app-manifest-ancestor-alias':alias_entries={'calcom/apps/web':(tarfile.SYMTYPE,'../elsewhere')}
 layer_blobs=[];layer_descriptors=[];config['rootfs']['diff_ids']=[]
 if scenario in ['native-schema-alias','native-sql-alias','native-sql-hardlink']:
  key=native_schema if scenario=='native-schema-alias' else native_sql
  layers[0].pop(key);alias_entries[key]=(tarfile.LNKTYPE if scenario=='native-sql-hardlink' else tarfile.SYMTYPE,'elsewhere')
 if scenario=='native-sql-ancestor':alias_entries['calcom/ops/packages/prisma/migrations']=(tarfile.SYMTYPE,'elsewhere')
 for layer_number,layer_files in enumerate(layers):
  layerbuf=io.BytesIO()
  with tarfile.open(fileobj=layerbuf,mode='w') as tar:
   for name,data in layer_files.items():
    info=tarfile.TarInfo(name); info.size=len(data);tar.addfile(info,io.BytesIO(data))
   if scenario=='duplicate-package':
    info=tarfile.TarInfo('calcom/node_modules/next/package.json');data=layer_files[info.name];info.size=len(data);tar.addfile(info,io.BytesIO(data))
   if layer_number==(1 if scenario=='alias-dpkg-ancestor' else 0):
    for name,(kind,target) in alias_entries.items():
     info=tarfile.TarInfo(name);info.type=kind;info.linkname=target;tar.addfile(info)
  layer=layerbuf.getvalue();config['rootfs']['diff_ids'].append('sha256:'+m.sha(layer))
  compressed=scenario in ['gzip','corrupt-gzip','gzip-bound','gzip-deadline']
  blob=gzip.compress(layer,mtime=0) if compressed else layer
  if scenario=='corrupt-gzip':blob=b'not gzip'
  layer_blobs.append(blob)
  if scenario=='gzip-bound':m.MAX_EXPANDED=len(layer)-1
  if scenario=='gzip-deadline':m.READ_SECONDS=-1
 config_bytes=encoded(config);config_digest='sha256:'+m.sha(config_bytes)
 def desc(data,mt):return {'mediaType':mt,'digest':'sha256:'+m.sha(data),'size':len(data)}
 manifest={'schemaVersion':2,'mediaType':m.MANIFEST,'config':desc(config_bytes,'application/vnd.oci.image.config.v1+json'),
           'layers':[desc(blob,'application/vnd.oci.image.layer.v1.tar'+('+gzip' if compressed else '')) for blob in layer_blobs]}
 if scenario=='config-created-annotation':manifest['config']['annotations']={'org.opencontainers.image.created':timestamp}
 if scenario=='layer-created-annotation':manifest['layers'][0]['annotations']={'org.opencontainers.image.created':timestamp}
 manifest_bytes=encoded(manifest);manifest_digest='sha256:'+m.sha(manifest_bytes)
 index={'schemaVersion':2,'manifests':[desc(manifest_bytes,m.MANIFEST)]}
 created_cases={'created-annotation':timestamp,'created-nanoseconds':timestamp.replace('Z','.123456789Z'),
  'created-invalid-date':'2026-02-30T00:00:00Z','created-invalid-leap':'2025-02-29T00:00:00Z',
  'created-invalid-hour':'2026-10-19T25:00:00Z','created-non-utc':'2026-10-19T00:00:00+08:00',
  'created-missing-zone':'2026-10-19T00:00:00','created-too-precise':'2026-10-19T00:00:00.1234567890Z',
  'created-overlong':'x'*2001,'created-wrong-type':True}
 if scenario in created_cases:index['manifests'][0]['annotations']={'org.opencontainers.image.created':created_cases[scenario]}
 if scenario=='created-unknown-annotation':index['manifests'][0]['annotations']={'unknown':'fixture'}
 if scenario=='created-extra-annotation':index['manifests'][0]['annotations']={'org.opencontainers.image.created':timestamp,'extra':'fixture'}
 if scenario=='created-ref-name':index['manifests'][0]['annotations']={'org.opencontainers.image.ref.name':'fixture-tag'}
 if scenario=='created-empty-annotations':index['manifests'][0]['annotations']={}
 if scenario=='created-annotations-type':index['manifests'][0]['annotations']=[]
 if scenario=='created-unknown-descriptor-key':
  index['manifests'][0]['annotations']={'org.opencontainers.image.created':timestamp};index['manifests'][0]['urls']=['https://example.invalid']
 if scenario=='index-platform':index['manifests'][0]['platform']={'os':'linux','architecture':'arm64'}
 if scenario=='multiple-platforms':index['manifests'].append(index['manifests'][0])
 members={'oci-layout':encoded({'imageLayoutVersion':'1.0.0'}),'index.json':encoded(index),
          'blobs/sha256/'+m.sha(config_bytes):config_bytes,
          'blobs/sha256/'+m.sha(manifest_bytes):manifest_bytes}
 for blob in layer_blobs:members['blobs/sha256/'+m.sha(blob)]=blob
 if scenario=='corrupt-blob':members['blobs/sha256/'+m.sha(layer_blobs[0])]=b'x'*len(layer_blobs[0])
 if scenario=='missing-blob':members.pop('blobs/sha256/'+m.sha(layer_blobs[0]))
 if scenario=='unreferenced-blob':members['blobs/sha256/'+m.sha(b'extra')]=b'extra'
 if scenario=='traversal':members['../outside']=b'no'
 with tarfile.open(d/m.FILES['archive'],mode='w') as tar:
  for name,data in members.items():
   info=tarfile.TarInfo(name);info.size=len(data);tar.addfile(info,io.BytesIO(data))
  if scenario=='duplicate-member':
   info=tarfile.TarInfo('index.json');info.size=len(members['index.json']);tar.addfile(info,io.BytesIO(members['index.json']))
  if scenario in ['symlink','device']:
   info=tarfile.TarInfo('blobs');info.type=tarfile.SYMTYPE if scenario=='symlink' else tarfile.CHRTYPE
   info.linkname='/tmp/fixture-only';tar.addfile(info)
 identity={'schemaVersion':1,'sourceSha':source,'manifestDigest':manifest_digest,'configDigest':config_digest,'completedAt':timestamp,'exitCode':0}
 container={**identity,'publicOrigin':m.ORIGIN,'buildId':build['buildId'],'nativeReceiptSha256':m.sha(b'private native fixture'),
  'expectedMigrations':1,'appliedMigrations':1,
  'checks':{k:True for k in ['migration','migrationReplay','nonRootReadOnlyWeb','nativePublicCallback','anonymousSession']}}
 high={'VulnerabilityID':'CVE-fixture','PkgName':'fixture-os','InstalledVersion':os_version,'Severity':'HIGH'}
 os_result={'Target':'Debian GNU/Linux','Class':'os-pkgs','Type':'debian',
  'Packages':[{'ID':'fixture-os@'+os_version,'Name':'fixture-os','Version':os_version,'PkgPath':''}],'Vulnerabilities':[high],'Secrets':[]}
 node_result={'Target':'Node packages','Class':'lang-pkgs','Type':'node-pkg','Packages':[
  {'ID':str(i),'Name':name,'Version':'1.0.0','PkgPath':file} for i,(file,name) in enumerate(m.REQUIRED.items())],
  'Vulnerabilities':[],'Secrets':[]}
 if scenario not in ['app-manifest-missing','app-manifest-whiteout','app-manifest-symlink','app-manifest-hardlink','app-manifest-ancestor-alias','app-manifest-ancestor-replaced']:
  node_result['Packages'].append({'ID':'first-party-web','Name':'@calcom/another' if scenario=='app-manifest-name-wrong' else '@calcom/web','Version':'6.2.1' if scenario=='app-manifest-whiteout-replacement' else '6.2.0','PkgPath':app})
 if scenario=='app-manifest':
  for i in range(770):node_result['Packages'].append({'ID':'fixture-dependency-'+str(i),'Name':'fixture-dependency-'+str(i),'Version':'1.0.0','PkgPath':'calcom/node_modules/fixture-dependency-'+str(i)+'/package.json'})
 if scenario=='app-manifest-unexpected-outside':node_result['Packages'].append({'ID':'outside','Name':'@calcom/other','Version':'1.0.0','PkgPath':'calcom/apps/other/package.json'})
 if scenario in ['nested-copy-included','same-layer-opaque-replacement']:
  node_result['Packages'].append({'ID':'extra','Name':'extra','Version':'2.0.0','PkgPath':extra})
 if scenario in ['fragment-complete-nested','fragment-nearest-parent','fragment-ambiguous-parent']:
  node_result['Packages'].append({'ID':'embedded','Name':'embedded','Version':'2.0.0','PkgPath':'calcom/node_modules/next/embedded/package.json'})
 if scenario in ['fragment-spoofed-install-root','fragment-nested-next-parent']:
  node_result['Packages'].append({'ID':'spoofed','Name':'next','Version':'2.0.0','PkgPath':owner+'/package.json'})
 if scenario in ['replaced-copy','alias-whiteout-replacement']:node_result['Packages'][0]['Version']='2.0.0'
 if scenario=='alias-duplicate-coverage':node_result['Packages'].append({'ID':'invented-alias-copy','Name':'next','Version':'1.0.0','PkgPath':'calcom/node_modules/alias/package.json'})
 scan={**identity,'scanner':{'version':'0.75.0','binarySha256':m.sha(b'scanner'),'databaseSha256':m.sha(b'database'),
   'ignoredFindings':0,'skipFiles':[],'skipDirs':[],'ignoreUnfixed':False},'rawReportSha256':m.sha(b'private scan fixture'),
  'secretScope':{'filesystem':True,'allLayers':True,'configAndHistory':True,'findings':0,'exitCode':0},'releaseApproved':False,
  'report':{'SchemaVersion':2,'ArtifactType':'container_image','Metadata':{'ImageID':config_digest,'OS':{'Family':'debian','Name':'13'}},
  'Results':[os_result,node_result]}}
 db_metadata={'Version':2,'UpdatedAt':(now-dt.timedelta(hours=1)).isoformat(timespec='seconds').replace('+00:00','Z'),
  'NextUpdate':(now+dt.timedelta(hours=23)).isoformat(timespec='seconds').replace('+00:00','Z'),'DownloadedAt':timestamp}
 if scenario=='expired-database':db_metadata['NextUpdate']=(now-dt.timedelta(seconds=1)).isoformat(timespec='seconds').replace('+00:00','Z')
 if scenario=='future-database':db_metadata['UpdatedAt']=(now+dt.timedelta(hours=1)).isoformat(timespec='seconds').replace('+00:00','Z')
 if scenario=='implausible-database-expiry':db_metadata['NextUpdate']=(now+dt.timedelta(days=365)).isoformat(timespec='seconds').replace('+00:00','Z')
 if scenario=='stale-database-download':db_metadata['DownloadedAt']='2000-01-01T00:00:00Z'
 if scenario=='database-nanoseconds':
  for key in ['UpdatedAt','NextUpdate','DownloadedAt']:db_metadata[key]=db_metadata[key].replace('Z','.123456789Z')
 raw_metadata=encoded(db_metadata)
 scan['scanner']['databaseMetadata']={'raw':raw_metadata.decode(),'sha256':m.sha(raw_metadata)}
 if scenario=='database-metadata-hash':scan['scanner']['databaseMetadata']['sha256']='0'*64
 ledger={'schemaVersion':1,'sourceSha':source,'manifestDigest':manifest_digest,'releaseApproved':False,
  'entries':[{'target':os_result['Target'],'package':'fixture-os','version':os_version,'advisory':'CVE-fixture','disposition':'unwaived'}]}
 if scenario=='stale-native':container['completedAt']='2000-01-01T00:00:00Z'
 if scenario=='stale-scan':scan['completedAt']='2000-01-01T00:00:00Z'
 if scenario=='incomplete-native':container['checks']['migrationReplay']=False
 if scenario=='failed-native':container['exitCode']=1
 if scenario=='migration-count':container['appliedMigrations']=0
 if scenario=='native-wrong-count':container.update(expectedMigrations=596,appliedMigrations=596)
 if scenario=='container-origin':container['publicOrigin']='http://localhost:3000'
 if scenario=='failed-scan':scan['exitCode']=1
 if scenario=='wrong-scan-image':scan['report']['Metadata']['ImageID']='sha256:'+'0'*64
 if scenario=='missing-os':scan['report']['Results'].pop(0)
 if scenario=='duplicate-os':scan['report']['Results'].append(copy.deepcopy(os_result))
 if scenario=='missing-node-copy':node_result['Packages'].pop()
 if scenario=='duplicate-node-copy':node_result['Packages'].append(copy.deepcopy(node_result['Packages'][0]))
 if scenario=='critical':high['Severity']='CRITICAL'
 if scenario=='secrets':scan['secretScope']['findings']=1
 if scenario=='missing-secret-scope':scan['secretScope']['allLayers']=False
 if scenario=='scan-ignores':scan['scanner']['skipFiles']=['somewhere']
 if scenario=='missing-high-ledger':ledger['entries']=[]
 if scenario=='waived-high':ledger['entries'][0]['disposition']='accepted'
 if scenario=='release-approval':scan['releaseApproved']=True
 if scenario=='wrong-recipe':build['dockerfileSha256']='0'*64
 for kind,data in [('build',build),('container',container),('scan',scan),('ledger',ledger)]: (d/m.FILES[kind]).write_bytes(encoded(data))
 receipt={'schemaVersion':1,'repository':m.REPOSITORY,'sourceSha':source,'producerActor':'FixtureActor','producedAt':timestamp,
  'publicOrigin':m.ORIGIN,'artifacts':{kind:{'assetId':i+1,'bytes':(d/file).stat().st_size,'sha256':m.file_hash(d/file)} for i,(kind,file) in enumerate(m.FILES.items())}}
 if scenario=='wrong-source':receipt['sourceSha']='0'*40
 if scenario=='wrong-actor':receipt['producerActor']='OtherActor'
 if scenario=='wrong-origin':receipt['publicOrigin']='http://localhost:3000'
 if scenario=='unknown-field':receipt['extra']='fixture-only'
 if scenario=='bool-id':receipt['artifacts']['archive']['assetId']=True
 if scenario=='archive-size':receipt['artifacts']['archive']['bytes']+=1
 (d/'publication.json').write_bytes(encoded(receipt)); receipt_hash=m.file_hash(d/'publication.json')
 if scenario=='checksum':receipt_hash='0'*64
 if scenario=='duplicate-json':
  data=(d/'publication.json').read_bytes().replace(b'"schemaVersion":1',b'"schemaVersion":1,"schemaVersion":1')
  (d/'publication.json').write_bytes(data);receipt_hash=m.file_hash(d/'publication.json')
 if scenario=='extra-file':(d/'.env').write_text('fixture-only')
 if scenario=='artifact-symlink':
  saved=pathlib.Path(temp)/'saved-receipt';saved.write_bytes((d/'publication.json').read_bytes())
  (d/'publication.json').unlink();(d/'publication.json').symlink_to(saved)
 if scenario=='tamper-after-read':
  original=m.image_archive
  def changed(*args,**kwargs):
   result=original(*args,**kwargs)
   with (d/m.FILES['archive']).open('r+b') as stream:stream.write(b'x')
   return result
  m.image_archive=changed
 calls=[]
 def crane(args,**kwargs):
  calls.append(args[1]); operation=args[1]
  if operation=='auth':return response()
  if operation=='push':return response()
  if operation=='digest':
   if scenario=='auth-error':return response(1,err=b'401 unauthorized MANIFEST_UNKNOWN fixture-sensitive-body')
   if scenario=='transport-error':return response(1,err=b'timeout fixture-sensitive-body')
   if scenario=='conflict':return response(out=('sha256:'+'0'*64).encode())
   if scenario=='publish' and calls.count('digest')==1:return response(1,err=b'MANIFEST_UNKNOWN')
   if scenario=='digest-readback' and calls.count('digest')>1:return response(out=('sha256:'+'0'*64).encode())
   return response(out=manifest_digest.encode())
  if operation=='manifest':return response(out=encoded(manifest)+(b' ' if scenario=='manifest-bytes' else b''))
  if operation=='blob':
   assert args==['crane','blob',m.REGISTRY+'@'+config_digest]
   return response(out=encoded(config)+(b' ' if scenario=='config-readback' else b''))
  raise AssertionError('unexpected command')
 positive=scenario in ['native-schema-replacement','native-sql-replacement','native-extra-removed','app-manifest','app-manifest-whiteout-replacement','admit','publish','idempotent','gzip','nested-copy-included','removed-copy','opaque-copy','replaced-copy','same-layer-opaque-replacement','fetch','safe-redirect','module-marker','source-revision','database-nanoseconds','created-annotation','created-nanoseconds',
   'package-alias','alias-next-hashed','alias-absolute','alias-chain','alias-depth40','alias-removed','alias-whiteout-replacement',
   'distroless-home','distroless-certificate','distroless-certificate-actual-shape','status-d-basic','status-d-explicit','status-d-md5sums','status-d-epoch','status-d-replaced','status-d-whiteout-replacement',
   'status-d-uninstalled-record','status-d-transition','fragment-name-only','fragment-version-only','fragment-type-side-effects',
   'fragment-complete-nested','fragment-nearest-parent','fragment-next-bundle','fragment-next-bundle-subpath','fragment-shapes75']
 try:
  if scenario=='cli-redaction':
   receipt['unexpected']='fixture-only-sensitive-provider-body';(d/'publication.json').write_bytes(encoded(receipt));receipt_hash=m.file_hash(d/'publication.json')
   invoked=subprocess.run(['python3','-B',str(root/'scripts/publish-enterprise-prebuilt.py'),'admit','--directory',str(d),'--source-sha',source,
    '--actor','FixtureActor','--receipt-sha256',receipt_hash],capture_output=True)
   assert invoked.returncode==1 and invoked.stdout==b'' and b'fixture-only-sensitive' not in invoked.stderr
   assert invoked.stderr==b'Prebuilt candidate refused; inspect private evidence and documented admission requirements\n'
   raise m.Refused('expected CLI refusal')
  elif scenario.startswith('fetch'):
   payloads={99:('publication.json',(d/'publication.json').read_bytes())}
   for kind,asset in receipt['artifacts'].items():payloads[asset['assetId']]=(m.FILES[kind],(d/m.FILES[kind]).read_bytes())
   release={'id':42,'draft':False,'prerelease':True,'tag_name':'cal-candidate-'+source,'target_commitish':source,
     'author':{'login':'FixtureActor'},'assets':[{'id':asset,'name':name,'size':len(data),'state':'uploaded'} for asset,(name,data) in payloads.items()]}
   if scenario=='fetch-draft':release['draft']=True
   if scenario=='fetch-source':release['target_commitish']='0'*40
   if scenario=='fetch-author':release['author']['login']='OtherActor'
   if scenario=='fetch-extra-asset':release['assets'].append({'id':100,'name':'extra','size':1,'state':'uploaded'})
   if scenario=='fetch-wrong-name':release['assets'][1]['name']='../outside'
   requested=[]
   def transport(endpoint,output,limit,token):
    requested.append(endpoint)
    assert endpoint.startswith('https://api.github.com/repos/'+m.REPOSITORY+'/releases/')
    if output is None:return release
    asset=int(endpoint.rsplit('/',1)[1]);data=payloads[asset][1]
    if scenario=='fetch-corrupt' and asset==1:data=b'x'*len(data)
    output.write_bytes(data)
   m.download=transport
   downloaded=pathlib.Path(temp)/'downloaded'
   m.fetch(downloaded,42,99,receipt_hash,source,'FixtureActor')
   result=m.admit(downloaded,receipt_hash,source,'FixtureActor',root,now=now)
   assert len(requested)==7
  elif scenario in ['safe-redirect','host-redirect','http-redirect','port-redirect']:
   request=m.urllib.request.Request('https://api.github.com/repos/'+m.REPOSITORY+'/releases/assets/1',headers={'Authorization':'Bearer fixture-only'})
   target={'safe-redirect':'https://release-assets.githubusercontent.com/fixture','host-redirect':'https://other.example.test/fixture',
           'http-redirect':'http://release-assets.githubusercontent.com/fixture','port-redirect':'https://release-assets.githubusercontent.com:8443/fixture'}[scenario]
   redirected=m.SafeRedirect().redirect_request(request,None,302,'',{},target)
   assert not redirected.has_header('Authorization')
   result=m.admit(d,receipt_hash,source,'FixtureActor',root,now=now)
  elif scenario in ['publish','idempotent','auth-error','transport-error','conflict','digest-readback','config-readback','manifest-bytes','wrong-workflow','source-revision']:
   os.environ.update(GITHUB_ACTIONS='true',GITHUB_EVENT_NAME='workflow_dispatch',GITHUB_REPOSITORY=m.REPOSITORY,
    GITHUB_ACTOR='FixtureActor',GITHUB_SHA=publisher_sha,GITHUB_RUN_ID='1',GITHUB_TOKEN='fixture-only-never-output',
    GITHUB_WORKFLOW_REF=m.REPOSITORY+'/.github/workflows/build-fork-image.yml@refs/heads/fixture')
   if scenario=='wrong-workflow':os.environ['GITHUB_REPOSITORY']='Other/Repo'
   result=m.publish(d,receipt_hash,source,'FixtureActor',checkout,run=crane)
   assert ('push' in calls)==(scenario=='publish')
  else:
   if scenario=='app-manifest':
    _manifest,_config,_image_config,physical,_os=m.image_archive(d/m.FILES['archive'],build,layout=None)
    assert len(physical)==776 and physical.get(app)==('@calcom/web','6.2.0'), 'actual image collector omitted first-party app occurrence'
   result=m.admit(d,receipt_hash,source,'FixtureActor',checkout,now=now)
  assert positive, 'invalid bundle admitted'
  assert result['releaseApproved'] is False and result['manifestDigest']==manifest_digest and result['configDigest']==config_digest
  assert result['counts']=={'HIGH':1} and result['tag']=='candidate-'+source+'-'+manifest_digest[7:]
 except (m.Refused,gzip.BadGzipFile,EOFError):
  assert not positive, 'valid fixture refused'
  if scenario in ['auth-error','transport-error','conflict','wrong-workflow']:assert 'push' not in calls
 print('fixture-control-passed')
`;
for (const scenario of [
  "native-proof-forged",
  "native-proof-missing",
  "native-proof-bool",
  "native-schema-wrong",
  "native-schema-missing",
  "native-sql-wrong",
  "native-sql-missing",
  "native-sql-extra",
  "native-sql-renamed",
  "native-schema-whiteout",
  "native-sql-whiteout",
  "native-sql-opaque",
  "native-schema-replacement",
  "native-sql-replacement",
  "native-sql-stale-lower",
  "native-extra-removed",
  "native-schema-alias",
  "native-sql-alias",
  "native-sql-hardlink",
  "native-sql-ancestor",
  "native-wrong-count",
  "admit",
  "publish",
  "idempotent",
  "wrong-platform",
  "root-user",
  "wrong-entrypoint",
  "wrong-label",
  "secret-env",
  "distroless-home",
  "distroless-certificate",
  "distroless-certificate-actual-shape",
  "certificate-alternate-path",
  "certificate-regex-dot",
  "duplicate-certificate",
  "certificate-unknown-name",
  "wrong-home",
  "duplicate-home",
  "status-d-basic",
  "status-d-explicit",
  "status-d-md5sums",
  "status-d-only-md5sums",
  "status-d-multiple-records",
  "status-d-uninstalled-record",
  "status-d-transition",
  "status-d-epoch",
  "status-d-replaced",
  "status-d-whiteout-replacement",
  "status-d-duplicate-field",
  "status-d-case-duplicate-field",
  "status-d-duplicate-package",
  "status-d-missing-version",
  "status-d-identity-continuation",
  "status-d-mixed",
  "combined-missing-status",
  "status-d-whiteout",
  "status-d-opaque",
  "status-d-nondirectory",
  "status-d-alias",
  "status-d-hardlink",
  "status-d-alias-ancestor",
  "wrong-shipped-build",
  "wrong-shipped-recipe",
  "missing-shipped-manifest",
  "whiteout",
  "index-platform",
  "multiple-platforms",
  "created-annotation",
  "created-nanoseconds",
  "created-invalid-date",
  "created-invalid-leap",
  "created-invalid-hour",
  "created-non-utc",
  "created-missing-zone",
  "created-too-precise",
  "created-overlong",
  "created-wrong-type",
  "created-unknown-annotation",
  "created-extra-annotation",
  "created-ref-name",
  "created-empty-annotations",
  "created-annotations-type",
  "created-unknown-descriptor-key",
  "config-created-annotation",
  "layer-created-annotation",
  "corrupt-blob",
  "missing-blob",
  "unreferenced-blob",
  "traversal",
  "duplicate-member",
  "symlink",
  "device",
  "stale-native",
  "stale-scan",
  "incomplete-native",
  "failed-native",
  "migration-count",
  "container-origin",
  "failed-scan",
  "wrong-scan-image",
  "missing-os",
  "duplicate-os",
  "missing-node-copy",
  "duplicate-node-copy",
  "critical",
  "secrets",
  "missing-secret-scope",
  "scan-ignores",
  "missing-high-ledger",
  "waived-high",
  "release-approval",
  "wrong-recipe",
  "wrong-source",
  "wrong-actor",
  "wrong-origin",
  "unknown-field",
  "bool-id",
  "archive-size",
  "checksum",
  "duplicate-json",
  "extra-file",
  "auth-error",
  "transport-error",
  "conflict",
  "digest-readback",
  "config-readback",
  "wrong-workflow",
  "manifest-bytes",
  "gzip",
  "corrupt-gzip",
  "gzip-bound",
  "gzip-deadline",
  "duplicate-package",
  "package-alias",
  "alias-next-hashed",
  "alias-absolute",
  "alias-chain",
  "alias-depth40",
  "alias-depth41",
  "alias-cycle",
  "alias-escape",
  "alias-dangling",
  "alias-file",
  "alias-hardlink",
  "alias-package-json",
  "alias-target-marker",
  "alias-outside-inventory",
  "alias-componentwise-escape",
  "alias-replaced-ancestor",
  "alias-whiteout-target",
  "alias-opaque-target",
  "alias-removed",
  "alias-whiteout-replacement",
  "alias-duplicate-coverage",
  "alias-dpkg-ancestor",
  "nested-copy-missing",
  "nested-copy-included",
  "removed-copy",
  "opaque-copy",
  "replaced-copy",
  "replaced-copy-old-scan",
  "same-layer-opaque-replacement",
  "artifact-symlink",
  "tamper-after-read",
  "fetch",
  "fetch-draft",
  "fetch-source",
  "fetch-author",
  "fetch-extra-asset",
  "fetch-wrong-name",
  "fetch-corrupt",
  "safe-redirect",
  "host-redirect",
  "http-redirect",
  "port-redirect",
  "ambiguous-package",
  "module-marker",
  "fragment-name-only",
  "fragment-version-only",
  "fragment-type-side-effects",
  "fragment-contradictory-name",
  "fragment-contradictory-version",
  "fragment-invalid-type",
  "fragment-unknown-fields",
  "fragment-target-escape",
  "fragment-no-module-hint",
  "fragment-duplicate-field",
  "fragment-standalone-marker",
  "fragment-standalone-incomplete",
  "fragment-cross-namespace",
  "fragment-sibling-prefix",
  "fragment-complete-nested",
  "fragment-complete-missing-scan",
  "fragment-nearest-parent",
  "fragment-ambiguous-parent",
  "fragment-next-bundle",
  "fragment-next-bundle-subpath",
  "fragment-next-bundle-wrong-name",
  "fragment-shapes75",
  "fragment-spoofed-install-root",
  "fragment-nested-next-parent",
  "app-manifest",
  "app-manifest-missing",
  "app-manifest-name-missing",
  "app-manifest-name-wrong",
  "app-manifest-version-missing",
  "app-manifest-version-empty",
  "app-manifest-version-type",
  "app-manifest-version-mismatch",
  "app-manifest-duplicate-field",
  "app-manifest-wrong-path",
  "app-manifest-unexpected-outside",
  "app-manifest-symlink",
  "app-manifest-hardlink",
  "app-manifest-ancestor-alias",
  "app-manifest-whiteout",
  "app-manifest-ancestor-replaced",
  "app-manifest-whiteout-replacement",
  "app-manifest-replacement-stale-scan",
  "fragment-i18next-client",
  "fragment-i18next-client-wrong-name",
  "fragment-i18next-client-wrong-path",
  "fragment-i18next-client-wrong-root",
  "fragment-i18next-client-root-prefix",
  "fragment-i18next-client-wrong-parent",
  "fragment-i18next-client-nearer-parent",
  "fragment-i18next-client-main-change",
  "fragment-i18next-client-main-escape",
  "fragment-i18next-client-browser-change",
  "fragment-i18next-client-browser-escape",
  "fragment-i18next-client-main-absolute",
  "fragment-i18next-client-main-missing",
  "fragment-i18next-client-browser-missing",
  "fragment-i18next-client-extra-module",
  "fragment-i18next-client-extra-private",
  "fragment-i18next-client-extra-script",
  "fragment-semantic-deadline",
  "cli-redaction",
  "source-revision",
  "tree-as-source",
  "expired-database",
  "future-database",
  "implausible-database-expiry",
  "stale-database-download",
  "database-nanoseconds",
  "database-metadata-hash",
]) {
  test(`prebuilt publisher ${scenario} uses actual collector/admission with explicit policy/source/native/provider fixtures`, () => {
    const { execFileSync } = require("node:child_process");
    const output = execFileSync(
      "python3",
      ["-B", "-c", prebuiltFixture, path.resolve(__dirname, "../.."), scenario],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 20000,
      }
    );
    assert.equal(output.trim(), "fixture-control-passed");
  });
}

test("existing publisher workflow keeps authority and prebuilt publication cannot reach legacy builds", async () => {
  const workflow = await fs.readFile(
    path.resolve(__dirname, "../../.github/workflows/build-fork-image.yml"),
    "utf8"
  );
  assert.match(workflow, /runs-on: mereka-k8s-heavy-builders/);
  assert.match(workflow, /timeout-minutes: 60/);
  assert.match(workflow, /permissions:\n {2}contents: read\n {2}packages: write/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /\$TAG_OVERRIDE" != candidate-\*/);
  for (const step of [
    "Compute image tags",
    "Set up Docker Buildx",
    "Log in to GHCR",
    "Build and push",
    "Summary",
  ]) {
    assert.ok(workflow.includes(`- name: ${step}\n        if: inputs.mode != 'prebuilt'`));
  }
  for (const step of [
    "Admit exact prebuilt candidate",
    "Prepare pinned prebuilt publisher",
    "Publish and read back exact candidate",
  ]) {
    assert.ok(
      workflow.includes(
        `- name: ${step}\n        if: github.event_name == 'workflow_dispatch' && inputs.mode == 'prebuilt'`
      )
    );
  }
  assert.doesNotMatch(workflow, /\$\{\{ inputs.tag_override \}\}"/);
});

function accountSetupSource() {
  const syncFs = require("node:fs");
  const recipe = syncFs.readFileSync(path.resolve(__dirname, "../../Dockerfile.enterprise-preview"), "utf8");
  const commands = recipe
    .split("\n")
    .filter((line) => line.startsWith("RUN ["))
    .map((line) => JSON.parse(line.slice(4)));
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].slice(0, 2), ["/nodejs/bin/node", "-e"]);
  return require("node:vm").compileFunction(commands[0][2], ["require", "process"], {
    filename: "Dockerfile.enterprise-preview:account-setup",
  });
}

test("packaged account setup preserves base accounts and creates the existing UID's home", () => {
  const setup = accountSetupSource();
  const passwd =
    "root:x:0:0:root:/root:/sbin/nologin\nnonroot:x:65532:65532:nonroot:/home/nonroot:/sbin/nologin\n";
  const group = "root:x:0:\nnonroot:x:65532:\n";
  const files = new Map([
    ["/etc/passwd", passwd],
    ["/etc/group", group],
  ]);
  const writes = [];
  // These explicit filesystem/privilege doubles exercise the shipped RUN source, not host account files.
  const filesystem = {
    readFileSync: (name, encoding) => {
      assert.equal(encoding, "utf8");
      assert.ok(files.has(name));
      return files.get(name);
    },
    existsSync: (name) => {
      assert.equal(name, "/home/node");
      return false;
    },
    appendFileSync: (name, text) => {
      assert.ok(files.has(name));
      files.set(name, files.get(name) + text);
      writes.push(["append", name]);
    },
    mkdirSync: (name, options) => writes.push(["mkdir", name, options]),
    chownSync: (...args) => writes.push(["chown", ...args]),
    chmodSync: (...args) => writes.push(["chmod", ...args]),
  };
  setup(
    (name) => {
      assert.equal(name, "node:fs");
      return filesystem;
    },
    { getuid: () => 0, getgid: () => 0 }
  );
  assert.equal(files.get("/etc/passwd"), passwd + "node:x:1000:1000:Node:/home/node:/sbin/nologin\n");
  assert.equal(files.get("/etc/group"), group + "node:x:1000:\n");
  assert.deepEqual(writes, [
    ["append", "/etc/passwd"],
    ["append", "/etc/group"],
    ["mkdir", "/home/node", { mode: 0o700 }],
    ["chown", "/home/node", 1000, 1000],
    ["chmod", "/home/node", 0o700],
  ]);
});

for (const problem of [
  "uid",
  "primary-gid",
  "group-gid",
  "username",
  "group-name",
  "passwd-shape",
  "group-shape",
  "existing-home",
  "nonroot-setup",
]) {
  test(`packaged account setup refuses ${problem} before any filesystem write`, () => {
    const setup = accountSetupSource();
    let passwd = "root:x:0:0:root:/root:/sbin/nologin\n";
    let group = "root:x:0:\n";
    if (problem === "uid") passwd += "other:x:1000:2000:other:/other:/sbin/nologin\n";
    if (problem === "primary-gid") passwd += "other:x:2000:1000:other:/other:/sbin/nologin\n";
    if (problem === "group-gid") group += "other:x:1000:\n";
    if (problem === "username") passwd += "node:x:2000:2000:other:/other:/sbin/nologin\n";
    if (problem === "group-name") group += "node:x:2000:\n";
    if (problem === "passwd-shape") passwd += "broken\n";
    if (problem === "group-shape") group += "broken\n";
    const writes = [];
    const filesystem = {
      readFileSync: (name) => {
        assert.ok(["/etc/passwd", "/etc/group"].includes(name));
        return name === "/etc/passwd" ? passwd : group;
      },
      existsSync: (name) => {
        assert.equal(name, "/home/node");
        return problem === "existing-home";
      },
      appendFileSync: (...args) => writes.push(args),
      mkdirSync: (...args) => writes.push(args),
      chownSync: (...args) => writes.push(args),
      chmodSync: (...args) => writes.push(args),
    };
    assert.throws(() =>
      setup(
        (name) => {
          assert.equal(name, "node:fs");
          return filesystem;
        },
        { getuid: () => (problem === "nonroot-setup" ? 1000 : 0), getgid: () => 0 }
      )
    );
    assert.deepEqual(writes, []);
  });
}
