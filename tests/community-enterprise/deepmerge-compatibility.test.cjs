// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const root = path.resolve(__dirname, "../..");
const fromRoot = createRequire(path.join(root, "package.json"));
const fromPrisma = createRequire(fromRoot.resolve("prisma/package.json"));
const configModule = fromPrisma.resolve("@prisma/config");
const fromConfig = createRequire(configModule);
const mergeModule = fromConfig.resolve("deepmerge-ts");
const mergePackage = path.resolve(path.dirname(mergeModule), "..");
const { loadConfigFromFile } = fromPrisma("@prisma/config");
const { deepmerge } = fromConfig("deepmerge-ts");

function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cal-deepmerge-"));
  return Promise.resolve()
    .then(() => run(directory))
    .finally(() => fs.rmSync(directory, { recursive: true, force: true }));
}

function writeConfiguration(directory, body) {
  fs.writeFileSync(
    path.join(directory, "prisma.config.cjs"),
    `const { defineConfig } = require(${JSON.stringify(configModule)});\n${body}\n`
  );
}

test("Prisma's actual dependency resolves the qualified deepmerge release", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(mergePackage, "package.json"), "utf8"));
  assert.equal(manifest.name, "deepmerge-ts");
  assert.equal(manifest.version, "8.0.2");
});

test("the real Prisma/c12 caller loads defaults when no configuration exists", async () => {
  await fixture(async (directory) => {
    const result = await loadConfigFromFile({ configRoot: directory });
    assert.equal(result.error, undefined);
    assert.equal(result.resolvedPath, null);
    assert.equal(typeof result.config, "object");
  });
});

test("the real Prisma/c12 caller preserves nested configuration and resolves its paths", async () => {
  await fixture(async (directory) => {
    writeConfiguration(
      directory,
      'module.exports = defineConfig({ schema: "./schema.prisma", migrations: { path: "./migrations", seed: "node synthetic-seed.cjs" }, experimental: { externalTables: true }, tables: { external: ["public.synthetic_events"] } });'
    );
    const result = await loadConfigFromFile({ configRoot: directory });
    assert.equal(result.error, undefined);
    assert.equal(result.resolvedPath, path.join(directory, "prisma.config.cjs"));
    assert.equal(result.config.schema, path.join(directory, "schema.prisma"));
    assert.equal(result.config.migrations.path, path.join(directory, "migrations"));
    assert.equal(result.config.migrations.seed, "node synthetic-seed.cjs");
    assert.deepEqual(result.config.tables.external, ["public.synthetic_events"]);
    assert.equal(result.config.experimental.externalTables, true);
  });
});

test("the real Prisma/c12 caller rejects an invalid native configuration export", async () => {
  await fixture(async (directory) => {
    writeConfiguration(directory, "module.exports = null;");
    const result = await loadConfigFromFile({ configRoot: directory });
    assert.equal(result.error?._tag, "ConfigLoadError");
    assert.equal(result.config, undefined);
  });
});

test("the installed merger preserves inputs and its documented record, array and Map behavior", () => {
  const first = { nested: { first: true }, items: [1] };
  const second = { nested: { second: true }, items: [2] };
  assert.deepEqual(deepmerge(first, second), {
    nested: { first: true, second: true },
    items: [1, 2],
  });
  assert.deepEqual(first, { nested: { first: true }, items: [1] });
  assert.deepEqual(second, { nested: { second: true }, items: [2] });
  const maps = deepmerge(new Map([["shared", { first: true }]]), new Map([["shared", { second: true }]]));
  assert.deepEqual(maps.get("shared"), { first: true, second: true });
});

test("the installed native merger terminates safely on the reported recursive input", () => {
  const script = `
    const assert = require("node:assert/strict");
    const { deepmerge } = require(${JSON.stringify(mergeModule)});
    const first = { first: true }; first.self = first;
    const second = { second: true }; second.self = second;
    const result = deepmerge(first, second);
    assert.equal(result.first, true);
    assert.equal(result.second, true);
    assert.equal(result.self.first, true);
    assert.equal(result.self.second, true);
  `;
  const child = spawnSync(process.execPath, ["--eval", script], {
    encoding: "utf8",
    timeout: 2500,
    maxBuffer: 64 * 1024,
    env: { PATH: process.env.PATH, LANG: "C.UTF-8" },
  });
  assert.equal(child.error, undefined, "recursive-input child must finish within its deadline");
  assert.equal(child.status, 0, child.stderr);
});

test("actual installed Prisma and deepmerge declarations pass strict TypeScript without library skipping", async () => {
  await fixture(async (directory) => {
    fs.writeFileSync(
      path.join(directory, "caller.cts"),
      `import { defineConfig, loadConfigFromFile } from "@prisma/config";
import type { PrismaConfig } from "@prisma/config";
import { deepmerge } from "deepmerge-ts";
const input: PrismaConfig = { schema: "./schema.prisma", migrations: { path: "./migrations" } };
const config = defineConfig(input);
const merged: { first: boolean; second: boolean } = deepmerge({ first: true }, { second: true });
async function caller(configRoot: string): Promise<string | undefined> {
  const result = await loadConfigFromFile({ configRoot });
  if (result.error) return undefined;
  return result.config.schema;
}
void config; void merged; void caller;
`
    );
    fs.writeFileSync(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          baseUrl: path.join(root, "node_modules"),
          paths: {
            "@prisma/config": [path.resolve(path.dirname(configModule), "..")],
            "deepmerge-ts": [mergePackage],
          },
          types: ["node"],
          typeRoots: [path.join(root, "node_modules/@types")],
        },
        files: ["caller.cts"],
      })
    );
    const child = spawnSync(
      process.execPath,
      [
        "--max-old-space-size=1536",
        fromRoot.resolve("typescript/lib/tsc.js"),
        "--project",
        path.join(directory, "tsconfig.json"),
        "--pretty",
        "false",
      ],
      {
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH, LANG: "C.UTF-8" },
      }
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stdout + child.stderr);
  });
});
