import { freshnessState } from "./snapshot.js";
import { OPERATION_TRACKS } from "./track-arbiter.js";
import type { AvailabilityContext, AvailabilityDecision, VehicleTrack } from "./types.js";

const risk = (operationName: string): "LOW" | "MEDIUM" | "HIGH" =>
  operationName === "vehicle_fire_weapon" || operationName === "vehicle_emergency_stop"
    ? "HIGH"
    : operationName.startsWith("vehicle_get_") || operationName === "vehicle_laser_range"
      ? "LOW"
      : "MEDIUM";

export function checkVehicleAvailability(context: AvailabilityContext): AvailabilityDecision {
  const prefix = context.reasonPrefix ?? "UGV";
  const code = (suffix: string) => `${prefix}_${suffix}`;
  const result = (availability: AvailabilityDecision["availability"], reasonCode: string) => ({
    availability,
    riskLevel: risk(context.operationName),
    reasonCode,
    description: reasonCode,
  });
  if (!context.snapshot.connectivity.mqttConnected)
    if (context.operationName !== "vehicle_get_capabilities")
      return result("UNKNOWN", code("MQTT_UNAVAILABLE"));
  if (!context.snapshot.connectivity.deviceMcpConnected)
    return result("UNKNOWN", code("DEVICE_MCP_UNAVAILABLE"));
  if (context.snapshot.connectivity.deviceAvailable === false)
    return result("DISABLED", code("DEVICE_UNAVAILABLE"));
  if (
    context.operationName === "vehicle_area_recon" &&
    context.circularScanSupported === false &&
    context.scanMode === "circular"
  )
    return result("DISABLED", code("CIRCULAR_SCAN_UNSUPPORTED"));
  if (!context.requiredToolsPresent) return result("UNKNOWN", code("TOOL_UNAVAILABLE"));
  if (context.operationName === "vehicle_get_capabilities")
    return result("AVAILABLE", code("AVAILABLE"));
  const requiredDomains = domains(context.operationName);
  if (
    requiredDomains.some(
      (domain) =>
        freshnessState(context.snapshot, domain, context.freshness, context.now) !== "fresh",
    )
  )
    return result("UNKNOWN", code("STATE_STALE"));
  if (context.operationName !== "vehicle_emergency_stop")
    for (const track of OPERATION_TRACKS[context.operationName] ?? []) {
      if (context.occupiedTracks.has(track)) return result("DISABLED", busy(track, prefix));
    }
  if (context.snapshot.health.components.communications === "fault")
    return result("DISABLED", code("COMMUNICATION_LOST"));
  if (
    context.snapshot.health.components.gnss === "fault" &&
    context.operationName === "vehicle_navigate"
  )
    return result("DISABLED", code("GNSS_LOST"));
  if (
    context.snapshot.health.components.navigation === "fault" &&
    context.operationName === "vehicle_navigate"
  )
    return result("DISABLED", code("PATH_BLOCKED"));
  if (
    context.operationName === "vehicle_area_recon" ||
    context.operationName === "vehicle_track_target" ||
    context.operationName === "vehicle_control_gimbal"
  ) {
    if (context.snapshot.payload.online === false) return result("DISABLED", code("SENSOR_BLIND"));
    if (context.snapshot.health.components.sensor === "fault")
      return result("DISABLED", code("SENSOR_BLIND"));
  }
  if (
    context.operationName === "vehicle_track_target" ||
    context.operationName === "vehicle_fire_weapon"
  ) {
    const target = context.snapshot.payload.targets.find((x) => x.targetId === context.targetId);
    if (target === undefined) return result("DISABLED", code("TARGET_NOT_FOUND"));
    if (
      context.operationName === "vehicle_fire_weapon" &&
      context.snapshot.payload.lockedTargetId !== context.targetId
    )
      return result("DISABLED", code("TARGET_NOT_LOCKED"));
  }
  if (context.operationName === "vehicle_fire_weapon") {
    if (context.snapshot.health.components.weapon === "fault")
      return result("DISABLED", code("WEAPON_FAULT"));
    if (context.snapshot.payload.attackReady !== true)
      return result("UNKNOWN", code("ATTACK_NOT_READY"));
    if (context.fireRequiresChassisStopped && (context.snapshot.chassis.speedKmh ?? 0) > 0.1)
      return result("DISABLED", code("FIRE_REQUIRES_STOP"));
  }
  return result("AVAILABLE", code("AVAILABLE"));
}

function domains(operationName: string) {
  if (operationName === "vehicle_fire_weapon") return ["mission", "target", "payload"] as const;
  if (
    operationName === "vehicle_area_recon" ||
    operationName === "vehicle_track_target" ||
    operationName === "vehicle_control_gimbal" ||
    operationName === "vehicle_get_payload_status" ||
    operationName === "vehicle_laser_range"
  )
    return ["payload"] as const;
  if (operationName === "vehicle_get_targets") return ["target"] as const;
  return ["chassis", "health"] as const;
}
function busy(track: VehicleTrack, prefix = "UGV"): string {
  return track === "chassis"
    ? `${prefix}_CHASSIS_TRACK_BUSY`
    : track === "eo"
      ? `${prefix}_EO_TRACK_BUSY`
      : `${prefix}_WEAPON_TRACK_BUSY`;
}
