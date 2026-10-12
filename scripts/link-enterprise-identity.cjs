// SPDX-License-Identifier: MIT
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { Pool } = require("pg");

function parseArguments(args) {
  const [mode, ...flags] = args;
  if (!["plan", "apply"].includes(mode) || flags.length % 2)
    throw new Error("Use plan or apply with explicit named paths and database");
  const result = { mode };
  const allowed =
    mode === "plan" ? ["--request", "--out", "--database"] : ["--request", "--plan", "--database"];
  for (let i = 0; i < flags.length; i += 2) {
    const key = flags[i];
    if (!allowed.includes(key) || result[key] || !flags[i + 1] || flags[i + 1].startsWith("--"))
      throw new Error("Invalid or duplicate option");
    result[key] = flags[i + 1];
  }
  if (!allowed.every((key) => result[key])) throw new Error("Missing required option");
  return result;
}
function readJson(file) {
  const descriptor = fs.openSync(path.resolve(file), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 65536) throw new Error("Input must be a bounded regular JSON file");
    return JSON.parse(fs.readFileSync(descriptor, "utf8"));
  } finally {
    fs.closeSync(descriptor);
  }
}
function databaseFingerprint(url, identity) {
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new Error("Expected PostgreSQL URL");
  return createHash("sha256")
    .update(
      JSON.stringify({
        host: parsed.hostname,
        port: parsed.port || "5432",
        path: parsed.pathname,
        socket: parsed.searchParams.get("host"),
        database: identity.database,
        role: identity.role,
        address: identity.address,
        serverPort: identity.serverPort,
      })
    )
    .digest("hex");
}

async function main(args = process.argv.slice(2), env = process.env) {
  const options = parseArguments(args);
  const input = readJson(options["--request"]);
  const reviewed = options.mode === "apply" ? readJson(options["--plan"]) : null;
  if (!env.DATABASE_URL || !env.CAL_AUTHENTIK_ISSUER || !env.NEXT_PUBLIC_WEBAPP_URL)
    throw new Error("Explicit database, issuer and application origin environment is required");
  // Use the repository's installed compiler/runtime; no .env loader, shell
  // execution, provider credentials or automatic dependency installation.
  require("ts-node").register({
    skipProject: true,
    transpileOnly: true,
    compilerOptions: {
      module: "CommonJS",
      moduleResolution: "node",
      target: "ES2022",
      esModuleInterop: true,
    },
  });
  const { PrismaClient } = require("../packages/prisma/client");
  const { PrismaPg } = require("@prisma/adapter-pg");
  const {
    AuditedIdentityLinkService,
  } = require("../packages/features/community-enterprise/identity/AuditedIdentityLinkService");
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const identity = (
      await pool.query(
        'SELECT current_database() AS database, current_user AS role, inet_server_addr()::text AS address, inet_server_port() AS "serverPort"'
      )
    ).rows[0];
    if (identity.database !== options["--database"])
      throw new Error("Connected database does not match the operator's expected database");
    const service = new AuditedIdentityLinkService(prisma, {
      issuer: env.CAL_AUTHENTIK_ISSUER,
      webOrigin: env.NEXT_PUBLIC_WEBAPP_URL,
      databaseFingerprint: databaseFingerprint(env.DATABASE_URL, identity),
    });
    if (options.mode === "plan") {
      const plan = await service.plan(input);
      fs.writeFileSync(path.resolve(options["--out"]), JSON.stringify(plan, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      console.log(
        JSON.stringify({
          status: "planned",
          operationId: input.operationId,
          count: plan.rows.length,
          planHash: plan.planHash,
          expiresAt: new Date(plan.expiresAt).toISOString(),
        })
      );
    } else console.log(JSON.stringify(await service.apply(input, reviewed)));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}
if (require.main === module)
  main().catch(() => {
    // Never serialize Prisma/provider exceptions: they may contain URLs or query values.
    console.error(
      JSON.stringify({
        error:
          "Identity operation refused; verify the reviewed target, active operator, mappings and unexpired plan.",
      })
    );
    process.exitCode = 1;
  });
module.exports = { main, parseArguments, readJson, databaseFingerprint };
