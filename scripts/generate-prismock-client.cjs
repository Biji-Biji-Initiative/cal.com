// SPDX-License-Identifier: MIT
// Prismock loads @prisma/client even when its explicit-DMMF factory is used.
// Generate that compatibility client from the SAME schema; never borrow an old
// node_modules client or replace the schema/data model with a test invention.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const schema = fs.readFileSync(path.join(root, "packages/prisma/schema.prisma"), "utf8");
const declaration = /^generator client \{[^}]*\}/gm;
if (Array.from(schema.matchAll(declaration)).length !== 1)
  throw new Error("Expected exactly one client generator");
// The generator resolves its package relative to the schema. Use an ephemeral
// generated cache inside this candidate, so it finds the pinned installed client.
const cache = path.join(root, "node_modules/.cache");
fs.mkdirSync(cache, { recursive: true });
const directory = fs.mkdtempSync(path.join(cache, "cal-prismock-schema-"));
const destination = path.join(root, "node_modules/.prisma/client");
for (const location of [path.dirname(destination), destination]) {
  if (fs.existsSync(location) && fs.lstatSync(location).isSymbolicLink())
    throw new Error("Refusing a linked output directory");
}
try {
  const temporarySchema = path.join(directory, "schema.prisma");
  fs.writeFileSync(
    temporarySchema,
    schema.replace(
      declaration,
      `generator client {\n  provider = "prisma-client-js"\n  previewFeatures = ["views"]\n  output = ${JSON.stringify(destination)}\n  engineType = "client"\n}`
    )
  );
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules/prisma/build/index.js"),
      "generate",
      "--schema",
      temporarySchema,
      "--generator",
      "client",
    ],
    {
      cwd: directory,
      env: {
        ...process.env,
        PRISMA_GENERATE_SKIP_AUTOINSTALL: "true",
        DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture",
        DATABASE_DIRECT_URL: "postgresql://fixture:fixture@127.0.0.1:1/fixture",
      },
      stdio: "inherit",
      timeout: 120000,
    }
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
