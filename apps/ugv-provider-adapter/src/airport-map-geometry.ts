import { createHash } from "node:crypto";
import { z } from "zod";
import type { AppliedMqttObservation } from "../../../packages/vehicle-mqtt-ingress/src/index.js";
import type { ReconFootprintFact } from "./footprint-business-processor.js";

export const AIRPORT_SECTOR_MODEL = "isr.airport.eo-range-sector/v1";
export const AIRPORT_MAP_FRAME = "isr.airport.display-centres/v1";
export const AIRPORT_MAP_TRANSFORM = "isr.airport.linear-gnss/v1";
export const AIRPORT_MAP_COORDINATES = {
  frameId: AIRPORT_MAP_FRAME,
  transformRef: AIRPORT_MAP_TRANSFORM,
};
const toGeo = (x: number, y: number): [number, number] => [
  106.81485 + x / 111320,
  29.7195 + y / 110540,
];
const parameters = z.object({
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  compassHeadingDeg: z.number(),
  relativeGimbalYawDeg: z.number(),
  rangeM: z.number().positive().max(10000),
  fovDeg: z.number().positive().max(180),
});

/** Operator-selected display estimate, without pitch, terrain or occlusion claims.
 * Airport heading is world yaw + 90; EO pose is relative gimbal yaw, and
 * eo_control.launch.py mounts the camera at -90 degrees relative to that gimbal.
 */
export function airportRangeSector(input: z.infer<typeof parameters>) {
  const p = parameters.parse(input);
  const x = (p.longitude - 106.81485) * 111320;
  const y = (p.latitude - 29.7195) * 110540;
  const yaw = p.compassHeadingDeg + p.relativeGimbalYawDeg - 180;
  const steps = Math.max(2, Math.ceil(p.fovDeg / 5));
  const ring: number[][] = [toGeo(x, y)];
  for (let i = 0; i <= steps; i++) {
    const a = ((yaw - p.fovDeg / 2 + (p.fovDeg * i) / steps) * Math.PI) / 180;
    ring.push(toGeo(x + p.rangeM * Math.cos(a), y + p.rangeM * Math.sin(a)));
  }
  ring.push(toGeo(x, y));
  return {
    kind: "geojson" as const,
    crs: "OGC:CRS84" as const,
    geometry: { type: "Polygon" as const, coordinates: [ring] },
  };
}

/** Exact topic packets, not sticky composite gimbal fields with another angle convention. */
export function airportFootprintFact(input: {
  missionId: string;
  createdAt: string;
  nowMs: number;
  maxAgeMs: number;
  maximumFutureSkewMs?: number;
  rangeM?: number;
  status?: AppliedMqttObservation;
  position?: AppliedMqttObservation;
  heading?: AppliedMqttObservation;
  gimbal?: AppliedMqttObservation;
}): ReconFootprintFact {
  const { status, position, heading, gimbal } = input;
  const recon = status?.observation.patch.payload?.reconnaissance;
  const packets = [status, position, heading, gimbal];
  const observedTimes = packets.flatMap((p) => (p ? [Date.parse(p.observedAt)] : []));
  const fresh = packets.every(
    (p) =>
      p &&
      !p.retained &&
      Date.parse(p.observedAt) >= Date.parse(input.createdAt) &&
      input.nowMs - Date.parse(p.observedAt) >= -(input.maximumFutureSkewMs ?? 0) &&
      input.nowMs - Date.parse(p.observedAt) <= input.maxAgeMs,
  );
  const active =
    recon?.motionStatus === 5 || (recon?.motionStatus === 8 && recon.lock?.stage === 3);
  const fault = recon?.cameraFault === true || recon?.loadStatus === 4;
  const coords = position?.observation.patch.chassis?.position;
  const parsed = parameters.safeParse({
    longitude: coords?.longitude,
    latitude: coords?.latitude,
    compassHeadingDeg: heading?.observation.patch.chassis?.compassHeadingDeg,
    relativeGimbalYawDeg: gimbal?.observation.patch.payload?.gimbal?.yaw,
    fovDeg: recon?.eoFovDeg,
    rangeM: input.rangeM,
  });
  const enabled = fresh && active && !fault && parsed.success;
  const observedAt = enabled
    ? new Date(Math.max(...observedTimes)).toISOString()
    : new Date(input.nowMs).toISOString();
  const base = {
    schemaVersion: "ugv.recon-footprint-fact/1" as const,
    missionId: input.missionId,
    areaRevision: 1,
    sourceRecordId: createHash("sha256")
      .update(
        JSON.stringify([
          AIRPORT_SECTOR_MODEL,
          packets.map((p) => p?.cursor),
          input.rangeM,
          enabled,
        ]),
      )
      .digest("hex"),
    sourceRevision: Date.parse(observedAt),
    observedAt,
  };
  return enabled
    ? {
        ...base,
        state: "active",
        quality: "estimated",
        sourceKind: "configured_model",
        modelRef: AIRPORT_SECTOR_MODEL,
        validUntil: new Date(Math.min(...observedTimes) + input.maxAgeMs).toISOString(),
        content: airportRangeSector(parsed.data),
      }
    : { ...base, state: fault ? "camera_fault" : "paused" };
}

/** The existing publisher sends rounded world-metre display-cell centres, not indices.
 * Merge touching cells within a row to keep the bounded public geometry small.
 * These display cells are an approximation; the publisher's precision-grid percentage is separate.
 */
export function airportCoveredCells(cells: readonly { x: number; y: number }[], edge: number) {
  if (!Number.isFinite(edge) || edge <= 0 || cells.length > 10000 || !cells.length)
    return undefined;
  const rows = new Map<number, number[]>();
  for (const { x, y } of cells) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    const row = rows.get(y) ?? [];
    row.push(x);
    rows.set(y, row);
  }
  const rectangles: [number, number, number, number][] = [];
  for (const [y, xs] of [...rows].sort((a, b) => a[0] - b[0])) {
    xs.sort((a, b) => a - b);
    const first = xs[0];
    if (first === undefined) continue;
    let left = first - edge / 2,
      right = first + edge / 2;
    for (const x of xs.slice(1)) {
      if (Math.abs(x - edge / 2 - right) <= 0.11) right = x + edge / 2;
      else {
        rectangles.push([left, right, y - edge / 2, y + edge / 2]);
        left = x - edge / 2;
        right = x + edge / 2;
      }
    }
    rectangles.push([left, right, y - edge / 2, y + edge / 2]);
  }
  if (rectangles.length > 100) return undefined;
  return {
    kind: "geojson" as const,
    crs: "OGC:CRS84" as const,
    geometry: {
      type: "MultiPolygon" as const,
      coordinates: rectangles.map(([l, r, b, t]) => [
        [toGeo(l, b), toGeo(r, b), toGeo(r, t), toGeo(l, t), toGeo(l, b)],
      ]),
    },
  };
}
