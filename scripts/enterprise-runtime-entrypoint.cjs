// SPDX-License-Identifier: MIT
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

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

function main(args = process.argv.slice(2), env = process.env) {
  const root = path.resolve(__dirname, "..");
  const receipt = JSON.parse(fs.readFileSync(path.join(root, "enterprise-build.json"), "utf8"));
  const mode = args[0] || "web";
  console.log(JSON.stringify(validateRuntime(env, receipt, mode)));
  const command =
    mode === "web"
      ? [path.join(root, "apps/web/server.js")]
      : [
          path.join(root, "ops/node_modules/prisma/build/index.js"),
          "migrate",
          "deploy",
          "--schema",
          path.join(root, "ops/packages/prisma/schema.prisma"),
        ];
  if (args.length > 1) throw new Error("Unexpected runtime arguments");
  const child = spawn(process.execPath, command, {
    cwd: mode === "web" ? path.join(root, "apps/web") : path.join(root, "ops"),
    env,
    stdio: "inherit",
  });
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
  child.on("error", () => {
    console.error("Runtime process could not start");
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
if (require.main === module) {
  try {
    main();
  } catch {
    console.error(
      "Enterprise runtime preflight refused; check the exact build, origin, operation and runtime configuration"
    );
    process.exitCode = 1;
  }
}
module.exports = { validateRuntime };
