import { randomUUID } from "node:crypto";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import type { PrismaClient } from "@calcom/prisma";
import { prisma } from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import type { TaskClaim } from "./execution";
import {
  executionFor,
  MAX_ACTIVE_TASKS,
  RETRY_ERROR,
  RUNNING_PREFIX,
  taskExecution,
  taskStateError,
  UNKNOWN_PREFIX,
} from "./execution";
import type { TaskTypes } from "./tasker";

type Dependencies = { prismaClient: PrismaClient };
export type ClaimedTask = TaskClaim & { type: string; payload: string; maxAttempts: number };
export type TaskSettlement = "succeeded" | "retry" | "unconfirmed";
const now = Prisma.sql`(clock_timestamp() AT TIME ZONE 'UTC')`;
const runnable = Prisma.sql`"succeededAt" IS NULL AND attempts >= 0 AND attempts < "maxAttempts"
  AND "scheduledAt" <= ${now}
  AND ("lastError" IS NULL OR ("lastError" NOT LIKE ${RUNNING_PREFIX + "%"} AND "lastError" NOT LIKE ${UNKNOWN_PREFIX + "%"}))`;
const pausedOrRunning = {
  OR: [{ lastError: { startsWith: RUNNING_PREFIX } }, { lastError: { startsWith: UNKNOWN_PREFIX } }],
};
const milliseconds = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3600000)
    throw new ErrorWithCode(ErrorCode.BadRequest, "Invalid task execution duration");
  return value;
};
const ownLease = (claim: TaskClaim) => Prisma.sql`id=${claim.id} AND attempts=${claim.attempt}
  AND "lastError"=${RUNNING_PREFIX + claim.token} AND "succeededAt" IS NULL`;

export class TaskRepository {
  constructor(private readonly deps: Dependencies) {}

  async create(
    type: TaskTypes,
    payload: string,
    options: { scheduledAt?: Date; maxAttempts?: number; referenceUid?: string } = {}
  ) {
    if (
      typeof payload !== "string" ||
      (options.maxAttempts !== undefined &&
        (!Number.isSafeInteger(options.maxAttempts) ||
          options.maxAttempts < 1 ||
          options.maxAttempts > 1000)) ||
      (options.scheduledAt && !Number.isFinite(options.scheduledAt.getTime()))
    ) {
      throw new ErrorWithCode(ErrorCode.BadRequest, "Invalid task creation options");
    }
    // Payloads may contain secrets. Creation and processing logs omit them.
    const result = await this.deps.prismaClient.task.create({
      data: {
        type,
        payload,
        scheduledAt: options.scheduledAt,
        maxAttempts: options.maxAttempts,
        referenceUid: options.referenceUid,
      },
      select: { id: true },
    });
    return result.id;
  }

  // Read-only inspection; only claimNext authorizes execution.
  async getNextBatch() {
    return this.deps.prismaClient.$queryRaw<
      Array<{ id: string; type: string; payload: string; attempts: number; maxAttempts: number }>
    >`
      SELECT id,type,payload,attempts,"maxAttempts" FROM "Task" WHERE ${runnable}
      ORDER BY "scheduledAt",id LIMIT 100`;
  }

