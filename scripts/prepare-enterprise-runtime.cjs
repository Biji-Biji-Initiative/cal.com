// SPDX-License-Identifier: MIT
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { nodeFileTrace } = require("next/dist/compiled/@vercel/nft");
const { retainNotices } = require("./retain-enterprise-notices.cjs");
const root = path.resolve(__dirname, "..");

async function prepare(outputPath, receiptPath) {
  if (!path.isAbsolute(outputPath) || !path.isAbsolute(receiptPath))
    throw new Error("Absolute output and verified build-receipt paths required");
  const output = path.resolve(outputPath);
  if (output === root || output.startsWith(`${root}${path.sep}`))
    throw new Error("Build context must be outside the checkout");
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (head !== receipt.source || !/^[a-f0-9]{40}$/.test(head)) throw new Error("Wrong source revision");
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
  await fs.writeFile(path.join(output, "enterprise-build.json"), JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
  });
  await validateTree(output);
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
  prepare(process.argv[2] || "", process.argv[3] || "").catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { validateTree };
