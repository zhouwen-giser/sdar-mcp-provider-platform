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
        text(record(record(record(value).response).structuredContent).reasonCode) ||
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
  CHASSIS_PREFIX_BUSINESS_LENGTH_CRC_COMPATIBILITY:
    "当前使用显式现场接收合同：长度与 CRC 校验业务载荷",
  UGV_PLANNER_CONTEXT_MISSING: "规划器未提供有效的当前任务上下文",
  UGV_PLANNER_CONTEXT_STALE: "规划器的设备或控制器状态已过期",
  UGV_PLANNER_ENTITY_MISMATCH: "规划器受控实体与本项目设备绑定不一致",
  UGV_PLANNER_EPOCH_CHANGED: "规划过程中仿真世界版本已变化",
  UGV_PLANNER_CONTROLLER_CHANGED: "规划器控制器实例已变化",
  UGV_PLANNER_MISSION_CHANGED: "规划器当前任务已变化",
  UGV_PLANNER_CONTEXT_CHANGED: "规划期间任务上下文已变化，请重新预览",
  UGV_PLANNER_POSITION_UNAVAILABLE: "规划器缺少新鲜车辆位置",
  UGV_PLANNER_START_CHANGED: "请求起点与规划器当前车辆位置不一致",
  UGV_PLANNER_RESPONSE_TIMEOUT: "上下文已核实，等待路线响应超时",
  UGV_PLANNER_UPSTREAM_REJECTED: "上游明确拒绝本次规划",
  UGV_PLANNER_SCENE_UNAVAILABLE: "规划器场景信息暂不可核实",
  UGV_PLANNER_SCENE_NOT_READY: "上游场景正在切换、加载或尚未就绪",
  UGV_PLANNER_ADMISSION_UNAVAILABLE: "上游运行准入状态缺失或过期",
  UGV_PLANNER_ADMISSION_INVALID: "上游运行准入证据不符合合同",
  UGV_PLANNER_COMPONENT_UNAVAILABLE: "上游未开放场景或车辆组件，本次规划已拒绝",
  UGV_PLANNER_DEPLOYMENT_CHANGED: "场景与运行管理器的部署身份不一致，请稍后重新预览",
  UGV_PLANNER_SCENE_STATE_CHANGED: "场景状态与运行阶段不一致，请稍后重新预览",
  UGV_PLANNER_SCENE_MISMATCH: "规划器地图与部署配置不一致",
  UGV_PLANNER_SCENE_TRANSFORM_MISMATCH: "规划器坐标转换与配置的 ENU 参考不一致",
  UGV_PLANNER_RESPONSE_INVALID: "规划响应结构或坐标不符合合同",

  ZMQ_FRAME_AUDIT_UNAVAILABLE: "图像读取审计存储不可用，本次读取未完成",
  ZMQ_FRAME_ENDPOINT_UNCONFIGURED: "未配置独立取帧端点",
  ZMQ_FRAME_EVICTED: "指定帧已被上游淘汰，请重新选择已观测帧",
  ZMQ_FRAME_NOT_OBSERVED_OR_EXPIRED: "该帧未被当前接收会话观测，或关联记录已过期",
  ZMQ_FRAME_CACHE_EXPIRED_OR_UNAUTHORIZED: "图像缓存已失效，或当前会话无权读取",
  ZMQ_FRAME_SEND_TIMEOUT: "取帧请求发送超时",
  ZMQ_FRAME_RECEIVE_TIMEOUT: "等待原图响应超时",
  ZMQ_FRAME_RESPONSE_INVALID: "上游取帧响应无效",
  ZMQ_FRAME_RESPONSE_ASSOCIATION_INVALID: "取帧响应与指定相机、帧或请求不一致",
  ZMQ_FRAME_OBSERVATION_MISMATCH: "图像元数据与已观测帧不一致",
  ZMQ_FRAME_JPEG_INVALID: "JPEG 无效或超过解码资源上限",
  ZMQ_FRAME_JPEG_DIMENSIONS_INVALID: "JPEG 实际尺寸与元数据不一致",
  ZMQ_FRAME_CHUNK_INTEGRITY_FAILED: "图像分块或完整文件校验失败",
  ZMQ_FRAME_CAMERA_NOT_FOUND: "上游未注册该相机",
  ZMQ_FRAME_CHANNEL_BUSY: "已有图像读取进行中，请稍后重试",

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
