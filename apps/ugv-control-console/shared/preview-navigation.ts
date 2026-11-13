import { classifyTask, record, text, type CommandRow, type Json } from "./model.js";

/** The preview is immutable; separate command records carry every adoption attempt. */
export function previewNavigations(commands: CommandRow[], previewCommandId: string) {
  if (!previewCommandId) return [];
  return commands
    .filter(
      (c) =>
        c.request.previewCommandId === previewCommandId &&
        c.request.tool === "vehicle_zmq_navigate",
    )
    .sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.commandId.localeCompare(a.commandId),
    );
}

export function recoverPreviewNavigation(
  commands: CommandRow[],
  resourceId: string,
  catalogHash: string,
) {
  return commands.find((command) => {
    const preview = record(record(command.response).structuredContent);
    return (
      command.request.tool === "vehicle_zmq_plan_route" &&
      command.status === "completed" &&
      command.request.catalogHash === catalogHash &&
      preview.resourceId === resourceId &&
      preview.adoption === "preview_only" &&
      ["ugv.zmq-route-preview/1", "ugv.zmq-route-preview/2", "ugv.zmq-route-preview/3"].includes(
        text(preview.schemaVersion),
      ) &&
      previewNavigations(commands, command.commandId).length > 0
    );
  });
}

export function navigationPresentation(command: CommandRow, task?: Json) {
  if (task) {
    const status = classifyTask(task),
      result = record(task.result),
      data = record(result.structuredContent);
    return {
      ...status,
      label: `导航${status.label}`,
      reasonCode: text(data.reasonCode) || text(task.statusMessage),
    };
  }
  const response = record(command.response);
  if (command.status === "rejected")
    return {
      label: "导航未受理",
      tone: "error",
      reasonCode: text(response.reasonCode) || text(record(response.structuredContent).reasonCode),
    };
  if (command.taskId)
    return { label: "导航已受理，正在核实执行结果", tone: "active", reasonCode: "" };
  return {
    label: command.status === "dispatching" ? "导航提交中" : "导航结果未确认",
    tone: "warning",
    reasonCode: "",
  };
}

export function plannerDegradationDetail(admission: Json) {
  const fault = text(admission.faultComponent),
    reason = text(admission.reason) || text(admission.sceneError);
  if (
    !fault ||
    reason.toLowerCase().startsWith(fault.toLowerCase() + ":") ||
    reason.startsWith(fault + "：")
  )
    return reason;
  return reason ? `${fault}：${reason}` : fault;
}
