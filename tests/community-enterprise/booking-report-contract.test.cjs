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

const { buildBookingReport } = compile(
  "packages/features/community-enterprise/reporting/BookingReportContract.ts"
);

const row = (overrides = {}) => ({
  id: "booking-1",
  orgId: "org-1",
  teamId: "team-1",
  status: "confirmed",
  hostId: "host-1",
  noShow: false,
  delivery: "sent",
  ...overrides,
});

test("report reconciles statuses, cancellations, no-shows and delivery failures", () => {
  const report = buildBookingReport({ orgId: "org-1", teamId: "team-1" }, [
    row(),
    row({
      id: "booking-2",
      status: "cancelled",
      hostId: "host-2",
      noShow: true,
      delivery: "failed",
    }),
    row({
      id: "booking-3",
      status: "pending",
      hostId: null,
      delivery: "uncertain",
    }),
    row({ id: "booking-4", status: "rejected", hostId: "host-1", delivery: "none" }),
  ]);

  assert.deepEqual(report.totals, {
    bookings: 4,
    cancellations: 1,
    noShows: 1,
    deliveryFailures: 2,
  });
  assert.deepEqual(report.statusCounts, {
    confirmed: 1,
    cancelled: 1,
    pending: 1,
    rejected: 1,
  });
  assert.deepEqual(report.hostDistribution, { "host-1": 2, "host-2": 1, unassigned: 1 });
  assert.deepEqual(report.reconciliation, { statusTotal: 4, hostTotal: 4, balanced: true });
});

test("organization and team scope fails closed on mixed rows", () => {
  assert.throws(
    () =>
      buildBookingReport({ orgId: "org-1", teamId: "team-1" }, [
        row(),
        row({ id: "booking-2", orgId: "org-2" }),
      ]),
    /cross the requested/
  );
  assert.throws(
    () =>
      buildBookingReport({ orgId: "org-1", teamId: "team-1" }, [
        row(),
        row({ id: "booking-2", teamId: "team-2" }),
      ]),
    /cross the requested/
  );
});

test("report output contains aggregates only and no row or attendee payload", () => {
  const report = buildBookingReport({ orgId: "org-1" }, [row()]);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("booking-1"), false);
  assert.equal(serialized.includes("host-1"), true);
  assert.deepEqual(Object.keys(report), [
    "version",
    "scope",
    "totals",
    "statusCounts",
    "hostDistribution",
    "reconciliation",
  ]);
});

test("organization-only scope can reconcile multiple teams without leaking rows", () => {
  const report = buildBookingReport({ orgId: "org-1" }, [
    row(),
    row({ id: "booking-2", teamId: "team-2", hostId: "host-2" }),
  ]);
  assert.equal(report.totals.bookings, 2);
  assert.deepEqual(report.hostDistribution, { "host-1": 1, "host-2": 1 });
  assert.deepEqual(report.scope, { orgId: "org-1" });
});

test("empty scoped report is a valid zero report", () => {
  const report = buildBookingReport({ orgId: "org-1", teamId: "team-1" }, []);
  assert.deepEqual(report.totals, {
    bookings: 0,
    cancellations: 0,
    noShows: 0,
    deliveryFailures: 0,
  });
  assert.deepEqual(report.statusCounts, { confirmed: 0, cancelled: 0, pending: 0, rejected: 0 });
  assert.deepEqual(report.hostDistribution, {});
  assert.deepEqual(report.reconciliation, { statusTotal: 0, hostTotal: 0, balanced: true });
});

test("duplicate booking rows and invalid status are rejected", () => {
  assert.throws(() => buildBookingReport({ orgId: "org-1" }, [row(), row()]), /duplicate booking id/);
  assert.throws(
    () => buildBookingReport({ orgId: "org-1" }, [row({ status: "unknown" })]),
    /status is invalid/
  );
});

test("invalid row shape is rejected before any aggregate is returned", () => {
  assert.throws(
    () => buildBookingReport({ orgId: "org-1" }, [row({ noShow: "false" })]),
    /noShow must be boolean/
  );
  assert.throws(
    () => buildBookingReport({ orgId: "org-1" }, [row({ delivery: "delivered" })]),
    /delivery is invalid/
  );
});
