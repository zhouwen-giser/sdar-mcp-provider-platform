import { FrameViewer } from "./FrameViewer.js";
import { FRAME_TOOL } from "../shared/zmq-native.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PreviewNavigation } from "./PreviewNavigation.js";
import {
  plannerDegradationDetail,
  previewNavigations,
  recoverPreviewNavigation,
} from "../shared/preview-navigation.js";
import { api, describe, download } from "./api.js";
import { newCommandId } from "./command-id.js";
import { Diagram } from "./Diagram.js";
import { parseCoordinates, type Point } from "../shared/coordinates.js";
import { PLAN_ROUTE } from "../shared/zmq-native.js";
import { array, record, text, type Json, type CommandRow, type TaskRow } from "../shared/model.js";

const labels: Record<string, string> = {
  simulation_adjust_view: "仿真视场（专属相机）",
  chassis: "自驾",
  eo: "光电",
  simulationEffect: "仿真效果",
  vehicle_zmq_navigate: "导航",
  vehicle_zmq_area_recon: "区域侦察",
  vehicle_zmq_circular_recon: "环视",
  vehicle_zmq_camera: "云台",
  vehicle_zmq_inspect_area: "区域检查",
  simulation_apply_effect: "仿真效果交互",
};
const when = (value: unknown) =>
  typeof value === "string" ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未知";
