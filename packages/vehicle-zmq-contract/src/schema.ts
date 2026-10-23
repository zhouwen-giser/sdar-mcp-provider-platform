import { z } from "zod";

export const WireId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/);
const finite = z.number();
const boundedText = z.string().min(1).max(65_536);
const ratio = finite.min(0).max(1);
const utc = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const duration = z.number().int().min(0).max(3_600_000);
const angle = finite.gte(-Math.PI).lt(Math.PI);
const pitch = finite.min(-Math.PI / 2).max(Math.PI / 2);
const origin = z.enum(["measured", "simulated", "replay"]);
export const EoMethods = z.enum(["AreaSearch", "CircularSearch", "TaskControl", "TeleControl"]);
export const WirePosition = z
  .object({
    latitude_deg: finite.min(-90).max(90),
    longitude_deg: finite.gte(-180).lt(180),
    ellipsoid_height_m: finite,
  })
  .strict();
const effectPosition = WirePosition.extend({ ellipsoid_height_m: finite.nullable() });
const commandFields = {
  request_id: WireId,
  state: z.enum(["accepted", "failed"]),
  task_id: WireId.nullable(),
  reason: boundedText.nullable(),
};
const eoCommand = z.object({ ...commandFields, method: EoMethods }).strict();
const effectCommand = z
  .object({ ...commandFields, method: z.literal("AttackTarget"), task_id: WireId })
  .strict();
const error = z.object({ code: z.string().min(1).max(128), message: boundedText }).strict();

function convex(points: z.infer<typeof WirePosition>[]): boolean {
  if (
    points.length !== 4 ||
    new Set(points.map((p) => `${p.longitude_deg},${p.latitude_deg}`)).size !== 4
  )
    return false;
  const signs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = points[i],
      b = points[(i + 1) % 4],
      c = points[(i + 2) % 4];
    if (!a || !b || !c || Math.abs(a.longitude_deg - b.longitude_deg) > 180) return false;
    signs.push(
      Math.sign(
        (b.longitude_deg - a.longitude_deg) * (c.latitude_deg - b.latitude_deg) -
          (b.latitude_deg - a.latitude_deg) * (c.longitude_deg - b.longitude_deg),
      ),
    );
  }
  return signs.every((s) => s === 1) || signs.every((s) => s === -1);
}
const region = z.array(WirePosition).length(4).refine(convex, "ZMQ_REGION_NOT_STRICT_CONVEX_QUAD");
const timeout = z.number().int().min(1000).max(3_600_000);
const strategy = z.enum(["recognize", "track"]);
const requestBase = {
  protocol: z.literal("2.2"),
  kind: z.literal("request"),
  device_id: WireId,
  request_id: WireId,
};
const teleParams = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("position"),
      yaw_rad: angle,
      pitch_rad: pitch,
      move_timeout_ms: z.number().int().min(100).max(10_000),
    })
    .strict(),
  z
    .object({
      action: z.literal("velocity"),
      yaw_rate_rad_s: finite,
      pitch_rate_rad_s: finite,
      hold_ms: z.number().int().min(100).max(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal("zoom"),
      zoom_ratio: finite.positive(),
      zoom_timeout_ms: z.number().int().min(100).max(10_000),
    })
    .strict(),
  z.object({ action: z.literal("stop") }).strict(),
]);
export const EoRequest = z.discriminatedUnion("method", [
  z
    .object({
      ...requestBase,
      method: z.literal("AreaSearch"),
      params: z
        .object({ region_wgs84: region, task_timeout_ms: timeout, search_strategy: strategy })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...requestBase,
      method: z.literal("CircularSearch"),
      params: z
        .object({
          scan_mode: z.enum(["circular", "sector"]),
          yaw_center_rad: angle.nullable(),
          yaw_span_rad: finite
            .positive()
            .lt(2 * Math.PI)
            .nullable(),
          pitch_rad: pitch,
          yaw_speed_rad_s: finite.positive(),
          cycle_count: z.number().int().min(1).max(10_000),
          task_timeout_ms: timeout,
          search_strategy: strategy,
        })
        .strict()
        .refine(
          (p) =>
            p.scan_mode === "circular"
              ? p.yaw_center_rad === null && p.yaw_span_rad === null
              : p.yaw_center_rad !== null && p.yaw_span_rad !== null,
          "ZMQ_SCAN_PARAMETERS_INVALID",
        ),
    })
    .strict(),
  z
    .object({
      ...requestBase,
      method: z.literal("TaskControl"),
      params: z
        .object({ task_id: WireId, action: z.enum(["start", "pause", "resume", "stop"]) })
        .strict(),
    })
    .strict(),
  z.object({ ...requestBase, method: z.literal("TeleControl"), params: teleParams }).strict(),
]);
export const SimulationEffectRequest = z
  .object({
    protocol: z.literal("1.0"),
    kind: z.literal("request"),
    device_id: WireId,
    request_id: WireId,
    method: z.literal("AttackTarget"),
    params: z.object({ target_id: WireId, position: effectPosition }).strict(),
  })
  .strict();

