import type { TaskRecord } from "../../domain/src/index.js";
import type { InputRequestRecord } from "../../persistence-postgres/src/index.js";

export type DetailedTaskProjection = "create" | "get" | "notification";

export function mapTaskToDetailedTask(
  task: TaskRecord,
  inputRequests: readonly InputRequestRecord[] = [],
  projection: DetailedTaskProjection = "notification",
): Record<string, unknown> {
  const wireTtlMs =
    task.handleExpiresAt === null
      ? null
      : task.handleExpiresAt.getTime() - task.createdAt.getTime();
  if (wireTtlMs !== null && (!Number.isSafeInteger(wireTtlMs) || wireTtlMs < 0)) {
    throw new Error("TASK_TTL_SEMANTICS_MISMATCH");
  }
  if (!/^(0|[1-9][0-9]{0,19})$/.test(task.runtimeRevision)) {
    throw new Error("TASK_RUNTIME_REVISION_INVALID");
  }

  const base: Record<string, unknown> = {
    ...(projection === "create"
      ? { resultType: "task" }
      : projection === "get"
        ? { resultType: "complete" }
        : {}),
    taskId: task.taskId,
    status: task.mcpStatus,
    ...(task.statusMessage === null ? {} : { statusMessage: task.statusMessage }),
    createdAt: task.createdAt.toISOString(),
    lastUpdatedAt: task.runtimeUpdatedAt.toISOString(),
    ttlMs: wireTtlMs,
    ...(!task.mcpStatus.startsWith("completed") &&
    task.mcpStatus !== "failed" &&
    task.mcpStatus !== "cancelled"
      ? { pollIntervalMs: task.pollIntervalMs }
      : {}),
    _meta: {
      "io.sdar/taskExecution": {
        profileVersion: "1.0",
        runtimeRevision: task.runtimeRevision,
        ...(task.adapterRevision > 0 ? { providerRevision: String(task.adapterRevision) } : {}),
        ...(task.substate === null ? {} : { substate: task.substate }),
        ...(task.cancelRequested ? { cancellationRequested: true } : {}),
      },
    },
  };

  // SEP-2663 CreateTaskResult is the operational Task base. Status-specific
  // payloads are exposed only by tasks/get and task notifications.
  if (projection === "create") return base;

  if (task.mcpStatus === "input_required") {
    const open = inputRequests.filter((request) => request.status === "OPEN");
    if (open.length === 0) throw new Error("TASK_INPUT_REQUESTS_MISSING");
    base.inputRequests = Object.fromEntries(
      open.map((request) => [request.key, request.requestJson]),
    );
  } else if (task.mcpStatus === "completed") {
    if (task.result === null) throw new Error("TASK_RESULT_MISSING");
    base.result = { resultType: "complete", ...task.result };
  } else if (task.mcpStatus === "failed") {
    if (task.error === null) throw new Error("TASK_ERROR_MISSING");
    base.error = task.error;
  }

  return base;
}
