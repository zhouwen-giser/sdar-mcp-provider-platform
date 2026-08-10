import type { VehicleTrack } from "./types.js";

export const OPERATION_TRACKS: Record<string, VehicleTrack[]> = {
  vehicle_get_state: [],
  vehicle_get_capabilities: [],
  vehicle_get_payload_status: [],
  vehicle_get_targets: [],
  vehicle_laser_range: [],
  vehicle_navigate: ["chassis"],
  vehicle_area_recon: ["eo"],
  vehicle_track_target: ["eo"],
  vehicle_control_gimbal: ["eo"],
  vehicle_fire_weapon: ["eo", "weapon"],
  vehicle_emergency_stop: ["chassis", "eo", "weapon"],
};

/** Backward-compatible alias retained for Goal 10 UGV consumers. */
export const UGV_OPERATION_TRACKS: Record<string, VehicleTrack[]> = {
  ...OPERATION_TRACKS,
};

export class TrackArbiter {
  readonly #owners = new Map<VehicleTrack, string>();
  constructor(
    readonly allowNavigationWithRecon = true,
    readonly reasonPrefix = "UGV",
    readonly operationTracks: Readonly<Record<string, readonly VehicleTrack[]>> = OPERATION_TRACKS,
  ) {}
  occupied(): ReadonlySet<VehicleTrack> {
    return new Set(this.#owners.keys());
  }
  owner(track: VehicleTrack): string | undefined {
    return this.#owners.get(track);
  }
  acquire(taskId: string, operationName: string): { accepted: boolean; reasonCode: string } {
    const tracks = this.operationTracks[operationName] ?? [];
    if (operationName === "vehicle_emergency_stop") {
      for (const track of tracks) this.#owners.set(track, taskId);
      return { accepted: true, reasonCode: `${this.reasonPrefix}_EMERGENCY_PREEMPTED_TRACKS` };
    }
    if (!this.allowNavigationWithRecon) {
      const conflictingTrack =
        operationName === "vehicle_navigate"
          ? "eo"
          : operationName === "vehicle_area_recon"
            ? "chassis"
            : undefined;
      if (conflictingTrack !== undefined) {
        const owner = this.#owners.get(conflictingTrack);
        if (owner !== undefined && owner !== taskId)
          return {
            accepted: false,
            reasonCode:
              conflictingTrack === "chassis"
                ? `${this.reasonPrefix}_CHASSIS_TRACK_BUSY`
                : `${this.reasonPrefix}_EO_TRACK_BUSY`,
          };
      }
    }
    for (const track of tracks) {
      const owner = this.#owners.get(track);
      if (owner !== undefined && owner !== taskId)
        return {
          accepted: false,
          reasonCode:
            track === "chassis"
              ? `${this.reasonPrefix}_CHASSIS_TRACK_BUSY`
              : track === "eo"
                ? `${this.reasonPrefix}_EO_TRACK_BUSY`
                : `${this.reasonPrefix}_WEAPON_TRACK_BUSY`,
        };
    }
    for (const track of tracks) this.#owners.set(track, taskId);
    return { accepted: true, reasonCode: `${this.reasonPrefix}_TRACKS_ACQUIRED` };
  }
  release(taskId: string): void {
    for (const [track, owner] of this.#owners) if (owner === taskId) this.#owners.delete(track);
  }
  restore(taskId: string, tracks: VehicleTrack[]): void {
    for (const track of tracks) if (!this.#owners.has(track)) this.#owners.set(track, taskId);
  }
}