const responseBase = {
  kind: z.literal("response"),
  device_id: WireId,
  response_id: WireId.nullable(),
  ok: z.boolean(),
  error: error.nullable(),
};
export const EoResponse = z
  .object({
    ...responseBase,
    protocol: z.literal("2.2"),
    method: EoMethods.nullable(),
    command: eoCommand.nullable(),
  })
  .strict()
  .refine(
    (r) =>
      r.ok
        ? r.error === null &&
          r.response_id !== null &&
          r.method !== null &&
          r.command?.request_id === r.response_id &&
          r.command.method === r.method &&
          r.command.state === "accepted" &&
          (r.method === "TeleControl" ? r.command.task_id === null : r.command.task_id !== null)
        : r.command === null && r.error !== null,
    "ZMQ_RESPONSE_INCONSISTENT",
  );
export const SimulationEffectResponse = z
  .object({
    ...responseBase,
    protocol: z.literal("1.0"),
    method: z.literal("AttackTarget").nullable(),
    command: effectCommand.nullable(),
  })
  .strict()
  .refine(
    (r) =>
      r.ok
        ? r.error === null &&
          r.response_id !== null &&
          r.method !== null &&
          r.command?.request_id === r.response_id &&
          r.command.state === "accepted"
        : r.command === null && r.error !== null,
    "ZMQ_RESPONSE_INCONSISTENT",
  );

const eventBase = { kind: z.literal("event"), device_id: WireId, published_at_utc_ms: utc };
const telecontrol = z
  .object({
    action: z.enum(["position", "velocity", "zoom", "stop"]),
    state: z.enum(["running", "succeeded", "failed"]),
    remaining_ms: z.number().int().min(0).max(10_000),
    command: eoCommand,
  })
  .strict()
  .refine(
    (t) =>
      t.command.method === "TeleControl" &&
      t.command.task_id === null &&
      (t.state === "running" || t.remaining_ms === 0),
    "ZMQ_TELECONTROL_INCONSISTENT",
  );
const deviceStatus = z
  .object({
    mode: z.enum(["idle", "task", "telecontrol", "stopping", "fault"]),
    ready: z.boolean(),
    data_origin: origin,
    camera_online: z.boolean(),
    gimbal_online: z.boolean(),
    navigation_valid: z.boolean(),
    gimbal_yaw_rad: angle.nullable(),
    gimbal_pitch_rad: pitch.nullable(),
    zoom_ratio: finite.positive().nullable(),
    active_task_id: WireId.nullable(),
    telecontrol: telecontrol.nullable(),
    fault_code: boundedText.nullable(),
    fault_message: boundedText.nullable(),
  })
  .strict()
  .refine(
    (d) =>
      !d.ready ||
      (d.mode === "idle" && d.active_task_id === null && d.telecontrol?.state !== "running"),
    "ZMQ_DEVICE_READY_INCONSISTENT",
  );
