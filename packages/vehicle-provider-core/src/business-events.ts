import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { jsonToProtoStruct, type AdapterBusinessEvent } from "../../adapter-protocol/src/index.js";
import {
  BUSINESS_EVENT_SOURCE_STREAMS,
  type BusinessEventDraft,
  type ProviderStore,
} from "../../provider-adapter-kit/src/index.js";
import { assertNoRefereeData } from "./snapshot.js";

const TASK_EVENTS = new Set([
  "vehicle.mission.started",
  "vehicle.mission.paused",
  "vehicle.mission.resumed",
  "vehicle.mission.completed",
  "vehicle.mission.failed",
  "vehicle.mission.cancelled",
  "vehicle.payload.recon_started",
  "vehicle.payload.recon_completed",
  "vehicle.payload.recon_failed",
  "vehicle.payload.target_locked",
  "vehicle.payload.target_lost",
  "vehicle.weapon.fire_started",
  "vehicle.weapon.fire_completed",
  "vehicle.weapon.fire_failed",
  "vehicle.gimbal.control_started",
  "vehicle.gimbal.control_completed",
  "vehicle.gimbal.control_failed",
]);
const RESOURCE_EVENTS = new Set([
  "vehicle.chassis.path_blocked",
  "vehicle.chassis.gnss_lost",
  "vehicle.chassis.power_depleted",
  "vehicle.chassis.communication_lost",
  "vehicle.chassis.mobility_damage",
  "vehicle.chassis.navigation_stuck",
  "vehicle.payload.sensor_blind",
  "vehicle.payload.gimbal_fault",
  "vehicle.payload.weapon_fault",
  "vehicle.payload.offline",
  "vehicle.payload.camera_fault",
  "vehicle.payload.camera_recovered",
  "vehicle.connectivity.mqtt_disconnected",
  "vehicle.connectivity.mqtt_restored",
  "vehicle.connectivity.device_mcp_disconnected",
  "vehicle.connectivity.device_mcp_restored",
  "vehicle.telemetry.stale",
  "vehicle.telemetry.recovered",
  "vehicle.availability.healthy",
  "vehicle.availability.degraded",
  "vehicle.availability.open",
  "vehicle.availability.recovering",
  "vehicle.target.detected",
  "vehicle.target.lost",
]);

export class VehicleBusinessEventHub {
  readonly #events = new EventEmitter();
  #targetSequence = 0;
  constructor(
    readonly store: ProviderStore,
    readonly identity: { reasonPrefix: string; resourceId: string },
    readonly retentionMs = 604_800_000,
  ) {}
  async publish(
    draft: Omit<BusinessEventDraft, "retainUntil"> | VehicleTargetEventDraft,
  ): Promise<AdapterBusinessEvent> {
    assertVehicleEvent(draft, this.identity.reasonPrefix);
    assertNoRefereeData(draft.rawPayload);
    if (draft.resourceRef !== undefined && draft.resourceRef !== this.identity.resourceId)
      throw new Error(`${this.identity.reasonPrefix}_CROSS_RESOURCE_EVENT_FORBIDDEN`);
    if (draft.sourceId === "vehicle.target") {
      const sequence = String(++this.#targetSequence);
      const event: AdapterBusinessEvent = {
        sourceEventId: createHash("sha256")
          .update(`${sequence}\0${draft.occurredAt}\0${draft.eventType}`)
          .digest("base64url"),
        sourceSequence: sequence,
        sourceStreamId: BUSINESS_EVENT_SOURCE_STREAMS["vehicle.target"],
        scope: "resource",
        occurredAt: timestamp(draft.occurredAt),
        eventType: draft.eventType,
        description: draft.description,
        ...(draft.resourceRef === undefined ? {} : { resourceRef: draft.resourceRef }),
        severityHint: draft.severityHint,
        reasonCode: draft.reasonCode,
        rawPayload: jsonToProtoStruct(draft.rawPayload),
      };
      this.#events.emit(draft.sourceId, event);
      return event;
    }
    const event = await this.store.appendBusinessEvent({
      ...draft,
      retainUntil: new Date(Date.parse(draft.occurredAt) + this.retentionMs).toISOString(),
    });
    this.#events.emit(draft.sourceId, event);
    return event;
  }
  subscribe(sourceId: string, listener: (event: AdapterBusinessEvent) => void): () => void {
    this.#events.on(sourceId, listener);
    return () => this.#events.off(sourceId, listener);
  }
}

export interface VehicleTargetEventDraft {
  sourceId: "vehicle.target";
  scope: "resource";
  occurredAt: string;
  eventType: "vehicle.target.detected" | "vehicle.target.lost";
  description: string;
  reasonCode: string;
  resourceRef?: string;
  severityHint: "" | "info" | "warning" | "critical";
  rawPayload: Record<string, unknown>;
}

export function assertVehicleEvent(
  draft: Omit<BusinessEventDraft, "retainUntil"> | VehicleTargetEventDraft,
  reasonPrefix: string,
): void {
  if (draft.scope === "task" && !TASK_EVENTS.has(draft.eventType))
    throw new Error(`${reasonPrefix}_TASK_BUSINESS_EVENT_FORBIDDEN`);
  if (draft.scope === "resource" && !RESOURCE_EVENTS.has(draft.eventType))
    throw new Error(`${reasonPrefix}_RESOURCE_BUSINESS_EVENT_FORBIDDEN`);
  if (
    draft.eventType
      .toLowerCase()
      .split(/[._:-]/)
      .some((segment) => ["hit", "miss", "destroyed", "damage", "referee"].includes(segment))
  )
    throw new Error(`${reasonPrefix}_REFEREE_BUSINESS_EVENT_FORBIDDEN`);
}

function timestamp(value: string): { seconds: string; nanos: number } {
  const milliseconds = Date.parse(value);
  return {
    seconds: String(Math.floor(milliseconds / 1000)),
    nanos: (milliseconds % 1000) * 1_000_000,
  };
}
