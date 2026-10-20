// SPDX-License-Identifier: MIT
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");

const NATIVE_COMMIT = "1c193cca8682b33b9866c792186033f7ef886682";
const NATIVE_POLICY_CORE = "7e1a935d7aba6a51cbd6a1a7e38c65b4855ecadd1c804a1d9c69b8879cdb776c";
const SOURCE_LIMIT = 512 * 1024 * 1024;
const SOURCE_FILE_LIMIT = 64 * 1024 * 1024;
const nativeHash = (data) => createHash("sha256").update(data).digest("hex");
const nativeCanonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]])
        )
      : item
  );
function nativeNeed(condition, message) {
  if (!condition) throw new Error(message);
}
function nativeShape(value, keys) {
  nativeNeed(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(" ") === keys.split(" ").sort().join(" "),
    "Invalid native baseline object"
  );
}
function nativePath(value) {
  nativeNeed(
    typeof value === "string" &&
      Buffer.byteLength(value) <= 1024 &&
      /^[\x20-\x7e]+$/.test(value) &&
      !value.includes("\\") &&
      !value.startsWith("/") &&
      value.split("/").every((part) => part && part !== "." && part !== ".."),
    "Invalid native baseline path"
  );
  return value;
}
function nativeRecord(value, keys = "blob bytes mode") {
  nativeShape(value, keys);
  nativeNeed(
    typeof value.blob === "string" &&
      /^[a-f0-9]{40}$/.test(value.blob) &&
      Number.isSafeInteger(value.bytes) &&
      value.bytes >= 0 &&
      value.bytes <= SOURCE_FILE_LIMIT &&
      ["100644", "100755", "120000"].includes(value.mode),
    "Invalid native source identity"
  );
  if (Object.hasOwn(value, "sha256"))
    nativeNeed(
      typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256),
      "Invalid native source checksum"
    );
}
function parseNativePolicy(raw) {
  nativeNeed(Buffer.byteLength(raw) <= 2 * 1024 * 1024, "Native baseline policy exceeds bound");
  const policy = JSON.parse(raw);
  nativeNeed(
    `${nativeCanonical(policy)}\n` === raw,
    "Native baseline policy must be canonical without duplicate keys"
  );
  nativeShape(
    policy,
    "schemaVersion nativeCommit nativeTree requiredSourceCount requiredSources nativeSchemaSha256 nativeMigrationCount nativeMigrations forbiddenActiveMigrations reviewedSourcePorts reviewedAdditionalMigrations rootDependencyClosure"
  );
  const { reviewedSourcePorts, reviewedAdditionalMigrations, rootDependencyClosure, ...core } = policy;
  nativeNeed(
    policy.schemaVersion === 1 &&
      policy.nativeCommit === NATIVE_COMMIT &&
      nativeHash(nativeCanonical(core)) === NATIVE_POLICY_CORE,
    "Native baseline differs from the pinned full source"
  );
  for (const entries of [reviewedSourcePorts, reviewedAdditionalMigrations])
    nativeNeed(
      entries !== null &&
        typeof entries === "object" &&
        !Array.isArray(entries) &&
        Object.keys(entries).length <= 9430,
      "Invalid reviewed native ledger"
    );
  for (const name of Object.keys(policy.requiredSources)) {
    nativePath(name);
    nativeRecord(policy.requiredSources[name]);
    nativeNeed(name.startsWith("apps/") || name.startsWith("packages/"), "Invalid native source namespace");
  }
  for (const [name, record] of Object.entries(reviewedSourcePorts)) {
    nativePath(name);
    nativeNeed(
      Object.hasOwn(policy.requiredSources, name) && !name.startsWith("packages/prisma/migrations/"),
      "Unsupported native source override"
    );
    nativeRecord(record, "nativeBlob blob bytes mode sha256");
    const original = policy.requiredSources[name];
    nativeNeed(
      record.nativeBlob === original.blob && record.mode === original.mode && record.mode !== "120000",
      "Native override has wrong preimage or mode"
    );
  }
  for (const [name, record] of Object.entries(reviewedAdditionalMigrations)) {
    nativePath(name);
    nativeRecord(record, "blob bytes mode sha256");
    nativeNeed(
      /^packages\/prisma\/migrations\/\d{14,17}_[A-Za-z0-9_]*\/migration\.sql$/.test(name) &&
        !Object.hasOwn(policy.requiredSources, name) &&
        !policy.forbiddenActiveMigrations.includes(name) &&
        record.mode === "100644",
      "Unsupported additional migration"
    );
  }
  if (rootDependencyClosure !== null) {
    nativeShape(rootDependencyClosure, "packageManager files generatedArtifacts");
    nativeNeed(
      typeof rootDependencyClosure.packageManager === "string" &&
        /^yarn@\d+\.\d+\.\d+$/.test(rootDependencyClosure.packageManager),
      "Invalid reviewed package manager"
    );
    const files = rootDependencyClosure.files;
    nativeNeed(
      files &&
        typeof files === "object" &&
        !Array.isArray(files) &&
        Object.keys(files).length <= 2000 &&
        ["package.json", "yarn.lock", ".yarnrc.yml"].every((name) => Object.hasOwn(files, name)),
      "Incomplete root dependency closure"
    );
    for (const [name, record] of Object.entries(files)) {
      nativePath(name);
      nativeRecord(record, "blob bytes mode sha256");
      nativeNeed(
        (["package.json", "yarn.lock", ".yarnrc.yml"].includes(name) || name.startsWith(".yarn/")) &&
          record.mode !== "120000",
        "Unsupported dependency companion"
      );
    }
    nativeNeed(
      Array.isArray(rootDependencyClosure.generatedArtifacts) &&
        new Set(rootDependencyClosure.generatedArtifacts).size ===
          rootDependencyClosure.generatedArtifacts.length &&
        rootDependencyClosure.generatedArtifacts.every((name) =>
          [".yarn/cache", ".yarn/unplugged", ".yarn/install-state.gz", ".yarn/build-state.yml"].includes(name)
        ) &&
        rootDependencyClosure.generatedArtifacts.every(
          (name) => !Object.keys(files).some((key) => key === name || key.startsWith(`${name}/`))
        ),
      "Unsupported generated-file exception"
    );
  }
  return policy;
}
function readNativePolicy() {
  const filename = path.join(__dirname, "native-calcom-baseline.json");
  const before = fsSync.lstatSync(filename, { bigint: true });
  nativeNeed(
    before.isFile() && before.nlink === 1n && before.size <= 2n * 1024n * 1024n,
    "Invalid native policy file"
  );
  const fd = fsSync.openSync(filename, fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW);
  try {
    const opened = fsSync.fstatSync(fd, { bigint: true });
    nativeNeed(opened.ino === before.ino && opened.dev === before.dev, "Native policy changed during read");
    const raw = fsSync.readFileSync(fd, "utf8");
    const after = fsSync.fstatSync(fd, { bigint: true });
    nativeNeed(
      after.size === before.size && after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs,
      "Native policy changed during read"
    );
    return parseNativePolicy(raw);
  } finally {
    fsSync.closeSync(fd);
  }
}
function nativeRequirements(policy) {
  const records = { ...policy.requiredSources };
  for (const [name, record] of Object.entries(policy.reviewedSourcePorts)) records[name] = record;
  Object.assign(records, policy.reviewedAdditionalMigrations);
  return records;
}
function nativeMigrationHashes(policy) {
  return Object.fromEntries([
    ...Object.entries(policy.nativeMigrations).map(([name, value]) => [name, value.sha256]),
    ...Object.entries(policy.reviewedAdditionalMigrations).map(([name, value]) => [name, value.sha256]),
  ]);
}
function validateNativeRecords(policy, records) {
  nativeNeed(
    records !== null &&
      typeof records === "object" &&
      !Array.isArray(records) &&
      Object.keys(records).length <= 200000,
    "Invalid native source inventory"
  );
  for (const [name, record] of Object.entries(records)) {
    nativePath(name);
    nativeRecord(record, Object.hasOwn(record, "sha256") ? "blob bytes mode sha256" : "blob bytes mode");
  }
  const expected = nativeRequirements(policy);
  for (const [name, value] of Object.entries(expected)) {
    const actual = records[name];
    nativeNeed(
      actual && actual.mode === value.mode && actual.blob === value.blob && actual.bytes === value.bytes,
      `Missing or changed full-native source: ${name}`
    );
  }
  const sql = Object.keys(records)
    .filter((name) => name.startsWith("packages/prisma/migrations/") && name.endsWith(".sql"))
    .sort();
  nativeNeed(
    JSON.stringify(sql) === JSON.stringify(Object.keys(nativeMigrationHashes(policy)).sort()),
    "Unapproved active migration set"
  );
  return nativeHash(
    nativeCanonical(
      Object.fromEntries(
        Object.entries(expected).map(([name, row]) => [
          name,
          { blob: row.blob, bytes: row.bytes, mode: row.mode },
        ])
      )
    )
  );
}
async function nativeAncestors(directory, name) {
  let current = directory;
  for (const part of name.split("/").slice(0, -1)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    nativeNeed(
      stat.isDirectory() && !stat.isSymbolicLink(),
      "Native source ancestor is not a plain directory"
    );
  }
}
async function nativeFileIdentity(directory, name, expected, budget) {
  nativePath(name);
  await nativeAncestors(directory, name);
  const filename = path.join(directory, name);
  const before = await fs.lstat(filename, { bigint: true });
  const git = createHash("sha1").update(`blob ${expected.bytes}\0`);
  const hash = createHash("sha256");
  let bytes = 0;
  const consume = (data) => {
    bytes += data.length;
    budget.bytes += data.length;
    nativeNeed(
      bytes <= expected.bytes && budget.bytes <= SOURCE_LIMIT && Date.now() <= budget.deadline,
      "Native source exceeds byte/time bound"
    );
    git.update(data);
    hash.update(data);
  };
  if (expected.mode === "120000") {
    nativeNeed(before.isSymbolicLink(), "Native source symlink was replaced");
    const target = await fs.readlink(filename, { encoding: "buffer" });
    const resolved = path.resolve(path.dirname(filename), target.toString("utf8"));
    nativeNeed(
      !path.isAbsolute(target.toString("utf8")) &&
        (resolved === directory || resolved.startsWith(`${directory}${path.sep}`)),
      "Native source link escapes root"
    );
    consume(target); // Compare the public literal link, never read its environment-file target.
  } else {
    nativeNeed(
      before.isFile() &&
        before.nlink === 1n &&
        before.size === BigInt(expected.bytes) &&
        (before.mode & 0o111n ? "100755" : "100644") === expected.mode,
      "Native source has wrong type, mode or size"
    );
    const handle = await fs.open(filename, fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat({ bigint: true });
      nativeNeed(opened.ino === before.ino && opened.dev === before.dev, "Native source changed during open");
      const buffer = Buffer.alloc(1024 * 1024);
      for (;;) {
        const read = await handle.read(buffer, 0, buffer.length, null);
        if (!read.bytesRead) break;
        consume(buffer.subarray(0, read.bytesRead));
      }
    } finally {
      await handle.close();
    }
  }
  const after = await fs.lstat(filename, { bigint: true });
  nativeNeed(
    after.ino === before.ino &&
      after.dev === before.dev &&
      after.mode === before.mode &&
      after.size === before.size &&
      after.mtimeNs === before.mtimeNs &&
      after.ctimeNs === before.ctimeNs &&
      bytes === expected.bytes,
    "Native source changed during read"
  );
  await nativeAncestors(directory, name);
  const digest = hash.digest("hex");
  nativeNeed(!expected.sha256 || digest === expected.sha256, "Native source checksum mismatch");
  return { blob: git.digest("hex"), bytes, mode: expected.mode, sha256: digest };
}
async function nativeNamespaceFiles(directory, prefix, generated = []) {
  const files = [];
  let visited = 0;
  const deadline = Date.now() + 60000;
  async function visit(name) {
    nativeNeed(++visited <= 20000 && Date.now() <= deadline, "Native namespace exceeds bound");
    nativePath(name);
    await nativeAncestors(directory, name);
    let stat;
    try {
      stat = await fs.lstat(path.join(directory, name));
    } catch (error) {
      if (error.code === "ENOENT" && name === prefix) return;
      throw error;
    }
    nativeNeed(!stat.isSymbolicLink(), "Native source namespace contains an alias");
    if (generated.includes(name)) {
      nativeNeed(
        [".yarn/cache", ".yarn/unplugged"].includes(name)
          ? stat.isDirectory()
          : stat.isFile() && stat.nlink === 1,
        "Unsupported generated dependency artifact type"
      );
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of await fs.readdir(path.join(directory, name))) await visit(`${name}/${entry}`);
    } else {
      nativeNeed(stat.isFile(), "Native namespace contains a special file");
      files.push(name);
    }
  }
  await visit(prefix);
  return files;
}
async function validateNativeBaseline(directory) {
  const policy = readNativePolicy();
  const canonicalRoot = await fs.realpath(directory);
  const budget = { bytes: 0, deadline: Date.now() + 60000 };
  const records = {};
  for (const [name, expected] of Object.entries(nativeRequirements(policy)))
    records[name] = await nativeFileIdentity(canonicalRoot, name, expected, budget);
  const sqlFiles = await nativeNamespaceFiles(canonicalRoot, "packages/prisma/migrations");
  for (const name of sqlFiles.filter((name) => name.endsWith(".sql")))
    nativeNeed(Object.hasOwn(records, name), "Unapproved active migration set");
  const sourceClosureSha256 = validateNativeRecords(policy, records);
  const schemaSha256 = records["packages/prisma/schema.prisma"].sha256;
  const expectedSchema =
    policy.reviewedSourcePorts["packages/prisma/schema.prisma"]?.sha256 ?? policy.nativeSchemaSha256;
  nativeNeed(schemaSha256 === expectedSchema, "Native schema differs from the reviewed baseline");
  const migrations = nativeMigrationHashes(policy);
  for (const [name, digest] of Object.entries(migrations))
    nativeNeed(records[name].sha256 === digest, "Native migration checksum differs");
  const dependency = policy.rootDependencyClosure;
  nativeNeed(
    dependency !== null,
    "Root dependency closure is not reviewed; native code alone cannot qualify a build"
  );
  for (const [name, expected] of Object.entries(dependency.files)) {
    const actual = await nativeFileIdentity(canonicalRoot, name, expected, budget);
    nativeNeed(actual.blob === expected.blob, "Dependency companion differs from the reviewed closure");
  }
  for (const name of await nativeNamespaceFiles(canonicalRoot, ".yarn", dependency.generatedArtifacts))
    nativeNeed(Object.hasOwn(dependency.files, name), "Unreviewed package-manager or patch companion");
  await nativeAncestors(canonicalRoot, "package.json");
  const manifestHandle = await fs.open(
    path.join(canonicalRoot, "package.json"),
    fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW
  );
  let manifest;
  try {
    const metadata = await manifestHandle.stat();
    nativeNeed(
      metadata.isFile() && metadata.size === dependency.files["package.json"].bytes,
      "Root manifest changed"
    );
    const raw = await manifestHandle.readFile();
    nativeNeed(nativeHash(raw) === dependency.files["package.json"].sha256, "Root manifest changed");
    manifest = JSON.parse(raw);
  } finally {
    await manifestHandle.close();
  }
  nativeNeed(manifest.packageManager === dependency.packageManager, "Wrong reviewed package manager");
  return {
    schemaVersion: 1,
    nativeCommit: policy.nativeCommit,
    policySha256: nativeHash(`${nativeCanonical(policy)}\n`),
    sourceClosureSha256,
    schemaSha256,
    migrationSetSha256: nativeHash(nativeCanonical(migrations)),
    migrationCount: Object.keys(migrations).length,
    rootDependencyClosureSha256: nativeHash(nativeCanonical(dependency)),
  };
}