export function freshSitePosition(state: Json): Point | undefined {
  const item = array(state.observations)
    .map(record)
    .find(
      (o) =>
        o.component === "chassis" &&
        record(o.observation).key === "localization" &&
        o.receiptFresh === true,
    );
  const p = record(record(item?.observation).position);
  return typeof p.longitude === "number" &&
    typeof p.latitude === "number" &&
    Number.isFinite(p.longitude) &&
    Number.isFinite(p.latitude)
    ? { longitude: p.longitude, latitude: p.latitude }
    : undefined;
}
export function SiteReadonlyConsole({
  device,
  session,
  commands,
  tasks,
  refresh,
  renderTask,
  siteControl = false,
  controls,
  stopControl,
  onAdoptPreview,
}: {
  device: Json;
  session: Json;
  commands: CommandRow[];
  tasks: TaskRow[];
  refresh: () => void;
  renderTask: (taskId: string) => ReactNode;
  siteControl?: boolean;
  controls?: ReactNode;
  stopControl?: ReactNode;
  onAdoptPreview?: (commandId: string, preview: Json) => Promise<CommandRow | undefined>;
}) {
  const state = record(record(device.data).vehicle_get_state),
    capabilities = record(record(device.data).vehicle_get_capabilities);
  const point = freshSitePosition(state),
    resourceId = text(device.resourceId);
  const [start, setStart] = useState(""),
    [coordinates, setCoordinates] = useState(""),
    [density, setDensity] = useState("adaptive");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [preview, setPreview] = useState<Json>();
  const [previewCommandId, setPreviewCommandId] = useState("");
  const restored = useRef(false);
  const [adopting, setAdopting] = useState(false),
    [adoptAttempted, setAdoptAttempted] = useState(false),
    [adoptError, setAdoptError] = useState<unknown>(),
    [submittedNavigation, setSubmittedNavigation] = useState<CommandRow>();
  const [selected, setSelected] = useState(""),
    [importId, setImportId] = useState("");
  const planAvailable = record(capabilities.planner).available === true;
  const navigations = previewNavigations(
    submittedNavigation && !commands.some((c) => c.commandId === submittedNavigation.commandId)
      ? [submittedNavigation, ...commands]
      : commands,
    previewCommandId,
  );
  const hasAdoption = adoptAttempted || navigations.length > 0;
  useEffect(() => {
    if (
      restored.current ||
      !commands.length ||
      !resourceId ||
      !device.catalogHash ||
      busy ||
      preview
    )
      return;
    if (start.trim() || coordinates.trim()) {
      restored.current = true;
      return;
    }
    const command = recoverPreviewNavigation(commands, resourceId, text(device.catalogHash));
    if (!command) return;
    restored.current = true;
    const saved = record(record(command.response).structuredContent),
      args = command.request.arguments;
    setPreview(saved);
    setPreviewCommandId(command.commandId);
    setStart(
      `lon: ${text(record(args.start).longitude)}, lat: ${text(record(args.start).latitude)}`,
    );
    setCoordinates(
      array(args.waypoints)
        .map((p) => `lon: ${text(record(p).longitude)}, lat: ${text(record(p).latitude)}`)
        .join("\n"),
    );
    setDensity(text(args.density) || "adaptive");
  }, [commands, resourceId, device.catalogHash, start, coordinates, busy, preview]);
  const previewPoints = array(preview?.waypoints)
    .map(record)
    .flatMap((p) =>
      typeof p.longitude === "number" && typeof p.latitude === "number"
        ? [{ longitude: p.longitude, latitude: p.latitude }]
        : [],
    );
  let draft: Point[] = [];
  try {
    if (coordinates.trim()) draft = parseCoordinates(coordinates);
  } catch {
    /* Keep incomplete input editable. */
  }
  async function plan() {
    restored.current = true;
    setError(undefined);
    setPreview(undefined);
    setPreviewCommandId("");
    setAdoptAttempted(false);
    setAdoptError(undefined);
    setSubmittedNavigation(undefined);
    setBusy(true);
    try {
      const origin = parseCoordinates(start);
      if (origin.length !== 1) throw Error("请填写一行起点经纬度");
      const row = await api<CommandRow>("/commands", {
        commandId: newCommandId(),
        kind: "tool",
        tool: PLAN_ROUTE,
        arguments: {
          resourceId,
          start: origin[0],
          waypoints: parseCoordinates(coordinates),
          density,
        },
        catalogHash: device.catalogHash,
      });
      const result = record(row.response);
      if (row.status !== "completed" || result.isError === true)
        throw Error(
          text(result.reasonCode) ||
            text(record(result.structuredContent).reasonCode) ||
            "UGV_PLANNER_PREVIEW_UNCONFIRMED",
        );
      const value = record(result.structuredContent);
      if (
        value.adoption !== "preview_only" ||
        !["ugv.zmq-route-preview/1", "ugv.zmq-route-preview/2", "ugv.zmq-route-preview/3"].includes(
          text(value.schemaVersion),
        )
      )
        throw Error("UGV_PLANNER_PREVIEW_UNCONFIRMED");
      setPreview(value);
      setPreviewCommandId(row.commandId);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      refresh();
    }
  }
  async function adopt() {
    if (!preview || !onAdoptPreview || adopting || hasAdoption) return;
    setAdopting(true);
    setAdoptAttempted(true);
    setAdoptError(undefined);
    try {
      const row = await onAdoptPreview(previewCommandId, preview);
      if (row) setSubmittedNavigation(row);
      else setAdoptError(Error("采用请求结果未确认，请查看命令记录与原任务"));
    } catch (error) {
      setAdoptError(error);
    } finally {
      setAdopting(false);
      refresh();
    }
  }
  return (
    <div className="console site-console">
      <header className="topbar">
        <div className="brand">
          <span className="brand-symbol">U</span>
          <div>
            <strong>无人车现场观测</strong>
            <small>MCP / ZMQ</small>
          </div>
        </div>
        <div className="topbar-right">
          <span className="badge warning">{siteControl ? "现场控制" : "现场只读"}</span>
          <span>{text(session.username)}</span>
          <button
            className="ghost"
            onClick={() => {
              void api("/session/logout", {}).then(() => window.location.reload());
            }}
          >
            退出
          </button>
          {stopControl ?? (
            <button className="stop" disabled title="当前只读模式不能发送停止命令">
              ■ 停止不可用 · 只读模式
            </button>
          )}
        </div>
      </header>
      <main className="workspace">
        <div className="page-heading">
          <div>
            <h1>设备观测与路线预览</h1>
            <small>
              {resourceId} · 最近读取 {when(device.receivedAt)}
            </small>
          </div>
          <button onClick={refresh}>刷新状态</button>
        </div>
        <div className="notice warning">
          {siteControl
            ? "现场控制按操作参数、组件状态和租约核实。来源启动身份、源时钟与检查完整性仍待核实；规划与实际执行分别显示。"
            : "控制准入关闭。当前数据来自真实接收，来源启动身份、源时间与完整性仍待核实；路线仅供预览，尚未采用。"}
        </div>
        {Object.keys(record(device.errors)).length > 0 && (
          <div className="notice error" role="alert">
            部分读取失败：
            {Object.entries(record(device.errors))
              .map(([k, v]) => `${k}: ${text(v)}`)
              .join("；")}
          </div>
        )}
        <section className="panel" aria-label="观测归档与准入">
          <h2>归档与控制准入</h2>
          <p>
            归档：
            {record(state.archive).status === "running"
              ? "正常写入"
              : `不可用 · ${text(record(state.archive).status)}`}
            {record(state.archive).failureCode
              ? ` · ${text(record(state.archive).failureCode)}`
              : ""}
          </p>
          <p>
            控制准入：{siteControl ? "逐操作核实" : "关闭（只读模式）"}
            。归档不可用或有效状态过期时禁止派发。
          </p>
          {array(state.archiveGaps)
            .map(record)
            .map((g) => (
              <p className="notice warning" key={text(g.eventId)}>
                已记录接收断档：{when(g.receivedAt)} · {text(g.code)}
              </p>
            ))}
          {record(state.archive).status !== "running" && (
            <div className="notice warning">
              归档接收已中断，以下连接状态是最后一次已持久化记录，不能证明当前链路正常。
            </div>
          )}
        </section>
        <section className="metrics">
          {Object.entries(record(state.channels)).map(([name, value]) => {
            const c = record(value);
            return (
              <article className="metric" key={name}>
                <span>{labels[name] ?? name}</span>
                <h2>
                  {record(state.archive).status !== "running"
                    ? "连接状态未确认"
                    : text(c.state) === "connected"
                      ? "订阅已连接"
                      : "订阅未连接"}
                </h2>
                <p>{c.receiptFresh === true ? "近期收到有效消息" : "有效消息过期或未收到"}</p>
                <small>接收 {when(c.lastValidCommittedAt)} · 源新鲜度未核实</small>
              </article>
            );
          })}
        </section>
        <div className="main-grid">
          <div>
            {controls}
            {array(device.tools).some((t) => record(t).name === FRAME_TOOL) && (
              <FrameViewer
                resourceId={resourceId}
                unavailableReason={
                  array(
                    array(capabilities.tools)
                      .map(record)
                      .find((t) => t.name === FRAME_TOOL)?.blockers,
                  ).map(text)[0]
                }
                frames={array(state.observations)
                  .map(record)
                  .map((o) => record(o.observation))
                  .filter((o) => o.key === "frame_header")
                  .map((o) => record(o.data))}
              />
            )}

            <section className="panel">
              <div className="section-head">
                <h2>7879 路线预览</h2>
                <span className="badge warning">{hasAdoption ? "已关联导航请求" : "尚未采用"}</span>
              </div>
              <p>WGS84，经度在前、纬度在后。支持 lon: …, lat: … 多行坐标；起点用于核对返回路线。</p>
              {!planAvailable && (
                <div className="notice warning">
                  规划器策略或坐标转换尚未确认 · UGV_PLANNER_FRAME_OR_POLICY_UNCONFIRMED
                </div>
              )}
              <label>
                起点经纬度
                <textarea
                  aria-label="预览起点"
                  rows={2}
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    setPreview(undefined);
                  }}
                />
              </label>
              <button
                disabled={!point}
                onClick={() => {
                  if (point) {
                    setStart(`lon: ${point.longitude}, lat: ${point.latitude}`);
                    setPreview(undefined);
                  }
                }}
              >
                填入当前接收位置
              </button>
              <small className="field-help">
                定位未收到或接收已过期时，请人工填写起点；接收新鲜不代表源时钟已核实。
              </small>
              <label>
                目的地与途经点
                <textarea
                  aria-label="预览目的地与途经点"
                  rows={5}
                  value={coordinates}
                  onChange={(e) => {
                    setCoordinates(e.target.value);
                    setPreview(undefined);
                  }}
                  placeholder="每行一个经纬度，最后一行为目的地"
                />
              </label>
              <label>
                路线密度
                <select
                  value={density}
                  onChange={(e) => {
                    setDensity(e.target.value);
                    setPreview(undefined);
                  }}
                >
                  <option value="adaptive">自适应</option>
                  <option value="dense">密集</option>
                  <option value="medium">中等</option>
                  <option value="sparse">稀疏</option>
                </select>
              </label>
              {text(record(record(capabilities.planner).mapReference).mapId) && (
                <p className="field-help">
                  当前地图：{text(record(record(capabilities.planner).mapReference).mapId)}
                  。请使用本场景的 WGS84 经纬度；起点可由新鲜定位填入。
                </p>
              )}
              {error !== undefined && (
                <div className="notice error" role="alert">
                  {describe(error)}
                </div>
              )}
              <div className="submit-row">
                <button
                  className="primary"
                  disabled={busy || !planAvailable}
                  onClick={() => {
                    void plan();
                  }}
                >
                  {busy ? "正在规划…" : "预览路线"}
                </button>
                <button
                  disabled={!preview}
                  onClick={() => download(preview, "ugv-route-preview.json")}
                >
                  下载预览报告
                </button>
              </div>
              {onAdoptPreview && (
                <button
                  disabled={!preview || adopting || hasAdoption}
                  onClick={() => {
                    void adopt();
                  }}
                >
                  {adopting ? "正在提交导航…" : hasAdoption ? "本预览已有导航请求" : "采用并导航"}
                </button>
              )}
              {adoptError !== undefined && (
                <div className="notice warning" role="alert">
                  {describe(adoptError)}。请查询原命令；重新预览后才能再次提交。
                </div>
              )}
              {navigations.map((command) => (
                <PreviewNavigation
                  key={command.commandId}
                  command={command}
                  onOpen={(id) => {
                    setSelected(id);
                    requestAnimationFrame(() =>
                      document
                        .getElementById("site-selected-task")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                    );
                  }}
                />
              ))}
              {preview && (
                <div className="notice">
                  <strong>
                    {hasAdoption ? "路线预览已生成 · 已关联导航请求" : "路线预览已生成 · 尚未采用"}
                  </strong>
                  <p>
                    {previewPoints.length} 个规划点；
                    {["ugv.zmq-route-preview/2", "ugv.zmq-route-preview/3"].includes(
                      text(preview.schemaVersion),
                    )
                      ? "已校验请求标识、任务上下文与 ENU 几何。"
                      : "仅按几何匹配，规划器未提供请求 ID。"}
                    {when(preview.createdAt)}
                  </p>
                  <small>来源 {text(preview.sourceRecordId)}</small>
                  {preview.schemaVersion === "ugv.zmq-route-preview/3" && (
                    <div
                      className={
                        record(preview.plannerAdmission).degraded === true
                          ? "notice warning"
                          : "notice"
                      }
                    >
                      <strong>
                        {record(preview.plannerAdmission).degraded === true
                          ? "上游整体降级；场景与车辆组件已开放，只读预览已校验"
                          : "场景与车辆组件准入已核实"}
                      </strong>
                      <p>
                        地图 {text(record(record(preview.transform).reference).mapId)} · 运行阶段{" "}
                        {text(record(preview.plannerAdmission).runtimePhase)}
                      </p>
                      {record(preview.plannerAdmission).degraded === true && (
                        <p>{plannerDegradationDetail(record(preview.plannerAdmission))}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
            {!siteControl && (
              <section className="panel">
                <h2>控制能力与阻塞原因</h2>
                {array(capabilities.tools)
                  .map(record)
                  .filter((t) => labels[text(t.name)])
                  .map((t) => (
                    <details key={text(t.name)}>
                      <summary>
                        <button disabled>{labels[text(t.name)]}</button> 只读模式不可执行
                      </summary>
                      <ul>
                        {array(t.blockers).map((code) => (
                          <li key={text(code)}>{describe(Error(text(code)))}</li>
                        ))}
                      </ul>
                    </details>
                  ))}
              </section>
            )}
          </div>
          <div className="right-column">
            <Diagram position={point} draft={draft} objects={[]} previewRoute={previewPoints} />
            <section className="panel">
              <h2>接收数据与来源</h2>
              <p>
                当前位置：
                {point
                  ? `${point.longitude}, ${point.latitude}`
                  : "未知 · POSITION_NOT_OBSERVED_OR_STALE"}
              </p>
              <p>诊断：{array(state.diagnostics).map(text).join(" · ")}</p>
              {array(state.observations)
                .map(record)
                .map((o) => {
                  const n = record(o.observation),
                    clock = record(n.sourceTime);
                  return (
                    <details key={`${text(o.component)}:${text(n.key)}`}>
                      <summary>
                        {labels[text(o.component)] ?? text(o.component)} / {text(n.key)} ·{" "}
                        {o.receiptFresh === true ? "近期接收" : "接收过期"}
                      </summary>
                      <p>
                        设备 {text(n.deviceId)} · 来源 {text(n.reportedOrigin)} · 接收{" "}
                        {when(o.receivedAt)}
                      </p>
                      <p>
                        源时间 {text(clock.value) || "未提供"}（{text(clock.unit)}）；校验{" "}
                        {array(o.diagnostics).map(text).join(" / ") || "通过"}
                      </p>
                      <pre>{JSON.stringify(n.data, null, 2)}</pre>
                    </details>
                  );
                })}
              <details>
                <summary>完整观测与载荷快照</summary>
                <pre>{JSON.stringify(state, null, 2)}</pre>
              </details>
            </section>
          </div>
        </div>
        <section className="panel">
          <h2>本面板任务记录</h2>
          <form
            className="import-form"
            onSubmit={(e) => {
              e.preventDefault();
              setError(undefined);
              void api("/tasks/import", { taskId: importId.trim() })
                .then(() => {
                  setSelected(importId.trim());
                  setImportId("");
                  refresh();
                })
                .catch(setError);
            }}
          >
            <input
              aria-label="导入 Task ID"
              value={importId}
              onChange={(e) => setImportId(e.target.value)}
              placeholder="输入原身份域内的 Task ID"
            />
            <button>导入任务</button>
          </form>
          <p>仅显示本面板记录或显式导入的任务。查询沿原身份域执行；历史退役任务仅供读取。</p>
          {tasks.map((t) => (
            <button className="ghost" key={t.taskId} onClick={() => setSelected(t.taskId)}>
              {labels[t.operation] ?? t.operation} · {t.taskId}
            </button>
          ))}
        </section>
        {selected && <div id="site-selected-task">{renderTask(selected)}</div>}
        <section className="panel">
          <div className="section-head">
            <h2>规划与命令记录</h2>
            <button onClick={() => download(commands, "ugv-site-command-records.json")}>
              导出记录
            </button>
          </div>
          {commands.map((c) => (
            <details key={c.commandId}>
              <summary>
                {c.request.tool ?? c.request.kind} ·{" "}
                {c.status === "completed"
                  ? c.request.tool === PLAN_ROUTE
                    ? "预览完成"
                    : "操作完成"
                  : c.status === "unknown"
                    ? "结果未确认"
                    : c.status === "rejected"
                      ? "已拒绝"
                      : c.status === "accepted"
                        ? "已受理，设备结果另行核实"
                        : c.status}{" "}
                · {when(c.createdAt)}
              </summary>
              <pre>{JSON.stringify(c, null, 2)}</pre>
            </details>
          ))}
        </section>
      </main>
    </div>
  );
}
