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

interface TrackHolder {
  taskId: string;
  operationName: string;
  targetId?: string;
}

export class TrackArbiter {
  readonly #owners = new Map<VehicleTrack, Map<string, TrackHolder>>();
  constructor(
    readonly allowNavigationWithRecon = true,
    readonly reasonPrefix = "UGV",
    readonly operationTracks: Readonly<Record<string, readonly VehicleTrack[]>> = OPERATION_TRACKS,
    readonly allowReconChain = false,
  ) {}
  occupied(): ReadonlySet<VehicleTrack> {
    return new Set(this.#owners.keys());
  }
  owner(track: VehicleTrack): string | undefined {
    return this.#owners.get(track)?.keys().next().value;
  }
  /** Only the UGV's running recon -> lock -> same-target fire chain may share EO. */
  occupiedFor(
    operationName: string,
    targetId?: string,
    ignoreTaskId?: string,
  ): ReadonlySet<VehicleTrack> {
    const blocked = new Set<VehicleTrack>();
    for (const [track, holders] of this.#owners)
      for (const holder of holders.values()) {
        if (holder.taskId === ignoreTaskId) continue;
        const reconChain =
          this.allowReconChain &&
          track === "eo" &&
          targetId !== undefined &&
          ((holder.operationName === "vehicle_area_recon" &&
            (operationName === "vehicle_track_target" ||
              operationName === "vehicle_fire_weapon")) ||
            (holder.operationName === "vehicle_track_target" &&
              operationName === "vehicle_fire_weapon" &&
              holder.targetId === targetId));
        if (!reconChain) blocked.add(track);
      }
    return blocked;
  }
  acquire(
    taskId: string,
    operationName: string,
    targetId?: string,
  ): { accepted: boolean; reasonCode: string } {
    const tracks = this.operationTracks[operationName] ?? [];
    if (operationName === "vehicle_emergency_stop") {
      for (const track of tracks)
        this.#owners.set(track, new Map([[taskId, { taskId, operationName }]]));
      return { accepted: true, reasonCode: `${this.reasonPrefix}_EMERGENCY_PREEMPTED_TRACKS` };
    }
    const occupied = this.occupiedFor(operationName, targetId, taskId);
    if (!this.allowNavigationWithRecon) {
      const conflictingTrack =
        operationName === "vehicle_navigate"
          ? "eo"
          : operationName === "vehicle_area_recon"
            ? "chassis"
            : undefined;
      if (conflictingTrack !== undefined && occupied.has(conflictingTrack))
        return { accepted: false, reasonCode: this.#busy(conflictingTrack) };
    }
    for (const track of tracks)
      if (occupied.has(track)) return { accepted: false, reasonCode: this.#busy(track) };
    for (const track of tracks)
      this.#add(track, { taskId, operationName, ...(targetId === undefined ? {} : { targetId }) });
    return { accepted: true, reasonCode: `${this.reasonPrefix}_TRACKS_ACQUIRED` };
  }
  #busy(track: VehicleTrack): string {
    return `${this.reasonPrefix}_${track === "chassis" ? "CHASSIS" : track === "eo" ? "EO" : "WEAPON"}_TRACK_BUSY`;
  }
  #add(track: VehicleTrack, holder: TrackHolder): void {
    let holders = this.#owners.get(track);
    if (holders === undefined) {
      holders = new Map();
      this.#owners.set(track, holders);
    }
    holders.set(holder.taskId, holder);
  }
  release(taskId: string): void {
    for (const [track, holders] of this.#owners) {
      holders.delete(taskId);
      if (holders.size === 0) this.#owners.delete(track);
    }
  }
  restore(
    taskId: string,
    tracks: VehicleTrack[],
    operationName = "unknown",
    targetId?: string,
  ): void {
    for (const track of tracks)
      if (this.allowReconChain || !this.#owners.has(track))
        this.#add(track, {
          taskId,
          operationName,
          ...(targetId === undefined ? {} : { targetId }),
        });
  }
}
