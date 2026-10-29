import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, describe, download } from "./api.js";
import { newCommandId } from "./command-id.js";
import { AvailabilityNotice } from "./AvailabilityNotice.js";
import { Diagram, visibleGeometryObjects } from "./Diagram.js";
import { SiteControlConsole } from "./SiteControlConsole.js";
import { SiteReadonlyConsole } from "./SiteReadonlyConsole.js";
import { siteReadonlyTools, siteControlTools } from "../shared/zmq-native.js";
import { ZmqResults } from "./ZmqResults.js";
import { SimulationViewResult } from "./SimulationViewResult.js";
import {
  NATIVE_CONTROL_TOOLS,
  isZmqControl,
  ZMQ_INSPECT,
  EFFECT_APPLY,
  inspectionArguments,
  zmqToolReason,
} from "../shared/zmq.js";
import { parseCoordinates, regionArguments, type Point } from "../shared/coordinates.js";
import {
  array,
  classifyTask,
  record,
  taskProfile,
  text,
  type Command,
  type CommandRow,
  type Json,
  type TaskRow,
  type Tool,
} from "../shared/model.js";
import "./styles.css";
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
});
const labels: Record<string, string> = {
  vehicle_navigate: "导航",
  vehicle_area_recon: "区域侦察",
  vehicle_inspect_area: "区域检查",
  vehicle_control_gimbal: "云台",
  vehicle_track_target: "目标跟踪",
  vehicle_emergency_stop: "紧急停止",
  vehicle_zmq_navigate: "ZMQ 导航",
  vehicle_zmq_area_recon: "ZMQ 区域侦察",
  vehicle_zmq_circular_recon: "ZMQ 环视",
  vehicle_zmq_camera: "ZMQ 云台",
  simulation_adjust_view: "仿真视场（专属相机）",
  [ZMQ_INSPECT]: "ZMQ 区域检查",
  [EFFECT_APPLY]: "仿真效果",
};
const num = (v: unknown, digits = 2) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
const when = (v: unknown) =>
  typeof v === "string" ? new Date(v).toLocaleString("zh-CN", { hour12: false }) : "—";
