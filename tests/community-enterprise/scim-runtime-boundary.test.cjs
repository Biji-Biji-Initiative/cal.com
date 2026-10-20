// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { inventory } = require("../../scripts/inventory-scim-runtime-boundary.cjs");

const root = path.resolve(__dirname, "../..");
const identityRoot = "packages/features/community-enterprise/identity";
const contracts = ["ScimProvisioningContract.ts", "ScimRequestContract.ts"].map(
  (name) => `${identityRoot}/${name}`
);
const runtimeScimFiles = [
  "ScimGroupMembershipService.ts",
  "ScimIdentityService.ts",
  "ScimMembershipProvenance.ts",
].map((name) => `${identityRoot}/${name}`);
const report = inventory(root);

function fixture(overrides) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cal-scim-inventory-fixture-"));
  try {
    fs.mkdirSync(path.join(scratch, identityRoot), { recursive: true });
    fs.mkdirSync(path.join(scratch, "apps/api/v2/src"), { recursive: true });
    const sources = Object.fromEntries(
      contracts.map((file) => [file, fs.readFileSync(path.join(root, file), "utf8")])
    );
    for (const [file, source] of Object.entries({ ...sources, ...overrides })) {
      fs.writeFileSync(path.join(scratch, file), source);
    }
    return inventory(scratch);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

test("SCIM contract is present and remains write-free", () => {
  assert.equal(
    report.contract.file,
    "packages/features/community-enterprise/identity/ScimProvisioningContract.ts"
  );
  assert.equal(report.contract.hasUserAndGroupSchemas, true);
  assert.equal(report.contract.hasReconciliationPlan, true);
  assert.equal(report.contract.directDatabaseWrites, false);
  assert.equal(report.contract.directHttpCalls, false);
  assert.equal(report.contract.routeDecorators, false);
});
test("both exact known contracts pass source-only checks, including parseScimRequest", () => {
  assert.deepEqual(
    report.contracts.map(({ file }) => file),
    contracts
  );
  for (const contract of report.contracts) {
    assert.equal(contract.directDatabaseWrites, false);
    assert.equal(contract.directHttpCalls, false);
    assert.equal(contract.routeDecorators, false);
    assert.equal(contract.unexpectedModuleCode, false);
    assert.equal(contract.sourceOnly, true);
  }
});
test("an unknown SCIM identity file remains a runtime marker even without SCIM body text", () => {
  const file = `${identityRoot}/UnexpectedScimAdapter.ts`;
  const result = fixture({ [file]: "export function dispatch() { return null; }" });
  assert.deepEqual(result.identityRuntimeScimMarkers, [file]);
});
for (const file of contracts) {
  for (const [label, code, field] of [
    ["database write", "export function persist() { return db.user.update({}); }", "directDatabaseWrites"],
    [
      "tagged raw write",
      "export function persistRaw() { return db.$executeRaw`UPDATE memberships SET active = false`; }",
      "directDatabaseWrites",
    ],
    [
      "HTTP call",
      "export function dispatch() { return fetch('https://directory.invalid'); }",
      "directHttpCalls",
    ],
    ["route decorator", "@Controller('scim') export class DirectoryController {}", "routeDecorators"],
    ["handler export", "export function GET() { return null; }", "routeDecorators"],
    ["top-level execution", "registerDirectory();", "unexpectedModuleCode"],
    ["executable initializer", "export const runtime = startDirectory();", "unexpectedModuleCode"],
    ["runtime import", "import './runtime';", "unexpectedModuleCode"],
    ["invalid source", "export const broken = ;", "unexpectedModuleCode"],
  ]) {
    test(`${path.basename(file)} with ${label} cannot be hidden as a source contract`, () => {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      const result = fixture({ [file]: `${source}\n${code}\n` });
      const contract = result.contracts.find((entry) => entry.file === file);
      assert.equal(contract[field], true);
      assert.equal(contract.sourceOnly, false);
      assert.deepEqual(result.identityRuntimeScimMarkers, [file]);
      if (field === "directHttpCalls") assert.deepEqual(result.identityRuntimeDirectHttp, [file]);
    });
  }
}

test("SCIM database services are inventoried while direct API and IdP HTTP dispatch remain absent", () => {
  assert.deepEqual(report.apiScimRouteCandidates, []);
  assert.deepEqual(report.identityRuntimeScimMarkers, runtimeScimFiles);
  assert.deepEqual(report.identityRuntimeDirectHttp, []);
});

test("local session checks are recorded separately from IdP revocation", () => {
  assert.ok(
    report.localSessionRevocationMarkers.includes(
      "packages/features/community-enterprise/identity/AuthentikIdentity.ts"
    )
  );
  assert.deepEqual(report.identityRuntimeScimMarkers, runtimeScimFiles);
});
