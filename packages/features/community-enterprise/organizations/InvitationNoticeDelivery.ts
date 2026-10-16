// SPDX-License-Identifier: MIT
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { Prisma, PrismaClient } from "@calcom/prisma/client";
import { z } from "zod";
import {
  executionFor,
  RUNNING_PREFIX,
  TaskOutcomeUnknownError,
  UNKNOWN_PREFIX,
} from "../../tasker/execution";
import { TaskRepository } from "../../tasker/repository";
import { TaskProcessor } from "../../tasker/task-processor";
import { digest } from "../identity/IdentityLinkPlan";
import {
  type InvitationNoticePayload,
  invitationNoticePayload,
  invitationNoticeReference,
  invitationNoticeType,
  noticeOutcomeId,
} from "./InvitationNoticeOutbox";
import type { InvitationNotice, InvitationNotification } from "./OrganizationInvitationService";

type Outcome = "submitted" | "not_sent" | "suppressed" | "unconfirmed";
type Resolve = (tx: Prisma.TransactionClient, input: InvitationNoticePayload) => Promise<InvitationNotice>;

// The route's opportunistic send and cron use this SAME durable claim path.
// SMTP is never inside the transaction that records permission and attempt.
export class InvitationNoticeDelivery {
  constructor(
    private readonly db: PrismaClient,
    private readonly resolve: Resolve
  ) {}

  private async requireClaim(tx: Prisma.TransactionClient, taskId: string, input: InvitationNoticePayload) {
    const { claim } = executionFor(taskId);
    await tx.$queryRaw`SELECT id FROM "Task" WHERE id=${taskId} FOR UPDATE`;
    const rows = await tx.$queryRaw<Array<{ payload: string; type: string; referenceUid: string | null }>>`
      SELECT payload,type,"referenceUid" FROM "Task" WHERE id=${taskId}
        AND attempts=${claim.attempt} AND "lastError"=${RUNNING_PREFIX + claim.token}
        AND "succeededAt" IS NULL AND "scheduledAt" > (clock_timestamp() AT TIME ZONE 'UTC')`;
    const row = rows[0];
    if (
      rows.length !== 1 ||
      row.type !== invitationNoticeType ||
      row.referenceUid !== invitationNoticeReference(input) ||
      row.payload !== JSON.stringify(input)
    )
      throw new TaskOutcomeUnknownError();
    // The operation may have been aborted while waiting for the database row.
    executionFor(taskId);
  }

  private async record(
    tx: Prisma.TransactionClient,
    input: InvitationNoticePayload,
    taskId: string,
    state: Outcome | "attempted"
  ) {
    const operationId = state === "attempted" ? `${taskId}:notice-attempt` : noticeOutcomeId(taskId);
    const [clock] = await tx.$queryRaw<Array<{ milliseconds: number }>>`
      SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::float8 AS milliseconds`;
    await tx.enterpriseAuditEvent.create({
      data: {
        operationId,
        createdAt: new Date(clock.milliseconds),
        operationHash: digest({ taskId, input, state }),
        actorUserId: input.actor.id,
        organizationId: input.organizationId,
        entityId: input.invitationId,
        action: `organization.invitation.notification-${state}`,
        details: { version: 1, taskId, requestId: input.requestId, state },
      },
      select: { id: true },
    });
  }

  private async requireIntent(tx: Prisma.TransactionClient, input: InvitationNoticePayload, taskId: string) {
    const intent = await tx.enterpriseAuditEvent.findUnique({
      where: { operationId: input.requestId },
      select: { actorUserId: true, organizationId: true, entityId: true, action: true, details: true },
    });
    if (
      !intent ||
      intent.actorUserId !== input.actor.id ||
      intent.organizationId !== input.organizationId ||
      intent.entityId !== input.invitationId ||
      !["organization.invitation.created", "organization.invitation.notification-queued"].includes(
        intent.action
      ) ||
      !z.object({ notificationTaskId: z.literal(taskId) }).safeParse(intent.details).success
    )
      throw new TaskOutcomeUnknownError();
  }

  private async outcome(
    db: Pick<Prisma.TransactionClient, "enterpriseAuditEvent">,
    input: InvitationNoticePayload,
    taskId: string
  ): Promise<Outcome | null> {
    const row = await db.enterpriseAuditEvent.findUnique({
      where: { operationId: noticeOutcomeId(taskId) },
      select: {
        action: true,
        operationHash: true,
        actorUserId: true,
        organizationId: true,
        entityId: true,
        details: true,
      },
    });
    if (!row) return null;
    const details = z
      .object({
        version: z.literal(1),
        taskId: z.literal(taskId),
        requestId: z.literal(input.requestId),
        state: z.enum(["submitted", "not_sent", "suppressed", "unconfirmed"]),
      })
      .strict()
      .safeParse(row.details);
    if (
      !details.success ||
      row.actorUserId !== input.actor.id ||
      row.organizationId !== input.organizationId ||
      row.entityId !== input.invitationId ||
      row.action !== `organization.invitation.notification-${details.data.state}` ||
      row.operationHash !== digest({ taskId, input, state: details.data.state })
    )
      throw new TaskOutcomeUnknownError();
    return details.data.state;
  }

