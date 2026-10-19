// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const root = path.resolve(__dirname, "../..");
const fromRoot = createRequire(path.join(root, "package.json"));
const utilModule = fromRoot.resolve("@todesktop/client-util");
const coreModule = fromRoot.resolve("@todesktop/client-core");
const fromUtil = createRequire(utilModule);
const nanoManifestPath = fromUtil.resolve("nanoid/package.json");
const nanoPackage = path.dirname(nanoManifestPath);
const utilURL = pathToFileURL(utilModule).href;
const coreURL = pathToFileURL(coreModule).href;

function child(source, flags = []) {
  const result = spawnSync(process.execPath, [...flags, "--input-type=module", "--eval", source], {
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 256 * 1024,
    env: { PATH: process.env.PATH, LANG: "C.UTF-8" },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

test("the reviewed ToDesktop and Trigger parents select the supported Nanoid bridge", () => {
  const manifest = JSON.parse(fs.readFileSync(nanoManifestPath, "utf8"));
  const parent = JSON.parse(fs.readFileSync(path.join(path.dirname(utilModule), "package.json"), "utf8"));
  assert.equal(manifest.name, "nanoid");
  assert.equal(manifest.version, "3.3.20");
  assert.equal(parent.version, "1.4.0");
  assert.equal(
    parent.dependencies.nanoid,
    "^4.0.2",
    "the explicit major exception must not rewrite upstream metadata"
  );
  assert.equal(fromRoot("nanoid/package.json").version, "3.3.20");
  const fromFeatures = createRequire(path.join(root, "packages/features/package.json"));
  const fromSdk = createRequire(fromFeatures.resolve("@trigger.dev/sdk"));
  const coreManifest = fromSdk.resolve("@trigger.dev/core/package.json");
  const core = JSON.parse(fs.readFileSync(coreManifest, "utf8"));
  assert.equal(core.version, "4.7.4");
  assert.equal(core.dependencies.nanoid, "3.3.18", "upstream's exact dependency metadata remains unchanged");
  assert.equal(createRequire(coreManifest)("nanoid/package.json").version, "3.3.20");
});

test("the actual parent dependency exposes synchronous CJS and ESM identifiers", async () => {
  const cjs = fromUtil("nanoid");
  const esm = await import(pathToFileURL(path.join(nanoPackage, "index.js")).href);
  for (const api of [cjs, esm]) {
    const ids = Array.from({ length: 64 }, () => api.nanoid());
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{21}$/.test(id)));
    assert.match(api.nanoid(10), /^[A-Za-z0-9_-]{10}$/);
  }
});

test("the real Cal ToDesktop core import remains safe without a window during SSR", () => {
  child(`
    import assert from "node:assert/strict";
    assert.equal(typeof window, "undefined");
    const core = await import(${JSON.stringify(coreURL)});
    assert.equal(core.platform.todesktop.isDesktopApp(), false);
  `);
});

// Only the synthetic host endpoint is supplied. The installed utility and its
// native Nanoid import execute unchanged, including ID creation and removal.
const subscriptions = `
  import assert from "node:assert/strict";
  const active = new Map();
  const removals = [];
  globalThis.window = { todesktop: {
    on(name, callback, id) {
      assert.match(id, /^[A-Za-z0-9_-]{21}$/);
      assert.equal(active.has(name + ":" + id), false);
      active.set(name + ":" + id, { name, callback, id });
    },
    off(name, callback, id) {
      const key = name + ":" + id;
      assert.equal(active.get(key)?.callback, callback);
      assert.equal(active.delete(key), true);
      removals.push(id);
    }
  } };
  const util = await import(${JSON.stringify(utilURL)});
  let received = 0;
  const callback = () => received++;
  const mapping = { ready: "fixture-ready", changed: "fixture-changed" };
  const first = await util.setupAddEventListener(mapping)("ready", callback);
  const second = await util.setupAddEventListener(mapping)("ready", callback);
  const wildcard = await util.setupAddEventListener(mapping)("*", callback);
  const typed = await util.typedSetupAddEventListener(mapping)("changed", callback);
  const entries = [...active.values()];
  assert.equal(entries.length, 5);
  assert.equal(new Set(entries.map(({ id }) => id)).size, 4);
  for (const entry of entries) entry.callback();
  assert.equal(received, 5);
  await first(); await second(); await wildcard(); await typed();
  assert.equal(active.size, 0);
  assert.equal(removals.length, 5);
  assert.equal(new Set(removals).size, 4);
  delete globalThis.window;
`;

test("the installed parent pairs single, wildcard and typed subscription IDs with removal", () => {
  child(subscriptions);
});

test("native browser-condition resolution and real parent subscriptions use Web Crypto", () => {
  child(
    `
    import { createRequire } from "node:module";
    import assert from "node:assert/strict";
    const fromUtil = createRequire(${JSON.stringify(utilURL)});
    assert.match(fromUtil.resolve("nanoid"), /index\\.browser\\.js$/);
    assert.equal(typeof globalThis.crypto.getRandomValues, "function");
    ${subscriptions.replace('import assert from "node:assert/strict";', "")}
  `,
    ["--conditions=browser"]
  );
});

// ToDesktop does not expose Nanoid in its declarations. Check the changed
// package's actual conditional entrypoints without suppressing library errors.
test("real parent-selected Nanoid CJS and ESM declarations pass strict TypeScript", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cal-nanoid-types-"));
  try {
    fs.writeFileSync(
      path.join(directory, "caller.cts"),
      `
      import { nanoid } from ${JSON.stringify(fromUtil.resolve("nanoid"))};
      const id: string = nanoid(21); void id;
    `
    );
    fs.writeFileSync(
      path.join(directory, "caller.mts"),
      `
      import { nanoid } from ${JSON.stringify(path.join(nanoPackage, "index.js"))};
      const id: string = nanoid();
      const sized: string = nanoid(10);
      void id; void sized;
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
          types: ["node"],
          typeRoots: [path.join(root, "node_modules/@types")],
        },
        files: ["caller.cts", "caller.mts"],
      })
    );
    const result = spawnSync(
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
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
