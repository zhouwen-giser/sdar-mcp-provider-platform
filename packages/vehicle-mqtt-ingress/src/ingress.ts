import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  applySnapshotPatch,
  createNpcTankSnapshot,
  createUgvSnapshot,
  type FreshnessDomain,
  type NpcTankSnapshot,
  type SnapshotPatch,
  type UgvSnapshot,
  type VehicleSnapshot,
  type VehicleTarget,
} from "../../vehicle-provider-core/src/index.js";
import { decodeMqttPayload, type JsonLimits, type MqttWireMode } from "./guard.js";
import {
  normalizeMqttObservation,
  normalizeNpcTankMqttObservation,
  deduplicateVehicleTargets,
  type NormalizedMqttObservation,
} from "./normalizers.js";
import { exactNpcTankTopic, exactUgvTopic } from "./topics.js";

export interface IngestResult {
  accepted: boolean;
  reasonCode: string;
  duplicate: boolean;
  olderObservation: boolean;
  retained: boolean;
  revision: string;
}

export interface VehicleMqttProfile<TSnapshot extends VehicleSnapshot> {
  createSnapshot(): TSnapshot;
  exactTopic(topic: string): boolean;
  normalize(topic: string, value: unknown): NormalizedMqttObservation;
  connectionSnapshotEvents?: boolean;
  acceptedReasonCode: string;
  duplicateReasonCode: string;
  olderReasonCode: string;
  topicNotAllowedReasonCode: string;
  targetAuthority?: {
    detectedObjectsTopic: string;
    reconTargetsTopic: string;
  };
  taskStateAuthority?: {
    missionStateTopic: string;
    compositeStatusTopics: readonly string[];
  };
}

export const UGV_MQTT_PROFILE: VehicleMqttProfile<UgvSnapshot> = {
  createSnapshot: () => createUgvSnapshot(),
  exactTopic: exactUgvTopic,
  normalize: (topic, value) => normalizeMqttObservation(topic as never, value),
  connectionSnapshotEvents: true,
  acceptedReasonCode: "UGV_MQTT_MESSAGE_ACCEPTED",
  duplicateReasonCode: "UGV_MQTT_DUPLICATE_IGNORED",
  olderReasonCode: "UGV_MQTT_OLDER_OBSERVATION_IGNORED",
  topicNotAllowedReasonCode: "UGV_MQTT_TOPIC_NOT_ALLOWED",
  targetAuthority: {
    detectedObjectsTopic: "/ugv/detected_objects",
    reconTargetsTopic: "/ugv/area_recon/targets",
  },
};

export function npcTankMqttProfile(
  supportsCircularEoScan = false,
): VehicleMqttProfile<NpcTankSnapshot> {
  return {
    createSnapshot: () => createNpcTankSnapshot(supportsCircularEoScan),
    exactTopic: exactNpcTankTopic,
    normalize: (topic, value) => normalizeNpcTankMqttObservation(topic as never, value),
    connectionSnapshotEvents: true,
    acceptedReasonCode: "NPC_TANK_MQTT_MESSAGE_ACCEPTED",
    duplicateReasonCode: "NPC_TANK_MQTT_DUPLICATE_IGNORED",
    olderReasonCode: "NPC_TANK_MQTT_OLDER_OBSERVATION_IGNORED",
    topicNotAllowedReasonCode: "NPC_TANK_MQTT_TOPIC_NOT_ALLOWED",
    targetAuthority: {
      detectedObjectsTopic: "/npc_tank1/detected_objects",
      reconTargetsTopic: "/npc_tank1/area_recon/targets",
    },
    taskStateAuthority: {
      missionStateTopic: "/npc_tank1/mission_state",
      // The compact canonical status deliberately is not a task authority.
      compositeStatusTopics: ["/npc_tank1/status"],
    },
  };
}

