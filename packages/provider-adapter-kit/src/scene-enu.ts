import type { z } from "zod";
import type { PlannerMapReference } from "../../vehicle-zmq-contract/src/interop-profile.js";

const a = 6378137,
  f = 1 / 298.257223563,
  e2 = f * (2 - f),
  rad = Math.PI / 180;
const ecef = (longitude: number, latitude: number, altitude: number) => {
  if (
    ![longitude, latitude, altitude].every(Number.isFinite) ||
    Math.abs(longitude) > 180 ||
    Math.abs(latitude) > 90
  )
    throw Error("UGV_PLANNER_WGS84_INVALID");
  const p = latitude * rad,
    l = longitude * rad,
    n = a / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  return [
    (n + altitude) * Math.cos(p) * Math.cos(l),
    (n + altitude) * Math.cos(p) * Math.sin(l),
    (n * (1 - e2) + altitude) * Math.sin(p),
  ] as const;
};
/** WGS84 cartesian + topocentric, equivalent to upstream MapFrame's PROJ pipeline. */
export class SceneEnu {
  readonly origin: readonly [number, number, number];
  readonly sinLat: number;
  readonly cosLat: number;
  readonly sinLon: number;
  readonly cosLon: number;
  constructor(readonly reference: z.infer<typeof PlannerMapReference>) {
    this.origin = ecef(reference.longitude, reference.latitude, reference.altitude);
    this.sinLat = Math.sin(reference.latitude * rad);
    this.cosLat = Math.cos(reference.latitude * rad);
    this.sinLon = Math.sin(reference.longitude * rad);
    this.cosLon = Math.cos(reference.longitude * rad);
  }
  toMap(point: {
    longitude: number;
    latitude: number;
    altitude?: number | undefined;
  }): [number, number, number] {
    const p = ecef(point.longitude, point.latitude, point.altitude ?? this.reference.altitude);
    const dx = p[0] - this.origin[0],
      dy = p[1] - this.origin[1],
      dz = p[2] - this.origin[2];
    return [
      -this.sinLon * dx + this.cosLon * dy,
      -this.sinLat * this.cosLon * dx - this.sinLat * this.sinLon * dy + this.cosLat * dz,
      this.cosLat * this.cosLon * dx + this.cosLat * this.sinLon * dy + this.sinLat * dz,
    ];
  }
  toGnss(east: number, north: number, up = 0) {
    if (![east, north, up].every(Number.isFinite)) throw Error("UGV_PLANNER_MAP_POINT_INVALID");
    const x =
      this.origin[0] -
      this.sinLon * east -
      this.sinLat * this.cosLon * north +
      this.cosLat * this.cosLon * up;
    const y =
      this.origin[1] +
      this.cosLon * east -
      this.sinLat * this.sinLon * north +
      this.cosLat * this.sinLon * up;
    const z = this.origin[2] + this.cosLat * north + this.sinLat * up;
    const horizontal = Math.hypot(x, y),
      longitude = Math.atan2(y, x) / rad;
    if (horizontal < 1e-8)
      return { longitude, latitude: Math.sign(z) * 90, altitude: Math.abs(z) - a * (1 - f) };
    let latitude = Math.atan2(z, horizontal * (1 - e2));
    for (let i = 0; i < 12; i++) {
      const n = a / Math.sqrt(1 - e2 * Math.sin(latitude) ** 2);
      const next = Math.atan2(z + e2 * n * Math.sin(latitude), horizontal);
      if (Math.abs(next - latitude) < 1e-14) {
        latitude = next;
        break;
      }
      latitude = next;
    }
    const n = a / Math.sqrt(1 - e2 * Math.sin(latitude) ** 2);
    return { longitude, latitude: latitude / rad, altitude: horizontal / Math.cos(latitude) - n };
  }
}
