import { useEffect, useRef, useState, type ComponentProps } from "react";
import { SiteReadonlyConsole } from "./SiteReadonlyConsole.js";
import { api, describe } from "./api.js";
import { newCommandId } from "./command-id.js";
import { parseCoordinates } from "../shared/coordinates.js";
import {
  inspectionArguments,
  inspectionArgumentsV13,
  kilometresPerHourToMps,
} from "../shared/zmq.js";
import { array, record, text, type Command, type CommandRow, type Json } from "../shared/model.js";
const labels: Record<string, string> = {
  vehicle_zmq_navigate: "导航",
  vehicle_zmq_camera: "云台",
  vehicle_zmq_area_recon: "区域侦察",
  vehicle_zmq_circular_recon: "环视",
  vehicle_zmq_inspect_area: "区域检查",
  simulation_apply_effect: "仿真效果交互",
};
export function SiteControlConsole(props: ComponentProps<typeof SiteReadonlyConsole>) {
  const profile = text(
    record(record(record(array(props.device.tools)[0])._meta)["io.sdar/ugvZmq"]).catalogProfile,
  );
  const v14 = profile === "zmq_v1_4_0_site_control_14";
  const v13 = v14 || profile === "zmq_v1_3_0_site_control_13";
  const [fov, setFov] = useState("60"),
    [recreate, setRecreate] = useState(false);
  const [tool, setTool] = useState("vehicle_zmq_navigate"),
    [variant, setVariant] = useState("point"),
    [camera, setCamera] = useState("position"),
    [coordinates, setCoordinates] = useState(""),
    [height, setHeight] = useState(""),
    [strategy, setStrategy] = useState("recognize");
  const [speed, setSpeed] = useState(v13 ? "60" : "1"),
    [avoid, setAvoid] = useState(true),
    [budget, setBudget] = useState("300"),
    [yaw, setYaw] = useState("0"),
    [pitch, setPitch] = useState("0"),
    [zoom, setZoom] = useState("1"),
    [timeout, setTimeoutValue] = useState("3000"),
    [hold, setHold] = useState("500"),
    [yawRate, setYawRate] = useState("0.1"),
    [pitchRate, setPitchRate] = useState("0"),
    [scan, setScan] = useState("sector"),
    [span, setSpan] = useState("1.57"),
    [cycles, setCycles] = useState("1"),
    [returnType, setReturnType] = useState("0");
  const [source, setSource] = useState("observation"),
    [target, setTarget] = useState(""),
    [note, setNote] = useState(""),
    [observation, setObservation] = useState(""),
    [availability, setAvailability] = useState<Json>(),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [stopNotice, setStopNotice] = useState(""),
    [stopping, setStopping] = useState(false),
    [stopTasks, setStopTasks] = useState<string[]>([]);
  const [reconcileTask, setReconcileTask] = useState(""),
    [component, setComponent] = useState("eo"),
    [reason, setReason] = useState("");
  const submitting = useRef(false),
    stopFlight = useRef(false),
    stopEpoch = useRef(0);
  const resourceId = text(props.device.resourceId),
    catalogHash = text(props.device.catalogHash);
  const support = array(
    record(record(props.device.data).vehicle_get_capabilities).operationSupport,
  ).map(record);
  const view = record(record(record(props.device.data).vehicle_get_capabilities).simulationView);
  const admissionKey =
    tool === "simulation_adjust_view"
      ? "camera.simulationView"
      : tool === "vehicle_zmq_navigate"
        ? "navigation." + variant
        : tool === "vehicle_zmq_camera"
          ? "camera." + camera
          : tool === "vehicle_zmq_area_recon"
            ? "recon.area"
            : tool === "vehicle_zmq_inspect_area"
              ? "inspection.area"
              : tool === "vehicle_zmq_circular_recon"
                ? "recon." + scan
                : "simulation.applyEffect." + source;
  const admission = support.find((s) => s.operation === admissionKey);
  const blockedOperation = support.length > 0 && admission?.status !== "supported";
  const candidates = array(
    record(record(props.device.data).vehicle_get_targets).effectCandidates,
  ).map(record);
  let args: Json | undefined,
    inputError = "";
  const number = (v: string) => {
    if (!v.trim() || !Number.isFinite(Number(v))) throw Error("请填写有效数值");
    return Number(v);
  };
  try {
    if (number(budget) <= 0 || Number(budget) > 300) throw Error("执行期限必须在 0–300 秒内");
    if (tool === "vehicle_zmq_navigate") {
      const points = coordinates.trim() ? parseCoordinates(coordinates) : [];
      if (variant !== "returnHome" && !points.length) throw Error("请输入经纬度");
      if (variant === "point" && points.length !== 1) throw Error("单点导航需要一个坐标");
      args = {
        resourceId,
        operation: {
          name: "navigation." + variant,
          params: {
            speedLimitMps: v13 ? kilometresPerHourToMps(number(speed)) : number(speed),
            obstacleAvoidance: avoid,
            ...(variant === "point" ? { destination: points[0] } : { waypoints: points }),
            ...(variant === "returnHome" ? { returnType: number(returnType) } : {}),
          },
        },
      };
    } else if (tool === "vehicle_zmq_camera")
      args = {
        resourceId,
        operation: {
          name: "camera." + camera,
          params:
            camera === "position"
              ? { yaw_rad: number(yaw), pitch_rad: number(pitch), move_timeout_ms: number(timeout) }
              : camera === "zoom"
                ? { zoom_ratio: number(zoom), zoom_timeout_ms: number(timeout) }
                : {
                    yaw_rate_rad_s: number(yawRate),
                    pitch_rate_rad_s: number(pitchRate),
                    hold_ms: number(hold),
                  },
        },
      };
    else if (["vehicle_zmq_area_recon", "vehicle_zmq_inspect_area"].includes(tool))
      args = (v13 ? inspectionArgumentsV13 : inspectionArguments)(
        resourceId,
        coordinates,
        height,
        strategy,
      );
    else if (tool === "vehicle_zmq_circular_recon")
      args = {
        resourceId,
        params: {
          scan_mode: scan,
          yaw_center_rad: scan === "circular" ? null : number(yaw),
          yaw_span_rad: scan === "circular" ? null : number(span),
          pitch_rad: number(pitch),
          yaw_speed_rad_s: number(yawRate),
          cycle_count: number(cycles),
          task_timeout_ms: number(budget) * 1000,
          search_strategy: strategy,
        },
      };
    else if (tool === "simulation_adjust_view") {
      if (!text(view.viewId)) throw Error("尚未配置本项目仿真相机和场景绑定");
      if (!recreate) throw Error("请确认创建或重建本项目专属相机");
      const degrees = number(fov);
      if (degrees < Number(view.minFovDeg) || degrees > Number(view.maxFovDeg))
        throw Error("视场角超出部署支持范围");
      args = {
        resourceId,
        viewId: text(view.viewId),
        horizontalFovDeg: degrees,
        acknowledgeCameraRecreation: true,
      };
    } else {
      const p = parseCoordinates(coordinates);
      if (p.length !== 1) throw Error("仿真交互需要一个目标位置");
      args = {
        resourceId,
        targetId: target,
        position: {
          longitude_deg: p[0].longitude,
          latitude_deg: p[0].latitude,
          ellipsoid_height_m: height.trim() ? number(height) : null,
        },
        targetSource: source,
        ...(source === "manual"
          ? { sourceNote: note }
          : { observation: JSON.parse(observation) as unknown }),
      };
      if (!target.trim() || (source === "manual" && !note.trim()))
        throw Error("请填写目标标识与来源说明");
    }
  } catch (error) {
    inputError = describe(error);
  }
  if (blockedOperation)
    inputError =
      text(admission?.description) || text(admission?.reasonCode) || "该动作尚未核实支持";
  const argsKey = args ? JSON.stringify(args) : "",
    timing = {
      start: { mode: "immediate" as const, startToleranceMs: 60000 },
      maxElapsedMs: Number(budget) * 1000,
    };
  useEffect(() => {
    let active = true;
    setAvailability(undefined);
    if (!argsKey || inputError) return;
    const check = async () => {
      try {
        const a = await api<Json>("/availability", {
          tool,
          arguments: JSON.parse(argsKey) as Json,
          timing,
        });
        if (active) setAvailability(a);
      } catch (e) {
        if (active) setAvailability({ availability: "disabled", reasonCode: describe(e) });
      }
    };
    void check();
    const timer = setInterval(() => {
      void check();
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
    // Parameters are serialized so polling never uses a previous form submission.
  }, [tool, argsKey, budget, catalogHash, inputError]);
  const send = async (request: Omit<Command, "commandId" | "catalogHash">) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setNotice("");
    const epoch = stopEpoch.current;
    try {
      const row = await api<CommandRow>("/commands", {
        ...request,
        commandId: newCommandId(),
        catalogHash,
      });
      if (
        row.status === "accepted" &&
        row.taskId &&
        epoch !== stopEpoch.current &&
        !["simulation_apply_effect", "simulation_adjust_view"].includes(request.tool ?? "")
      ) {
        await api("/commands", {
          commandId: newCommandId(),
          kind: "cancel",
          taskId: row.taskId,
          arguments: {},
          catalogHash,
        });
        setStopTasks((ids) => [...new Set([...ids, row.taskId ?? ""])].filter(Boolean));
        setStopNotice("在途任务已返回 Task ID，停止请求受理，等待设备确认");
      }
      setNotice(
        row.status === "accepted"
          ? "任务已受理，请查看任务与设备结果"
          : row.status === "completed"
            ? "对账完成，原任务结果保持不变"
            : "请求结果未确认，请查看命令记录",
      );
    } catch (e) {
      setNotice(describe(e));
    } finally {
      submitting.current = false;
      setBusy(false);
      props.refresh();
    }
  };
  const stop = async () => {
    if (stopFlight.current) return;
    stopFlight.current = true;
    stopEpoch.current++;
    setStopping(true);
    setStopNotice("");
    const latestTasks = await api<ComponentProps<typeof SiteReadonlyConsole>["tasks"]>(
      "/tasks",
    ).catch(() => props.tasks);
    const requested: string[] = [];
    const results = await Promise.all(
      latestTasks
        .filter(
          (t) =>
            Object.keys(labels).includes(t.operation) && t.operation !== "simulation_apply_effect",
        )
        .map(async (t) => {
          try {
            const current = await api<Json>("/tasks/" + encodeURIComponent(t.taskId));
            if (!["working", "input_required"].includes(text(current.status))) return null;
            await api("/commands", {
              commandId: newCommandId(),
              kind: "cancel",
              taskId: t.taskId,
              arguments: {},
              catalogHash,
            });
            requested.push(t.taskId);
            return `${t.taskId}：停止请求受理，等待任务及设备确认`;
          } catch (e) {
            return `${t.taskId}：${describe(e)}`;
          }
        }),
    );
    setStopNotice(
      results.filter(Boolean).join("；") ||
        (submitting.current
          ? "停止意图已记录，等待在途控制返回 Task ID；结果未确认时需人工核实。"
          : "没有本控制端可停止的活动任务。仿真效果服务不支持停止。"),
    );
    setStopTasks(requested);
    setStopping(false);
    stopFlight.current = false;
    props.refresh();
  };
  useEffect(() => {
    if (!stopTasks.length) return;
    let active = true;
    const check = async () => {
      const messages = await Promise.all(
        stopTasks.map(async (id) => {
          const component =
            props.tasks.find((t) => t.taskId === id)?.operation === "vehicle_zmq_navigate"
              ? "底盘"
              : "光电";
          try {
            const task = await api<Json>("/tasks/" + encodeURIComponent(id));
            if (!["completed", "failed", "cancelled"].includes(text(task.status)))
              return `${component} · ${id}：停止中，等待设备确认`;
            const business = await api<Json>(`/tasks/${encodeURIComponent(id)}/business`),
              result = record(record(record(business.context).summary).properties).executionResult,
              report = record(result);
            return `${component} · ${id}：${report.stopConfirmed === true && report.occupancy === "released" ? "已确认停止，组件已释放" : "任务已结束，停止证据未确认；请查看报告或人工对账"}`;
          } catch (e) {
            return `${component} · ${id}：${describe(e)}`;
          }
        }),
      );
      if (active) setStopNotice(messages.join("；"));
    };
    void check();
    const timer = setInterval(() => {
      void check();
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [stopTasks, props.tasks]);
  const field = (label: string, value: string, set: (v: string) => void, type = "number") => (
    <label>
      {label}
      <input aria-label={label} type={type} value={value} onChange={(e) => set(e.target.value)} />
    </label>
  );
  const select = (
    label: string,
    value: string,
    set: (v: string) => void,
    choices: Record<string, string>,
  ) => (
    <label>
      {label}
      <select aria-label={label} value={value} onChange={(e) => set(e.target.value)}>
        {Object.entries(choices).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  const controls = (
    <section className="panel">
      <h2>现场设备控制</h2>
      {select(
        "控制能力",
        tool,
        setTool,
        v14 ? { ...labels, simulation_adjust_view: "仿真视场（专属相机）" } : labels,
      )}
      {admission && (
        <div
          className={blockedOperation ? "notice warning" : "field-help"}
          aria-label="动作准入状态"
        >
          当前动作：
          {admission.status === "supported"
            ? "已配置支持"
            : admission.status === "unsupported"
              ? "不支持"
              : "待核实"}
          {" · "}
          {text(admission.description)}
          {text(admission.reasonCode) && <span> · {text(admission.reasonCode)}</span>}
        </div>
      )}
      {tool === "vehicle_zmq_navigate" && (
        <>
          {select("导航方式", variant, setVariant, {
            point: "单点",
            route: "航点路线",
            returnHome: "返航",
          })}
          {field(v13 ? "速度上限（km/h）" : "速度上限（m/s）", speed, setSpeed)}
          <label>
            <input type="checkbox" checked={avoid} onChange={(e) => setAvoid(e.target.checked)} />
            避障开启
          </label>
          {variant === "returnHome" &&
            select("返航类型", returnType, setReturnType, { 0: "按返航规则", 1: "按给定路点" })}
        </>
      )}
      {[
        "vehicle_zmq_navigate",
        "vehicle_zmq_area_recon",
        "vehicle_zmq_inspect_area",
        "simulation_apply_effect",
      ].includes(tool) && (
        <label>
          WGS84 经度在前、纬度在后
          <textarea
            aria-label="控制坐标"
            rows={4}
            value={coordinates}
            onChange={(e) => setCoordinates(e.target.value)}
            placeholder="lon: 106.81, lat: 29.72"
          />
        </label>
      )}
      {["vehicle_zmq_area_recon", "vehicle_zmq_inspect_area", "simulation_apply_effect"].includes(
        tool,
      ) &&
        field(
          v13 && tool !== "simulation_apply_effect"
            ? "椭球高（米，留空默认 0；非实测高度）"
            : "椭球高（米，仿真目标未知可留空）",
          height,
          setHeight,
        )}
      {[
        "vehicle_zmq_area_recon",
        "vehicle_zmq_inspect_area",
        "vehicle_zmq_circular_recon",
      ].includes(tool) &&
        select("搜索策略", strategy, setStrategy, { recognize: "识别", track: "跟踪搜索" })}
      {tool === "simulation_adjust_view" && (
        <>
          <p className="field-help">
            来源：本项目专属仿真视图相机。结果包含实际视场角和新帧取证，上游光电识别使用自己的相机来源。
          </p>
          <p>
            视图：{text(view.viewId) || "尚未绑定"} · 支持 {text(view.minFovDeg) || "—"}–
            {text(view.maxFovDeg) || "—"}°
          </p>
          {field("水平视场角（度）", fov, setFov)}
          <label>
            <input
              type="checkbox"
              checked={recreate}
              onChange={(e) => setRecreate(e.target.checked)}
            />
            确认创建或重建本项目专属相机
          </label>
          <small>已应用的视场不会因任务超时自动恢复，当前版本不支持暂停或撤销重建。</small>
        </>
      )}
      {tool === "vehicle_zmq_camera" && (
        <>
          {select("云台动作", camera, setCamera, {
            position: "绝对角度",
            zoom: "绝对倍率",
            velocity: "有限租期角速度",
          })}
          {camera === "position" && (
            <>
              {field("偏航（弧度）", yaw, setYaw)}
              {field("俯仰（弧度）", pitch, setPitch)}
            </>
          )}
          {camera === "zoom" && field("缩放倍率", zoom, setZoom)}
          {camera !== "velocity" && field("动作超时（毫秒）", timeout, setTimeoutValue)}
          {camera === "velocity" && (
            <>
              {field("偏航速度（弧度/秒）", yawRate, setYawRate)}
              {field("俯仰速度（弧度/秒）", pitchRate, setPitchRate)}
              {field("速度租期（毫秒，100–1000）", hold, setHold)}
            </>
          )}
        </>
      )}
      {tool === "vehicle_zmq_circular_recon" && (
        <>
          {select("扫描方式", scan, setScan, { sector: "扇扫", circular: "周扫" })}
          {scan === "sector" && (
            <>
              {field("中心偏航（弧度）", yaw, setYaw)}
              {field("扫描角宽（弧度）", span, setSpan)}
            </>
          )}
          {field("俯仰（弧度）", pitch, setPitch)}
          {field("偏航速度（弧度/秒）", yawRate, setYawRate)}
          {field("循环次数", cycles, setCycles)}
        </>
      )}
      {tool === "simulation_apply_effect" && (
        <>
          {select("目标来源", source, setSource, {
            manual: "人工指定",
            observation: "关联设备观测",
          })}
          {field("目标标识", target, setTarget, "text")}
          {source === "manual" ? (
            field("人工来源说明", note, setNote, "text")
          ) : (
            <label>
              关联设备观测
              <select
                aria-label="关联设备观测"
                value={observation}
                onChange={(e) => {
                  setObservation(e.target.value);
                  const selected = candidates.find(
                    (c) => JSON.stringify(c.observation) === e.target.value,
                  );
                  if (selected) {
                    const p = record(selected.position);
                    setTarget(text(selected.targetId));
                    setCoordinates(`${text(p.longitude_deg)},${text(p.latitude_deg)}`);
                    setHeight(
                      typeof p.ellipsoid_height_m === "number" ? String(p.ellipsoid_height_m) : "",
                    );
                  }
                }}
              >
                <option value="">请选择当前任务关联观测</option>
                {candidates.map((c) => (
                  <option key={JSON.stringify(c.observation)} value={JSON.stringify(c.observation)}>
                    {text(c.targetId)} · {text(c.observedAt)}
                  </option>
                ))}
              </select>
              <small>
                只显示当前身份、来源会话及位置通过校验的观测；无有效观测时可显式切换人工来源。
              </small>
              <textarea
                aria-label="关联观测引用"
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
                placeholder={'{"taskId":"...","externalExecutionId":"...","revision":1}'}
              />
            </label>
          )}
          <p>请求将改变仿真状态。协议不支持暂停、取消或撤销；受理与最终效果分别显示。</p>
        </>
      )}
      {field("执行期限（秒，上限 300）", budget, setBudget)}
      {inputError ? (
        <p className="field-help">{inputError}</p>
      ) : (
        <div
          className={`notice ${availability?.availability === "available" ? "" : "warning"}`}
          role="status"
        >
          {availability
            ? `${availability.availability === "available" ? "当前可执行" : "当前不可执行"} · ${describe(Error(text(availability.reasonCode)))}`
            : "正在核实可用性…"}
        </div>
      )}
      {notice && (
        <div className="notice" role="alert">
          {notice}
        </div>
      )}
      <button
        className="primary"
        disabled={
          busy ||
          !!inputError ||
          availability?.availability !== "available" ||
          !(Date.parse(text(availability.validUntil)) > Date.now())
        }
        onClick={() => {
          if (args) void send({ kind: "tool", tool, arguments: args, timing });
        }}
      >
        提交控制任务
      </button>
      <details>
        <summary>实际参数与合同</summary>
        <pre>{argsKey || inputError}</pre>
      </details>
      <details>
        <summary>未知结果的人工对账</summary>
        <p>只解除已有终态任务的组件占用；必须有新鲜空闲证据，原结果保持未知。</p>
        {select(
          "对账任务",
          reconcileTask,
          setReconcileTask,
          Object.fromEntries([
            ["", "请选择任务"],
            ...props.tasks.map((t): [string, string] => [t.taskId, t.taskId]),
          ]),
        )}
        {select("对账组件", component, setComponent, {
          chassis: "底盘",
          eo: "光电",
          simulationEffect: "仿真效果",
        })}
        {field("对账原因", reason, setReason, "text")}
        <button
          disabled={busy || !reconcileTask || !reason.trim()}
          onClick={() => {
            void send({
              kind: "reconcile",
              taskId: reconcileTask,
              arguments: { component, reason },
            });
          }}
        >
          核实空闲并解除占用
        </button>
      </details>
      {stopNotice && (
        <div className="notice warning" role="status">
          {stopNotice}
        </div>
      )}
    </section>
  );
  return (
    <SiteReadonlyConsole
      {...props}
      siteControl
      controls={controls}
      stopControl={
        <button
          className="stop"
          disabled={stopping}
          onClick={() => {
            void stop();
          }}
        >
          ■ {stopping ? "正在请求停止…" : "停止已接管任务"}
        </button>
      }
      onAdoptPreview={(previewId, preview) => {
        void send({
          kind: "tool",
          tool: "vehicle_zmq_navigate",
          previewCommandId: previewId,
          arguments: {
            resourceId,
            operation: {
              name: "navigation.route",
              params: {
                waypoints: array(preview.waypoints),
                speedLimitMps: v13 ? kilometresPerHourToMps(Number(speed)) : Number(speed),
                obstacleAvoidance: avoid,
              },
            },
          },
          timing,
        });
      }}
    />
  );
}
