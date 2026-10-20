// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { sourceModules } = require("./tasker-fixture.cjs");
const { scimMembershipDisposition: disposition } = sourceModules(undefined).load(
  "packages/features/community-enterprise/identity/ScimMembershipProvenance.ts"
);
const scope = { directoryId: "Exact-Directory", userId: 17, teamId: 31 };
const member = {
  id: 41,
  userId: 17,
  teamId: 31,
  role: "MEMBER",
  accepted: true,
  customRoleId: null,
  updatedAt: new Date("2026-10-20T10:00:00Z"),
};
const grant = {
  directoryId: scope.directoryId,
  membershipId: member.id,
  lastManagedRole: "MEMBER",
  lastManagedAccepted: true,
  lastManagedCustomRoleId: null,
  lastManagedUpdatedAt: new Date(member.updatedAt),
};
const denied = { code: "forbidden_error" };

test("missing and local grants remain distinct from recorded directory ownership", () => {
  assert.equal(disposition(scope, null, []), "missing");
  assert.equal(disposition(scope, member, []), "local");
  assert.equal(disposition(scope, { ...member, role: "OWNER", customRoleId: "local-role" }, []), "local");
  assert.equal(disposition(scope, member, [grant]), "owned");
  assert.throws(() => disposition(scope, null, [grant]), denied);
});

for (const role of ["OWNER", "ADMIN"]) {
  test(`even a matching persisted ${role} snapshot cannot authorize a SCIM privilege edit`, () => {
    assert.throws(
      () => disposition(scope, { ...member, role }, [{ ...grant, lastManagedRole: role }]),
      denied
    );
  });
}

test("custom roles are explicitly refused even when both snapshots match", () => {
  for (const [current, saved] of [
    ["role-a", "role-a"],
    ["role-a", null],
    [null, "role-a"],
  ]) {
    assert.throws(
      () =>
        disposition(scope, { ...member, customRoleId: current }, [
          { ...grant, lastManagedCustomRoleId: saved },
        ]),
      denied
    );
  }
});

test("role, accepted-state and timestamp drift cannot be silently overwritten", () => {
  for (const change of [
    { role: "ADMIN" },
    { accepted: false },
    { updatedAt: null },
    { updatedAt: new Date(member.updatedAt.getTime() + 1) },
  ]) {
    assert.throws(() => disposition(scope, { ...member, ...change }, [grant]), denied);
  }
  for (const change of [
    { lastManagedRole: "ADMIN" },
    { lastManagedAccepted: false },
    { lastManagedUpdatedAt: null },
  ]) {
    assert.throws(() => disposition(scope, member, [{ ...grant, ...change }]), denied);
  }
});

test("nullable timestamps compare exactly and invalid dates never qualify", () => {
  assert.equal(
    disposition(scope, { ...member, updatedAt: null }, [{ ...grant, lastManagedUpdatedAt: null }]),
    "owned"
  );
  assert.equal(
    disposition(scope, { ...member, accepted: false }, [{ ...grant, lastManagedAccepted: false }]),
    "owned"
  );
  for (const value of [new Date(Number.NaN), "2026-10-20T10:00:00Z", 0, undefined]) {
    assert.throws(() => disposition(scope, { ...member, updatedAt: value }, [grant]), denied);
    assert.throws(() => disposition(scope, member, [{ ...grant, lastManagedUpdatedAt: value }]), denied);
  }
});

test("duplicate, foreign-directory and wrong-member provenance is never guessed", () => {
  assert.throws(() => disposition(scope, member, [grant, grant]), denied);
  for (const change of [
    { directoryId: "exact-directory" },
    { directoryId: "Foreign-Directory" },
    { membershipId: member.id + 1 },
  ]) {
    assert.throws(() => disposition(scope, member, [{ ...grant, ...change }]), denied);
  }
  for (const change of [{ userId: 18 }, { teamId: 32 }, { id: -1 }]) {
    assert.throws(() => disposition(scope, { ...member, ...change }, []), denied);
  }
});

test("scope validation fails closed and does not normalize identity", () => {
  for (const change of [
    { userId: 0 },
    { teamId: Number.NaN },
    { directoryId: " Exact-Directory" },
    { directoryId: "" },
  ]) {
    assert.throws(() => disposition({ ...scope, ...change }, member, [grant]), denied);
  }
});

test("classification leaves frozen local membership and provenance rows intact", () => {
  const current = Object.freeze({ ...member });
  const saved = Object.freeze({ ...grant });
  const rows = Object.freeze([saved]);
  const snapshot = JSON.stringify([current, rows]);
  assert.equal(disposition(Object.freeze({ ...scope }), current, rows), "owned");
  assert.equal(JSON.stringify([current, rows]), snapshot);
});
