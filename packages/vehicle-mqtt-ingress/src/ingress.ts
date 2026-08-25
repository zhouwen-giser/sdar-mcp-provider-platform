import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  applySnapshotPatch,
  createNpcTankSnapshot,
  createUgvSnapshot,
  encodeObservationCursorV1,
  type FieldObservationAuthority,
  type FreshnessDomain,
  type NpcTankSnapshot,
  type SnapshotPatch,
  type UgvSnapshot,
  type VehicleIdentity,
  type VehicleObservationField,
  type VehicleSnapshot,
  type VehicleTarget,
  type VehicleTaskTrack,
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

export const VEHICLE_OBSERVATION_FIELDS = [
  "chassis.position.geodetic",
  "chassis.position.local",
  "chassis.speed",
  "chassis.heading",
  "chassis.mission",
  "payload.recon",
  "payload.targets",
  "payload.gimbal",
] as const satisfies readonly VehicleObservationField[];

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
  compositeStatusAuthority?: {
    canonicalTopic: string;
    aliasTopics: readonly string[];
    aliasFallbackAfterMs: number;
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
  taskStateAuthority: {
    missionStateTopic: "/ugv/mission_state",
    compositeStatusTopics: ["status/ugv", "/ugv/status"],
  },
  compositeStatusAuthority: {
    canonicalTopic: "status/ugv",
    aliasTopics: ["/ugv/status"],
    aliasFallbackAfterMs: 3_000,
  },
};

