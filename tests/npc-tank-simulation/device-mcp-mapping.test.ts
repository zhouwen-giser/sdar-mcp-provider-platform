import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildNpcTankAttackConfirmationCall,
  buildNpcTankEmergencyStopCalls,
  buildNpcTankGimbalStopCall,
  buildNpcTankStartFollowupCall,
  buildNpcTankTargetLockCall,
  DeviceToolProtocolError,
  DeviceToolRejectedError,
  executeNpcTankStartFlow,
  mockNpcTankToolContracts,
  npcCircularScanSupported,
  npcControlDeviceCalls,
  npcStartDeviceCalls,
  NPC_TANK_DEVICE_PROFILE,
  NPC_TANK_DEVICE_TOOL_ALLOWLIST,
  selectNpcNavigationTool,
  validateNpcTankToolResult,
} from "../../packages/vehicle-device-mcp-client/src/index.js";

const capture = JSON.parse(
  readFileSync(resolve("reports/npc-tank-simulation/MCP_CONTRACT_CAPTURE.json"), "utf8"),
) as { capturedToolNames: string[] };
const contracts = mockNpcTankToolContracts("2026-08-10T00:00:00.000Z");

describe("real NPC Tank Device MCP inventory", () => {
  it("uses exactly the 15 tools captured from the real server", () => {
    expect(NPC_TANK_DEVICE_TOOL_ALLOWLIST).toEqual(capture.capturedToolNames);
    expect(contracts.map(({ name }) => name)).toEqual(capture.capturedToolNames);
    expect(NPC_TANK_DEVICE_PROFILE.resilientCalls).toBe(true);
    for (const removed of [
      "npc_tank_send_waypoints",
      "npc_tank_stop",
      "npc_tank_cancel_mission",
      "npc_tank_attack_target",
      "npc_tank_area_recon_unlock",
      "npc_tank_area_recon_get_exceptions",
      "npc_tank_laser_range",
      "npc_tank_eo_scan_start",
      "npc_tank_eo_scan_stop",
      "npc_tank_eo_set_angle",
    ])
      expect(NPC_TANK_DEVICE_TOOL_ALLOWLIST).not.toContain(removed);
  });

  it("selects only path_follow and derives circular recon from configure/control", () => {
    expect(selectNpcNavigationTool(contracts)).toMatchObject({
      selected: "npc_tank_path_follow_mission",
      primaryValid: true,
      fallbackValid: false,
    });
    expect(npcCircularScanSupported(contracts)).toBe(true);
    expect(
      npcCircularScanSupported(
        contracts.filter(({ name }) => name !== "npc_tank_area_recon_control"),
      ),
    ).toBe(false);
  });
});