function JsonView({ value, title = "原始数据" }: { value: unknown; title?: string }) {
  return (
    <details className="json-view">
      <summary>{title}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
function ErrorNote({ error }: { error: unknown }) {
  return error ? (
    <div role="alert" className="notice error">
      {describe(error)}
    </div>
  ) : null;
}
function Badge({ label, tone = "muted" }: { label: string; tone?: string }) {
  return <span className={`badge ${tone}`}>{label}</span>;
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("operator"),
    [password, setPassword] = useState(""),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <div className="login-art">
        <span className="eyebrow">SMPP / FIELD OPERATIONS</span>
        <h1>
          掌握状态，
          <br />
          执行每一步。
        </h1>
        <div className="radar">
          <span />
          <span />
          <span />
          <b>UGV</b>
        </div>
        <p>
          无人车 MCP 控制台
          <br />
          <small>设备状态 · 导航侦察 · 任务证据</small>
        </p>
      </div>
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(undefined);
          void api("/session/login", { username, password })
            .then(() => {
              setPassword("");
              onLogin();
            })
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        <span className="eyebrow">OPERATOR ACCESS</span>
        <h2>登录控制台</h2>
        <p className="muted">使用部署时配置的操作员账号</p>
        <label>
          账号
          <input
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label>
          密码
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <ErrorNote error={error} />
        <button className="primary" disabled={busy}>
          {busy ? "正在登录…" : "进入控制台 →"}
        </button>
        <small>通过同源接口访问设备控制功能</small>
      </form>
    </main>
  );
}
function Console() {
  const qc = useQueryClient();
  const session = useQuery({ queryKey: ["session"], queryFn: () => api<Json>("/session") });
  const [toolName, setToolName] = useState("vehicle_navigate"),
    [selected, setSelected] = useState(""),
    [notice, setNotice] = useState<unknown>(),
    [measurement, setMeasurement] = useState<Json>(),
    [sending, setSending] = useState(false),
    [stopPending, setStopPending] = useState(false),
    [importId, setImportId] = useState("");
  useEffect(() => {
    const expired = () => {
      qc.setQueryData(["session"], null);
      setSelected("");
    };
    window.addEventListener("ugv-session-expired", expired);
    return () => window.removeEventListener("ugv-session-expired", expired);
  }, [qc]);
  const device = useQuery({
    queryKey: ["device"],
    queryFn: () => api<Json>("/device"),
    enabled: !!session.data,
    refetchInterval: 3000,
  });
  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: () => api<TaskRow[]>("/tasks"),
    enabled: !!session.data,
    refetchInterval: 3000,
  });
  const commands = useQuery({
    queryKey: ["commands"],
    queryFn: () => api<CommandRow[]>("/commands"),
    enabled: !!session.data,
    refetchInterval: 3000,
  });
  const selectedBusiness = useQuery({
    queryKey: ["business", selected],
    queryFn: () => api<Json>(`/tasks/${encodeURIComponent(selected)}/business`),
    enabled: !!selected,
  });
  const d = record(device.data),
    data = record(d.data),
    state = record(data.vehicle_get_state),
    zmqState = state.schemaVersion === "ugv.vehicle-observation-state/2.0",
    location = array(state.observations)
      .map(record)
      .find(
        (o) =>
          o.component === "chassis" &&
          record(o.observation).key === "localization" &&
          o.receiptFresh === true,
      ),
    chassis: Json = zmqState
      ? { position: record(record(location?.observation).position) }
      : record(state.chassis),
    connectivity = record(state.connectivity),
    freshness = record(state.freshness);
  const tools = array(d.tools) as Tool[],
    resourceId = text(d.resourceId),
    catalogHash = text(d.catalogHash),
    currentTool = tools.find((t) => t.name === toolName);
  const [mode, setMode] = useState("point"),
    [coordinates, setCoordinates] = useState(""),
    [distance, setDistance] = useState("5"),
    [direction, setDirection] = useState("forward"),
    [speed, setSpeed] = useState("3"),
    [avoid, setAvoid] = useState(true),
    [planning, setPlanning] = useState("auto"),
    [budget, setBudget] = useState("300"),
    [scheduled, setScheduled] = useState("");
  const [scanMode, setScanMode] = useState("area"),
    [scanCount, setScanCount] = useState("1"),
    [sensor, setSensor] = useState("adaptive"),
    [scanPitch, setScanPitch] = useState(""),
    [scanSpeed, setScanSpeed] = useState("");
  const [gimbalMode, setGimbalMode] = useState("absolute"),
    [yaw, setYaw] = useState("0"),
    [pitch, setPitch] = useState("0"),
    [zoom, setZoom] = useState(""),
    [targetId, setTargetId] = useState("");
  const [ellipsoidHeight, setEllipsoidHeight] = useState(""),
    [searchStrategy, setSearchStrategy] = useState("recognize"),
    [effectIndex, setEffectIndex] = useState("");
  const [nativeParameters, setNativeParameters] = useState("{}");
  const [previewRequest, setPreviewRequest] = useState<{ request: Json; generation: number }>();
  const previewGeneration = useRef(0);
  const preview = useQuery({
    queryKey: ["availability", previewRequest],
    queryFn: () => api<Json>("/availability", previewRequest?.request),
    enabled: !!previewRequest && !!session.data,
    refetchInterval: 2000,
  });
  const preflight = preview.data,
    previewBusy = preview.isFetching;
  const targetData = record(data.vehicle_get_targets),
    targets = array(targetData.targets).map(record);
  const effectCandidates = array(targetData.effectCandidates).map(record);
  const position = record(chassis.position);
  const point =
    typeof position.longitude === "number" && typeof position.latitude === "number"
      ? { longitude: position.longitude, latitude: position.latitude }
      : undefined;
  let draft: Point[] = [];
  try {
    if (
      coordinates.trim() &&
      ["vehicle_navigate", "vehicle_area_recon", "vehicle_inspect_area", ZMQ_INSPECT].includes(
        toolName,
      )
    )
      draft = parseCoordinates(coordinates);
  } catch {
    /* Incomplete drafts stay editable. */
  }
  const build = (): Json => {
    if (!resourceId) throw Error("资源绑定尚未解析");
    if (NATIVE_CONTROL_TOOLS.includes(toolName)) {
      const value = JSON.parse(nativeParameters) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("ZMQ 参数必须为 JSON 对象");
      return { ...record(value), resourceId };
    }
    if (toolName === "vehicle_navigate") {
      let mission: Json = { type: mode };
      if (mode === "point" || mode === "route") {
        const points = parseCoordinates(coordinates);
        if (mode === "point" && points.length !== 1) throw Error("单点导航只接受一行坐标");
        mission =
          mode === "point" ? { type: mode, target: points[0] } : { type: mode, waypoints: points };
      }
      if (mode === "distance") mission = { type: mode, direction, distanceM: Number(distance) };
      return {
        resourceId,
        mission,
        speedLimitKmh: Number(speed),
        stopOnObstacle: avoid,
        planningMode: planning,
      };
    }
    if (toolName === "vehicle_area_recon")
      return {
        ...(scanMode === "area"
          ? regionArguments(resourceId, coordinates, false)
          : { resourceId, scanMode: "circular" }),
        scanCount: Number(scanCount),
        reconType: sensor,
        ...(scanPitch !== "" ? { scanPitch: Number(scanPitch) } : {}),
        ...(scanSpeed !== "" ? { scanSpeed: Number(scanSpeed) } : {}),
      };
    if (toolName === "vehicle_inspect_area") return regionArguments(resourceId, coordinates, true);
    if (toolName === ZMQ_INSPECT)
      return inspectionArguments(resourceId, coordinates, ellipsoidHeight, searchStrategy);
    if (toolName === EFFECT_APPLY) {
      const candidate = effectCandidates.find(
        (v) => JSON.stringify({ targetId: v.targetId, observation: v.observation }) === effectIndex,
      );
      if (!effectIndex || !candidate) throw Error("请选择带有效地理位置及执行来源的当前仿真观测");
      return {
        resourceId,
        targetId: candidate.targetId,
        position: candidate.position,
        observation: candidate.observation,
      };
    }
    if (toolName === "vehicle_control_gimbal")
      return {
        resourceId,
        mode: gimbalMode,
        ...(gimbalMode === "reset"
          ? {}
          : {
              yaw: Number(yaw),
              pitch: Number(pitch),
              ...(zoom !== "" ? { deltaZoom: Number(zoom) } : {}),
            }),
      };
    if (toolName === "vehicle_track_target") {
      if (!targetId) throw Error("请选择当前观测目标");
      return { resourceId, targetId };
    }
    throw Error("此工具没有专用控制表单");
  };
  const timing = (): Command["timing"] => ({
    start: {
      mode:
        scheduled && taskProfile(currentTool).supportsScheduling === true
          ? "scheduled"
          : "immediate",
      startToleranceMs: 60000,
      ...(scheduled && taskProfile(currentTool).supportsScheduling === true
        ? { scheduledAt: new Date(scheduled).toISOString() }
        : {}),
    },
    maxElapsedMs: Number(budget) * 1000,
  });
  useEffect(
    () => setPreviewRequest(undefined),
    [
      toolName,
      mode,
      coordinates,
      distance,
      direction,
      speed,
      avoid,
      planning,
      budget,
      scheduled,
      scanMode,
      scanCount,
      sensor,
      scanPitch,
      scanSpeed,
      gimbalMode,
      yaw,
      pitch,
      zoom,
      targetId,
      ellipsoidHeight,
      searchStrategy,
      effectIndex,
      catalogHash,
    ],
  );
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["availability"] });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
    void qc.invalidateQueries({ queryKey: ["commands"] });
    void qc.invalidateQueries({ queryKey: ["task", selected] });
    void qc.invalidateQueries({ queryKey: ["business", selected] });
  };
  const submit = async (command: Omit<Command, "commandId" | "catalogHash">, stop = false) => {
    (stop ? setStopPending : setSending)(true);
    setNotice(undefined);
    const request: Command = { ...command, commandId: newCommandId(), catalogHash };
    try {
      const result = await api<CommandRow>("/commands", request);
      if (result.taskId) setSelected(result.taskId);
      if (result.status === "unknown")
        setNotice(Error("请求结果未确认，请查看命令记录。系统不会自动重发。"));
    } catch (error) {
      if (error instanceof ApiError && record(error.payload).commandId) {
        const row = record(error.payload);
        const response = record(row.response);
        setNotice(Error(text(response.reasonCode) || text(response.description) || "命令未受理"));
      } else setNotice(error);
    } finally {
      (stop ? setStopPending : setSending)(false);
      refresh();
    }
  };
  const doTool = () => {
    try {
      const args = build();
      void submit({ kind: "tool", tool: toolName, arguments: args, timing: timing() });
    } catch (e) {
      setNotice(e);
    }
  };
  const inspectAvailable = () => {
    setNotice(undefined);
    try {
      const request = { tool: toolName, arguments: build(), timing: timing() };
      setPreviewRequest({ request, generation: ++previewGeneration.current });
    } catch (e) {
      setNotice(e);
    }
  };
  if (session.isPending) return <div className="loading">正在连接控制台…</div>;
  if (!session.data)
    return (
      <Login
        onLogin={() => {
          void qc.invalidateQueries();
        }}
      />
    );
  if (siteReadonlyTools(tools) || siteControlTools(tools))
    return React.createElement(siteControlTools(tools) ? SiteControlConsole : SiteReadonlyConsole, {
      device: d,
      session: session.data,
      commands: commands.data ?? [],
      tasks: tasks.data ?? [],
      refresh: () => {
        void device.refetch();
        refresh();
      },
      renderTask: (id: string) => (
        <TaskDetail
          taskId={id}
          operationName={tasks.data?.find((t) => t.taskId === id)?.operation ?? ""}
          tools={tools}
          resourceId={resourceId}
          position={point}
          sending={false}
          submit={(command) => submit(command)}
        />
      ),
    });
  const controls = Object.keys(labels).filter((name) => name !== "vehicle_emergency_stop");
  const compatible =
    !!currentTool &&
    taskProfile(currentTool).taskBehavior === "task_required" &&
    taskProfile(currentTool).profileVersion === "1.0" &&
    taskProfile(currentTool).idempotency === "server_managed" &&
    !zmqToolReason(currentTool, resourceId) &&
    (!isZmqControl(toolName) || session.data.executionMode === "simulation");

  return (
    <div className="console">
      <header className="topbar">
        <div className="brand">
          <span className="brand-symbol">U</span>
          <div>
            <strong>无人车控制台</strong>
            <small>SMPP / MCP OPERATIONS</small>
          </div>
        </div>
        <div className="topbar-right">
          <Badge
            label={text(session.data.executionMode) === "live" ? "现场模式" : "仿真模式"}
            tone={text(session.data.executionMode) === "live" ? "warning" : "active"}
          />
          <span className="operator">{text(session.data.username)}</span>
          <button
            className="ghost"
            onClick={() => {
              void api("/session/logout", {}).then(() => {
                qc.clear();
                void qc.invalidateQueries();
                window.location.reload();
              });
            }}
          >
            退出
          </button>
          <button
            className="stop"
            disabled={
              stopPending || !catalogHash || !tools.some((t) => t.name === "vehicle_emergency_stop")
            }
            onClick={() => {
              void submit(
                {
                  kind: "tool",
                  tool: "vehicle_emergency_stop",
                  arguments: { resourceId },
                  timing: {
                    start: { mode: "immediate", startToleranceMs: 30000 },
                    maxElapsedMs: 300000,
                  },
                },
                true,
              );
            }}
          >
            {stopPending ? "正在请求停止…" : "■ 紧急停止"}
          </button>
        </div>
      </header>
      <main className="workspace">
        <div className="page-heading">
          <div>
            <span className="eyebrow">DEVICE WORKSPACE</span>
            <h1>
              设备工作台 <span>{resourceId || "连接中"}</span>
            </h1>
          </div>
          <div className="updated">
            最近接收 {when(d.receivedAt)}
            <button
              className="ghost"
              onClick={() => {
                void device.refetch();
                refresh();
              }}
            >
              ↻ 刷新
            </button>
          </div>
        </div>
        <ErrorNote error={device.error} />
        <ErrorNote error={notice} />
        {zmqState && (
          <div className="notice warning">
            ZMQ 观测视图 · {text(state.deploymentBinding)} ·
            来源启动身份和完整性未验证。仅显示可关联的新鲜位置；没有来源的速度、航向及覆盖足迹保持未知。
          </div>
        )}
        {Object.keys(record(d.errors)).length > 0 && (
          <div className="notice warning">
            部分设备数据不可用：
            {Object.entries(record(d.errors))
              .map(([key, v]) => `${labels[key] ?? key}: ${text(v)}`)
              .join("；")}
          </div>
        )}
        <section className="metrics">
          <Metric
            title="MCP RUNTIME"
            value={device.isSuccess ? "已接入" : "未连接"}
            detail={text(record(d.provider).providerId) || "等待协议发现"}
            ok={device.isSuccess}
          />
          <Metric
            title="设备链路"
            value={
              zmqState
                ? "ZMQ 观测"
                : connectivity.deviceAvailable === true
                  ? "设备在线"
                  : "状态未知 / 离线"
            }
            detail={
              zmqState
                ? Object.entries(record(state.channels))
                    .map(
                      ([name, channel]) =>
                        `${name} ${text(record(channel).state)} / ${record(channel).receiptFresh === true ? "接收新鲜" : "陈旧或缺失"}`,
                    )
                    .join(" · ")
                : `MQTT ${connectivity.mqttConnected === true ? "在线" : "未确认"} · 设备 MCP ${connectivity.deviceMcpConnected === true ? "在线" : "未确认"}`
            }
            ok={
              zmqState
                ? Object.values(record(state.channels)).every(
                    (v) => record(v).receiptFresh === true,
                  )
                : connectivity.deviceAvailable === true
            }
          />
          <Metric
            title="上报位置 · WGS84"
            value={point ? `${num(point.longitude, 8)}, ${num(point.latitude, 8)}` : "—"}
            detail={`速度 ${num(chassis.speedKmh)} km/h`}
          />
          <Metric
            title="数据与载荷"
            value={
              text(
                record(record(data.vehicle_get_payload_status).reconnaissance).loadStatusLabel,
              ) ||
              text(record(record(state.payload).reconnaissance).loadStatusLabel) ||
              "待核实"
            }
            detail={`底盘源时间 ${when(freshness.chassisObservedAt)}`}
          />
        </section>
        <div className="main-grid">
          <section className="control-panel">
            <div className="section-head">
              <div>
                <span className="eyebrow">COMMAND CENTER</span>
                <h2>设备控制</h2>
              </div>
              <Badge label="MCP 标准任务" tone="active" />
            </div>
            <div className="tabs" role="tablist">
              {controls.map((name) => (
                <button
                  role="tab"
                  aria-selected={name === toolName}
                  key={name}
                  className={name === toolName ? "selected" : ""}
                  onClick={() => setToolName(name)}
                >
                  {labels[name]}
                </button>
              ))}
            </div>
            <div className="control-body">
              {!compatible && (
                <div className="notice warning">
                  {currentTool
                    ? (zmqToolReason(currentTool, resourceId) ?? "当前任务合同或执行域不兼容")
                    : "当前目录未发布此能力"}
                  ，请查看能力目录与连接诊断。
                </div>
              )}
              {toolName === "vehicle_navigate" && (
                <>
                  <div className="form-row">
                    <label>
                      导航方式
                      <select value={mode} onChange={(e) => setMode(e.target.value)}>
                        <option value="point">单点导航</option>
                        <option value="route">航点路线</option>
                        <option value="distance">方向距离</option>
                        <option value="return_home">返航</option>
                      </select>
                    </label>
                    <label>
                      速度上限 km/h
                      <input
                        type="number"
                        min=".1"
                        step=".1"
                        value={speed}
                        onChange={(e) => setSpeed(e.target.value)}
                      />
                    </label>
                  </div>
                  {mode === "distance" && (
                    <div className="form-row">
                      <label>
                        方向
                        <select value={direction} onChange={(e) => setDirection(e.target.value)}>
                          <option value="forward">前进</option>
                          <option value="backward">后退</option>
                          <option value="left">左移</option>
                          <option value="right">右移</option>
                        </select>
                      </label>
                      <label>
                        距离 m
                        <input
                          type="number"
                          min=".1"
                          value={distance}
                          onChange={(e) => setDistance(e.target.value)}
                        />
                      </label>
                    </div>
                  )}
                  <div className="form-row">
                    <label>
                      规划模式
                      <select value={planning} onChange={(e) => setPlanning(e.target.value)}>
                        <option value="auto">自动规划</option>
                        <option value="road_network">路网规划</option>
                        <option value="direct">直接规划</option>
                      </select>
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={avoid}
                        onChange={(e) => setAvoid(e.target.checked)}
                      />
                      遇障停止
                    </label>
                  </div>
                </>
              )}
              {toolName === "vehicle_area_recon" && (
                <>
                  <div className="form-row">
                    <label>
                      扫描模式
                      <select value={scanMode} onChange={(e) => setScanMode(e.target.value)}>
                        <option value="area">区域侦察</option>
                        <option value="circular">环视侦察</option>
                      </select>
                    </label>
                    <label>
                      扫描次数
                      <input
                        type="number"
                        min="0"
                        max="1000"
                        value={scanCount}
                        onChange={(e) => setScanCount(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="form-row">
                    <label>
                      传感器
                      <select value={sensor} onChange={(e) => setSensor(e.target.value)}>
                        <option value="adaptive">自适应</option>
                        <option value="visible">可见光</option>
                        <option value="infrared">红外</option>
                        <option value="dc">DC</option>
                      </select>
                    </label>
                    <label>
                      扫描俯仰 °（可选）
                      <input
                        type="number"
                        min="-90"
                        max="90"
                        value={scanPitch}
                        onChange={(e) => setScanPitch(e.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    扫描速度（设备合同单位，可选）
                    <input
                      type="number"
                      min=".01"
                      step=".1"
                      value={scanSpeed}
                      onChange={(e) => setScanSpeed(e.target.value)}
                    />
                  </label>
                </>
              )}
              {NATIVE_CONTROL_TOOLS.includes(toolName) && (
                <>
                  <label>
                    ZMQ 参数（JSON，不含 resourceId）
                    <textarea
                      aria-label="ZMQ 原生参数"
                      value={nativeParameters}
                      onChange={(e) => setNativeParameters(e.target.value)}
                      rows={12}
                    />
                  </label>
                  <p className="muted">
                    导航坐标为
                    WGS84，经度在前、纬度在后；速度为米/秒。云台角度为弧度。区域须四个严格凸顶点并逐点提供椭球高。参数将按当前发布合同校验。
                  </p>
                  <JsonView value={currentTool?.inputSchema} title="查看本工具的参数格式" />
                </>
              )}
              {((toolName === "vehicle_navigate" && ["point", "route"].includes(mode)) ||
                (toolName === "vehicle_area_recon" && scanMode === "area") ||
                toolName === "vehicle_inspect_area" ||
                toolName === ZMQ_INSPECT) && (
                <>
                  <label>
                    WGS84 坐标 · 经度在前，纬度在后
                    <textarea
                      className="coordinate-input"
                      aria-label="WGS84 坐标"
                      spellCheck={false}
                      value={coordinates}
                      onChange={(e) => setCoordinates(e.target.value)}
                      placeholder={
                        "106.81283082, 29.72057535\n106.81302505, 29.72031863\n106.81328403, 29.72044495\n106.81311812, 29.72077910"
                      }
                    />
                  </label>
                  <div className="field-help">
                    每行一个点，也支持 lon: …, lat: …。在文本中直接编辑、排序或删除顶点。
                  </div>
                  <div className="button-group">
                    <button
                      onClick={() => {
                        if (point) setCoordinates(`${point.longitude}, ${point.latitude}`);
                      }}
                      disabled={!point}
                    >
                      填入当前位置
                    </button>
                    <button onClick={() => setCoordinates("")}>清空</button>
                    <span className="muted">已解析 {draft.length} 个点</span>
                  </div>
                </>
              )}
              {toolName === "vehicle_inspect_area" && (
                <p className="field-help">
                  执行一次区域检查，最长 300 秒。报告将分别列出发现、覆盖情况与缺失证据。
                </p>
              )}
              {toolName === ZMQ_INSPECT && (
                <>
                  <div className="form-row">
                    <label>
                      已确认的 WGS84 椭球高 m
                      <input
                        aria-label="WGS84 椭球高"
                        type="number"
                        step="any"
                        value={ellipsoidHeight}
                        onChange={(e) => setEllipsoidHeight(e.target.value)}
                      />
                    </label>
                    <label>
                      搜索策略
                      <select
                        value={searchStrategy}
                        onChange={(e) => setSearchStrategy(e.target.value)}
                      >
                        <option value="recognize">识别</option>
                        <option value="track">识别与自动跟踪</option>
                      </select>
                    </label>
                  </div>
                  <p className="field-help">
                    光电 2.2
                    仅接收四个严格凸顶点和明确的椭球高；不接受排除区。一次扫描，平台期限不超过 300
                    秒。检查成果按来源、覆盖与轨迹证据分别降级。
                  </p>
                </>
              )}
              {toolName === EFFECT_APPLY && (
                <>
                  <label>
                    当前可关联的仿真地理观测
                    <select
                      aria-label="仿真观测"
                      value={effectIndex}
                      onChange={(e) => setEffectIndex(e.target.value)}
                    >
                      <option value="">请选择观测</option>
                      {effectCandidates.map((v, i) => (
                        <option
                          key={i}
                          value={JSON.stringify({
                            targetId: v.targetId,
                            observation: v.observation,
                          })}
                        >
                          {text(v.targetId)} · {text(v.observedAt) || "采集时间待核实"} · rev{" "}
                          {text(record(v.observation).revision)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!effectCandidates.length && (
                    <p className="notice warning">
                      没有带有效地理位置、采集时间与执行来源的当前观测。像素检测项不能直接用于仿真交互。
                    </p>
                  )}
                  <p className="field-help">
                    位置快照和来源版本随请求固定。此动作一经受理无法暂停或撤销；超时后继续显示未结束占用及迟到结果。
                  </p>
                </>
              )}
              {toolName === "vehicle_control_gimbal" && (
                <>
                  <label>
                    控制方式
                    <select value={gimbalMode} onChange={(e) => setGimbalMode(e.target.value)}>
                      <option value="absolute">绝对角度</option>
                      <option value="relative">相对调整</option>
                      <option value="reset">复位</option>
                    </select>
                  </label>
                  {gimbalMode !== "reset" && (
                    <>
                      <div className="form-row">
                        <label>
                          偏航 °
                          <input
                            type="number"
                            min="-180"
                            max="180"
                            value={yaw}
                            onChange={(e) => setYaw(e.target.value)}
                          />
                        </label>
                        <label>
                          俯仰 °
                          <input
                            type="number"
                            min="-90"
                            max="90"
                            value={pitch}
                            onChange={(e) => setPitch(e.target.value)}
                          />
                        </label>
                      </div>
                      <label>
                        缩放增量（可选）
                        <input
                          type="number"
                          step=".1"
                          value={zoom}
                          onChange={(e) => setZoom(e.target.value)}
                        />
                      </label>
                    </>
                  )}
                </>
              )}
              {toolName === "vehicle_track_target" && (
                <>
                  <label>
                    当前观测目标
                    <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                      <option value="">请选择目标</option>
                      {targets.map((target, i) => {
                        const id = text(target.targetId ?? target.id);
                        return (
                          <option value={id} key={id || i}>
                            {text(target.type ?? target.targetType) || "目标"} · {id}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <p className="field-help">
                    目标可用性由提交时的设备状态核实，历史目标不能直接作为当前观测。
                  </p>
                </>
              )}
              <details className="advanced">
                <summary>执行时序</summary>
                <div className="form-row">
                  <label>
                    最大执行时间 s
                    <input
                      type="number"
                      min="1"
                      max={
                        ["vehicle_inspect_area", ZMQ_INSPECT, EFFECT_APPLY].includes(toolName)
                          ? 300
                          : 31536000
                      }
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                    />
                  </label>
                  {taskProfile(currentTool).supportsScheduling === true && (
                    <label>
                      预约启动（本地时间，可选）
                      <input
                        type="datetime-local"
                        value={scheduled}
                        onChange={(e) => setScheduled(e.target.value)}
                      />
                    </label>
                  )}
                </div>
                <small>默认立即启动，启动容差 60 秒。</small>
              </details>
              <ErrorNote error={preview.error} />
              {preflight && (
                <AvailabilityNotice result={preflight} pending={previewBusy} snapshot={state} />
              )}
              <div className="submit-row">
                <button disabled={!compatible || previewBusy} onClick={inspectAvailable}>
                  {previewBusy ? "检查中…" : "检查可用性"}
                </button>
                <button className="primary" disabled={!compatible || sending} onClick={doTool}>
                  {sending ? "正在提交…" : `执行${labels[toolName]}`}
                </button>
              </div>
              <small className="field-help">点击执行后提交当前参数，任务回执将在右侧显示。</small>
            </div>
          </section>
          <div className="right-column">
            <Diagram
              position={point}
              draft={draft}
              draftClosed={toolName === "vehicle_area_recon" || toolName === "vehicle_inspect_area"}
              objects={visibleGeometryObjects(
                array(record(selectedBusiness.data).objects).map(record),
                record(record(selectedBusiness.data).context),
              )}
            />
            <section className="task-index">
              <div className="section-head">
                <div>
                  <span className="eyebrow">SHARED TASKS</span>
                  <h2>任务记录</h2>
                </div>
                <span className="muted">最近 {tasks.data?.length ?? 0} 项</span>
              </div>
              <form
                className="import-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  setNotice(undefined);
                  void api("/tasks/import", { taskId: importId.trim() })
                    .then(() => {
                      setSelected(importId.trim());
                      setImportId("");
                      refresh();
                    })
                    .catch(setNotice);
                }}
              >
                <input
                  aria-label="导入 Task ID"
                  placeholder="粘贴已有 Task ID"
                  value={importId}
                  onChange={(e) => setImportId(e.target.value)}
                  required
                />
                <button>导入</button>
              </form>
              <small className="field-help">显示本面板创建或导入的任务，多台电脑共享。</small>
              <div className="task-list">
                {tasks.data?.map((task) => {
                  const status = classifyTask(task.snapshot);
                  return (
                    <button
                      key={task.taskId}
                      className={`task-list-item ${selected === task.taskId ? "selected" : ""}`}
                      onClick={() => setSelected(task.taskId)}
                    >
                      <div>
                        <strong>{labels[task.operation] || task.operation || "已导入任务"}</strong>
                        <small>{task.taskId}</small>
                      </div>
                      <Badge {...status} />
                    </button>
                  );
                })}
                {!tasks.data?.length && (
                  <div className="empty">还没有任务。可以执行控制或导入已有 Task ID。</div>
                )}
              </div>
            </section>
          </div>
        </div>
        {selected && (
          <TaskDetail
            taskId={selected}
            operationName={tasks.data?.find((row) => row.taskId === selected)?.operation ?? ""}
            tools={tools}
            resourceId={resourceId}
            position={point}
            sending={sending}
            submit={(command) => submit(command)}
          />
        )}
        <div className="bottom-grid">
          <section className="panel">
            <div className="section-head">
              <h2>命令记录</h2>
              <button
                className="ghost"
                onClick={() => download(commands.data, "ugv-command-records.json")}
              >
                导出
              </button>
            </div>
            <div className="command-list">
              {commands.data?.map((command) => (
                <div className="command-item" key={command.commandId}>
                  <div>
                    <strong>
                      {command.request.tool
                        ? labels[command.request.tool] || command.request.tool
                        : {
                            tool: "工具调用",
                            pause: "暂停",
                            resume: "恢复",
                            cancel: "取消",
                            input: "人工答复",
                            intervention: "计划调整",
                            reconcile: "人工对账",
                          }[command.request.kind]}
                    </strong>
                    <small>
                      {when(command.createdAt)} · {command.commandId}
                    </small>
                  </div>
                  <Badge
                    label={
                      {
                        dispatching: "提交中",
                        accepted: "已受理",
                        rejected: "未受理",
                        unknown: "结果未确认",
                      }[command.status] ?? command.status
                    }
                    tone={
                      command.status === "unknown"
                        ? "warning"
                        : command.status === "rejected"
                          ? "error"
                          : "muted"
                    }
                  />
                  <JsonView title="参数与回执" value={command} />
                </div>
              ))}
              {!commands.data?.length && (
                <div className="empty">提交后在此查看参数、回执和原因码</div>
              )}
            </div>
          </section>
          <section className="panel">
            <h2>连接与能力诊断</h2>
            <p className="field-help">
              位置、载荷和任务源时间分别保留；刚收到查询回执不代表设备数据新鲜。
            </p>
            <JsonView
              title="源时间与业务语义"
              value={{
                freshness,
                observedAt: state.observedAt,
                businessSemantics: state.businessSemantics,
              }}
            />
            <JsonView
              title={`已发布能力 · ${tools.length} 项`}
              value={tools.map((t) => ({
                name: t.name,
                task: taskProfile(t),
                resource: record(t._meta)["io.sdar/resourceBinding"],
              }))}
            />
            <JsonView title="当前设备状态" value={data} />
            {tools.some((t) => t.name === "vehicle_laser_range") && (
              <button
                onClick={() => {
                  void api("/read", { tool: "vehicle_laser_range", arguments: { resourceId } })
                    .then((v) => setMeasurement(record(v)))
                    .catch(setNotice);
                }}
              >
                读取测距
              </button>
            )}
            <button
              className="ghost"
              onClick={() => {
                void api("/read", {
                  tool: "vehicle_get_trajectory_history",
                  arguments: {
                    resourceId,
                    historyVersion: "1.0",
                    limit: 256,
                    maxPageBytes: 1048576,
                  },
                })
                  .then((v) => download(v, "ugv-trajectory-history-page.json"))
                  .catch(setNotice);
              }}
            >
              读取历史轨迹页
            </button>
            {measurement && (
              <div className={`notice ${measurement.valid === true ? "success" : "warning"}`}>
                测距：
                {measurement.valid === true
                  ? `${num(measurement.distanceM)} m`
                  : "本次测量无效"} · {when(measurement.observedAt)}
                <JsonView title="测距证据" value={measurement} />
              </div>
            )}
          </section>
        </div>
        <footer>
          UGV CONTROL CONSOLE{" "}
          <span>
            Protocol 2026-07-28 · TaskExecution 1.0 · {catalogHash.slice(0, 12) || "等待目录"}
          </span>
        </footer>
      </main>
    </div>
  );
}
function Metric({
  title,
  value,
  detail,
  ok,
}: {
  title: string;
  value: string;
  detail: string;
  ok?: boolean;
}) {
  return (
    <div className="metric">
      <span className="eyebrow">{title}</span>
      <strong>
        {ok !== undefined && <i className={ok ? "dot online" : "dot"} />} {value}
      </strong>
      <small>{detail}</small>
    </div>
  );
}
function TaskDetail({
  taskId,
  operationName,
  tools,
  resourceId,
  position,
  sending,
  submit,
}: {
  taskId: string;
  operationName: string;
  tools: Tool[];
  resourceId: string;
  position?: Point;
  sending: boolean;
  submit: (command: Omit<Command, "commandId" | "catalogHash">) => Promise<void>;
}) {
  const qc = useQueryClient(),
    [error, setError] = useState<unknown>(),
    [adjust, setAdjust] = useState(""),
    [artifact, setArtifact] = useState<unknown>(),
    [observations, setObservations] = useState<Json>(),
    [streamState, setStreamState] = useState("连接中");
  const task = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api<Json>(`/tasks/${encodeURIComponent(taskId)}`),
    refetchInterval: (q) =>
      ["completed", "failed", "cancelled"].includes(text(q.state.data?.status)) ? false : 2000,
  });
  const business = useQuery({
    queryKey: ["business", taskId],
    queryFn: () => api<Json>(`/tasks/${encodeURIComponent(taskId)}/business`),
    refetchInterval: (q) =>
      q.state.error
        ? false
        : ["completed", "failed", "cancelled"].includes(text(task.data?.status))
          ? false
          : 4000,
  });
  useEffect(() => {
    setError(undefined);
    setArtifact(undefined);
    setObservations(undefined);
    setAdjust("");
  }, [taskId]);
  useEffect(() => {
    let source: EventSource | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      closed = false,
      lastRefresh = 0;
    const connect = async () => {
      let cursor: unknown;
      try {
        cursor = (await api<Json>(`/tasks/${encodeURIComponent(taskId)}/business`)).resumeFrom;
      } catch {
        /* Task-only notifications are still supported. */
      }
      if (closed) return;
      source = new EventSource(
        `/api/tasks/${encodeURIComponent(taskId)}/events${cursor ? `?cursor=${encodeURIComponent(JSON.stringify(cursor))}` : ""}`,
      );
      const reconnect = () => {
        source?.close();
        if (closed) return;
        setStreamState("正在重连，保留定时核实");
        timer = setTimeout(() => {
          void connect();
        }, 3000);
      };
      source.onmessage = (e) => {
        let message: Json;
        try {
          message = record(JSON.parse(String(e.data)));
        } catch {
          return;
        }
        if (message.type === "connected") {
          setStreamState("事件已连接");
          return;
        }
        if (Date.now() - lastRefresh > 500 || message.type === "resync") {
          lastRefresh = Date.now();
          void qc.invalidateQueries({ queryKey: ["task", taskId] });
          void qc.invalidateQueries({ queryKey: ["business", taskId] });
        }
        if (message.type === "resync") reconnect();
      };
      source.onerror = reconnect;
    };
    void connect();
    return () => {
      closed = true;
      source?.close();
      if (timer) clearTimeout(timer);
    };
  }, [taskId, qc]);
  const snapshot = record(task.data),
    b = record(business.data),
    context = record(b.context),
    objects = array(b.objects).map(record),
    identity = record(context.identity);
  const operation =
    text(identity.operationName) ||
    text(record(record(snapshot._meta)["io.sdar/taskExecution"]).operationName) ||
    operationName;
  const tool = tools.find((t) => t.name === operation),
    profile = taskProfile(tool),
    status = classifyTask(snapshot),
    active =
      !siteReadonlyTools(tools) && ["working", "input_required"].includes(text(snapshot.status));
  const result = record(snapshot.result),
    content = record(result.structuredContent),
    report = record(content.inspectionReport),
    anomalies = array(content.anomalies).map(record);
  const inputs = objects.filter((o) => o.kind === "input_request").map((o) => record(o.value)),
    interventions = objects.filter((o) => o.kind === "intervention").map((o) => record(o.value));
  const handle = (action: Omit<Command, "commandId" | "catalogHash">) => {
    setError(undefined);
    void submit(action).catch(setError);
  };
  const downloadReport = () => {
    setError(undefined);
    void api(`/tasks/${encodeURIComponent(taskId)}/report`)
      .then((value) => download(value, `ugv-report-${taskId}.json`))
      .catch(setError);
  };
  return (
    <section className="task-detail panel">
      <div className="section-head">
        <div>
          <span className="eyebrow">TASK EXECUTION</span>
          <h2>
            任务详情 <Badge {...status} />
          </h2>
          <small className="mono">{taskId}</small>
        </div>
        <div className="button-group">
          <small className="muted">{streamState}</small>
          <button onClick={downloadReport}>下载完整报告</button>
        </div>
      </div>
      <ErrorNote error={task.error ?? error} />
      {operation === "simulation_adjust_view" && <SimulationViewResult result={content} />}
      {[ZMQ_INSPECT, EFFECT_APPLY].includes(operation) && (
        <ZmqResults taskId={taskId} operation={operation} />
      )}
      <div className="detail-meta">
        <div>
          <small>操作</small>
          <strong>{labels[operation] ?? (operation.length ? operation : "待核实")}</strong>
        </div>
        <div>
          <small>最近更新</small>
          <strong>{when(snapshot.lastUpdatedAt)}</strong>
        </div>
        <div>
          <small>执行身份</small>
          <strong className="mono">{text(identity.executionId) || "—"}</strong>
        </div>
        <div>
          <small>计划版本</small>
          <strong>{text(context.effectivePlanRevision) || "—"}</strong>
        </div>
      </div>
      {!!(snapshot.statusMessage ?? record(snapshot.error).message) && (
        <div className="notice">
          {text(snapshot.statusMessage) || text(record(snapshot.error).message)}
        </div>
      )}
      <div className="button-group task-actions">
        <button
          disabled={!active || sending || profile.supportsPauseResume !== true}
          onClick={() => handle({ kind: "pause", taskId, arguments: {} })}
        >
          暂停
        </button>
        <button
          disabled={!active || sending || profile.supportsPauseResume !== true}
          onClick={() => handle({ kind: "resume", taskId, arguments: {} })}
        >
          恢复
        </button>
        <button
          className="danger-outline"
          disabled={!active || sending || profile.supportsCancellation !== true}
          onClick={() => handle({ kind: "cancel", taskId, arguments: {} })}
        >
          取消任务
        </button>
        <button
          onClick={() => {
            void api<Json>(`/tasks/${encodeURIComponent(taskId)}/observations`)
              .then(setObservations)
              .catch(setError);
          }}
        >
          读取状态历史
        </button>
      </div>
      {active &&
        text(record(record(snapshot._meta)["io.sdar/taskExecution"]).substate) === "stopping" && (
          <div className="notice warning">正在等待设备停止确认。取消回执不等于设备已经停止。</div>
        )}
      <div className="task-content-grid">
        <div>
          <Diagram
            position={position}
            draft={[]}
            objects={visibleGeometryObjects(objects, context)}
          />
          <div className="evidence-summary">
            <h3>
              {[ZMQ_INSPECT, EFFECT_APPLY].includes(operation) ? "原任务结果与证据" : "结果与证据"}
            </h3>
            {Object.keys(content).length ? (
              <>
                <div className="evidence-cards">
                  <div>
                    <small>业务结论</small>
                    <strong>
                      {text(content.outcome) || text(report.completion) || "查看原始结果"}
                    </strong>
                  </div>
                  <div>
                    <small>报告完整性</small>
                    <strong>
                      {text(report.completion) || text(content.completeness) || "未提供"}
                    </strong>
                  </div>
                  <div>
                    <small>关联强度</small>
                    <strong>{text(content.correlationStrength) || "未提供"}</strong>
                  </div>
                  <div>
                    <small>内联发现</small>
                    <strong>{anomalies.length} 项</strong>
                  </div>
                </div>
                {array(content.missingEvidence).length > 0 && (
                  <div className="notice warning">
                    缺失证据：{array(content.missingEvidence).map(text).join("、")}
                  </div>
                )}
                {(content.truncated === true ||
                  record(content.truncation).truncated === true ||
                  report.truncated === true) && (
                  <div className="notice warning">
                    内联报告已截断，请下载完整报告并查看业务对象。
                  </div>
                )}
                {anomalies.length > 0 && (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>类型 / 来源</th>
                          <th>观察时间</th>
                          <th>位置</th>
                        </tr>
                      </thead>
                      <tbody>
                        {anomalies.map((a, i) => (
                          <tr key={i}>
                            <td>
                              {text(a.targetType ?? a.eventType ?? a.type)}
                              <small>{text(a.sourceRef ?? a.sourceId)}</small>
                            </td>
                            <td>{when(a.observedAt ?? a.observationTime)}</td>
                            <td>
                              {a.longitude !== undefined
                                ? `${num(a.longitude, 8)}, ${num(a.latitude, 8)}`
                                : "未提供"}
                              <JsonView value={a} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <JsonView title="完整任务业务结果" value={result} />
              </>
            ) : (
              <p className="field-help">结果尚未形成。空目标列表不能证明区域内没有发现。</p>
            )}
          </div>
        </div>
        <div className="business-column">
          <h3>人工决策与业务对象</h3>
          {business.error && (
            <div className="notice warning">
              业务快照当前不可读：{describe(business.error)}。任务状态仍独立查询。
            </div>
          )}
          {b.complete === false && (
            <div className="notice warning">
              快照存在未解析引用，证据尚不完整。
              <JsonView value={b.missingRefs} />
            </div>
          )}
          {inputs.map((input) => (
            <div className="business-card" key={`${text(input.requestId)}:${text(input.revision)}`}>
              <strong>{text(input.title)}</strong>
              <Badge label={text(input.state)} />
              <p>{text(input.description)}</p>
              <small>
                截止 {when(input.deadlineAt)} · 版本 {text(input.revision)}
              </small>
              {input.state === "pending" && input.inputType === "target.disposition_decision" && (
                <div className="button-group">
                  {(["accept", "decline", "cancel"] as const).map((action) => (
                    <button
                      key={action}
                      disabled={
                        !active ||
                        sending ||
                        (!!input.deadlineAt && Date.parse(text(input.deadlineAt)) <= Date.now())
                      }
                      onClick={() =>
                        handle({
                          kind: "input",
                          taskId,
                          arguments: {
                            requestKey: input.requestKey,
                            requestRevision: input.revision,
                            action,
                          },
                        })
                      }
                    >
                      {
                        { accept: "继续观察", decline: "拒绝并恢复扫描", cancel: "撤销此提示" }[
                          action
                        ]
                      }
                    </button>
                  ))}
                </div>
              )}
              <JsonView value={input} />
            </div>
          ))}
          {interventions.map((item) => (
            <div
              className="business-card"
              key={`${text(item.interventionId)}:${text(item.revision)}`}
            >
              <strong>{text(item.title)}</strong>
              <Badge label={text(item.state)} />
              {item.interventionType === "navigation.adjust_plan" && item.state === "available" && (
                <>
                  <label>
                    新路线 · WGS84 经纬度
                    <textarea
                      aria-label="调整路线坐标"
                      value={adjust}
                      onChange={(e) => setAdjust(e.target.value)}
                      placeholder="每行 经度, 纬度"
                    />
                  </label>
                  <button
                    disabled={!active || sending}
                    onClick={() => {
                      try {
                        const input: Json = { waypoints: parseCoordinates(adjust) };
                        if (record(record(item.inputSchema).properties).density)
                          input.density = "adaptive";
                        handle({
                          kind: "intervention",
                          taskId,
                          arguments: {
                            interventionId: item.interventionId,
                            interventionRevision: item.revision,
                            effectivePlanRevision: context.effectivePlanRevision,
                            input,
                          },
                        });
                      } catch (e) {
                        setError(e);
                      }
                    }}
                  >
                    提交路线调整
                  </button>
                </>
              )}
              <JsonView value={item} />
            </div>
          ))}
          {objects
            .filter((o) => o.kind === "artifact")
            .map((o) => {
              const v = record(o.value);
              return (
                <div className="business-card" key={`${text(v.artifactId)}:${text(v.revision)}`}>
                  <strong>{text(v.artifactType)}</strong>
                  <Badge label={text(v.availability)} />
                  <small className="mono">
                    {text(v.artifactId)} · rev {text(v.revision)}
                  </small>
                  <JsonView title="内容与证据声明" value={v} />
                  <button
                    onClick={() => {
                      setError(undefined);
                      void api(
                        `/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(text(v.artifactId))}?revision=${text(v.revision)}`,
                      )
                        .then(setArtifact)
                        .catch(setError);
                    }}
                  >
                    读取完整内容
                  </button>
                  {text(v.artifactType).includes("trajectory") &&
                    tools.some((t) => t.name === "vehicle_get_trajectory_evidence") && (
                      <button
                        onClick={() => {
                          void api("/read", {
                            tool: "vehicle_get_trajectory_evidence",
                            arguments: {
                              resourceId,
                              historyVersion: "1.0",
                              taskId,
                              executionId: identity.executionId,
                              artifactId: v.artifactId,
                              revision: v.revision,
                            },
                          })
                            .then(setArtifact)
                            .catch(setError);
                        }}
                      >
                        读取轨迹证据
                      </button>
                    )}
                </div>
              );
            })}
          {!objects.length && !business.error && <div className="empty">正在读取关联业务对象…</div>}
          <JsonView title="Context 与源关联" value={context} />
          {artifact !== undefined && (
            <div className="business-card">
              <h3>完整业务内容</h3>
              <button onClick={() => download(artifact, "ugv-artifact.json")}>导出内容</button>
              <pre className="artifact-preview">{JSON.stringify(artifact, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>
      <JsonView title="Task 原始状态" value={snapshot} />
      {observations && (
        <div>
          <JsonView title="状态历史" value={observations} />
          {record(observations._meta).hasMore === true && (
            <button
              onClick={() => {
                void api<Json>(
                  `/tasks/${encodeURIComponent(taskId)}/observations?cursor=${encodeURIComponent(text(record(observations._meta).observationCursor))}`,
                )
                  .then(setObservations)
                  .catch(setError);
              }}
            >
              下一页状态历史
            </button>
          )}
        </div>
      )}
    </section>
  );
}
const rootElement = document.getElementById("root");
if (!rootElement) throw Error("CONSOLE_ROOT_MISSING");
createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Console />
    </QueryClientProvider>
  </React.StrictMode>,
);
