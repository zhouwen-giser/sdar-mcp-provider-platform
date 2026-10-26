import { record, text } from "../shared/model.js";
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly payload: unknown,
    readonly status: number,
  ) {
    super(code);
  }
}
export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...(body !== undefined
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const value: unknown = await response.json();
  if (response.status === 401 && path !== "/session/login")
    window.dispatchEvent(new Event("ugv-session-expired"));
  if (!response.ok)
    throw new ApiError(
      text(record(value).reasonCode) ||
        text(record(record(value).response).reasonCode) ||
        "请求未受理",
      value,
      response.status,
    );
  return value as T;
}
export function download(value: unknown, name: string) {
  const href = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
export const reasons: Record<string, string> = {
  ZMQ_SITE_READONLY_CONTROL_DISABLED: "现场只读模式，设备控制尚未开放",
  ZMQ_CHASSIS_CONTROL_SENDER_UNSPECIFIED: "控制端 ID 保持缺省，底盘发令身份尚未确认",
  SOURCE_RESTART_RECONCILIATION_UNAVAILABLE: "来源服务重启后的动作对账证据不足",
  CHASSIS_FEEDBACK_UNCORRELATED: "底盘反馈缺少足够的任务与请求关联",
  INSPECTION_SOURCE_STREAM_NOT_RECOVERABLE: "检查报告流缺少完整补取和完整性证据",
  SIMULATION_ID_UNCONFIRMED: "仿真场景 ID 尚未确认",
  EVIDENCE_DEPLOYMENTIDENTITY_MISSING: "缺少部署身份核验证据",
  EVIDENCE_TIMEANDCOORDINATES_MISSING: "缺少源时钟与坐标约定证据",
  EVIDENCE_OPTICALGEOMETRYANDLIMITS_MISSING: "缺少光电几何与动作范围核验证据",
  EVIDENCE_CAPABILITYSCOPE_MISSING: "缺少现场能力范围核验证据",
  EVIDENCE_SERVERIMPLEMENTATION_MISSING: "缺少上游实现保证的核验证据",
  EVIDENCE_PLANNERPOLICY_MISSING: "缺少规划器策略核验证据",
  EVIDENCE_PROVIDERGOLDENFRAMES_MISSING: "缺少上游确认的协议样本",
  UGV_PLANNER_TIMEOUT: "三秒内未收到匹配起点及途经点的路线，请核实起点和规划服务状态",
  UGV_PLANNER_BUSY: "同一规划服务已有预览请求，请稍后手动重试",
  UGV_PLANNER_TRANSPORT_FAILED: "规划服务连接失败",
  UGV_PLANNER_CONNECTION_CLOSED: "规划服务连接已断开",
  UGV_PLANNER_FRAME_OR_POLICY_UNCONFIRMED: "规划器策略或场景坐标转换尚未确认",
  UGV_PLANNER_SOURCE_TOO_LARGE: "规划响应超过保留上限，本次预览已拒绝",
  LOGIN_REQUIRED: "请先登录",
  LOGIN_FAILED: "账号或密码不正确",
  LOGIN_RATE_LIMITED: "登录尝试过多，请稍后重试",
  UGV_STATE_STALE: "设备状态过期或时钟偏差，当前不可派发",
  UGV_MQTT_UNAVAILABLE: "MQTT 链路不可用",
  UGV_DEVICE_MCP_UNAVAILABLE: "设备 MCP 链路不可用",
  UGV_EO_TRACK_BUSY: "光电通道被占用",
  UGV_EXTERNAL_EO_TRACK_BUSY: "设备报告光电任务仍在执行，通道尚未释放",
  UGV_CHASSIS_TRACK_BUSY: "底盘通道被占用",
  CATALOG_CHANGED_REFRESH_REQUIRED: "能力目录已更新，请刷新参数",
  MCP_TRANSPORT_UNCERTAIN: "MCP 连接中断，请求结果未确认",
  MCP_TASK_PROFILE_MISMATCH: "任务合同不匹配",
  TOOL_ARGUMENTS_SCHEMA_MISMATCH: "参数不符合当前工具合同",
  TOOL_UNPUBLISHED: "当前未发布此能力",
  BUSINESS_INPUT_REQUEST_SUPERSEDED: "人工请求已更新或失效",
  PLAN_REVISION_CONFLICT: "计划版本已变化，请刷新任务",
  TASK_ALREADY_TERMINAL: "任务已经结束",
  COMMAND_ID_CONFLICT: "命令标识与原内容冲突",
  CONSOLE_OPERATION_FAILED: "操作失败，请查看连接状态和任务记录",
  UGV_FIRE_DISABLED: "站点已禁用此能力",
};
export function describe(error: unknown) {
  const code =
    error instanceof ApiError ? error.code : error instanceof Error ? error.message : String(error);
  return reasons[code] ? `${reasons[code]} · ${code}` : code;
}