const task = z
  .object({
    task_id: WireId,
    task_type: z.enum(["AreaSearch", "CircularSearch"]),
    state: z.enum([
      "preparing",
      "ready",
      "starting",
      "searching",
      "pausing",
      "paused",
      "stopping",
      "completed",
      "canceled",
      "failed",
    ]),
    remaining_ms: duration,
    progress_ratio: ratio.nullable(),
    coverage_ratio: ratio.nullable(),
    coverage_complete: z.boolean().nullable(),
    completed_cycles: z.number().int().min(0).max(10_000).nullable(),
    total_cycles: z.number().int().min(1).max(10_000).nullable(),
    reason: boundedText.nullable(),
  })
  .strict()
  .refine(
    (t) =>
      t.task_type === "AreaSearch"
        ? t.completed_cycles === null && t.total_cycles === null
        : t.coverage_ratio === null &&
          t.coverage_complete === null &&
          t.completed_cycles !== null &&
          t.total_cycles !== null &&
          t.completed_cycles <= t.total_cycles,
    "ZMQ_TASK_METRICS_INCONSISTENT",
  )
  .refine(
    (t) => !["completed", "canceled", "failed"].includes(t.state) || t.remaining_ms === 0,
    "ZMQ_TASK_TERMINAL_BUDGET_INVALID",
  );
const taskStatus = z
  .object({ task: task.nullable(), command: eoCommand.nullable() })
  .strict()
  .refine(
    (d) =>
      d.task === null
        ? d.command === null
        : d.command === null || d.command.task_id === d.task.task_id,
    "ZMQ_TASK_COMMAND_MISMATCH",
  );
const image = z
  .object({
    camera_id: WireId,
    frame_id: WireId,
    width_px: z.number().int().min(1).max(32768),
    height_px: z.number().int().min(1).max(32768),
  })
  .strict();
const pixel = z.object({ x_px: finite.nonnegative(), y_px: finite.nonnegative() }).strict();
const bbox = z
  .object({
    x_px: finite.nonnegative(),
    y_px: finite.nonnegative(),
    width_px: finite.positive(),
    height_px: finite.positive(),
  })
  .strict();
function inside(p: z.infer<typeof pixel>, i: z.infer<typeof image>): boolean {
  return p.x_px < i.width_px && p.y_px < i.height_px;
}
const detection = z
  .object({
    target_id: WireId,
    category: z.string().min(1).max(64),
    confidence: ratio,
    threat_level: z.number().int().min(1).max(3).nullable(),
    pixel,
    bbox: bbox.nullable(),
  })
  .strict();
const targetList = z
  .object({
    task_id: WireId.nullable(),
    observed_at_utc_ms: utc.nullable(),
    image,
    data_origin: origin,
    truncated: z.boolean(),
    targets: z.array(detection).max(2000),
  })
  .strict()
  .refine(
    (d) =>
      new Set(d.targets.map((t) => t.target_id)).size === d.targets.length &&
      d.targets.every(
        (t) =>
          inside(t.pixel, d.image) &&
          (t.bbox === null ||
            (t.bbox.x_px + t.bbox.width_px <= d.image.width_px &&
              t.bbox.y_px + t.bbox.height_px <= d.image.height_px &&
              t.pixel.x_px >= t.bbox.x_px &&
              t.pixel.x_px < t.bbox.x_px + t.bbox.width_px &&
              t.pixel.y_px >= t.bbox.y_px &&
              t.pixel.y_px < t.bbox.y_px + t.bbox.height_px)),
      ),
    "ZMQ_DETECTION_GEOMETRY_INVALID",
  );
