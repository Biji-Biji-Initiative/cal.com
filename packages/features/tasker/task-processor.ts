import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { MAX_ACTIVE_TASKS, TaskOutcomeUnknownError, taskExecution } from "./execution";
import type { ClaimedTask, TaskRepository, TaskSettlement } from "./repository";
import { Task } from "./repository";
import type { TaskHandler } from "./tasker";
import tasksMap, { tasksConfig } from "./tasks";

type Options = {
  repository?: TaskRepository;
  handlers?: Record<string, (() => Promise<TaskHandler>) | undefined>;
  config?: Record<string, { minRetryIntervalMins?: number; maxAttempts?: number } | undefined>;
  concurrency?: number;
  maxTasks?: number;
  claimWindowMs?: number;
  leaseMs?: number;
  heartbeatMs?: number;
  taskTimeoutMs?: number;
};
export type TaskProcessingSummary = {
  claimed: number;
  succeeded: number;
  retryScheduled: number;
  exhausted: number;
  unconfirmed: number;
  recoveredInterruptions: number;
  pendingReconciliation: number;
  exhaustedTotal: number;
};

export class TaskProcessor {
  private readonly repository: TaskRepository;
  private readonly handlers: NonNullable<Options["handlers"]>;
  private readonly config: NonNullable<Options["config"]>;
  private readonly concurrency: number;
  private readonly maxTasks: number;
  private readonly claimWindowMs: number;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly taskTimeoutMs: number;

  constructor(options: Options = {}) {
    this.repository = options.repository ?? Task;
    this.handlers = options.handlers ?? tasksMap;
    this.config = options.config ?? tasksConfig;
    this.concurrency = options.concurrency ?? MAX_ACTIVE_TASKS;
    this.maxTasks = options.maxTasks ?? 100;
    this.claimWindowMs = options.claimWindowMs ?? 45000;
    this.leaseMs = options.leaseMs ?? 300000;
    this.heartbeatMs = options.heartbeatMs ?? 30000;
    this.taskTimeoutMs = options.taskTimeoutMs ?? 240000;
    const bounds = [
      [this.concurrency, MAX_ACTIVE_TASKS],
      [this.maxTasks, 1000],
      [this.claimWindowMs, 60000],
      [this.leaseMs, 3600000],
      [this.heartbeatMs, 3600000],
      [this.taskTimeoutMs, 3600000],
    ];
    if (
      bounds.some(([value, max]) => !Number.isSafeInteger(value) || value < 1 || value > max) ||
      this.heartbeatMs * 2 >= this.leaseMs ||
      this.taskTimeoutMs >= this.leaseMs
    ) {
      throw new ErrorWithCode(ErrorCode.BadRequest, "Invalid task processor limits");
    }
  }

  private async execute(task: ClaimedTask): Promise<TaskSettlement> {
    const controller = new AbortController();
    let finished = false;
    let renewing = false;
    let interrupt!: () => void;
    const interrupted = new Promise<TaskSettlement>((resolve) => {
      interrupt = () => {
        controller.abort();
        resolve("unconfirmed");
      };
    });
    const timeout = setTimeout(interrupt, this.taskTimeoutMs);
    const heartbeat = setInterval(() => {
      if (finished || renewing) return;
      renewing = true;
      void this.repository
        .renew(task, this.leaseMs)
        .then((owned) => {
          if (!owned && !finished) interrupt();
        })
        .catch(() => {
          if (!finished) interrupt();
        })
        .finally(() => {
          renewing = false;
        });
    }, this.heartbeatMs);
    try {
      const execution = taskExecution.run(
        { claim: task, signal: controller.signal },
        async (): Promise<TaskSettlement> => {
          try {
            const getter = Object.hasOwn(this.handlers, task.type) ? this.handlers[task.type] : undefined;
            if (!getter) return "unconfirmed";
            const handler = await getter();
            if (controller.signal.aborted) return "unconfirmed";
            if (typeof handler !== "function") return "unconfirmed";
            const result = handler(task.payload, task.id, { claim: task, signal: controller.signal });
            if (!result || typeof result.then !== "function") return "unconfirmed";
            await result;
            return controller.signal.aborted ? "unconfirmed" : "succeeded";
          } catch (error) {
            // Legacy explicit handler errors keep their existing at-least-once
            // retry contract. New external-effect handlers must classify ambiguity.
            return controller.signal.aborted || error instanceof TaskOutcomeUnknownError
              ? "unconfirmed"
              : "retry";
          }
        }
      );
      const outcome = await Promise.race([execution, interrupted]);
      finished = true;
      controller.abort();
      const mins = this.config[task.type]?.minRetryIntervalMins ?? 1;
      const retryMs = Number.isFinite(mins) && mins > 0 ? Math.min(Math.ceil(mins * 60000), 3600000) : 60000;
      // Persisting success is a separate phase. A failed database acknowledgement
      // must not turn an already-run handler into an ordinary retry.
      try {
        if (await this.repository.settle(task, outcome, retryMs)) return outcome;
        await this.repository.settle(task, "unconfirmed");
        return "unconfirmed";
      } catch {
        try {
          await this.repository.settle(task, "unconfirmed");
        } catch {
          /* The durable running marker will expire into review. */
        }
        throw new ErrorWithCode(
          ErrorCode.InternalServerError,
          "Task completion could not be recorded; reconcile before retrying"
        );
      }
    } finally {
      finished = true;
      clearTimeout(timeout);
      clearInterval(heartbeat);
      controller.abort();
    }
  }

  async processQueue(taskId?: string): Promise<TaskProcessingSummary> {
    if (taskId !== undefined && (typeof taskId !== "string" || !taskId.length || taskId.length > 256))
      throw new ErrorWithCode(ErrorCode.BadRequest, "Invalid targeted task identity");
    const summary: TaskProcessingSummary = {
      claimed: 0,
      succeeded: 0,
      retryScheduled: 0,
      exhausted: 0,
      unconfirmed: 0,
      recoveredInterruptions: 0,
      pendingReconciliation: 0,
      exhaustedTotal: 0,
    };
    summary.recoveredInterruptions = await this.repository.recoverExpired(taskId);
    const until = performance.now() + this.claimWindowMs;
    let remaining = taskId === undefined ? this.maxTasks : 1;
    let infrastructureFailure = false;
    let stopClaiming = false;
    const worker = async () => {
      try {
        while (!infrastructureFailure && !stopClaiming && remaining > 0 && performance.now() < until) {
          remaining--;
          const task = await this.repository.claimNext(this.leaseMs, taskId);
          if (!task) return;
          summary.claimed++;
          const outcome = await this.execute(task);
          if (outcome === "succeeded") summary.succeeded++;
          else if (outcome === "unconfirmed") {
            summary.unconfirmed++;
            // Abort is cooperative: a timed-out handler may still be alive.
            // Stop adding work in this pass; already-claimed work must settle.
            stopClaiming = true;
          } else if (task.attempt >= task.maxAttempts) summary.exhausted++;
          else summary.retryScheduled++;
        }
      } catch {
        infrastructureFailure = true;
      }
    };
    await Promise.all(Array.from({ length: taskId === undefined ? this.concurrency : 1 }, worker));
    if (infrastructureFailure)
      throw new ErrorWithCode(ErrorCode.InternalServerError, "Task processing state could not be confirmed");
    Object.assign(summary, await this.repository.attentionCounts());
    console.info("Task processing summary", summary);
    return summary;
  }
}
