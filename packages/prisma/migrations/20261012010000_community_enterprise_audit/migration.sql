-- Additive only: no existing scheduling or identity rows are changed.
CREATE TABLE "EnterpriseAuditEvent" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "operationHash" TEXT NOT NULL,
  "actorUserId" INTEGER NOT NULL,
  "organizationId" INTEGER NOT NULL,
  "entityId" INTEGER,
  "action" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EnterpriseAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EnterpriseAuditEvent_operationId_key" ON "EnterpriseAuditEvent"("operationId");
CREATE INDEX "EnterpriseAuditEvent_organizationId_createdAt_idx" ON "EnterpriseAuditEvent"("organizationId", "createdAt");
CREATE INDEX "EnterpriseAuditEvent_actorUserId_createdAt_idx" ON "EnterpriseAuditEvent"("actorUserId", "createdAt");
