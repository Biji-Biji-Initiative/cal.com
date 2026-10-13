// SPDX-License-Identifier: MIT
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");

function validateRuntime(env, receipt, mode) {
  if (!["web", "migrate"].includes(mode)) throw new Error("Unknown runtime operation");
  if (receipt.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(receipt.sourceSha))
    throw new Error("Invalid build identity");
  const origin = new URL(env.NEXT_PUBLIC_WEBAPP_URL || "");
  if (origin.origin !== receipt.publicOrigin || origin.href !== `${origin.origin}/`)
    throw new Error("Runtime origin differs from the built origin");
  if (origin.protocol !== "https:") throw new Error("An HTTPS public origin is required");
  const database = new URL(env.DATABASE_URL || "");
  if (!["postgres:", "postgresql:"].includes(database.protocol) || !database.hostname)
    throw new Error("Explicit PostgreSQL connection required");
  if (mode === "web") {
    if (env.NEXTAUTH_URL !== `${receipt.publicOrigin}/api/auth`)
      throw new Error("Native callback origin mismatch");
    if (
      !env.NEXTAUTH_SECRET ||
      env.NEXTAUTH_SECRET.length < 32 ||
      !env.CALENDSO_ENCRYPTION_KEY ||
      env.CALENDSO_ENCRYPTION_KEY.length < 32
    )
      throw new Error("Runtime session and encryption keys are required");
    if (
      env.CAL_AUTHENTIK_ENABLED !== "true" ||
      env.CAL_AUTHENTIK_ONLY !== "true" ||
      !env.CAL_AUTHENTIK_ISSUER ||
      !env.CAL_AUTHENTIK_CLIENT_ID ||
      !env.CAL_AUTHENTIK_CLIENT_SECRET
    )
      throw new Error("Native staff identity must be configured before web startup");
  } else {
    if (env.DATABASE_DIRECT_URL !== env.DATABASE_URL)
      throw new Error("Migration must use one explicit database endpoint");
    if (
      !env.CAL_ENTERPRISE_EXPECTED_DATABASE ||
      decodeURIComponent(database.pathname.slice(1)) !== env.CAL_ENTERPRISE_EXPECTED_DATABASE
    )
      throw new Error("Explicit operation database does not match the connection");
  }
  return { sourceSha: receipt.sourceSha, publicOrigin: receipt.publicOrigin, operation: mode };
}

async function runCommand(root, env, command, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, command, {
      cwd: path.join(root, "ops"),
      env,
      stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    });
    const handlers = new Map();
    for (const signal of ["SIGTERM", "SIGINT"]) {
      const handler = () => child.kill(signal);
      handlers.set(signal, handler);
      process.on(signal, handler);
    }
    const finish = (code) => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
      resolve(code);
    };
    child.once("error", () => finish(1));
    child.once("exit", (code) => finish(code ?? 1));
    if (input !== undefined) {
      child.stdin.on("error", () => {
        child.kill();
        finish(1);
      });
      child.stdin.end(input);
    }
  });
}

async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length > 1) throw new Error("Unexpected runtime arguments");
  const root = path.resolve(__dirname, "..");
  const receipt = JSON.parse(fs.readFileSync(path.join(root, "enterprise-build.json"), "utf8"));
  const mode = args[0] || "web";
  console.log(JSON.stringify(validateRuntime(env, receipt, mode)));
  if (mode === "web") {
    // The web process does not run migrations or inspect retired data.
    const child = spawn(process.execPath, [path.join(root, "apps/web/server.js")], {
      cwd: path.join(root, "apps/web"),
      env,
      stdio: "inherit",
    });
    for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
    child.on("error", () => {
      process.exitCode = 1;
    });
    child.on("exit", (code) => {
      process.exitCode = code ?? 1;
    });
    return;
  }
  const preflight = fs.readFileSync(path.join(root, "scripts/check-enterprise-migration.sql"));
  if (createHash("sha256").update(preflight).digest("hex") !== receipt.migrationPreflightSha256) {
    throw new Error("Migration preflight does not match the built artifact");
  }
  const cli = path.join(root, "ops/node_modules/prisma/build/index.js");
  const schema = path.join(root, "ops/packages/prisma/schema.prisma");
  const admission = await runCommand(
    root,
    env,
    [cli, "db", "execute", "--schema", schema, "--stdin"],
    preflight
  );
  if (admission !== 0) {
    console.error("Migration refused: legacy-data preflight failed; no migration command was started");
    process.exitCode = admission;
    return;
  }
  process.exitCode = await runCommand(root, env, [cli, "migrate", "deploy", "--schema", schema]);
}
if (require.main === module) {
  main().catch(() => {
    console.error(
      "Enterprise runtime preflight refused; check the exact build, origin, operation and runtime configuration"
    );
    process.exitCode = 1;
  });
}
module.exports = { validateRuntime };