export class VehicleMqttIngress<TSnapshot extends VehicleSnapshot = UgvSnapshot> {
  readonly #events = new EventEmitter();
  readonly #latest = new Map<
    string,
    { observedAt: string; hash: string; timeAuthority: NormalizedMqttObservation["timeAuthority"] }
  >();
  readonly #latestByAuthority = new Map<string, { observedAt: string; hash: string }>();
  readonly #authoritativeTaskStates = new Map<string, unknown>();
  #detectedTargets: VehicleTarget[] = [];
  #reconTargets: VehicleTarget[] = [];
  #reconTargetsObserved = false;
  #snapshot: TSnapshot;
  #sequence = 0;
  #stateConflict = false;
  constructor(
    readonly wireMode: MqttWireMode,
    readonly limits: JsonLimits,
    readonly profile: VehicleMqttProfile<TSnapshot> = UGV_MQTT_PROFILE as VehicleMqttProfile<TSnapshot>,
  ) {
    this.#snapshot = profile.createSnapshot();
  }
  snapshot(): TSnapshot {
    return structuredClone(this.#snapshot);
  }
  onSnapshot(listener: (snapshot: TSnapshot, topic: string) => void): () => void {
    this.#events.on("snapshot", listener);
    return () => this.#events.off("snapshot", listener);
  }
  setConnected(connected: boolean, observedAt = new Date().toISOString()): void {
    if (
      this.profile.connectionSnapshotEvents === true &&
      this.#snapshot.connectivity.mqttConnected === connected
    )
      return;
    this.#snapshot = applySnapshotPatch(
      this.#snapshot,
      { connectivity: { mqttConnected: connected } },
      observedAt,
      [],
    ) as TSnapshot;
    if (this.profile.connectionSnapshotEvents === true)
      this.#events.emit("snapshot", this.snapshot(), "mqtt_connection");
  }
  setDeviceConnected(connected: boolean, observedAt = new Date().toISOString()): void {
    if (
      this.profile.connectionSnapshotEvents === true &&
      this.#snapshot.connectivity.deviceMcpConnected === connected
    )
      return;
    this.#snapshot = applySnapshotPatch(
      this.#snapshot,
      { connectivity: { deviceMcpConnected: connected } },
      observedAt,
      [],
    ) as TSnapshot;
    if (this.profile.connectionSnapshotEvents === true)
      this.#events.emit("snapshot", this.snapshot(), "device_mcp_connection");
  }
  applyDeviceObservation(
    patch: SnapshotPatch,
    domains: FreshnessDomain[],
    observedAt = new Date().toISOString(),
  ): TSnapshot {
    this.#snapshot = applySnapshotPatch(this.#snapshot, patch, observedAt, domains) as TSnapshot;
    this.#events.emit("snapshot", this.snapshot(), "device_mcp");
    return this.snapshot();
  }
  handle(
    topic: string,
    payload: Buffer,
    retained = false,
    receivedAt = new Date().toISOString(),
  ): IngestResult {
    if (!this.profile.exactTopic(topic)) throw new Error(this.profile.topicNotAllowedReasonCode);
    let decoded: unknown;
    let observation: NormalizedMqttObservation;
    try {
      decoded = decodeMqttPayload(payload, this.wireMode, this.limits);
      observation = this.profile.normalize(topic, decoded);
    } catch (error) {
      if (
        this.profile.acceptedReasonCode.startsWith("NPC_TANK_") &&
        error instanceof Error &&
        error.message.startsWith("UGV_")
      )
        throw new Error(error.message.replace(/^UGV_/, "NPC_TANK_"), { cause: error });
      throw error;
    }
    const observedAt = observation.sourceObservedAt ?? receivedAt;
    const hash = createHash("sha256").update(canonical(observation.canonicalPayload)).digest("hex");
    const authorityCursor = `${topic}\0${observation.timeAuthority}`;
    const latestForAuthority = this.#latestByAuthority.get(authorityCursor);
    if (latestForAuthority?.observedAt === observedAt && latestForAuthority.hash === hash)
      return {
        accepted: true,
        reasonCode: this.profile.duplicateReasonCode,
        duplicate: true,
        olderObservation: false,
        retained,
        revision: this.#snapshot.revision,
      };
    if (
      latestForAuthority !== undefined &&
      Date.parse(observedAt) < Date.parse(latestForAuthority.observedAt)
    )
      return {
        accepted: true,
        reasonCode: this.profile.olderReasonCode,
        duplicate: false,
        olderObservation: true,
        retained,
        revision: this.#snapshot.revision,
      };
    observation = this.#applyTargetAuthority(topic, observation);
    this.#sequence++;
    if (topic === this.profile.taskStateAuthority?.missionStateTopic)
      this.#authoritativeTaskStates.set("mission_state", observation.patch.chassis?.mission?.state);
    if (
      this.profile.taskStateAuthority?.compositeStatusTopics.includes(topic) === true &&
      observation.patch.chassis?.mission !== undefined
    )
      this.#authoritativeTaskStates.set(
        "status.chassis_task",
        observation.patch.chassis.mission.state,
      );
    const missionState = this.#authoritativeTaskStates.get("mission_state");
    const statusState = this.#authoritativeTaskStates.get("status.chassis_task");
    this.#stateConflict =
      missionState !== undefined && statusState !== undefined && missionState !== statusState;
    this.#snapshot = applySnapshotPatch(
      this.#snapshot,
      observation.patch,
      observedAt,
      observation.domains,
    ) as TSnapshot;
    this.#latest.set(topic, { observedAt, hash, timeAuthority: observation.timeAuthority });
    this.#latestByAuthority.set(authorityCursor, { observedAt, hash });
    this.#events.emit("snapshot", this.snapshot(), topic);
    return {
      accepted: true,
      reasonCode: this.profile.acceptedReasonCode,
      duplicate: false,
      olderObservation: false,
      retained,
      revision: this.#snapshot.revision,
    };
  }
  ingestSequence(): number {
    return this.#sequence;
  }
  observationCursor(topic: string): string | undefined {
    const latest = this.#latest.get(topic);
    return latest === undefined ? undefined : `${latest.observedAt}\0${latest.hash}`;
  }
  stateConflict(): boolean {
    return this.#stateConflict;
  }

  #applyTargetAuthority(
    topic: string,
    observation: NormalizedMqttObservation,
  ): NormalizedMqttObservation {
    const authority = this.profile.targetAuthority;
    if (authority === undefined) return observation;
    const targets = observation.patch.payload?.targets;
    if (targets === undefined) return observation;
    if (topic === authority.detectedObjectsTopic) {
      this.#detectedTargets = deduplicateVehicleTargets(targets);
      const authoritative = this.#reconTargetsObserved ? this.#reconTargets : this.#detectedTargets;
      return {
        ...observation,
        patch: {
          ...observation.patch,
          payload: { ...observation.patch.payload, targets: structuredClone(authoritative) },
        },
        // Once the rich source has appeared, detected_objects is a secondary
        // view and must not refresh authoritative target freshness.
        domains: this.#reconTargetsObserved
          ? observation.domains.filter((domain) => domain !== "target")
          : observation.domains,
      };
    }
    if (topic === authority.reconTargetsTopic) {
      this.#reconTargetsObserved = true;
      this.#reconTargets = deduplicateVehicleTargets(targets);
      return {
        ...observation,
        patch: {
          ...observation.patch,
          payload: {
            ...observation.patch.payload,
            // An empty authoritative list intentionally clears stale targets.
            targets: structuredClone(this.#reconTargets),
          },
        },
      };
    }
    return observation;
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
