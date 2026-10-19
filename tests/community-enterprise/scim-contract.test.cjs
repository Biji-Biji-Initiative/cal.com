// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "../..");
function compile(file) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", output)(module, module.exports);
  return module.exports;
}

const contract = compile("packages/features/community-enterprise/identity/ScimProvisioningContract.ts");
const requestContract = compile("packages/features/community-enterprise/identity/ScimRequestContract.ts");
const {
  SCIM_LIST_SCHEMA,
  SCIM_PATCH_SCHEMA,
  SCIM_USER_SCHEMA,
  nextScimStart,
  parseScimGroupPatch,
  parseScimPage,
  parseScimUserResource,
  planScimMembershipReconciliation,
} = contract;
const { parseScimAuthorization, parseScimRequest } = requestContract;

const user = (overrides = {}) => ({
  schemas: [SCIM_USER_SCHEMA],
  id: "idp-user-17",
  externalId: "directory-user-17",
  userName: "staff@example.test",
  active: true,
  ...overrides,
});

test("SCIM users require and preserve the exact externalId", () => {
  const parsed = parseScimUserResource(user());
  assert.equal(parsed.externalId, "directory-user-17");
  assert.throws(() => parseScimUserResource(user({ externalId: undefined })), /externalId/);
  assert.throws(() => parseScimUserResource(user({ externalId: " directory-user-17" })), /externalId/);
  assert.throws(() => parseScimUserResource(user({ schemas: [] })), /requires/);
});

test("SCIM transport requires a bearer credential and canonical resource route", () => {
  assert.deepEqual(parseScimAuthorization("bearer directory-token-1234"), {
    scheme: "Bearer",
    credential: "directory-token-1234",
  });
  const request = parseScimRequest({
    method: "PATCH",
    path: "/scim/v2/Groups/group-7",
    authorization: "Bearer directory-token-1234",
  });
  assert.equal(request.resource, "Groups");
  assert.equal(request.resourceId, "group-7");
  assert.throws(() => parseScimAuthorization("Basic directory-token-1234"), /Bearer scheme/);
  assert.throws(() => parseScimAuthorization("Bearer short"), /too short/);
  assert.throws(
    () =>
      parseScimRequest({
        method: "GET",
        path: "/scim/v2/Users?access_token=directory-token-1234",
        authorization: "Bearer directory-token-1234",
      }),
    /path is outside/
  );
  assert.throws(
    () =>
      parseScimRequest({
        method: "GET",
        path: "/scim/v2/Users",
        authorization: "Bearer directory-token-1234",
        query: { token: "directory-token-1234" },
      }),
    /query parameters/
  );
});

test("group PATCH admits only member add/remove operations", () => {
  const parsed = parseScimGroupPatch({
    schemas: [SCIM_PATCH_SCHEMA],
    Operations: [
      { op: "Add", path: "members", value: [{ value: "directory-user-17" }] },
      { op: "remove", value: { value: "directory-user-18" } },
    ],
  });
  assert.deepEqual(parsed, [
    { op: "add", members: [{ value: "directory-user-17" }] },
    { op: "remove", members: [{ value: "directory-user-18" }] },
  ]);
  assert.throws(
    () =>
      parseScimGroupPatch({
        schemas: [SCIM_PATCH_SCHEMA],
        Operations: [{ op: "replace", path: "members", value: [] }],
      }),
    /add\/remove/
  );
  assert.throws(
    () =>
      parseScimGroupPatch({
        schemas: [SCIM_PATCH_SCHEMA],
        Operations: [{ op: "add", path: "displayName", value: "staff" }],
      }),
    /members path/
  );
});

test("SCIM page cursor is bounded and cannot skip or overrun resources", () => {
  const page = parseScimPage(
    {
      schemas: [SCIM_LIST_SCHEMA],
      startIndex: 1,
      itemsPerPage: 2,
      totalResults: 3,
      Resources: [user(), user({ id: "idp-user-18", externalId: "directory-user-18" })],
    },
    parseScimUserResource
  );
  assert.equal(nextScimStart(page), 3);
  assert.throws(
    () =>
      parseScimPage(
        {
          schemas: [SCIM_LIST_SCHEMA],
          startIndex: 3,
          itemsPerPage: 2,
          totalResults: 3,
          Resources: [user(), user()],
        },
        parseScimUserResource
      ),
    /exceeds/
  );
  assert.throws(
    () =>
      parseScimPage(
        { schemas: [SCIM_LIST_SCHEMA], startIndex: 1, itemsPerPage: 101, totalResults: 101, Resources: [] },
        parseScimUserResource
      ),
    /paging/
  );
});

