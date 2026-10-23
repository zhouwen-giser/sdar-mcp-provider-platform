import { describe, expect, it } from "vitest";
import {
  parsePublication,
  parseRequest,
  parseResponse,
  parseWireJson,
} from "../../packages/vehicle-zmq-contract/src/index.js";

const bytes = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
const eoEvent = (topic: string, data: unknown) => ({
  protocol: "2.2",
  kind: "event",
  device_id: "isr-01",
  topic,
  published_at_utc_ms: 1792756800000,
  data,
});
const frames = (topic: string, data: unknown): Buffer[] => [
  Buffer.from("isr/isr-01/" + topic),
  bytes(eoEvent(topic, data)),
];
const areaTask = (overrides: Record<string, unknown> = {}) => ({
  task: {
    task_id: "task-1",
    task_type: "AreaSearch",
    state: "completed",
    remaining_ms: 0,
    progress_ratio: 1,
    coverage_ratio: 1,
    coverage_complete: true,
    completed_cycles: null,
    total_cycles: null,
    reason: null,
    ...overrides,
  },
  command: null,
});
const image = { camera_id: "eo-1", frame_id: "frame-1", width_px: 1920, height_px: 1080 };
const emptyReport = {
  task_id: "task-1",
  observed_at_utc_ms: null,
  image,
  data_origin: "simulated",
  truncated: false,
  targets: [],
};

describe("strict wire JSON", () => {
  it.each(['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"a":{"b":1,"b":2}}'])(
    "rejects duplicate decoded keys: %s",
    (source) => {
      expect(() => parseWireJson(Buffer.from(source))).toThrow("DUPLICATE_KEY");
    },
  );
  it.each(['{"x":1e999}', '{"x":NaN}', '{"x":1,}', "[1,]", '{"x":"unterminated}', "{}{}"])(
    "rejects invalid syntax/nonfinite values: %s",
    (source) => {
      expect(() => parseWireJson(Buffer.from(source))).toThrow();
    },
  );
  it("rejects invalid UTF-8, excess depth and frame size", () => {
    expect(() => parseWireJson(Buffer.from([0xff]))).toThrow("UTF8_INVALID");
    expect(() => parseWireJson(Buffer.from("[".repeat(18) + "0" + "]".repeat(18)))).toThrow(
      "COMPLEXITY",
    );
    expect(() => parseWireJson(Buffer.alloc(65_537, 32))).toThrow("SIZE_INVALID");
  });
});

