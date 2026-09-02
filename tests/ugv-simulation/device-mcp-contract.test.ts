import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { describe, expect, it } from "vitest";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import {
  DeviceToolCircuitOpenError,
  DeviceToolProtocolError,
  DeviceToolRejectedError,
  NPC_TANK_DEVICE_TOOL_ALLOWLIST,
  OPERATION_REQUIRED_TOOLS,
  StreamableHttpNpcTankDeviceMcpClient,
  StreamableHttpUgvDeviceMcpClient,
  UGV_DEVICE_TOOL_ALLOWLIST,
  UGV_DEVICE_RESULT_POLICIES,
  UncertainMutatingDeviceCallError,
  buildUgvEmergencyStopCalls,
  buildUgvGimbalStopCall,
  buildUgvTargetLockCall,
  capturedToolSchemaHash,
  controlDeviceCalls,
  executeUgvStartFlow,
  mockUgvToolContracts,
  parseUgvMissionId,
  parseUgvTargetId,
  requiredUgvDeviceTools,
  startDeviceCalls,
  validateUgvToolResult,
  type UgvDeviceToolName,
} from "../../packages/vehicle-device-mcp-client/src/index.js";

describe("Goal 10 UGV Device MCP protocol binding", () => {
  it("uses the supplied 15-tool contract plus only the capability-gated laser extension", () => {
    expect(UGV_DEVICE_TOOL_ALLOWLIST).toEqual([
      "ugv_path_follow_mission",
      "ugv_return_home",
      "ugv_move_distance",
      "ugv_mission_control",
      "ugv_motion_stop",
      "get_status",
      "get_capabilities",
      "ugv_area_recon_configure",
      "ugv_area_recon_control",
      "ugv_area_recon_lock",
      "ugv_area_recon_get_status",
      "ugv_area_recon_get_targets",
      "ugv_area_recon_reset",
      "ugv_area_recon_attack_confirm",
      "ugv_gimbal_move",
      "ugv_laser_range",
    ]);
    expect(UGV_DEVICE_TOOL_ALLOWLIST).not.toContain("ugv_stop");
    expect(UGV_DEVICE_TOOL_ALLOWLIST).not.toContain("ugv_area_recon_unlock");
    expect(UGV_DEVICE_TOOL_ALLOWLIST).not.toContain("ugv_attack_target");
    expect(UGV_DEVICE_TOOL_ALLOWLIST).not.toContain("ugv_area_recon_get_exceptions");

    const contract = required(
      mockUgvToolContracts("2026-08-10T00:00:00.000Z").find(
        ({ name }) => name === "ugv_path_follow_mission",
      ),
    );
    expect(contract.inputSchema.type).toBe("object");
    expect(Object.keys(requiredRecord(contract.inputSchema.properties))).toEqual([
      "task_points",
      "json_url",
      "need_plan",
      "density",
      "mission_id",
    ]);
    expect(contract.outputSchema).toMatchObject({
      properties: { error_code: { type: "integer" }, mission_id: { type: "integer" } },
    });
    expect(
      capturedToolSchemaHash({
        name: contract.name,
        inputSchema: contract.inputSchema,
        outputSchema: {
          ...(contract.outputSchema ?? {}),
          properties: { changed: { type: "boolean" } },
        },
        ...(contract.annotations === undefined ? {} : { annotations: contract.annotations }),
      }),
    ).not.toBe(contract.schemaHash);
  });

  it("publishes a validated real capture during an outage without enabling offline mutations", async () => {
    const harness = new UgvMcpHarness();
    const reportPath = join(mkdtempSync(join(tmpdir(), "ugv-captured-contract-")), "contract.json");
    await harness.start();
    const remoteUrl = harness.url;
    const capturing = testClient(harness, new MemoryProviderStore(), { reportPath });
    await capturing.connect();
    await capturing.close();
    await harness.stop();

    const fallback = testClient(harness, new MemoryProviderStore(), {
      timeoutMs: 100,
      url: remoteUrl,
      reportPath,
      useCapturedContractWhenUnavailable: true,
    });
    try {
      await fallback.connect();
      expect(fallback.connected()).toBe(false);
      expect(fallback.contracts()).toHaveLength(UGV_DEVICE_TOOL_ALLOWLIST.length);
      expect(fallback.hasTool("ugv_path_follow_mission")).toBe(true);
      await expect(
        fallback.call("ugv_path_follow_mission", {
          task_points: [{ longitude: 106.81389697, latitude: 29.72041184 }],
          mission_id: 0,
        }),
      ).rejects.toThrow("UGV_DEVICE_MCP_UNAVAILABLE");
      expect(harness.toolCalls).toEqual([]);
    } finally {
      await fallback.close();
    }

    const tampered = JSON.parse(readFileSync(reportPath, "utf8")) as {
      mode: string;
      tools: { schemaHash: string }[];
    };
    required(tampered.tools[0]).schemaHash = "0".repeat(64);
    writeFileSync(reportPath, `${JSON.stringify(tampered)}\n`, "utf8");
    const rejected = testClient(harness, new MemoryProviderStore(), {
      timeoutMs: 100,
      url: remoteUrl,
      reportPath,
      useCapturedContractWhenUnavailable: true,
    });
    await expect(rejected.connect()).rejects.toBeDefined();
    expect(rejected.contracts()).toEqual([]);
    await rejected.close();
  });

  it("selects only tools required by the requested operation branch", () => {
    expect(
      requiredUgvDeviceTools("vehicle_navigate", {
        mission: { type: "distance", direction: "forward", distanceM: 1 },
      }),
    ).toEqual(["ugv_move_distance", "ugv_mission_control"]);
    expect(
      requiredUgvDeviceTools("vehicle_navigate", { mission: { type: "return_home" } }),
    ).toEqual(["ugv_return_home", "ugv_mission_control"]);
    expect(requiredUgvDeviceTools("vehicle_navigate", { mission: { type: "point" } })).toEqual([
      "ugv_path_follow_mission",
      "ugv_mission_control",
    ]);
    expect(requiredUgvDeviceTools("vehicle_navigate", { mission: { type: "route" } })).toEqual([
      "ugv_path_follow_mission",
      "ugv_mission_control",
    ]);
    expect(requiredUgvDeviceTools("vehicle_navigate", {}, "resume")).toEqual([
      "ugv_mission_control",
    ]);
    expect(requiredUgvDeviceTools("vehicle_get_capabilities")).toEqual(["get_capabilities"]);
    expect(requiredUgvDeviceTools("vehicle_area_recon", { scanMode: "area" })).toEqual([
      "ugv_area_recon_configure",
      "ugv_area_recon_control",
      "ugv_area_recon_get_status",
    ]);
    expect(requiredUgvDeviceTools("vehicle_area_recon", { scanMode: "circular" })).toEqual([
      "ugv_area_recon_configure",
      "ugv_area_recon_control",
      "ugv_area_recon_get_status",
    ]);
    expect(requiredUgvDeviceTools("vehicle_area_recon", {}, "cancel")).toEqual([
      "ugv_area_recon_control",
    ]);
    expect(requiredUgvDeviceTools("vehicle_emergency_stop")).toEqual(["ugv_motion_stop"]);
    expect(OPERATION_REQUIRED_TOOLS).toEqual({
      vehicle_get_state: ["get_status"],
      vehicle_get_capabilities: ["get_capabilities"],
      vehicle_get_payload_status: ["ugv_area_recon_get_status"],
      vehicle_get_targets: ["ugv_area_recon_get_targets"],
      vehicle_laser_range: ["ugv_laser_range"],
      vehicle_navigate: [
        "ugv_path_follow_mission",
        "ugv_return_home",
        "ugv_move_distance",
        "ugv_mission_control",
      ],
      vehicle_area_recon: [
        "ugv_area_recon_configure",
        "ugv_area_recon_control",
        "ugv_area_recon_get_status",
      ],
      vehicle_track_target: ["ugv_area_recon_lock", "ugv_area_recon_get_status"],
      vehicle_control_gimbal: ["ugv_gimbal_move"],
      vehicle_fire_weapon: ["ugv_area_recon_attack_confirm"],
      vehicle_emergency_stop: [
        "ugv_motion_stop",
        "ugv_mission_control",
        "ugv_area_recon_control",
        "ugv_area_recon_lock",
      ],
    });
  });

  it("builds exact path, distance, recon, lifecycle, lock, gimbal and stop arguments", () => {
    expect(
      startDeviceCalls("vehicle_navigate", {
        mission: {
          type: "point",
          target: { latitude: 30.2, longitude: 114.2 },
        },
      }),
    ).toEqual([
      {
        name: "ugv_path_follow_mission",
        arguments: {
          task_points: [{ longitude: 114.2, latitude: 30.2, altitude: 0 }],
          json_url: "",
          need_plan: false,
          density: "adaptive",
          mission_id: 0,
        },
      },
    ]);
    expect(
      startDeviceCalls("vehicle_navigate", {
        mission: {
          type: "point",
          target: { latitude: 30.2, longitude: 114.2 },
        },
        planningMode: "auto",
      })[0]?.arguments,
    ).toMatchObject({ need_plan: null });
    expect(
      startDeviceCalls("vehicle_navigate", {
        mission: {
          type: "point",
          target: { latitude: 30.2, longitude: 114.2 },
        },
        planningMode: "road_network",
        density: "dense",
      }),
    ).toEqual([
      {
        name: "ugv_path_follow_mission",
        arguments: {
          task_points: [{ longitude: 114.2, latitude: 30.2, altitude: 0 }],
          json_url: "",
          need_plan: true,
          density: "dense",
          mission_id: 0,
        },
      },
    ]);
    expect(
      startDeviceCalls("vehicle_navigate", {
        mission: { type: "distance", direction: "backward", distanceM: 2.5 },
      }),
    ).toEqual([
      {
        name: "ugv_move_distance",
        arguments: { direction: "back", distance: 2.5, mission_id: 0 },
      },
    ]);
    expect(
      startDeviceCalls("vehicle_area_recon", {
        scanMode: "circular",
        targetTypes: [2, "3"],
        scanCount: 2,
        scanPitch: -10,
      }),
    ).toEqual([
      {
        name: "ugv_area_recon_configure",
        arguments: {
          region_points: null,
          region_type: 5,
          target_types: [2, 3],
          scan_num: 2,
          lock_duration_limit: 0,
          recon_type: 1,
          scan_speed: 30,
          scan_mode: 2,
          scan_pitch: -10,
          mission_id: 0,
        },
      },
    ]);
    expect(controlDeviceCalls("vehicle_navigate", "resume", "42")).toEqual([
      {
        name: "ugv_mission_control",
        arguments: { action: "start", mission_id: 42 },
      },
    ]);
    expect(controlDeviceCalls("vehicle_navigate", "cancel", 42)).toEqual([
      {
        name: "ugv_mission_control",
        arguments: { action: "terminate", mission_id: 42 },
      },
    ]);
    expect(controlDeviceCalls("vehicle_area_recon", "pause", 43)).toEqual([
      {
        name: "ugv_area_recon_control",
        arguments: { cmd_type: 2, mission_id: 43 },
      },
    ]);
    expect(() => controlDeviceCalls("vehicle_fire_weapon", "cancel", 43)).toThrow(
      "UGV_FIRE_CANCEL_UNSUPPORTED",
    );
    expect(buildUgvTargetLockCall(true, "7", 43)).toEqual({
      name: "ugv_area_recon_lock",
      arguments: { lock: true, target_id: 7, mission_id: 43 },
    });
    expect(buildUgvGimbalStopCall("44")).toEqual({
      name: "ugv_gimbal_move",
      arguments: {
        mode: "velocity",
        yaw: 0,
        pitch: 0,
        yaw_speed: 0,
        pitch_speed: 0,
        delta_zoom: 0,
        mission_id: 44,
      },
    });
    expect(
      startDeviceCalls("vehicle_control_gimbal", {
        mode: "absolute",
        yaw: 15,
        pitch: -5,
        yawSpeed: 20,
        pitchSpeed: 10,
        deltaZoom: 1,
      }),
    ).toEqual([
      {
        name: "ugv_gimbal_move",
        arguments: {
          mode: "absolute",
          yaw: 15,
          pitch: -5,
          yaw_speed: 20,
          pitch_speed: 10,
          delta_zoom: 1,
          mission_id: 0,
        },
      },
    ]);
    expect(buildUgvEmergencyStopCalls({ chassisMissionId: "42", reconMissionId: 43 })).toEqual([
      { name: "ugv_motion_stop", arguments: {} },
      {
        name: "ugv_mission_control",
        arguments: { action: "terminate", mission_id: 42 },
      },
      {
        name: "ugv_area_recon_control",
        arguments: { cmd_type: 4, mission_id: 43 },
      },
      {
        name: "ugv_area_recon_lock",
        arguments: { lock: false, target_id: 0, mission_id: 43 },
      },
    ]);
  });

  it("chains returned integer mission IDs and persists them before dependent writes", async () => {
    const events: string[] = [];
    const result = await executeUgvStartFlow(
      "vehicle_navigate",
      {
        mission: { type: "distance", direction: "forward", distanceM: 1 },
      },
      (name, argumentsValue) => {
        events.push(`call:${name}:${String(argumentsValue.mission_id)}`);
        return Promise.resolve(commonResult(name === "ugv_move_distance" ? 42 : 42, 0));
      },
      {
        onMissionId: (canonical) => {
          events.push(`persist:${canonical}`);
        },
        beforeMutationDispatch: ({ phase, call }) => {
          events.push(`journal:${phase}:dispatching:${call.name}`);
        },
        afterMutationAccepted: ({ phase, canonicalMissionId }) => {
          events.push(`journal:${phase}:accepted:${String(canonicalMissionId)}`);
        },
      },
    );

    expect(events).toEqual([
      "journal:PRIMARY:dispatching:ugv_move_distance",
      "call:ugv_move_distance:0",
      "persist:42",
      "journal:PRIMARY:accepted:42",
      "journal:FOLLOWUP:dispatching:ugv_mission_control",
      "call:ugv_mission_control:42",
      "journal:FOLLOWUP:accepted:42",
    ]);
    expect(result.missionIds).toEqual([42]);
    expect(result.canonicalMissionIds).toEqual(["42"]);
  });

  it("rejects zero submit IDs and mismatched control response IDs", async () => {
    const persisted: string[] = [];
    await expect(
      executeUgvStartFlow(
        "vehicle_navigate",
        { mission: { type: "distance", direction: "forward", distanceM: 1 } },
        () => Promise.resolve(commonResult(0, 0)),
        { onMissionId: (missionId) => void persisted.push(missionId) },
      ),
    ).rejects.toThrow(UncertainMutatingDeviceCallError);
    expect(persisted).toEqual([]);

    const calls: UgvDeviceToolName[] = [];
    await expect(
      executeUgvStartFlow(
        "vehicle_navigate",
        { mission: { type: "distance", direction: "forward", distanceM: 1 } },
        (name) => {
          calls.push(name);
          return Promise.resolve(commonResult(name === "ugv_move_distance" ? 42 : 43, 0));
        },
        { onMissionId: (missionId) => void persisted.push(missionId) },
      ),
    ).rejects.toThrow(UncertainMutatingDeviceCallError);
    expect(calls).toEqual(["ugv_move_distance", "ugv_mission_control"]);
    expect(persisted).toEqual(["42"]);
  });

  it("classifies local persistence failure after a returned mutation as uncertain", async () => {
    const failures: unknown[] = [];
    await expect(
      executeUgvStartFlow(
        "vehicle_navigate",
        { mission: { type: "distance", direction: "forward", distanceM: 1 } },
        () => Promise.resolve(commonResult(42, 0)),
        {
          onMissionId: () => {
            throw new Error("TEST_MISSION_PERSISTENCE_FAILED");
          },
          afterMutationFailed: ({ error, result, canonicalMissionId }) => {
            failures.push(error, result, canonicalMissionId);
          },
        },
      ),
    ).rejects.toBeInstanceOf(UncertainMutatingDeviceCallError);
    expect(failures[0]).toBeInstanceOf(UncertainMutatingDeviceCallError);
    expect(failures[1]).toEqual(commonResult(42, 0));
    expect(failures[2]).toBe("42");
  });

  it("validates downstream business success instead of trusting MCP isError", () => {
    expect(new Set(Object.keys(UGV_DEVICE_RESULT_POLICIES))).toEqual(
      new Set(UGV_DEVICE_TOOL_ALLOWLIST),
    );
    expect(UGV_DEVICE_RESULT_POLICIES.ugv_move_distance).toMatchObject({
      kind: "mutating",
      responseIsError: "rejected",
      errorCode: "optional",
      successStates: [0, 1, 2, 3, 4],
      rejectedStates: [5],
      missionId: "allocates_or_controls",
    });
    expect(UGV_DEVICE_RESULT_POLICIES.get_status).toMatchObject({
      kind: "read",
      errorCode: "none",
      missionId: "none",
    });
    const acceptedWithoutErrorCode = commonResult(9, 0);
    delete acceptedWithoutErrorCode.error_code;
    expect(() =>
      validateUgvToolResult("ugv_move_distance", acceptedWithoutErrorCode, {
        mission_id: 9,
      }),
    ).not.toThrow();
    expect(() =>
      validateUgvToolResult("ugv_move_distance", {
        ...commonResult(9, 5),
        error_code: 831,
        message: "precondition rejected",
      }),
    ).toThrow(DeviceToolRejectedError);
    expect(() => validateUgvToolResult("ugv_move_distance", commonResult(9, 5))).toThrow(
      DeviceToolRejectedError,
    );
    expect(() =>
      validateUgvToolResult("ugv_move_distance", { state: 5, state_label: "failed" }),
    ).toThrow(DeviceToolRejectedError);
    expect(() => validateUgvToolResult("ugv_move_distance", { error_code: 831 })).toThrow(
      DeviceToolRejectedError,
    );
    expect(() =>
      validateUgvToolResult("ugv_move_distance", {
        ...commonResult(9, 0),
        mission_id: "9",
      }),
    ).toThrow(UncertainMutatingDeviceCallError);
    expect(() =>
      validateUgvToolResult("ugv_area_recon_configure", {
        ...commonResult(10, 0),
        res: false,
        fail_data: "",
      }),
    ).toThrow(DeviceToolRejectedError);
    expect(() =>
      validateUgvToolResult("ugv_area_recon_configure", {
        ...commonResult(10, 0),
        res: true,
        fail_data: "",
        coverability: {
          coverable: "maybe",
          coverable_label: "invalid",
        },
      }),
    ).toThrow(UncertainMutatingDeviceCallError);
    expect(() =>
      validateUgvToolResult("ugv_area_recon_control", {
        ...commonResult(10, 1),
        cmd_res: 1,
        fail_data: "rejected",
      }),
    ).toThrow(DeviceToolRejectedError);
    expect(() =>
      validateUgvToolResult("ugv_move_distance", {
        mission_id: 9,
        state_label: "accepted",
        message: "ambiguous because state is missing",
      }),
    ).toThrow(UncertainMutatingDeviceCallError);
    expect(() => validateUgvToolResult("get_status", { available: "yes" })).toThrow(
      DeviceToolProtocolError,
    );
    expect(() =>
      validateUgvToolResult("ugv_area_recon_get_status", {
        status: 99,
        out_of_range: false,
        camera_fault: false,
      }),
    ).not.toThrow();
  });

  it("accepts only safe canonical persisted IDs", () => {
    expect(parseUgvMissionId("42")).toBe(42);
    expect(parseUgvTargetId("7")).toBe(7);
    for (const value of ["01", "1e2", "-1", Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseUgvMissionId(value)).toThrow("UGV_MISSION_ID_INVALID");
    }
    expect(() => parseUgvTargetId("target-7")).toThrow("UGV_TARGET_ID_INVALID");
    expect(() => controlDeviceCalls("vehicle_navigate", "pause")).toThrow(
      "UGV_PERSISTED_MISSION_ID_REQUIRED",
    );
  });

  it("requires the primary emergency stop and treats cleanup rejection as best-effort", async () => {
    const calls: UgvDeviceToolName[] = [];
    const result = await executeUgvStartFlow(
      "vehicle_emergency_stop",
      { chassisMissionId: 42, reconMissionId: 43 },
      (name) => {
        calls.push(name);
        if (name === "ugv_mission_control")
          return Promise.resolve({
            ...commonResult(42, 3),
            error_code: 831,
            message: "already stopped",
          });
        if (name === "ugv_area_recon_control" || name === "ugv_area_recon_lock")
          return Promise.resolve({ ...commonResult(43, 3), cmd_res: 0, fail_data: "" });
        return Promise.resolve(commonResult(42, 3));
      },
    );
    expect(result.calls[0]).toEqual({ name: "ugv_motion_stop", arguments: {} });
    expect(calls).toEqual([
      "ugv_motion_stop",
      "ugv_mission_control",
      "ugv_area_recon_control",
      "ugv_area_recon_lock",
    ]);

    await expect(
      executeUgvStartFlow("vehicle_emergency_stop", {}, () =>
        Promise.resolve({ ...commonResult(0, 3), error_code: 831, message: "stop rejected" }),
      ),
    ).rejects.toBeInstanceOf(DeviceToolRejectedError);
  });
});

