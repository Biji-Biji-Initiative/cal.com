// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const names = ["LOGO", "LOGO_DARK", "LOGO_ICON"];
const defaults = {
  LOGO: "/calcom-logo-white-word.svg",
  LOGO_DARK: "/cal-logo-word-black.svg",
  LOGO_ICON: "/cal-com-icon-white.svg",
};

function branding(env) {
  const filename = path.join(root, "packages/lib/constants.ts");
  const parsed = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const declarations = parsed.statements.filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (entry) => ts.isIdentifier(entry.name) && names.includes(entry.name.text)
      )
  );
  assert.equal(declarations.length, 3, "All three actual source declarations must be exercised");
  const emitted = ts.transpileModule(declarations.map((node) => node.getText(parsed)).join("\n"), {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
  });
  assert.deepEqual(emitted.diagnostics, []);
  const exports = {};
  // Execute the actual independent initializers, not a second branding implementation.
  // Other constants and their unrelated runtime dependencies are outside this contract.
  new Function("exports", "process", emitted.outputText)(exports, { env });
  return Object.fromEntries(names.map((name) => [name, exports[name]]));
}

test("unconfigured branding retains every bundled upstream default", () => {
  assert.deepEqual(branding({}), defaults);
  for (const image of Object.values(defaults))
    assert.ok(fs.existsSync(path.join(root, "apps/web/public", image)));
});
for (const name of names) {
  test(`retained build-time override is independent for ${name}`, () => {
    const value = `/custom-${name.toLowerCase()}.svg`;
    assert.deepEqual(branding({ [`NEXT_PUBLIC_APP_${name}`]: value }), { ...defaults, [name]: value });
  });
}
test("empty branding options use safe existing assets", () => {
  assert.deepEqual(
    branding(Object.fromEntries(names.map((name) => [`NEXT_PUBLIC_APP_${name}`, ""]))),
    defaults
  );
});
test("existing explicit public image URLs retain their exact value", () => {
  const value = "https://assets.example.test/brand.svg";
  assert.equal(branding({ NEXT_PUBLIC_APP_LOGO: value }).LOGO, value);
});
test("example configuration documents the three build-time names without enabling absent assets", () => {
  const example = fs.readFileSync(path.join(root, ".env.example"), "utf8").split("\n");
  for (const name of names) assert.ok(example.includes(`NEXT_PUBLIC_APP_${name}=`));
});
test("real historical credential filenames are ignored but their examples are not", () => {
  const secrets = [
    "calcom.env",
    "calcom-k8s.env",
    "env-vars-production.yaml",
    "env-vars-api-v2.yaml",
    "google-credentials.json",
    ".deploy_api_v2-fixture.log",
    "scratch/google-credentials.json",
  ];
  const examples = [
    ".env.example",
    ".env.appStore.example",
    "calcom.env.example",
    "calcom-k8s.env.example",
    "env-vars-production.example.yaml",
    "env-vars-api-v2.example.yaml",
    "google-credentials.example.json",
  ];
  const result = spawnSync("git", ["check-ignore", "--no-index", "-z", "--stdin"], {
    cwd: root,
    input: [...secrets, ...examples].join("\0") + "\0",
    encoding: "utf8",
    timeout: 10000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.split("\0").filter(Boolean).sort(), secrets.sort());
});

test("example configuration does not ship a usable shared cron credential", () => {
  const lines = fs.readFileSync(path.join(root, ".env.example"), "utf8").split("\n");
  assert.deepEqual(
    lines.filter((line) => line.startsWith("CRON_API_KEY=")),
    ["CRON_API_KEY="]
  );
});
