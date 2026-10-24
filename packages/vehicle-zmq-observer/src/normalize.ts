import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  decodeChassisFrame,
  parsePublication,
  type DeploymentProfile,
} from "../../vehicle-zmq-contract/src/index.js";
import { canonical, sha256, type Component, type ObserverSettings } from "./config.js";
import {
  multipartHash,
  type ClockStamp,
  type NormalizedObservation,
  type Reception,
} from "./model.js";

export class ObservationNormalizer {
  #watermarks = new Map<string, bigint>();
  #lastBytes = new Map<string, string>();
  #frames = new Map<string, string>();
  #lastUtc = 0;
  #sequence = 0n;
  constructor(
    readonly profile: DeploymentProfile,
    readonly settings: ObserverSettings,
  ) {}

  receive(component: Component, frames: readonly Buffer[], clock: ClockStamp): Reception {
    const wireBytes = frames.reduce((sum, bytes) => sum + bytes.length, 0);
    const rawComplete =
      frames.length <= 16 && wireBytes <= 140_000 && frames.every((f) => f.length <= 70_000);
    const raw = rawComplete ? frames : [];
    const receipt: Reception = {
      ...clock,
      schemaVersion: "ugv.zmq-observation-event/2.0",
      type: "reception",
      eventId: randomUUID(),
      receiveSequence: (++this.#sequence).toString(),
      component,
      endpoint: this.profile.components[component].publicationEndpoint,
      frameCount: frames.length,
      wireBytes,
      rawComplete,
      multipartSha256: rawComplete ? multipartHash(frames) : null,
      frames: raw.map((bytes) => ({
        bytes: bytes.length,
        base64: bytes.toString("base64"),
        sha256: sha256(bytes),
      })),
      valid: false,
      validationCode: null,
      observation: null,
      projectable: false,
      diagnostics: ["SOURCE_CONTINUITY_UNVERIFIED", "SOURCE_PRODUCER_EPOCH_UNATTESTED"],
    };
    const utc = Date.parse(clock.receivedAt);
    if (utc < this.#lastUtc) receipt.diagnostics.push("RECEPTION_UTC_CLOCK_REGRESSED");
    this.#lastUtc = Math.max(this.#lastUtc, utc);
    if (!rawComplete) {
      receipt.validationCode = "ZMQ_RAW_CAPTURE_BOUND_EXCEEDED";
      return receipt;
    }
    try {
      const observation = this.decode(component, frames);
      receipt.observation = observation;
      receipt.valid = true;
      receipt.projectable = true;
      const key = `${component}/${observation.key}`;
      if (this.#lastBytes.get(key) === receipt.multipartSha256)
        receipt.diagnostics.push("REPEATED_WIRE_BYTES");
      this.#lastBytes.set(key, receipt.multipartSha256 ?? "");
      const sourceTime = observation.sourceTime.value;
      if (sourceTime !== null) {
        const time = BigInt(sourceTime),
          previous = this.#watermarks.get(key);
        const clockSkew =
          observation.sourceTime.unit === "utc_ms" &&
          Math.abs(Number(time) - utc) > this.settings.maxSourceClockSkewMs;
        if (clockSkew) {
          receipt.diagnostics.push("SOURCE_PUBLICATION_CLOCK_SKEW");
          receipt.projectable = false;
        } else if (
          previous !== undefined &&
          (time < previous || (time === previous && observation.key !== "targetlist"))
        ) {
          receipt.diagnostics.push(
            time < previous ? "SOURCE_TIME_REGRESSED_OR_REPLAYED" : "SOURCE_TIME_REPEATED",
          );
          receipt.projectable = false;
        } else this.#watermarks.set(key, time);
      } else receipt.diagnostics.push("SOURCE_TIME_NOT_SUPPLIED");
      if (observation.sourceTime.unit === "unconfirmed_us")
        receipt.diagnostics.push("SOURCE_TIMEBASE_UNCONFIRMED");
      if (observation.reportedOrigin === "replay") {
        receipt.diagnostics.push("SOURCE_REPLAY_ORIGIN");
        receipt.projectable = false;
      }
      if (component === "eo" && ["targetlist", "tracklist"].includes(observation.key)) {
        const images =
          observation.key === "targetlist"
            ? [observation.data.image]
            : Array.isArray(observation.data.targets)
              ? observation.data.targets.map((t) => object(t).image)
              : [];
        for (const input of images) {
          const image = object(input),
            frameKey = `${component}/${observation.key}/${String(image.camera_id)}/${String(image.frame_id)}`;
          const content = sha256(canonical(observation.data)),
            prior = this.#frames.get(frameKey);
          if (prior !== undefined) {
            receipt.diagnostics.push(
              prior === content ? "IMAGE_REPORT_REPEATED" : "IMAGE_REPORT_CONTENT_CONFLICT",
            );
            receipt.projectable = false;
          } else this.#frames.set(frameKey, content);
          if (this.#frames.size > 4096) {
            const oldest = this.#frames.keys().next().value;
            if (oldest !== undefined) this.#frames.delete(oldest);
          }
        }
        receipt.diagnostics.push("IMAGE_DEDUPLICATION_BOUNDED_TO_RECEIVER_SESSION");
        if (observation.data.truncated === true)
          receipt.diagnostics.push("SOURCE_REPORT_TRUNCATED");
        if (observation.acquisitionUtcMs === null)
          receipt.diagnostics.push("ACQUISITION_TIME_UNKNOWN");
      }
      return receipt;
    } catch (error) {
      receipt.valid = false;
      receipt.projectable = false;
      receipt.observation = null;
      receipt.validationCode =
        error instanceof ZodError ? "ZMQ_JSON_SCHEMA_MISMATCH" : safeCode(error);
      return receipt;
    }
  }

  private decode(component: Component, frames: readonly Buffer[]): NormalizedObservation {
    if (component === "chassis") {
      if (frames.length !== 1 || !frames[0]) throw Error("ZMQ_CHASSIS_MULTIPART_INVALID");
      const config = this.profile.components.chassis;
      if (config.systemId === null) throw Error("ZMQ_CHASSIS_SYSTEM_ID_UNBOUND");
      const parsed = decodeChassisFrame(frames[0], { systemId: config.systemId });
      if (parsed.topic !== "ipc_message") throw Error("ZMQ_CHASSIS_PUBLICATION_TOPIC_INVALID");
      if (parsed.targetSystemId !== "0" && parsed.targetSystemId !== config.controllerSystemId)
        throw Error("ZMQ_PUBLICATION_TARGET_UNMATCHED");
      const data = parsed.body;
      return {
        key: String(data.type),
        protocolVersion: parsed.protocolVersion,
        versionEvidence: "selected_contract_not_in_band",
        deviceId: parsed.systemId,
        nativeTaskId: typeof data.missionId === "number" ? String(data.missionId) : null,
        nativeRequestId: null,
        runtimeTaskId: null,
        sourceProducerEpoch: null,
        sourceTime: {
          unit: data.type === "localization" ? "unconfirmed_us" : "not_supplied",
          value: data.type === "localization" ? String(data.timeUs) : null,
        },
        acquisitionUtcMs: null,
        reportedOrigin: "unattested",
        position:
          data.type === "localization"
            ? {
                longitude: Number(data.longitude),
                latitude: Number(data.latitude),
                altitude: Number(data.altitude),
                altitudeDatum: "unconfirmed",
                crs: "OGC:CRS84",
              }
            : null,
        data,
      };
    }
    const parsed = parsePublication(component, frames, this.profile.components[component].deviceId);
    const data: Record<string, unknown> = parsed.data;
    const task = object(data.task),
      command = object(data.command);
    const origin = data.data_origin;
    return {
      key: parsed.topic,
      protocolVersion: parsed.protocol,
      versionEvidence: "in_band",
      deviceId: parsed.device_id,
      nativeTaskId: text(data.task_id) ?? text(task.task_id) ?? text(data.active_task_id),
      nativeRequestId: text(task.request_id) ?? text(command.request_id),
      runtimeTaskId: null,
      sourceProducerEpoch: null,
      sourceTime: { unit: "utc_ms", value: String(parsed.published_at_utc_ms) },
      acquisitionUtcMs:
        typeof data.observed_at_utc_ms === "number" ? data.observed_at_utc_ms : null,
      reportedOrigin:
        origin === "measured" || origin === "simulated" || origin === "replay"
          ? origin
          : "unattested",
      position: null,
      data,
    };
  }
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : null);
export const safeCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "ZMQ_OBSERVATION_FAILED";
  return /^[A-Z][A-Z0-9_]{0,127}$/.test(message) ? message : "ZMQ_OBSERVATION_FAILED";
};
