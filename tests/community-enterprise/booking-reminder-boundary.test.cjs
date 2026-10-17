// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { inventory } = require("../../scripts/inventory-booking-reminder-boundary.cjs");

const report = inventory(path.resolve(__dirname, "../.."));

test("pending reminder source keeps threshold and booking identity checks explicit", () => {
  assert.deepEqual(report.route.configuredIntervals, [2880, 1440, 180]);
  assert.equal(report.route.usesExactElapsedThreshold, true);
  assert.equal(report.route.checksSameBookingAndThreshold, true);
  assert.equal(report.route.filtersPendingBookings, true);
  assert.equal(report.route.filtersFutureEvents, true);
});

test("reminder delivery is marked only after the external email call", () => {
  assert.equal(report.route.sendsReminderEmail, true);
  assert.equal(report.route.createsMarkerAfterExternalSend, true);
  assert.equal(report.route.wrapsSendAndMarkerInTransaction, false);
  assert.equal(report.route.usesAtomicMarkerWrite, false);
  assert.equal(report.route.catchesExternalSendFailure, false);
});

test("ReminderMail has no database idempotency constraint for the compound identity", () => {
  assert.equal(report.storage.referenceIndex, true);
  assert.equal(report.storage.typeIndex, true);
  assert.equal(report.storage.compoundIdentityUnique, false);
  assert.equal(report.storage.migrationCreatesCompoundUnique, false);
});

test("no production cancellation or reschedule invalidation path is visible", () => {
  assert.deepEqual(report.wiring.reminderCreationCallsites, [
    "apps/web/app/api/cron/bookingReminder/route.ts",
  ]);
  assert.deepEqual(report.wiring.invalidationCallsites, []);
  assert.equal(report.sourceBoundaries.cancellationUsesPendingStatusGate, true);
  assert.equal(report.sourceBoundaries.cancellationDeletesMarkers, false);
  assert.equal(report.sourceBoundaries.reschedulingHasBookingIdentityVersion, false);
  assert.equal(report.sourceBoundaries.concurrencyHasDatabaseClaim, false);
});

test("the checked-in scheduler calls the reminder route every fifteen minutes", () => {
  assert.equal(report.wiring.workflowRunsEvery15Minutes, true);
  assert.equal(report.wiring.workflowCallsReminderEndpoint, true);
  assert.equal(report.wiring.workflowRequiresAppAndCronSecret, true);
});
