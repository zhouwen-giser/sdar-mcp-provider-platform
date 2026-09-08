import { describe, expect, it } from "vitest";
import {
  TrackArbiter,
  UGV_OPERATION_TRACKS,
} from "../../packages/vehicle-provider-core/src/index.js";
import {
  validateUgvToolResult,
  DeviceToolRejectedError,
  controlDeviceCalls,
  startDeviceCalls,
} from "../../packages/vehicle-device-mcp-client/src/index.js";

describe("UGV simulator recon command and EO chain", () => {
  it.each([
    "ugv_area_recon_control",
    "ugv_area_recon_lock",
    "ugv_area_recon_reset",
    "ugv_area_recon_attack_confirm",
  ] as const)("accepts CmdResEnum success=1 and rejects failure=2 for %s", (name) => {
    const result = {
      mission_id: 41924,
      state: 1,
      state_label: "running",
      message: "ok",
      error_code: 0,
      cmd_res: 1,
    };
    expect(validateUgvToolResult(name, result, { mission_id: 41924 })).toEqual(result);
    expect(() => validateUgvToolResult(name, { ...result, cmd_res: 2 })).toThrow(
      DeviceToolRejectedError,
    );
    expect(() => validateUgvToolResult(name, { ...result, cmd_res: 0 })).toThrow(
      DeviceToolRejectedError,
    );
  });
  it("uses EO stop and valid empty target type array", () => {
    expect(controlDeviceCalls("vehicle_area_recon", "cancel", 41924)).toEqual([
      { name: "ugv_area_recon_control", arguments: { cmd_type: 4, mission_id: 41924 } },
    ]);
    expect(
      startDeviceCalls("vehicle_area_recon", {
        scanMode: "area",
        area: {
          polygon: [
            { longitude: 1, latitude: 1 },
            { longitude: 1, latitude: 2 },
            { longitude: 2, latitude: 2 },
          ],
        },
      })[0]?.arguments.target_types,
    ).toEqual([]);
  });
  it("shares EO only along the same target chain and keeps each owner until released", () => {
    const a = new TrackArbiter(true, "UGV", UGV_OPERATION_TRACKS, true);
    expect(a.acquire("r", "vehicle_area_recon").accepted).toBe(true);
    expect(a.acquire("t", "vehicle_track_target", "63").accepted).toBe(true);
    expect(a.acquire("t2", "vehicle_track_target", "63").accepted).toBe(false);
    expect(a.acquire("wrong", "vehicle_fire_weapon", "64").accepted).toBe(false);
    expect(a.acquire("f", "vehicle_fire_weapon", "63").accepted).toBe(true);
    expect(a.acquire("f2", "vehicle_fire_weapon", "63").accepted).toBe(false);
    expect(a.acquire("g", "vehicle_control_gimbal").accepted).toBe(false);
    a.release("f");
    a.release("t");
    expect(a.owner("eo")).toBe("r");
    expect(a.acquire("r2", "vehicle_area_recon").accepted).toBe(false);
    a.release("r");
    expect(a.occupied().size).toBe(0);
  });
  it("restores shared ownership and emergency stop preempts all participants", () => {
    const a = new TrackArbiter(true, "UGV", UGV_OPERATION_TRACKS, true);
    a.restore("r", ["eo"], "vehicle_area_recon");
    a.restore("t", ["eo"], "vehicle_track_target", "63");
    a.release("r");
    expect(a.owner("eo")).toBe("t");
    expect(a.acquire("f", "vehicle_fire_weapon", "64").accepted).toBe(false);
    expect(a.acquire("stop", "vehicle_emergency_stop").accepted).toBe(true);
    a.release("t");
    expect(a.owner("eo")).toBe("stop");
  });
  it("leaves other providers exclusive unless explicitly enabled", () => {
    const a = new TrackArbiter(true);
    a.acquire("r", "vehicle_area_recon");
    expect(a.acquire("t", "vehicle_track_target", "63").accepted).toBe(false);
  });
});
