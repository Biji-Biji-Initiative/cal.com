// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");

test("API v2 route inventory covers permission-decorated methods and direct JWT readers", () => {
  const output = execFileSync(process.execPath, ["scripts/inventory-enterprise-api-routes.cjs"], {
    cwd: root,
    encoding: "utf8",
  });
  const inventory = JSON.parse(output);
  assert.equal(inventory.schemaVersion, 1);
  assert.ok(inventory.controllerFiles > 0);
  assert.ok(inventory.routeCount > 100);
  assert.ok(inventory.mutationRouteCount > 0);
  assert.ok(inventory.permissionRouteCount > 0);
  assert.deepEqual(inventory.permissionRoutesWithoutGuard, []);
  assert.ok(inventory.directJwtReaders.length > 0);
  assert.ok(inventory.routes.every((route) => route.file && route.controller && route.method));
});