  async claimNext(leaseMs: number): Promise<ClaimedTask | null> {
    milliseconds(leaseMs);
    const token = randomUUID();
    return this.deps.prismaClient.$transaction(
      async (tx) => {
        // Serialize only the short claim transaction, never a network handler.
        // The next statement obtains a fresh READ COMMITTED view after this lock.
        await tx.$queryRaw`SELECT true AS locked FROM pg_advisory_xact_lock(hashtext('cal.tasker.claim.v1'), 0)`;
        const active = await tx.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM "Task"
        WHERE "succeededAt" IS NULL AND "lastError" LIKE ${RUNNING_PREFIX + "%"} AND "scheduledAt" > ${now}`;
        if (active[0].count >= MAX_ACTIVE_TASKS) return null;
        const tasks = await tx.$queryRaw<
          Array<{ id: string; type: string; payload: string; attempts: number; maxAttempts: number }>
        >`
        WITH candidate AS (
          SELECT id FROM "Task" WHERE ${runnable} ORDER BY "scheduledAt",id LIMIT 1 FOR UPDATE SKIP LOCKED
        ) UPDATE "Task" t SET attempts=t.attempts+1,
          "scheduledAt"=${now}+(${leaseMs}::double precision * interval '1 millisecond'),
          "lastError"=${RUNNING_PREFIX + token},"updatedAt"=${now}
          FROM candidate WHERE t.id=candidate.id
          RETURNING t.id,t.type,t.payload,t.attempts,t."maxAttempts"`;
        return tasks[0]
          ? {
              id: tasks[0].id,
              type: tasks[0].type,
              payload: tasks[0].payload,
              maxAttempts: tasks[0].maxAttempts,
              attempt: tasks[0].attempts,
              token,
            }
          : null;
      },
      { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 10000 }
    );
  }

  async renew(claim: TaskClaim, leaseMs: number): Promise<boolean> {
    milliseconds(leaseMs);
    const changed = await this.deps.prismaClient.$executeRaw`UPDATE "Task"
      SET "scheduledAt"=${now}+(${leaseMs}::double precision * interval '1 millisecond'),"updatedAt"=${now}
      WHERE ${ownLease(claim)} AND "scheduledAt" > ${now}`;
    return changed === 1;
  }

  async settle(claim: TaskClaim, outcome: TaskSettlement, retryMs = 60000): Promise<boolean> {
    milliseconds(retryMs);
    const update =
      outcome === "succeeded"
        ? Prisma.sql`"succeededAt"=${now},"lastError"=NULL`
        : outcome === "retry"
          ? Prisma.sql`"scheduledAt"=${now}+(${retryMs}::double precision * interval '1 millisecond'),"lastError"=${RETRY_ERROR},"lastFailedAttemptAt"=${now}`
          : Prisma.sql`"lastError"=${UNKNOWN_PREFIX + "execution"},"lastFailedAttemptAt"=${now}`;
    // Late completion cannot overwrite a lost lease. Unknown-outcome marking
    // can occur after expiry, but still requires the exact original claim.
    const live = outcome === "unconfirmed" ? Prisma.empty : Prisma.sql`AND "scheduledAt" > ${now}`;
    const changed = await this.deps.prismaClient.$executeRaw`UPDATE "Task" SET ${update},"updatedAt"=${now}
      WHERE ${ownLease(claim)} ${live}`;
    return changed === 1;
  }

  async recoverExpired(): Promise<number> {
    // A crashed worker may already have caused an external effect. Expiry is
    // evidence for reconciliation, not permission to send the operation again.
    return this.deps.prismaClient.$executeRaw`WITH expired AS (
      SELECT id FROM "Task" WHERE "succeededAt" IS NULL AND "lastError" LIKE ${RUNNING_PREFIX + "%"}
        AND "scheduledAt" <= ${now} ORDER BY "scheduledAt",id LIMIT 100 FOR UPDATE SKIP LOCKED
    ) UPDATE "Task" t SET "lastError"=${UNKNOWN_PREFIX + "interrupted"},"lastFailedAttemptAt"=${now},"updatedAt"=${now}
      FROM expired WHERE t.id=expired.id`;
  }

  private failedWhere(): Prisma.TaskWhereInput {
    return {
      succeededAt: null,
      AND: [
        { OR: [{ lastError: null }, { NOT: { lastError: { startsWith: RUNNING_PREFIX } } }] },
        {
          OR: [
            { lastError: { startsWith: UNKNOWN_PREFIX } },
            { attempts: { gte: this.deps.prismaClient.task.fields.maxAttempts } },
          ],
        },
      ],
    };
  }
  async getFailed() {
    return this.deps.prismaClient.task.findMany({ where: this.failedWhere() });
  }
  async getSucceeded() {
    return this.deps.prismaClient.task.findMany({ where: { succeededAt: { not: null } } });
  }
  async count() {
    return this.deps.prismaClient.task.count();
  }
  async countFailed() {
    return this.deps.prismaClient.task.count({ where: this.failedWhere() });
  }
  async countSucceeded() {
    return this.deps.prismaClient.task.count({ where: { succeededAt: { not: null } } });
  }
  async countUpcoming() {
    const rows = await this.deps.prismaClient.$queryRaw<
      Array<{ count: number }>
    >`SELECT count(*)::int AS count FROM "Task" WHERE ${runnable}`;
    return rows[0].count;
  }
  async attentionCounts(): Promise<{ pendingReconciliation: number; exhaustedTotal: number }> {
    // One database view separates unresolved effects from terminal handler
    // failures. A quiet later cron invocation must not hide old failed work.
    const rows = await this.deps.prismaClient.$queryRaw<
      Array<{ pendingReconciliation: number; exhaustedTotal: number }>
    >`SELECT
      count(*) FILTER (WHERE "lastError" LIKE ${UNKNOWN_PREFIX + "%"})::int AS "pendingReconciliation",
      count(*) FILTER (WHERE attempts >= "maxAttempts" AND
        ("lastError" IS NULL OR ("lastError" NOT LIKE ${RUNNING_PREFIX + "%"} AND
          "lastError" NOT LIKE ${UNKNOWN_PREFIX + "%"})))::int AS "exhaustedTotal"
      FROM "Task" WHERE "succeededAt" IS NULL`;
    return rows[0];
  }

  async countUnconfirmed() {
    return this.deps.prismaClient.task.count({
      where: { succeededAt: null, lastError: { startsWith: UNKNOWN_PREFIX } },
    });
  }

  async retry({
    taskId,
    minRetryIntervalMins,
  }: {
    taskId: string;
    lastError?: string;
    minRetryIntervalMins?: number | null;
  }) {
    const context = executionFor(taskId);
    if (!(await this.settle(context.claim, "retry", (minRetryIntervalMins || 1) * 60000)))
      throw taskStateError();
    return { id: taskId };
  }
  async succeed(taskId: string) {
    const context = executionFor(taskId);
    if (!(await this.settle(context.claim, "succeeded"))) throw taskStateError();
    return { id: taskId };
  }

  async updatePayload(taskId: string, newPayload: string) {
    const context = taskExecution.getStore();
    if (context) {
      executionFor(taskId);
      const changed = await this.deps.prismaClient
        .$executeRaw`UPDATE "Task" SET payload=${newPayload},"updatedAt"=${now}
        WHERE ${ownLease(context.claim)} AND "scheduledAt" > ${now}`;
      if (changed !== 1) throw taskStateError();
    } else {
      const changed = await this.deps.prismaClient.task.updateMany({
        where: { id: taskId, succeededAt: null, OR: [{ lastError: null }, { NOT: pausedOrRunning }] },
        data: { payload: newPayload },
      });
      if (changed.count !== 1) throw taskStateError();
    }
    return { id: taskId };
  }

  private async cancelWhere(where: Prisma.TaskWhereInput): Promise<{ id: string } | null> {
    return this.deps.prismaClient.$transaction(async (tx) => {
      const found = await tx.task.findFirst({ where, select: { id: true, succeededAt: true } });
      if (!found) return null;
      // Existing payment/no-show callers may cancel after a task finished. That
      // is a harmless no-op, not permission to remove its completion evidence.
      if (found.succeededAt) return { id: found.id };
      const deleted = await tx.task.deleteMany({
        where: { id: found.id, succeededAt: null, OR: [{ lastError: null }, { NOT: pausedOrRunning }] },
      });
      if (deleted.count === 1) return { id: found.id };
      const current = await tx.task.findUnique({
        where: { id: found.id },
        select: { id: true, succeededAt: true },
      });
      if (!current) return null;
      if (current.succeededAt) return { id: current.id };
      throw taskStateError();
    });
  }
  async cancel(taskId: string) {
    const result = await this.cancelWhere({ id: taskId });
    if (!result) throw new ErrorWithCode(ErrorCode.NotFound, "Task does not exist");
    return result;
  }
  async cancelWithReference(referenceUid: string, type: TaskTypes) {
    return this.cancelWhere({ referenceUid, type });
  }
  async cleanup() {
    // Preserve the existing no-op. Recovery/retention policy must be settled
    // before an automated job deletes completed or ambiguous evidence.
    return 0;
  }
}
export const Task = new TaskRepository({ prismaClient: prisma });