function validateSource(directory, expectedRevision) {
  if (typeof expectedRevision !== "string" || !/^[a-f0-9]{40}$/.test(expectedRevision))
    throw new Error("Invalid source revision");
  const options = { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  const revision = execFileSync("git", ["rev-parse", "HEAD"], options).trim();
  if (revision !== expectedRevision) throw new Error("Wrong source revision");
  const changes = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all", "-z"], options);
  // A commit ID does not identify uncommitted files included by tracing or
  // copying. Do not label their bytes as the reviewed revision.
  if (changes.length) throw new Error("Uncommitted source changes; refuse runtime packaging");
  return revision;
}

async function prepare(outputPath, receiptPath) {
  if (!path.isAbsolute(outputPath) || !path.isAbsolute(receiptPath))
    throw new Error("Absolute output and verified build-receipt paths required");
  const output = path.resolve(outputPath);
  if (output === root || output.startsWith(`${root}${path.sep}`))
    throw new Error("Build context must be outside the checkout");
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
  const head = validateSource(root, receipt.source);
  const nativeBaseline = await validateNativeBaseline(root);
  const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft");
  const { retainNotices } = require("./retain-enterprise-notices.cjs");
  if (
    !["install", "generate", "app-registry", "trpc", "assets", "web-build"].every(
      (name) => receipt.results?.[name]?.exit_code === 0
    )
  )
    throw new Error("Incomplete native build evidence");
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  if (
    receipt.lock_before !== receipt.lock_after ||
    receipt.lock_after !== hash(await fs.readFile(path.join(root, "yarn.lock")))
  )
    throw new Error("Dependency lock drift");
  const origin = new URL(receipt.public_origin);
  if (origin.protocol !== "https:" || origin.origin !== receipt.public_origin)
    throw new Error("Invalid public origin");
  const standalone = path.join(root, "apps/web/.next/standalone");
  if (
    (await fs.readFile(path.join(standalone, "apps/web/.next/BUILD_ID"), "utf8")).trim() !== receipt.build_id
  )
    throw new Error("Standalone build identity mismatch");
  if (
    hash(await fs.readFile(path.join(root, "apps/web/.next/build-manifest.json"))) !== receipt.manifest_sha256
  )
    throw new Error("Build manifest changed");
  await fs.mkdir(output, { recursive: false, mode: 0o700 });
  console.log("Preparing the standalone runtime tree");
  await copyTree(standalone, path.join(output, "standalone"));
  for (const [source, target] of [
    ["apps/web/public", "apps/web/public"],
    ["apps/web/.next/static", "apps/web/.next/static"],
  ]) {
    await copyTree(path.join(root, source), path.join(output, "standalone", target));
  }
  console.log("Tracing the installed migration CLI");
  const traced = await nodeFileTrace(["node_modules/prisma/build/index.js"], {
    base: root,
    processCwd: root,
  });
  for (const file of traced.fileList) {
    if (path.isAbsolute(file) || file.split(path.sep).includes(".."))
      throw new Error("Trace escaped source root");
    const source = path.join(root, file);
    const target = path.join(output, "ops", file);
    const stat = await fs.lstat(source);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (stat.isSymbolicLink()) {
      const link = await fs.readlink(source);
      const resolved = path.resolve(path.dirname(source), link);
      if (!resolved.startsWith(`${root}${path.sep}`) || path.isAbsolute(link))
        throw new Error("External operations symlink");
      await fs.symlink(link, target);
    } else if (stat.isFile()) await fs.copyFile(source, target);
  }
  await fs.mkdir(path.join(output, "ops/packages/prisma"), { recursive: true });
  for (const file of ["schema.prisma", "migrations"]) {
    await fs.cp(path.join(root, "packages/prisma", file), path.join(output, "ops/packages/prisma", file), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }
  const cliRoot = path.join(root, "node_modules/prisma");
  const engineRoot = path.dirname(require.resolve("@prisma/engines/package.json", { paths: [cliRoot] }));
  const cliVersion = JSON.parse(await fs.readFile(path.join(cliRoot, "package.json"), "utf8")).version;
  const engineVersion = JSON.parse(await fs.readFile(path.join(engineRoot, "package.json"), "utf8")).version;
  if (cliVersion !== engineVersion || !engineRoot.startsWith(`${root}${path.sep}`))
    throw new Error("Migration engine does not match the pinned CLI");
  // Keep the installed matching schema engine; never fetch binaries on pod startup.
  await fs.cp(engineRoot, path.join(output, "ops", path.relative(root, engineRoot)), {
    recursive: true,
    verbatimSymlinks: true,
  });
  await fs.mkdir(path.join(output, "scripts"), { recursive: true });
  await fs.copyFile(
    path.join(root, "scripts/enterprise-runtime-entrypoint.cjs"),
    path.join(output, "scripts/enterprise-runtime-entrypoint.cjs")
  );
  await fs.copyFile(
    path.join(root, "scripts/check-enterprise-migration.sql"),
    path.join(output, "scripts/check-enterprise-migration.sql")
  );
  await fs.copyFile(path.join(root, "Dockerfile.enterprise-preview"), path.join(output, "Dockerfile"));
  const noticeCount = await retainNotices(output);
  const manifest = {
    schemaVersion: 1,
    nativeBaseline,
    sourceSha: head,
    publicOrigin: receipt.public_origin,
    buildId: receipt.build_id,
    buildManifestSha256: receipt.manifest_sha256,
    lockSha256: receipt.lock_after,
    entrypointSha256: hash(await fs.readFile(path.join(output, "scripts/enterprise-runtime-entrypoint.cjs"))),
    migrationPreflightSha256: hash(
      await fs.readFile(path.join(output, "scripts/check-enterprise-migration.sql"))
    ),
    dockerfileSha256: hash(await fs.readFile(path.join(output, "Dockerfile"))),
    migrationEngineVersion: engineVersion,
    operationsTraceFiles: traced.fileList.size,
    copiedLicenseNotices: noticeCount,
    traceWarnings: Array.from(traced.warnings, (warning) => warning.message),
  };
  await validateTree(output);
  // Do not write a completion manifest for an invalid or changed preparation.
  validateSource(root, head);
  nativeNeed(
    nativeCanonical(await validateNativeBaseline(root)) === nativeCanonical(nativeBaseline),
    "Native baseline changed during preparation"
  );
  await fs.writeFile(path.join(output, "enterprise-build.json"), JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      output,
      sourceSha: head,
      publicOrigin: manifest.publicOrigin,
      buildId: manifest.buildId,
      operationsTraceFiles: manifest.operationsTraceFiles,
      traceWarningCount: manifest.traceWarnings.length,
      copiedLicenseNotices: noticeCount,
    })
  );
}
async function copyTree(source, destination) {
  await fs.mkdir(destination, { recursive: true });
  await new Promise((resolve, reject) => {
    const pack = spawn("tar", ["-C", source, "-cf", "-", "."], { stdio: ["ignore", "pipe", "pipe"] });
    const unpack = spawn("tar", ["-C", destination, "-xf", "-", "--no-same-owner"], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    const failures = [];
    let complete = 0;
    const failed = (error) => {
      pack.kill();
      unpack.kill();
      reject(error);
    };
    for (const child of [pack, unpack]) {
      child.on("error", failed);
      child.stderr.on("data", (data) => {
        if (failures.length < 5) failures.push(data.toString().slice(0, 300));
      });
      child.on("exit", (code) => {
        if (code !== 0) {
          failed(new Error("Runtime tree copy failed: " + failures.join(" ")));
          return;
        }
        complete++;
        if (complete === 2) resolve();
      });
    }
    pack.stdout.pipe(unpack.stdin);
    unpack.stdin.on("error", failed);
  });
}
async function validateTree(directory, base = directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if ([".git", ".env", ".env.local", ".env.production", ".env.production.local"].includes(entry.name))
      throw new Error("Environment or Git data in runtime context");
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = await fs.readlink(file);
      const resolved = path.resolve(directory, target);
      if (path.isAbsolute(target) || !resolved.startsWith(`${base}${path.sep}`))
        throw new Error("Runtime symlink escapes context");
      await fs.stat(file);
    } else if (entry.isDirectory()) await validateTree(file, base);
    else if (!entry.isFile()) throw new Error("Unexpected special runtime file");
  }
}
if (require.main === module)
  (process.argv.length === 3 && process.argv[2] === "--check-native-baseline"
    ? validateNativeBaseline(root).then(() =>
        console.log("Full native source and reviewed dependency closure verified")
      )
    : prepare(process.argv[2] || "", process.argv[3] || "")
  ).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = {
  prepare,
  validateSource,
  validateTree,
  parseNativePolicy,
  validateNativeRecords,
  validateNativeBaseline,
};
