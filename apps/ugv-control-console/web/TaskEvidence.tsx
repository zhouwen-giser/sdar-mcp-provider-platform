import { array, classifyTask, record, text, type Json } from "../shared/model.js";
import { describe } from "./api.js";

const explanations: Partial<Record<string, { title: string; detail: string }>> = {
  SOURCE_PRODUCER_EPOCH_UNATTESTED: {
    title: "设备来源纪元未认证",
    detail: "底盘消息没有可核实的启动纪元；本地接收会话不能证明设备的启动身份。",
  },
  CHASSIS_INITIAL_MISSION_STATE_NOT_OBSERVED: {
    title: "受理时缺少设备任务状态基线",
    detail:
      "任务受理时未收到有效的底盘任务状态，无法据此核实设备此前的任务；本次平台 Task 已独立记录。",
  },
  CHASSIS_FEEDBACK_UNCORRELATED: {
    title: "底盘反馈与本次任务的关联不足",
    detail: "反馈缺少足够的任务或请求关联信息，不能用于确认本次导航的执行结果。",
  },
  MODE_PUBLICATION_ORDER_UNVERIFIED: {
    title: "模式回显的命令关联与顺序未核实",
    detail: "模式状态缺少可核实的命令关联或发送方顺序；较晚接收不能单独证明由本次命令产生。",
  },
};

/** Keep execution failure separate from limitations on the report's evidence. */
export function TaskExecutionConclusion({ task }: { task: Json }) {
  const content = record(record(task.result).structuredContent),
    terminal = ["completed", "failed", "cancelled"].includes(text(task.status)),
    reason =
      (terminal ? text(content.reasonCode) : "") ||
      text(task.statusMessage) ||
      text(record(task.error).message),
    status = classifyTask(task);
  if (!reason) return null;
  return (
    <div
      className={`notice ${status.tone === "error" ? "error" : status.tone === "warning" ? "warning" : ""}`}
      role="status"
      aria-label="任务执行结论"
    >
      <strong>{status.label}</strong>
      <p>{describe(Error(reason))}</p>
    </div>
  );
}

export function TaskEvidence({ missing }: { missing: unknown }) {
  const codes = [...new Set(array(missing).map(text).filter(Boolean))];
  if (!codes.length) return null;
  return (
    <div className="notice warning" role="note" aria-label="报告证据说明">
      <strong>报告证据待核实 · {codes.length} 项</strong>
      <p>以下说明报告的可核验范围。任务的执行结论和具体原因见上方“任务执行结论”。</p>
      <ul>
        {codes.map((code) => (
          <li key={code}>
            <strong>{explanations[code]?.title ?? describe(Error(code))}</strong>
            {explanations[code] && <p>{explanations[code].detail}</p>}
            <small className="mono">{code}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