  async consume(raw: string, taskId: string, deliver: InvitationNotification): Promise<void> {
    const input = invitationNoticePayload.parse(JSON.parse(raw));
    executionFor(taskId);
    const notice = await this.db.$transaction(
      async (tx) => {
        // Match every invitation/member writer's root-first order. Never keep
        // these locks while rendering email or waiting for a transport.
        await tx.$queryRaw`SELECT id FROM "Team" WHERE id=${input.organizationId} FOR UPDATE`;
        await this.requireClaim(tx, taskId, input);
        await this.requireIntent(tx, input, taskId);
        const previous = await this.outcome(tx, input, taskId);
        if (previous === "unconfirmed") throw new TaskOutcomeUnknownError();
        if (previous) return null;
        // A process may have died after this marker but before recording SMTP's
        // result. Re-entering a handler must never interpret that as permission to resend.
        if (
          await tx.enterpriseAuditEvent.findUnique({
            where: { operationId: `${taskId}:notice-attempt` },
            select: { id: true },
          })
        )
          throw new TaskOutcomeUnknownError();
        let resolved: InvitationNotice;
        try {
          resolved = await this.resolve(tx, input);
        } catch (error) {
          const denied =
            error instanceof ErrorWithCode &&
            [ErrorCode.Forbidden, ErrorCode.BadRequest, ErrorCode.NotFound].includes(error.code);
          if (!denied && !(error instanceof z.ZodError) && !(error instanceof SyntaxError)) throw error;
          await this.record(tx, input, taskId, "suppressed");
          return null;
        }
        await this.record(tx, input, taskId, "attempted");
        return resolved;
      },
      // Admission reads must happen AFTER a root-lock wait, not from the transaction's old snapshot.
      { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 10000 }
    );
    if (!notice) return;
    let outcome: Outcome;
    try {
      executionFor(taskId);
      const result = await deliver(notice);
      outcome = result === "submitted" || result === "not_sent" ? result : "unconfirmed";
    } catch {
      // A thrown SMTP response is not proof of non-delivery. Preserve uncertainty
      // without serializing provider error messages, addresses or credentials.
      outcome = "unconfirmed";
    }
    try {
      await this.db.$transaction(
        async (tx) => {
          await this.requireClaim(tx, taskId, input);
          await this.record(tx, input, taskId, outcome);
        },
        { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 10000 }
      );
    } catch {
      throw new TaskOutcomeUnknownError();
    }
    if (outcome === "unconfirmed") throw new TaskOutcomeUnknownError();
  }

  async dispatch(taskId: string, deliver: InvitationNotification) {
    const task = await this.db.task.findUnique({
      where: { id: taskId },
      select: { type: true, payload: true, referenceUid: true },
    });
    if (task?.type !== invitationNoticeType)
      throw new ErrorWithCode(ErrorCode.BadRequest, "Invalid invitation notification");
    const input = invitationNoticePayload.parse(JSON.parse(task.payload));
    if (task.referenceUid !== invitationNoticeReference(input)) throw new TaskOutcomeUnknownError();
    const processor = new TaskProcessor({
      repository: new TaskRepository({ prismaClient: this.db }),
      handlers: {
        [invitationNoticeType]: async () => async (payload, id) => {
          if (!id) throw new TaskOutcomeUnknownError();
          await this.consume(payload, id, deliver);
        },
      },
    });
    await processor.processQueue(taskId);
    let outcome: Outcome | null;
    try {
      outcome = await this.outcome(this.db, input, taskId);
    } catch (error) {
      if (error instanceof TaskOutcomeUnknownError) return { email: "unconfirmed" as const };
      throw error;
    }
    if (outcome === "submitted") return { email: "submitted" as const };
    if (outcome === "not_sent" || outcome === "suppressed") return { email: "not_sent" as const };
    const current = await this.db.task.findUnique({
      where: { id: taskId },
      select: { lastError: true, succeededAt: true, attempts: true, maxAttempts: true },
    });
    if (
      !current ||
      current.succeededAt ||
      current.attempts >= current.maxAttempts ||
      current.lastError?.startsWith(UNKNOWN_PREFIX) ||
      current.lastError?.startsWith(RUNNING_PREFIX) ||
      outcome
    )
      return { email: "unconfirmed" as const };
    return { email: "queued" as const };
  }
}