export function ugvMqttProfile(identity: VehicleIdentity): VehicleMqttProfile<UgvSnapshot> {
  return {
    ...UGV_MQTT_PROFILE,
    createSnapshot: () => createUgvSnapshot(identity),
    normalize: (topic, value) =>
      normalizeMqttObservation(topic as never, value, {
        entityId: identity.entityId,
        vehicleType: identity.vehicleType,
      }),
  };
}

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
    {
      observedAt: string;
      hash: string;
      timeAuthority: NormalizedMqttObservation["timeAuthority"];
      sourceSequence?: string;
      ingestSequence: number;
    }
  >();
  readonly #latestByAuthority = new Map<string, { observedAt: string; hash: string }>();
  readonly #fieldAuthorities = new Map<VehicleObservationField, FieldObservationAuthority>();
  readonly #authoritativeTaskStates = new Map<"primary" | "secondary", VehicleTaskTrack>();
  #detectedTargets: VehicleTarget[] = [];
  #reconTargets: VehicleTarget[] = [];
  #reconTargetsObserved = false;
  #snapshot: TSnapshot;
  #sequence = 0;
  #stateConflict = false;
  #canonicalCompositeStatusReceivedAt: string | undefined;
  #activeCompositeStatusTopic: string | undefined;
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
    const authorityCursor = JSON.stringify([topic, observation.timeAuthority]);
    const latestForAuthority = this.#latestByAuthority.get(authorityCursor);
    const compositeDecision = this.#compositeStatusDecision(topic, receivedAt);
    const duplicate =
      latestForAuthority?.observedAt === observedAt && latestForAuthority.hash === hash;
    const older =
      latestForAuthority !== undefined &&
      Date.parse(observedAt) < Date.parse(latestForAuthority.observedAt);
    if (duplicate && !compositeDecision.promotesAuthority)
      return {
        accepted: true,
        reasonCode: this.profile.duplicateReasonCode,
        duplicate: true,
        olderObservation: false,
        retained,
        revision: this.#snapshot.revision,
      };
    if (older && !compositeDecision.promotesAuthority)
      return {
        accepted: true,
        reasonCode: this.profile.olderReasonCode,
        duplicate: false,
        olderObservation: true,
        retained,
        revision: this.#snapshot.revision,
      };
    const applyToSnapshot = compositeDecision.applyToSnapshot;
    if (applyToSnapshot) {
      observation = this.#applyTargetAuthority(topic, observation);
      observation = this.#applyTaskStateAuthority(topic, observation);
    }
    this.#sequence++;
    if (applyToSnapshot) {
      observation = this.#applyFieldAuthorities(topic, observation, observedAt);
      this.#snapshot = applySnapshotPatch(
        this.#snapshot,
        observation.patch,
        observedAt,
        observation.domains,
      ) as TSnapshot;
    }
    if (!older || compositeDecision.promotesAuthority) {
      if (compositeDecision.promotesAuthority) {
        this.#latestByAuthority.delete(JSON.stringify([topic, "source"]));
        this.#latestByAuthority.delete(JSON.stringify([topic, "ingest"]));
      }
      this.#latest.set(topic, {
        observedAt,
        hash,
        timeAuthority: observation.timeAuthority,
        ...(observation.sourceSequence === undefined
          ? {}
          : { sourceSequence: observation.sourceSequence }),
        ingestSequence: this.#sequence,
      });
      this.#latestByAuthority.set(authorityCursor, { observedAt, hash });
    }
    if (applyToSnapshot) this.#events.emit("snapshot", this.snapshot(), topic);
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
    return latest === undefined
      ? undefined
      : encodeObservationCursorV1({
          version: 1,
          kind: "topic",
          topic,
          observedAt: latest.observedAt,
          timeAuthority: latest.timeAuthority,
          ...(latest.sourceSequence === undefined ? {} : { sourceSequence: latest.sourceSequence }),
          ingestSequence: latest.ingestSequence,
          payloadHash: latest.hash,
        });
  }
  observationAuthority(topic: string):
    | {
        topic: string;
        observedAt: string;
        timeAuthority: "source" | "ingest";
        sourceSequence?: string;
        ingestSequence: number;
        cursor: string;
      }
    | undefined {
    const latest = this.#latest.get(topic);
    return latest === undefined
      ? undefined
      : {
          topic,
          observedAt: latest.observedAt,
          timeAuthority: latest.timeAuthority,
          ...(latest.sourceSequence === undefined ? {} : { sourceSequence: latest.sourceSequence }),
          ingestSequence: latest.ingestSequence,
          cursor: encodeObservationCursorV1({
            version: 1,
            kind: "topic",
            topic,
            observedAt: latest.observedAt,
            timeAuthority: latest.timeAuthority,
            ...(latest.sourceSequence === undefined
              ? {}
              : { sourceSequence: latest.sourceSequence }),
            ingestSequence: latest.ingestSequence,
            payloadHash: latest.hash,
          }),
        };
  }
  fieldObservationAuthority(field: VehicleObservationField): FieldObservationAuthority | undefined {
    const authority = this.#fieldAuthorities.get(field);
    return authority === undefined ? undefined : structuredClone(authority);
  }
  fieldObservationAuthorities(
    fields: readonly VehicleObservationField[] = VEHICLE_OBSERVATION_FIELDS,
  ): FieldObservationAuthority[] {
    return fields.flatMap((field) => {
      const authority = this.fieldObservationAuthority(field);
      return authority === undefined ? [] : [authority];
    });
  }
  fieldFreshnessState(
    field: VehicleObservationField,
    maximumAgeMs: number,
    now = Date.now(),
  ): "fresh" | "stale" | "unknown" {
    const authority = this.#fieldAuthorities.get(field);
    if (authority === undefined) return "unknown";
    const age = now - Date.parse(authority.observedAt);
    return Number.isFinite(age) && age >= 0 && age <= maximumAgeMs ? "fresh" : "stale";
  }
  stateConflict(): boolean {
    return this.#stateConflict;
  }
  taskStateAuthority(): "PRIMARY" | "SECONDARY" | "UNKNOWN" {
    if (this.#authoritativeTaskStates.has("primary")) return "PRIMARY";
    if (this.#authoritativeTaskStates.has("secondary")) return "SECONDARY";
    return "UNKNOWN";
  }

  #compositeStatusDecision(
    topic: string,
    receivedAt: string,
  ): { applyToSnapshot: boolean; promotesAuthority: boolean } {
    const authority = this.profile.compositeStatusAuthority;
    if (authority === undefined) return { applyToSnapshot: true, promotesAuthority: false };
    if (topic === authority.canonicalTopic) {
      this.#canonicalCompositeStatusReceivedAt = receivedAt;
      const promotesAuthority = this.#activeCompositeStatusTopic !== topic;
      this.#activeCompositeStatusTopic = topic;
      return { applyToSnapshot: true, promotesAuthority };
    }
    if (!authority.aliasTopics.includes(topic))
      return { applyToSnapshot: true, promotesAuthority: false };
    let applyToSnapshot = this.#canonicalCompositeStatusReceivedAt === undefined;
    const canonicalAgeMs =
      this.#canonicalCompositeStatusReceivedAt === undefined
        ? Number.POSITIVE_INFINITY
        : Date.parse(receivedAt) - Date.parse(this.#canonicalCompositeStatusReceivedAt);
    if (!Number.isFinite(canonicalAgeMs) || canonicalAgeMs > authority.aliasFallbackAfterMs)
      applyToSnapshot = true;
    if (!applyToSnapshot) return { applyToSnapshot: false, promotesAuthority: false };
    const promotesAuthority = this.#activeCompositeStatusTopic !== topic;
    this.#activeCompositeStatusTopic = topic;
    return { applyToSnapshot: true, promotesAuthority };
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

  #applyTaskStateAuthority(
    topic: string,
    observation: NormalizedMqttObservation,
  ): NormalizedMqttObservation {
    const authority = this.profile.taskStateAuthority;
    const mission = observation.patch.chassis?.mission;
    if (authority === undefined || mission === undefined) return observation;
    const primary = topic === authority.missionStateTopic;
    const secondary = authority.compositeStatusTopics.includes(topic);
    if (!primary && !secondary) return observation;
    this.#authoritativeTaskStates.set(primary ? "primary" : "secondary", structuredClone(mission));
    const primaryTrack = this.#authoritativeTaskStates.get("primary");
    const secondaryTrack = this.#authoritativeTaskStates.get("secondary");
    this.#stateConflict =
      primaryTrack !== undefined &&
      secondaryTrack !== undefined &&
      primaryTrack.state !== secondaryTrack.state;
    if (secondary && primaryTrack !== undefined) {
      const accepted = structuredClone(observation);
      if (accepted.patch.chassis !== undefined) delete accepted.patch.chassis.mission;
      return accepted;
    }
    return observation;
  }

  #applyFieldAuthorities(
    topic: string,
    observation: NormalizedMqttObservation,
    observedAt: string,
  ): NormalizedMqttObservation {
    const accepted = structuredClone(observation);
    for (const [field] of observationFieldValues(observation)) {
      const previous = this.#fieldAuthorities.get(field);
      if (
        previous !== undefined &&
        !this.#isCompositeAuthorityHandoff(topic, previous.topic) &&
        Date.parse(observedAt) < Date.parse(previous.observedAt)
      )
        removeObservationField(accepted.patch, field);
    }
    for (const [field, value] of observationFieldValues(accepted)) {
      const payloadHash = createHash("sha256").update(canonical(value)).digest("hex");
      this.#fieldAuthorities.set(field, {
        field,
        topic,
        observedAt,
        timeAuthority: observation.timeAuthority,
        ...(observation.sourceSequence === undefined
          ? {}
          : { sourceSequence: observation.sourceSequence }),
        ingestSequence: this.#sequence,
        payloadHash,
        cursor: encodeObservationCursorV1({
          version: 1,
          kind: "field",
          field,
          topic,
          observedAt,
          timeAuthority: observation.timeAuthority,
          ...(observation.sourceSequence === undefined
            ? {}
            : { sourceSequence: observation.sourceSequence }),
          ingestSequence: this.#sequence,
          payloadHash,
        }),
      });
    }
    return accepted;
  }

  #isCompositeAuthorityHandoff(topic: string, previousTopic: string): boolean {
    const authority = this.profile.compositeStatusAuthority;
    if (authority === undefined) return false;
    return (
      (topic === authority.canonicalTopic && authority.aliasTopics.includes(previousTopic)) ||
      (authority.aliasTopics.includes(topic) && previousTopic === authority.canonicalTopic)
    );
  }
}