describe("Goal 10 UGV Device MCP transport safety", () => {
  it("keeps the Streamable HTTP NPC client on the resilient shared call path", async () => {
    const harness = new UgvMcpHarness(NPC_TANK_DEVICE_TOOL_ALLOWLIST);
    await harness.start();
    const tool = "npc_tank_get_capabilities";
    try {
      const auditFailingClient = npcTestClient(harness, new FailingAuditStore());
      await auditFailingClient.connect();
      await expect(auditFailingClient.call(tool, {})).resolves.toEqual(commonResult(1, 0));
      expect(auditFailingClient.toolHealth(tool)).toMatchObject({
        state: "healthy",
        consecutiveFailures: 0,
      });
      await auditFailingClient.close();

      harness.results.set(tool, "descriptive-only");
      const protocolErrorClient = npcTestClient(harness, new MemoryProviderStore());
      await protocolErrorClient.connect();
      await expect(protocolErrorClient.call(tool, {})).rejects.toThrow(
        "NPC_TANK_DEVICE_MCP_RESPONSE_CONFLICT",
      );
      expect(protocolErrorClient.toolHealth(tool)).toMatchObject({
        state: "degraded",
        consecutiveFailures: 1,
      });
      await protocolErrorClient.close();
    } finally {
      await harness.stop();
    }
  });

  it("reconnects and retries a dropped read response within the configured bound", async () => {
    const harness = new UgvMcpHarness();
    await harness.start();
    const store = new MemoryProviderStore();
    const client = testClient(harness, store, { readRetryAttempts: 1 });
    const states: string[] = [];
    const calls: { retries: number; attempts: number; uncertain: boolean }[] = [];
    client.onConnectionState((state) => states.push(state));
    client.onCallObservation((observation) => calls.push(observation));
    try {
      await client.connect();
      harness.dropNextToolCalls = 1;
      await expect(client.call("get_status", {})).resolves.toEqual({ available: true });
      expect(harness.toolCalls.filter(({ name }) => name === "get_status")).toHaveLength(2);
      expect(client.connected()).toBe(true);
      expect(states).toContain("disconnected");
      expect(states.at(-1)).toBe("connected");
      expect(store.toolCalls.at(-1)?.outcome).toBe("accepted");
      expect(calls).toEqual([
        expect.objectContaining({ attempts: 2, retries: 1, uncertain: false }),
      ]);
    } finally {
      await client.close();
      await harness.stop();
    }
  });

  it("classifies a lost mutating response as uncertain and never retries it", async () => {
    const harness = new UgvMcpHarness();
    harness.delays.set("ugv_motion_stop", 200);
    await harness.start();
    const store = new MemoryProviderStore();
    const client = testClient(harness, store, { timeoutMs: 30, readRetryAttempts: 4 });
    const calls: { retries: number; attempts: number; uncertain: boolean }[] = [];
    client.onCallObservation((observation) => calls.push(observation));
    try {
      await client.connect();
      await expect(client.call("ugv_motion_stop", {})).rejects.toBeInstanceOf(
        UncertainMutatingDeviceCallError,
      );
      expect(harness.toolCalls.filter(({ name }) => name === "ugv_motion_stop")).toHaveLength(1);
      expect(client.connected()).toBe(false);
      expect(store.toolCalls.at(-1)?.outcome).toBe("timeout");
      expect(calls).toEqual([
        expect.objectContaining({ attempts: 1, retries: 0, uncertain: true }),
      ]);
    } finally {
      await client.close();
      await harness.stop();
    }
  });

  it("opens only the failing tool circuit and recovers through a half-open probe", async () => {
    const harness = new UgvMcpHarness();
    harness.results.set("get_status", { available: "invalid" });
    await harness.start();
    const store = new MemoryProviderStore();
    const client = testClient(harness, store, {
      circuitBreakerThreshold: 2,
      circuitBreakerResetMs: 100,
    });
    try {
      await client.connect();
      await expect(client.call("get_status", {})).rejects.toBeInstanceOf(DeviceToolProtocolError);
      await expect(client.call("get_status", {})).rejects.toBeInstanceOf(DeviceToolProtocolError);
      expect(client.toolHealth("get_status")).toMatchObject({
        state: "open",
        consecutiveFailures: 2,
      });
      expect(client.toolAvailable("get_status")).toBe(false);
      expect(client.toolAvailable("get_capabilities")).toBe(true);
      await expect(client.call("get_status", {})).rejects.toBeInstanceOf(
        DeviceToolCircuitOpenError,
      );

      harness.results.set("get_status", { available: true });
      await wait(110);
      await expect(client.call("get_status", {})).resolves.toEqual({ available: true });
      expect(client.toolHealth("get_status")).toMatchObject({
        state: "healthy",
        consecutiveFailures: 0,
      });
    } finally {
      await client.close();
      await harness.stop();
    }
  });

  it("allows only one in-flight half-open probe", async () => {
    const harness = new UgvMcpHarness();
    harness.results.set("get_status", { available: "invalid" });
    await harness.start();
    const store = new MemoryProviderStore();
    const client = testClient(harness, store, {
      circuitBreakerThreshold: 1,
      circuitBreakerResetMs: 100,
    });
    try {
      await client.connect();
      await expect(client.call("get_status", {})).rejects.toBeInstanceOf(DeviceToolProtocolError);
      harness.results.set("get_status", { available: true });
      harness.delays.set("get_status", 50);
      await wait(110);

      const probe = client.call("get_status", {});
      await expect(client.call("get_status", {})).rejects.toBeInstanceOf(
        DeviceToolCircuitOpenError,
      );
      await expect(probe).resolves.toEqual({ available: true });
      expect(harness.toolCalls.filter(({ name }) => name === "get_status")).toHaveLength(2);
    } finally {
      await client.close();
      await harness.stop();
    }
  });

  it("does not mask an accepted mutation when local audit persistence fails", async () => {
    const harness = new UgvMcpHarness();
    await harness.start();
    const client = testClient(harness, new FailingAuditStore());
    try {
      await client.connect();
      await expect(client.call("ugv_motion_stop", {})).resolves.toMatchObject({
        error_code: 0,
      });
      expect(harness.toolCalls.filter(({ name }) => name === "ugv_motion_stop")).toHaveLength(1);
    } finally {
      await client.close();
      await harness.stop();
    }
  });

  it("records a structured downstream rejection as rejected, not protocol_error", async () => {
    const harness = new UgvMcpHarness();
    harness.results.set("ugv_motion_stop", {
      ...commonResult(1, 3),
      error_code: 831,
      message: "rejected",
    });
    await harness.start();
    const store = new MemoryProviderStore();
    const client = testClient(harness, store);
    try {
      await client.connect();
      await expect(client.call("ugv_motion_stop", {})).rejects.toBeInstanceOf(
        DeviceToolRejectedError,
      );
      expect(store.toolCalls.at(-1)?.outcome).toBe("rejected");
      expect(client.connected()).toBe(true);
      expect(client.toolHealth("ugv_motion_stop").state).toBe("healthy");
    } finally {
      await client.close();
      await harness.stop();
    }
  });

  it("uses MCP isError as rejection evidence and treats contradictory success as uncertain", async () => {
    const harness = new UgvMcpHarness();
    harness.errorTools.add("ugv_motion_stop");
    harness.results.set("ugv_motion_stop", commonResult(1, 5));
    await harness.start();
    const client = testClient(harness, new MemoryProviderStore());
    try {
      await client.connect();
      await expect(client.call("ugv_motion_stop", {})).rejects.toBeInstanceOf(
        DeviceToolRejectedError,
      );

      harness.results.set("ugv_motion_stop", commonResult(1, 0));
      await expect(client.call("ugv_motion_stop", {})).rejects.toBeInstanceOf(
        UncertainMutatingDeviceCallError,
      );

      harness.results.set("ugv_motion_stop", "explicit device rejection");
      await expect(client.call("ugv_motion_stop", {})).rejects.toBeInstanceOf(
        DeviceToolRejectedError,
      );
      expect(harness.toolCalls.filter(({ name }) => name === "ugv_motion_stop")).toHaveLength(3);
    } finally {
      await client.close();
      await harness.stop();
    }
  });
});

