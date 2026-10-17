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

const { parseRecoverySnapshot, reconcileRestoredSnapshot } = compile(
  "packages/features/community-enterprise/recovery/RestoreReconciliationContract.ts"
);

const fingerprint = "a".repeat(64);
const baseSnapshot = (overrides = {}) => ({
  counts: { users: 2, profiles: 2, bookings: 1, eventTypes: 1, providers: 1 },
  stableIds: {
    users: ["user-2", "user-1"],
    profiles: ["profile-1", "profile-2"],
    bookings: ["booking-1"],
    eventTypes: ["event-1"],
    providers: ["provider-1"],
  },
  bookingUrls: ["https://cal.example.test/team/booking-1"],
  encryptionKeyFingerprint: fingerprint,
  ...overrides,
});

const input = (overrides = {}) => ({
  scope: "isolated-disposable",
  productionTarget: false,
  writerQuiesced: true,
  backupId: "backup-2026-10-17-01",
  backupCapturedAt: "2026-10-17T10:00:00Z",
  restoredAt: "2026-10-17T10:10:00Z",
  source: baseSnapshot(),
  restored: baseSnapshot(),
  ...overrides,
});

test("matching isolated snapshots produce a deterministic successful report", () => {
  const report = reconcileRestoredSnapshot(input());
  assert.equal(report.matched, true);
  assert.deepEqual(report.differences, []);
  assert.deepEqual(report.source.stableIds.users, ["user-1", "user-2"]);
  assert.deepEqual(report.source.bookingUrls, ["https://cal.example.test/team/booking-1"]);
});

test("row counts and stable IDs are reconciled per entity", () => {
  const report = reconcileRestoredSnapshot(
    input({
      restored: baseSnapshot({
        counts: { users: 1, profiles: 2, bookings: 1, eventTypes: 1, providers: 1 },
        stableIds: { ...baseSnapshot().stableIds, users: ["user-3"] },
      }),
    })
  );
  assert.equal(report.matched, false);
  assert.deepEqual(
    report.differences.map((item) => [item.code, item.entity]),
    [
      ["count-mismatch", "users"],
      ["stable-id-mismatch", "users"],
    ]
  );
});

test("booking URLs are compared canonically and reject credentials or fragments", () => {
  const report = reconcileRestoredSnapshot(
    input({
      source: baseSnapshot({ bookingUrls: ["https://cal.example.test/team/booking-1/"] }),
      restored: baseSnapshot({ bookingUrls: ["https://cal.example.test/team/booking-1"] }),
    })
  );
  assert.equal(report.matched, false);
  assert.deepEqual(
    report.differences.map((item) => item.code),
    ["booking-url-mismatch"]
  );
  assert.throws(
    () =>
      parseRecoverySnapshot(baseSnapshot({ bookingUrls: ["https://user:secret@cal.example.test/booking"] })),
    /credentials/
  );
  assert.throws(
    () => parseRecoverySnapshot(baseSnapshot({ bookingUrls: ["https://cal.example.test/booking#private"] })),
    /fragment/
  );
  assert.throws(
    () => parseRecoverySnapshot(baseSnapshot({ bookingUrls: ["javascript:alert(1)"] })),
    /HTTP or HTTPS/
  );
});

test("encryption fingerprints must match without exposing key material", () => {
  const report = reconcileRestoredSnapshot(
    input({ restored: baseSnapshot({ encryptionKeyFingerprint: "b".repeat(64) }) })
  );
  assert.equal(report.matched, false);
  assert.deepEqual(
    report.differences.map((item) => item.code),
    ["encryption-fingerprint-mismatch"]
  );
  assert.throws(
    () => parseRecoverySnapshot(baseSnapshot({ encryptionKeyFingerprint: "secret-key" })),
    /SHA-256/
  );
});

test("restore receipt refuses production targets, active writers, malformed timestamps and duplicate IDs", () => {
  assert.throws(() => reconcileRestoredSnapshot(input({ productionTarget: true })), /not be production/);
  assert.throws(() => reconcileRestoredSnapshot(input({ writerQuiesced: false })), /quiesced writers/);
  assert.throws(() => reconcileRestoredSnapshot(input({ restoredAt: "yesterday" })), /ISO timestamp/);
  assert.throws(() => reconcileRestoredSnapshot(input({ restoredAt: "2026-10-17T09:00:00Z" })), /precede/);
  assert.throws(
    () =>
      parseRecoverySnapshot(
        baseSnapshot({ stableIds: { ...baseSnapshot().stableIds, bookings: ["booking-1", "booking-1"] } })
      ),
    /duplicates/
  );
  assert.throws(
    () => parseRecoverySnapshot(baseSnapshot({ counts: { ...baseSnapshot().counts, bookings: 2 } })),
    /does not match stable ID count/
  );
});