describe("optical JSON v2.2 contract", () => {
  it("preserves coverage false/null at ratio 1 instead of inventing completeness", () => {
    for (const complete of [false, null])
      expect(
        parsePublication(
          "eo",
          frames("task_status", areaTask({ coverage_complete: complete })),
          "isr-01",
        ),
      ).toMatchObject({ data: { task: { coverage_ratio: 1, coverage_complete: complete } } });
  });
  it("distinguishes an explicit empty frame and unknown capture time from no report", () => {
    expect(parsePublication("eo", frames("targetlist", emptyReport), "isr-01")).toMatchObject({
      data: { targets: [], observed_at_utc_ms: null, truncated: false },
    });
    expect(() =>
      parsePublication(
        "eo",
        frames("targetlist", { ...emptyReport, targets: undefined }),
        "isr-01",
      ),
    ).toThrow();
  });
  it("preserves source truncation and rejects pixel/geodetic conflation", () => {
    expect(
      parsePublication("eo", frames("targetlist", { ...emptyReport, truncated: true }), "isr-01"),
    ).toMatchObject({ data: { truncated: true } });
    const target = {
      target_id: "det-1",
      category: "unknown",
      confidence: 0.5,
      threat_level: null,
      pixel: { x_px: 1920, y_px: 0 },
      bbox: null,
    };
    expect(() =>
      parsePublication("eo", frames("targetlist", { ...emptyReport, targets: [target] }), "isr-01"),
    ).toThrow();
    expect(() =>
      parsePublication(
        "eo",
        frames("targetlist", { ...emptyReport, position: { longitude: 0, latitude: 0 } }),
        "isr-01",
      ),
    ).toThrow();
  });
  it("rejects foreign/mismatched topics, versions and multipart counts", () => {
    expect(() => parsePublication("eo", frames("task_status", areaTask()), "isr-02")).toThrow(
      "FOREIGN_DEVICE",
    );
    expect(() =>
      parsePublication(
        "eo",
        [Buffer.from("isr/isr-01/task_status-more"), bytes(eoEvent("task_status", areaTask()))],
        "isr-01",
      ),
    ).toThrow("TOPIC_MISMATCH");
    expect(() =>
      parsePublication("eo", [bytes(eoEvent("task_status", areaTask()))], "isr-01"),
    ).toThrow("MULTIPART_COUNT");
    expect(() =>
      parsePublication(
        "eo",
        [
          Buffer.from("isr/isr-01/task_status"),
          bytes({ ...eoEvent("task_status", areaTask()), protocol: "2.1" }),
        ],
        "isr-01",
      ),
    ).toThrow();
  });
  it("requires four convex WGS84 vertices with actual height fields", () => {
    const points = [
      [106, 29],
      [106.001, 29],
      [106.001, 29.001],
      [106, 29.001],
    ].map(([lon, lat]) => ({ longitude_deg: lon, latitude_deg: lat, ellipsoid_height_m: 10 }));
    const request = {
      protocol: "2.2",
      kind: "request",
      device_id: "isr-01",
      request_id: "req-1",
      method: "AreaSearch",
      params: { region_wgs84: points, task_timeout_ms: 300000, search_strategy: "recognize" },
    };
    expect(parseRequest("eo", bytes(request))).toMatchObject({ method: "AreaSearch" });
    expect(() =>
      parseRequest(
        "eo",
        bytes({ ...request, params: { ...request.params, region_wgs84: points.slice(0, 3) } }),
      ),
    ).toThrow();
    expect(() =>
      parseRequest(
        "eo",
        bytes({
          ...request,
          params: { ...request.params, region_wgs84: [points[0], points[2], points[1], points[3]] },
        }),
      ),
    ).toThrow();
    expect(() =>
      parseRequest(
        "eo",
        bytes({
          ...request,
          params: {
            ...request.params,
            region_wgs84: points.map((p) => ({ ...p, ellipsoid_height_m: undefined })),
          },
        }),
      ),
    ).toThrow();
  });
  it("enforces velocity leases and mutually exclusive remote parameters", () => {
    const request = {
      protocol: "2.2",
      kind: "request",
      device_id: "isr-01",
      request_id: "req-1",
      method: "TeleControl",
      params: { action: "velocity", yaw_rate_rad_s: 0.1, pitch_rate_rad_s: 0, hold_ms: 1000 },
    };
    expect(parseRequest("eo", bytes(request))).toMatchObject({ method: "TeleControl" });
    expect(() =>
      parseRequest("eo", bytes({ ...request, params: { ...request.params, hold_ms: 1001 } })),
    ).toThrow();
    expect(() =>
      parseRequest("eo", bytes({ ...request, params: { ...request.params, zoom_ratio: 2 } })),
    ).toThrow();
    expect(() => parseRequest("eo", bytes({ ...request, method: "GetStatus" }))).toThrow();
  });
  it("matches response identity and uses command rather than the erroneous result example", () => {
    const response = {
      protocol: "2.2",
      kind: "response",
      device_id: "isr-01",
      response_id: "req-1",
      method: "TaskControl",
      ok: false,
      command: null,
      error: { code: "BUSY", message: "busy" },
    };
    const expected = { deviceId: "isr-01", requestId: "req-1", method: "TaskControl" };
    expect(parseResponse("eo", [bytes(response)], expected).ok).toBe(false);
    expect(() =>
      parseResponse("eo", [bytes(response)], { ...expected, requestId: "req-2" }),
    ).toThrow("REQUEST_MISMATCH");
    expect(() =>
      parseResponse("eo", [bytes({ ...response, command: undefined, result: null })], expected),
    ).toThrow();
  });
});

describe("simulation effect v1 contract", () => {
  const event = (task: unknown) => [
    Buffer.from("artillery/artillery-01/task_status"),
    bytes({
      protocol: "1.0",
      kind: "event",
      device_id: "artillery-01",
      topic: "task_status",
      published_at_utc_ms: 1792756800000,
      data: { task },
    }),
  ];
  const task = {
    task_id: "effect-1",
    request_id: "req-1",
    target_id: "det-1",
    position: { longitude_deg: 106, latitude_deg: 29, ellipsoid_height_m: null },
    state: "succeeded",
    execution_finished: true,
    effect: "miss",
    reason: null,
  };
  it("keeps execution success separate from virtual effect", () => {
    expect(parsePublication("simulationEffect", event(task), "artillery-01")).toMatchObject({
      data: { task: { state: "succeeded", effect: "miss" } },
    });
  });
  it("retains unknown and its independent unfinished flag", () => {
    expect(
      parsePublication(
        "simulationEffect",
        event({
          ...task,
          state: "unknown",
          execution_finished: false,
          effect: "unknown",
          reason: "FEEDBACK_TIMEOUT",
        }),
        "artillery-01",
      ),
    ).toMatchObject({ data: { task: { state: "unknown", execution_finished: false } } });
    expect(() =>
      parsePublication(
        "simulationEffect",
        event({ ...task, execution_finished: false }),
        "artillery-01",
      ),
    ).toThrow();
  });
  it("rejects invented cancel methods and preserves unknown height", () => {
    const request = {
      protocol: "1.0",
      kind: "request",
      device_id: "artillery-01",
      request_id: "req-1",
      method: "AttackTarget",
      params: { target_id: "det-1", position: task.position },
    };
    expect(parseRequest("simulationEffect", bytes(request))).toMatchObject({
      params: { position: { ellipsoid_height_m: null } },
    });
    expect(() =>
      parseRequest("simulationEffect", bytes({ ...request, method: "Cancel" })),
    ).toThrow();
  });
});