function commonResult(missionId: number, state: number): Record<string, unknown> {
  return {
    mission_id: missionId,
    state,
    state_label: "accepted",
    message: "accepted",
    error_code: 0,
  };
}

class FailingAuditStore extends MemoryProviderStore {
  override appendDeviceToolCall(): Promise<void> {
    return Promise.reject(new Error("TEST_AUDIT_UNAVAILABLE"));
  }
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("TEST_VALUE_REQUIRED");
  return value;
}

function testClient(
  harness: UgvMcpHarness,
  store: MemoryProviderStore,
  overrides: Partial<{
    timeoutMs: number;
    readRetryAttempts: number;
    circuitBreakerThreshold: number;
    circuitBreakerResetMs: number;
    url: string;
    reportPath: string;
    useCapturedContractWhenUnavailable: boolean;
  }> = {},
): StreamableHttpUgvDeviceMcpClient {
  return new StreamableHttpUgvDeviceMcpClient(
    {
      url: overrides.url ?? harness.url,
      timeoutMs: overrides.timeoutMs ?? 500,
      maxResponseBytes: 65_536,
      contractReportPath:
        overrides.reportPath ??
        join(mkdtempSync(join(tmpdir(), "ugv-device-contract-")), "contract.json"),
      useMockContractWhenUnavailable: false,
      useCapturedContractWhenUnavailable: overrides.useCapturedContractWhenUnavailable ?? false,
      reconnectMinMs: 50,
      reconnectMaxMs: 100,
      readRetryAttempts: overrides.readRetryAttempts ?? 1,
      circuitBreakerThreshold: overrides.circuitBreakerThreshold ?? 3,
      circuitBreakerResetMs: overrides.circuitBreakerResetMs ?? 100,
    },
    store,
  );
}