test("empty SCIM pages preserve totals without repeating the same cursor", () => {
  for (const [startIndex, totalResults] of [
    [1, 0],
    [1, 50],
    [8, 50],
  ]) {
    const page = parseScimPage(
      {
        schemas: [SCIM_LIST_SCHEMA],
        startIndex,
        itemsPerPage: 0,
        totalResults,
        Resources: [],
      },
      () => assert.fail("An empty page must not map any resources")
    );
    assert.equal(page.totalResults, totalResults);
    assert.equal(page.startIndex, startIndex);
    assert.deepEqual(page.resources, []);
    assert.equal(nextScimStart(page), null);
  }
});

test("directory filter changes do not revoke existing grants", () => {
  const plan = planScimMembershipReconciliation({
    directoryId: "directory-1",
    event: "directory-filter-change",
    desiredExternalIds: [],
    current: [
      { membershipId: 2, externalId: "directory-user-2", source: "scim", bookingCount: 1 },
      { membershipId: 1, externalId: "local-user-1", source: "local", bookingCount: 0 },
    ],
  });
  assert.deepEqual(plan.operations, []);
  assert.equal(plan.filterChangeRevokesNothing, true);
  assert.equal(plan.preserveLocalGrants, true);
  assert.equal(plan.preserveBookingHistory, true);
});

test("membership provenance is unambiguous before a plan is built", () => {
  assert.throws(
    () =>
      planScimMembershipReconciliation({
        directoryId: "directory-1",
        event: "group-sync",
        current: [
          { membershipId: 1, externalId: "same-user", source: "local", bookingCount: 0 },
          { membershipId: 2, externalId: "same-user", source: "scim", bookingCount: 0 },
        ],
      }),
    /Duplicate membership externalId/
  );
});

test("group sync removes only stale SCIM grants and retains local grants", () => {
  const plan = planScimMembershipReconciliation({
    directoryId: "directory-1",
    event: "group-sync",
    desiredExternalIds: ["directory-user-3", "local-user-1"],
    current: [
      { membershipId: 2, externalId: "directory-user-2", source: "scim", bookingCount: 4 },
      { membershipId: 1, externalId: "local-user-1", source: "local", bookingCount: 4 },
    ],
  });
  assert.deepEqual(plan.operations, [
    {
      type: "grant-scim-membership",
      directoryId: "directory-1",
      externalId: "directory-user-3",
      source: "scim",
    },
    {
      type: "remove-scim-membership",
      directoryId: "directory-1",
      externalId: "directory-user-2",
      membershipId: 2,
      source: "scim",
    },
  ]);
});

test("disable queues reassignment without deleting membership history", () => {
  const plan = planScimMembershipReconciliation({
    directoryId: "directory-1",
    event: "user-disable",
    current: [{ membershipId: 8, externalId: "directory-user-8", source: "scim", bookingCount: 3 }],
  });
  assert.deepEqual(plan.operations, [
    { type: "disable-new-assignment", membershipId: 8, externalId: "directory-user-8" },
    { type: "queue-reassignment", membershipId: 8, externalId: "directory-user-8", bookingCount: 3 },
  ]);
  assert.equal(plan.preserveBookingHistory, true);
});

test("deprovision removes only the directory grant after scheduling handoff", () => {
  const plan = planScimMembershipReconciliation({
    directoryId: "directory-1",
    event: "user-deprovision",
    current: [
      { membershipId: 1, externalId: "local-user-1", source: "local", bookingCount: 0 },
      { membershipId: 2, externalId: "directory-user-2", source: "scim", bookingCount: 2 },
    ],
  });
  assert.ok(plan.operations.some((operation) => operation.type === "remove-scim-membership"));
  assert.ok(
    plan.operations.every(
      (operation) => operation.type !== "remove-scim-membership" || operation.externalId !== "local-user-1"
    )
  );
  assert.ok(plan.operations.some((operation) => operation.type === "queue-reassignment"));
  assert.equal(plan.preserveLocalGrants, true);
});