function observationFieldValues(
  observation: NormalizedMqttObservation,
): [VehicleObservationField, unknown][] {
  const values: [VehicleObservationField, unknown][] = [];
  const { chassis, payload } = observation.patch;
  if (chassis?.position !== undefined) values.push(["chassis.position.geodetic", chassis.position]);
  if (
    chassis?.navigation !== undefined &&
    (chassis.navigation.positionX !== undefined || chassis.navigation.positionY !== undefined)
  )
    values.push([
      "chassis.position.local",
      {
        ...(chassis.navigation.positionX === undefined ? {} : { x: chassis.navigation.positionX }),
        ...(chassis.navigation.positionY === undefined ? {} : { y: chassis.navigation.positionY }),
        ...(chassis.navigation.positionZ === undefined ? {} : { z: chassis.navigation.positionZ }),
      },
    ]);
  if (chassis?.speedKmh !== undefined) values.push(["chassis.speed", chassis.speedKmh]);
  if (chassis?.compassHeadingDeg !== undefined)
    values.push(["chassis.heading", chassis.compassHeadingDeg]);
  if (chassis?.mission !== undefined) values.push(["chassis.mission", chassis.mission]);
  if (payload?.reconnaissance !== undefined) values.push(["payload.recon", payload.reconnaissance]);
  if (payload?.targets !== undefined && observation.domains.includes("target"))
    values.push(["payload.targets", payload.targets]);
  if (payload?.gimbal !== undefined) values.push(["payload.gimbal", payload.gimbal]);
  return values;
}

function removeObservationField(patch: SnapshotPatch, field: VehicleObservationField): void {
  if (field === "chassis.position.geodetic" && patch.chassis !== undefined)
    delete patch.chassis.position;
  else if (field === "chassis.position.local" && patch.chassis?.navigation !== undefined) {
    delete patch.chassis.navigation.positionX;
    delete patch.chassis.navigation.positionY;
    delete patch.chassis.navigation.positionZ;
  } else if (field === "chassis.speed" && patch.chassis !== undefined) {
    delete patch.chassis.speedKmh;
    if (patch.chassis.navigation !== undefined) delete patch.chassis.navigation.speedKmh;
  } else if (field === "chassis.heading" && patch.chassis !== undefined)
    delete patch.chassis.compassHeadingDeg;
  else if (field === "chassis.mission" && patch.chassis !== undefined) delete patch.chassis.mission;
  else if (field === "payload.recon" && patch.payload !== undefined)
    delete patch.payload.reconnaissance;
  else if (field === "payload.targets" && patch.payload !== undefined) delete patch.payload.targets;
  else if (field === "payload.gimbal" && patch.payload !== undefined) delete patch.payload.gimbal;
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
