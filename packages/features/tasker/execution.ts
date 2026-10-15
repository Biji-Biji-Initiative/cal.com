// SPDX-License-Identifier: MIT
import { AsyncLocalStorage } from "node:async_hooks";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";

// Operational markers use the retained Task fields, not a second queue/schema.
// A running scheduledAt is its lease expiry; attempts counts claimed executions.
export const RUNNING_PREFIX = "tasker:v1:running:";
export const UNKNOWN_PREFIX = "tasker:v1:unconfirmed:";
export const RETRY_ERROR = "tasker:v1:retry:handler_failed";
export const MAX_ACTIVE_TASKS = 4;
export type TaskClaim = { id: string; attempt: number; token: string };
export type TaskExecutionContext = { claim: TaskClaim; signal: AbortSignal };
export const taskExecution = new AsyncLocalStorage<TaskExecutionContext>();

export class TaskOutcomeUnknownError extends ErrorWithCode {
  constructor() {
    super(
      ErrorCode.InternalServerError,
      "Task effect is unconfirmed; reconciliation is required before another attempt"
    );
    this.name = "TaskOutcomeUnknownError";
  }
}
export function executionFor(taskId: string): TaskExecutionContext {
  const context = taskExecution.getStore();
  if (!context || context.claim.id !== taskId || context.signal.aborted) {
    throw new ErrorWithCode(ErrorCode.BadRequest, "This task execution no longer owns the operation");
  }
  return context;
}
export function taskStateError(): ErrorWithCode {
  return new ErrorWithCode(
    ErrorCode.BadRequest,
    "Running, completed or unconfirmed task state cannot be overwritten; review the recorded outcome"
  );
}
