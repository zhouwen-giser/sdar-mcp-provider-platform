import { z } from "zod";
export type Json = Record<string, unknown>;
export const record = (v: unknown): Json =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
export const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const text = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
export interface Tool {
  name: string;
  inputSchema: Json;
  outputSchema?: Json;
  _meta?: Json;
}
export const CONTROL_TOOLS = [
  "vehicle_navigate",
  "vehicle_area_recon",
  "vehicle_inspect_area",
  "vehicle_control_gimbal",
  "vehicle_track_target",
  "vehicle_emergency_stop",
] as const;
export const READ_TOOLS = [
  "vehicle_get_state",
  "vehicle_get_capabilities",
  "vehicle_get_payload_status",
  "vehicle_get_targets",
  "vehicle_laser_range",
  "vehicle_get_trajectory_history",
  "vehicle_get_trajectory_evidence",
] as const;
export const CommandSchema = z
  .object({
    commandId: z.uuid(),
    kind: z.enum(["tool", "pause", "resume", "cancel", "input", "intervention"]),
    tool: z.string().max(128).optional(),
    taskId: z.string().min(1).max(256).optional(),
    arguments: z.record(z.string(), z.unknown()).default({}),
    timing: z
      .object({
        start: z
          .object({
            mode: z.enum(["immediate", "scheduled"]),
            startToleranceMs: z.number().int().min(0).max(86400000),
            scheduledAt: z.iso.datetime({ offset: true }).optional(),
          })
          .strict(),
        maxElapsedMs: z.number().int().min(1).max(31536000000),
      })
      .strict()
      .optional(),
    catalogHash: z.string().min(1).max(256),
  })
  .strict();
export type Command = z.infer<typeof CommandSchema>;
export interface CommandRow {
  commandId: string;
  status: string;
  request: Command;
  taskId: string | null;
  response: unknown;
  createdAt: string;
  updatedAt: string;
}
export interface TaskRow {
  taskId: string;
  operation: string;
  snapshot: Json;
  createdAt: string;
  updatedAt: string;
}
export function taskProfile(tool: Tool | undefined): Json {
  return record(tool?._meta?.["io.sdar/taskExecution"]);
}
export function classifyTask(task: Json): { label: string; tone: string } {
  const sub = record(record(task._meta)["io.sdar/taskExecution"]).substate;
  if (task.status === "working")
    return {
      label:
        sub === "stopping"
          ? "停止中"
          : sub === "paused"
            ? "已暂停"
            : sub === "pausing"
              ? "暂停中"
              : "执行中",
      tone: sub === "stopping" ? "warning" : "active",
    };
  if (task.status === "input_required") return { label: "等待人工答复", tone: "warning" };
  if (task.status === "cancelled") return { label: "已取消", tone: "muted" };
  if (task.status === "failed") return { label: "执行失败", tone: "error" };
  if (task.status === "completed") {
    const result = record(task.result),
      data = record(result.structuredContent);
    const evidence = record(data.inspectionReport ?? data.completeness ?? data.reportCompleteness);
    const outcome = text(data.outcome ?? data.status);
    if (result.isError === true || /fail|reject|error/.test(outcome))
      return { label: "业务失败", tone: "error" };
    if (
      data.complete === false ||
      data.reportComplete === false ||
      data.truncated === true ||
      evidence.complete === false ||
      ["partial", "unavailable", "incomplete"].includes(text(evidence.completion)) ||
      array(data.missingEvidence).length > 0 ||
      /partial|incomplete|degraded/.test(outcome)
    )
      return { label: "部分完成 / 证据不足", tone: "warning" };
    if (
      (Array.isArray(data.anomalies) && evidence.completion !== "complete") ||
      (result.isError !== false && !outcome)
    )
      return { label: "任务结束，需核实结果", tone: "warning" };
    return { label: "已完成", tone: "success" };
  }
  return { label: "状态未确认", tone: "warning" };
}
