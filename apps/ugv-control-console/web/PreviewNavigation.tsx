import { useQuery } from "@tanstack/react-query";
import { api, describe } from "./api.js";
import { record, text, type CommandRow, type Json } from "../shared/model.js";
import { navigationPresentation } from "../shared/preview-navigation.js";

export function PreviewNavigationView({
  command,
  task,
  error,
  onOpen,
}: {
  command: CommandRow;
  task?: Json;
  error?: unknown;
  onOpen: (taskId: string) => void;
}) {
  const status =
    error !== undefined
      ? { label: "导航结果未确认", tone: "warning", reasonCode: "" }
      : navigationPresentation(command, task);
  return (
    <div
      className={`notice ${status.tone === "error" ? "error" : status.tone === "warning" ? "warning" : ""}`}
      role="status"
      aria-label="本预览的导航结果"
    >
      <strong>{status.label}</strong>
      {status.reasonCode && <p>{describe(Error(status.reasonCode))}</p>}
      {error !== undefined && (
        <p>任务查询暂不可用：{describe(error)}。请查看原任务，系统不会重新派发。</p>
      )}
      <p>导航命令 {command.commandId}</p>
      {command.taskId && (
        <>
          <p>Task ID：{command.taskId}</p>
          <button onClick={() => onOpen(command.taskId ?? "")}>查看导航任务详情</button>
        </>
      )}
      <small>
        预览记录保持原样；导航以关联任务的设备结果为准。如需再次提交，请重新预览并确认。
      </small>
    </div>
  );
}

export function PreviewNavigation({
  command,
  onOpen,
}: {
  command: CommandRow;
  onOpen: (taskId: string) => void;
}) {
  const taskId = command.taskId ?? "";
  const task = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api<Json>(`/tasks/${encodeURIComponent(taskId)}`),
    enabled: !!taskId,
    refetchInterval: (q) =>
      record(q.state.data?._consoleRetention).readOnly === true ||
      ["completed", "failed", "cancelled"].includes(text(q.state.data?.status))
        ? false
        : 2000,
  });
  return (
    <PreviewNavigationView
      command={command}
      {...(task.data ? { task: task.data } : {})}
      {...(task.error ? { error: task.error } : {})}
      onOpen={onOpen}
    />
  );
}
