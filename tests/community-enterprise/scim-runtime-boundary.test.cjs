// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { inventory } = require("../../scripts/inventory-scim-runtime-boundary.cjs");

const report = inventory(path.resolve(__dirname, "../.."));

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

test("tracked API v2 and identity source contain no direct SCIM adapter", () => {
  assert.deepEqual(report.apiScimRouteCandidates, []);
  assert.deepEqual(report.identityRuntimeScimMarkers, []);
  assert.deepEqual(report.identityRuntimeDirectHttp, []);
});

test("local session checks are recorded separately from IdP revocation", () => {
  assert.ok(
    report.localSessionRevocationMarkers.includes(
      "packages/features/community-enterprise/identity/AuthentikIdentity.ts"
    )
  );
  assert.deepEqual(report.identityRuntimeScimMarkers, []);
});