function npcTestClient(
  harness: UgvMcpHarness,
  store: MemoryProviderStore,
): StreamableHttpNpcTankDeviceMcpClient {
  return new StreamableHttpNpcTankDeviceMcpClient(
    {
      url: harness.url,
      timeoutMs: 500,
      maxResponseBytes: 65_536,
      contractReportPath: join(
        mkdtempSync(join(tmpdir(), "npc-device-contract-")),
        "contract.json",
      ),
      useMockContractWhenUnavailable: false,
    },
    store,
  );
}

class UgvMcpHarness {
  #server: Server | undefined;
  #port: number | undefined;
  dropNextToolCalls = 0;
  readonly delays = new Map<string, number>();
  readonly errorTools = new Set<string>();
  readonly results = new Map<string, unknown>();
  readonly toolCalls: { name: string; arguments: Record<string, unknown> }[] = [];

  constructor(readonly toolNames: readonly string[] = UGV_DEVICE_TOOL_ALLOWLIST) {}

  get url(): string {
    if (this.#port === undefined) throw new Error("TEST_MCP_SERVER_NOT_STARTED");
    return `http://127.0.0.1:${String(this.#port)}/mcp`;
  }

  async start(): Promise<void> {
    const server = createServer((request, response) => void this.#handle(request, response));
    this.#server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("TEST_MCP_SERVER_ADDRESS_INVALID");
    this.#port = address.port;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    this.#port = undefined;
    if (server === undefined) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async #handle(request: IncomingMessage, response: ServerResponse) {
    if (request.method !== "POST") {
      response.writeHead(204).end();
      return;
    }
    const body = await jsonBody(request);
    const requestObject = record(body) ? body : {};
    const params = record(requestObject.params) ? requestObject.params : {};
    if (requestObject.method === "tools/call" && typeof params.name === "string") {
      const name = params.name;
      const argumentsValue = record(params.arguments) ? params.arguments : {};
      this.toolCalls.push({ name, arguments: structuredClone(argumentsValue) });
      if (this.dropNextToolCalls > 0) {
        this.dropNextToolCalls--;
        request.socket.destroy();
        return;
      }
    }

    const instance = new McpServer({ name: "goal10-device-test", version: "1.0.0" });
    for (const name of this.toolNames)
      instance.registerTool(name, { description: name, inputSchema: {} }, async () => {
        const delayMs = this.delays.get(name);
        if (delayMs !== undefined) await wait(delayMs);
        const result =
          this.results.get(name) ??
          (name === "get_status"
            ? { available: true }
            : name === "get_capabilities"
              ? {}
              : commonResult(1, 0));
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) ?? "undefined" }],
          ...(this.errorTools.has(name) ? { isError: true } : {}),
        };
      });
    const transport = new StreamableHTTPServerTransport();
    try {
      await instance.connect(transport as unknown as Transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      if (!response.headersSent) response.writeHead(500).end(String(error));
    } finally {
      response.once("close", () => {
        void transport.close();
        void instance.close();
      });
    }
  }
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredRecord(value: unknown): Record<string, unknown> {
  if (!record(value)) throw new Error("TEST_RECORD_REQUIRED");
  return value;
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