const rangeSource = z.enum([
  "measured_laser",
  "measured_radial_depth",
  "simulated_radial_depth",
  "computed_plane_intersection",
]);
const tracked = z
  .object({
    image,
    pixel,
    position: WirePosition.nullable(),
    range_m: finite.positive().nullable(),
    range_source: rangeSource.nullable(),
    reason: boundedText.nullable(),
  })
  .strict()
  .refine(
    (t) =>
      inside(t.pixel, t.image) &&
      (t.range_m === null) === (t.range_source === null) &&
      (t.position === null ? t.reason !== null : t.reason === null && t.range_m !== null),
    "ZMQ_TRACK_POSITION_INCONSISTENT",
  );
const trackList = z
  .object({
    task_id: WireId,
    track_state: z.enum(["acquiring", "tracking", "lost", "idle"]),
    track_id: WireId.nullable(),
    target_id: WireId.nullable(),
    observed_at_utc_ms: utc.nullable(),
    data_origin: origin,
    targets: z.array(tracked).max(1),
  })
  .strict()
  .refine(
    (d) =>
      d.track_state === "idle"
        ? d.track_id === null && d.target_id === null && d.targets.length === 0
        : d.track_id !== null &&
          d.target_id !== null &&
          d.targets.length === (d.track_state === "tracking" ? 1 : 0),
    "ZMQ_TRACK_STATE_INCONSISTENT",
  )
  .refine(
    (d) =>
      d.data_origin !== "simulated" ||
      d.targets.every(
        (t) => t.range_source !== "measured_laser" && t.range_source !== "measured_radial_depth",
      ),
    "ZMQ_SIMULATED_RANGE_MISLABELED",
  );
export const EoPublication = z.discriminatedUnion("topic", [
  z
    .object({
      ...eventBase,
      protocol: z.literal("2.2"),
      topic: z.literal("device_status"),
      data: deviceStatus,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      protocol: z.literal("2.2"),
      topic: z.literal("task_status"),
      data: taskStatus,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      protocol: z.literal("2.2"),
      topic: z.literal("targetlist"),
      data: targetList,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      protocol: z.literal("2.2"),
      topic: z.literal("tracklist"),
      data: trackList,
    })
    .strict(),
]);

const effectTask = z
  .object({
    task_id: WireId,
    request_id: WireId,
    target_id: WireId,
    position: effectPosition,
    state: z.enum(["accepted", "executing", "succeeded", "failed", "unknown"]),
    execution_finished: z.boolean(),
    effect: z.enum(["hit", "miss", "destroyed", "unknown"]),
    reason: boundedText.nullable(),
  })
  .strict()
  .refine(
    (t) =>
      t.state === "accepted" || t.state === "executing"
        ? !t.execution_finished && t.effect === "unknown" && t.reason === null
        : t.state === "succeeded"
          ? t.execution_finished && t.reason === null
          : t.state === "failed"
            ? t.execution_finished && t.reason !== null
            : t.reason !== null,
    "ZMQ_EFFECT_STATE_INCONSISTENT",
  );
const effectDevice = z
  .object({
    mode: z.enum(["idle", "busy", "fault"]),
    ready: z.boolean(),
    active_task_id: WireId.nullable(),
    fault_code: boundedText.nullable(),
    fault_message: boundedText.nullable(),
  })
  .strict()
  .refine(
    (d) =>
      !d.ready ||
      (d.mode === "idle" &&
        d.active_task_id === null &&
        d.fault_code === null &&
        d.fault_message === null),
    "ZMQ_EFFECT_READY_INCONSISTENT",
  );
export const SimulationEffectPublication = z.discriminatedUnion("topic", [
  z
    .object({
      ...eventBase,
      protocol: z.literal("1.0"),
      topic: z.literal("device_status"),
      data: effectDevice,
    })
    .strict(),
  z
    .object({
      ...eventBase,
      protocol: z.literal("1.0"),
      topic: z.literal("task_status"),
      data: z.object({ task: effectTask.nullable() }).strict(),
    })
    .strict(),
]);
