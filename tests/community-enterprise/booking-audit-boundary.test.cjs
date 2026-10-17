// SPDX-License-Identifier: MIT
const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { inventory } = require("../../scripts/inventory-booking-audit-boundary.cjs");

const report = inventory(path.resolve(__dirname, "../.."));

test("booking audit producer keeps actor payloads PII-free before queueing", () => {
  assert.equal(report.producer.piiFreeActorBeforeQueue, true);
  assert.equal(report.producer.actorMaterializationBeforeQueue, true);
  assert.equal(report.producer.taskCreateCalls, 2, "single and bulk producers must remain visible");
  assert.equal(
    report.interface.queueMethods,
    18,
    "the reviewed producer surface changed; re-audit call sites"
  );
});

test("booking audit boundary records what is and is not transactional", () => {
  assert.equal(report.producer.declaresTransactionDependency, false);
  assert.equal(report.producer.passesTaskReferenceUid, false);
  assert.equal(report.producer.catchesQueueErrors, true);
  assert.equal(report.consumer.writesBookingAuditInConsumer, true);
  assert.equal(report.repository.createCallsPrisma, 2);
  assert.equal(report.schema.bookingAuditOperationIdIndexed, true);
  assert.equal(report.documentation.readmeClaimsPseudonymization, true);
  assert.equal(report.schema.auditActorHasPseudonymizedAt, false);
  assert.equal(
    report.schema.bookingAuditOperationIdUnique,
    false,
    "operationId is a correlation index, not a database idempotency constraint"
  );
});

test("booking audit producer is not wired into a booking mutation path yet", () => {
  assert.deepEqual(
    report.wiring.productionCallsites,
    [],
    "a new producer call site requires a fresh transaction and crash/retry review"
  );
});

test("booking audit access boundary is explicit about its current owner-only scope", () => {
  assert.equal(report.access.ownerOnlyCheck, true);
  assert.equal(
    report.access.organizationIdReferences,
    1,
    "organization scope is accepted but not enforced by this service"
  );
  assert.equal(
    report.access.adminOnlyComment,
    true,
    "the owner-only implementation/comment must stay visible during enterprise review"
  );
});

test("booking audit has no production retention or anonymization worker in the scanned source", () => {
  assert.deepEqual(
    report.wiring.retentionCode,
    [],
    "retention/anonymization changes must be reviewed with the audit policy before landing"
  );
});