describe("real NPC Tank command mapping", () => {
  it("maps point, route, distance and return-home to captured argument names", () => {
    const navigation = selectNpcNavigationTool(contracts);
    expect(
      npcStartDeviceCalls(
        "vehicle_navigate",
        { mission: { type: "point", target: { latitude: 30.2, longitude: 114.2 } } },
        navigation,
        true,
      ),
    ).toEqual([
      {
        name: "npc_tank_path_follow_mission",
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
      npcStartDeviceCalls(
        "vehicle_navigate",
        {
          mission: {
            type: "route",
            waypoints: [
              { latitude: 30.2, longitude: 114.2 },
              { latitude: 30.3, longitude: 114.3, altitude: 4 },
            ],
          },
          planningMode: "road_network",
          density: "dense",
        },
        navigation,
        true,
      )[0]?.arguments,
    ).toMatchObject({ need_plan: true, density: "dense", mission_id: 0 });
    expect(
      npcStartDeviceCalls(
        "vehicle_navigate",
        { mission: { type: "distance", direction: "backward", distanceM: 2.5 } },
        navigation,
        true,
      ),
    ).toEqual([
      {
        name: "npc_tank_move_distance",
        arguments: { direction: "back", distance: 2.5, mission_id: 0 },
      },
    ]);
    expect(
      npcStartDeviceCalls(
        "vehicle_navigate",
        { mission: { type: "return_home" } },
        navigation,
        true,
      ),
    ).toEqual([{ name: "npc_tank_return_home", arguments: { mission_id: 0 } }]);
  });

  it("maps area and circular recon through one configure/control lifecycle", () => {
    const navigation = selectNpcNavigationTool(contracts);
    const areaArguments = {
      area: {
        polygon: [
          { latitude: 30.1, longitude: 114.1 },
          { latitude: 30.1, longitude: 114.2 },
          { latitude: 30.2, longitude: 114.2 },
        ],
      },
      scanMode: "area",
      scanCount: 2,
      targetTypes: [2, "3"],
      reconType: "visible",
    };
    expect(npcStartDeviceCalls("vehicle_area_recon", areaArguments, navigation, true)).toEqual([
      {
        name: "npc_tank_area_recon_configure",
        arguments: {
          region_points: [
            { longitude: 114.1, latitude: 30.1, altitude: 0 },
            { longitude: 114.2, latitude: 30.1, altitude: 0 },
            { longitude: 114.2, latitude: 30.2, altitude: 0 },
          ],
          region_type: 5,
          target_types: [2, 3],
          scan_num: 2,
          lock_duration_limit: 0,
          recon_type: 2,
          scan_speed: 30,
          scan_mode: 1,
          scan_pitch: 0,
          mission_id: 0,
        },
      },
    ]);
    expect(
      npcStartDeviceCalls(
        "vehicle_area_recon",
        { scanMode: "circular", scanCount: 1, scanPitch: -5 },
        navigation,
        true,
      )[0]?.arguments,
    ).toMatchObject({ region_points: null, scan_mode: 2, scan_pitch: -5, mission_id: 0 });
  });

  it("carries strict mission IDs through lifecycle, lock, gimbal and confirmation calls", () => {
    expect(buildNpcTankStartFollowupCall("vehicle_navigate", "42")).toEqual({
      name: "npc_tank_mission_control",
      arguments: { action: "start", mission_id: 42 },
    });
    expect(npcControlDeviceCalls("vehicle_navigate", "pause", 42)[0]?.arguments).toEqual({
      action: "pause",
      mission_id: 42,
    });
    expect(npcControlDeviceCalls("vehicle_navigate", "resume", 42)[0]?.arguments).toEqual({
      action: "start",
      mission_id: 42,
    });
    expect(npcControlDeviceCalls("vehicle_area_recon", "cancel", 43)[0]?.arguments).toEqual({
      cmd_type: 4,
      mission_id: 43,
    });
    expect(buildNpcTankTargetLockCall(true, "7", 43).arguments).toEqual({
      lock: true,
      target_id: 7,
      mission_id: 43,
    });
    expect(buildNpcTankTargetLockCall(false, 0, 43).arguments).toEqual({
      lock: false,
      target_id: 0,
      mission_id: 43,
    });
    expect(buildNpcTankGimbalStopCall(44).arguments).toMatchObject({
      mode: "velocity",
      yaw_speed: 0,
      pitch_speed: 0,
      mission_id: 44,
    });
    expect(buildNpcTankAttackConfirmationCall(1, 44)).toEqual({
      name: "npc_tank_area_recon_attack_confirm",
      arguments: { confirm: 1, mission_id: 44 },
    });
  });

  it("uses all independent captured stop primitives", () => {
    expect(buildNpcTankEmergencyStopCalls({ chassisMissionId: 11, reconMissionId: 12 })).toEqual([
      { name: "npc_tank_motion_stop", arguments: {} },
      {
        name: "npc_tank_mission_control",
        arguments: { action: "terminate", mission_id: 11 },
      },
      {
        name: "npc_tank_area_recon_control",
        arguments: { cmd_type: 4, mission_id: 12 },
      },
      {
        name: "npc_tank_area_recon_lock",
        arguments: { lock: false, target_id: 0, mission_id: 12 },
      },
    ]);
  });

  it("rejects unsupported velocity pitch motion", () => {
    expect(() =>
      npcStartDeviceCalls(
        "vehicle_control_gimbal",
        { mode: "velocity", yawSpeed: 5, pitchSpeed: 1, durationMs: 100 },
        selectNpcNavigationTool(contracts),
        true,
      ),
    ).toThrow("NPC_TANK_GIMBAL_VELOCITY_PITCH_UNSUPPORTED");
  });
});

describe("NPC Tank stateful result semantics", () => {
  it("persists a returned integer ID before dispatching dependent start", async () => {
    const order: string[] = [];
    const result = await executeNpcTankStartFlow(
      "vehicle_navigate",
      { mission: { type: "point", target: { latitude: 30.2, longitude: 114.2 } } },
      async (name, argumentsValue) => {
        order.push(`${name}:${String(argumentsValue.mission_id)}`);
        return commonResult(
          argumentsValue.mission_id === 0 ? 42 : 42,
          name.endsWith("control") ? 1 : 0,
        );
      },
      { onMissionId: (id) => void order.push(`persist:${id}`) },
    );
    expect(order).toEqual([
      "npc_tank_path_follow_mission:0",
      "persist:42",
      "npc_tank_mission_control:42",
    ]);
    expect(result.missionIds).toEqual([42]);
    expect(result.canonicalMissionIds).toEqual(["42"]);
  });

  it("validates error_code, mission correlation and available=false", () => {
    expect(() =>
      validateNpcTankToolResult("npc_tank_move_distance", commonResult(7, 0), {
        direction: "forward",
        distance: 1,
        mission_id: 0,
      }),
    ).not.toThrow();
    expect(() =>
      validateNpcTankToolResult(
        "npc_tank_move_distance",
        { error_code: 17, message: "rejected" },
        { direction: "forward", distance: 1, mission_id: 0 },
      ),
    ).toThrow(DeviceToolRejectedError);
    expect(() =>
      validateNpcTankToolResult("npc_tank_mission_control", commonResult(8, 1), {
        action: "start",
        mission_id: 7,
      }),
    ).toThrow(DeviceToolProtocolError);
    expect(() => validateNpcTankToolResult("get_status", { available: false })).not.toThrow();
    expect(() =>
      validateNpcTankToolResult("get_status", { available: false, state: "stale" }),
    ).toThrow("NPC_TANK_DEVICE_STATUS_UNAVAILABLE_CONTRADICTORY");
  });

  it("requires recon command and status result fields", () => {
    expect(() =>
      validateNpcTankToolResult(
        "npc_tank_area_recon_control",
        { ...commonResult(9, 1), cmd_res: 0, fail_data: "" },
        { cmd_type: 1, mission_id: 9 },
      ),
    ).not.toThrow();
    expect(() =>
      validateNpcTankToolResult("npc_tank_area_recon_get_status", {
        status: 5,
        status_label: "running",
        scan_mode: 2,
        out_of_range: false,
        camera_fault: false,
        progress: 25,
      }),
    ).not.toThrow();
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
