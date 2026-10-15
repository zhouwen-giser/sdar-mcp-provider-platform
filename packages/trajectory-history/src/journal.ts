import { randomUUID } from "node:crypto";
import type {
  VehicleMqttIngress,
  VehicleReceptionJournal,
  RawMqttReception,
} from "../../vehicle-mqtt-ingress/src/index.js";
import {
  captureTrajectoryReceipt,
  reportedTimeOrdinal,
  TRAJECTORY_SOURCE_TOPICS,
} from "./capture.js";
import type { ReceptionReceipt } from "./contract.js";
import type { PostgresReceptionStore } from "./postgres-store.js";

/** Single ordered source writer. Receipt time is supplied from the real callback before this queue. */
export class TrajectoryReceptionJournal implements VehicleReceptionJournal {
  readonly clockId: string;
  #sessionId: string | undefined;
  #pending: Promise<void> = Promise.resolve();
  #queueSize = 0;
  #failed = false;
  readonly #reportedTimeByTopic = new Map<string, bigint>();
  readonly #reportedSequenceByTopic = new Map<string, bigint>();
  #previousProviderUtc: string | undefined;
  constructor(
    readonly store: PostgresReceptionStore,
    readonly ingress: VehicleMqttIngress,
    readonly evidenceClass: ReceptionReceipt["evidenceClass"],
    readonly maxPending = 256,
  ) {
    this.clockId = store.identity.providerId + ":mqtt-process:" + randomUUID();
    if (!Number.isSafeInteger(maxPending) || maxPending < 1)
      throw Error("HISTORY_QUEUE_BOUND_INVALID");
  }
  async initialize(): Promise<void> {
    await this.store.initialize();
    this.#sessionId = await this.store.beginSession();
  }
  record(raw: RawMqttReception): Promise<boolean> {
    if (!(TRAJECTORY_SOURCE_TOPICS as readonly string[]).includes(raw.topic))
      return Promise.resolve(false);
    if (!this.#sessionId || this.#failed)
      return Promise.reject(Error("HISTORY_CAPTURE_UNAVAILABLE"));
    if (this.#queueSize >= this.maxPending) {
      this.#failed = true;
      return Promise.reject(Error("HISTORY_CAPTURE_QUEUE_EXHAUSTED"));
    }
    const receipt = captureTrajectoryReceipt(
      this.ingress,
      raw.topic,
      raw.payload,
      {
        receptionId: raw.receptionId,
        sessionId: this.#sessionId,
        receivedUtc: raw.receivedAt,
        monotonicNanoseconds: raw.monotonicNanoseconds,
        clockId: this.clockId,
        qos: raw.qos,
        packetId: raw.packetId,
        duplicateDeliveryHint: raw.duplicateDeliveryHint,
        retainedDelivery: raw.retainedDelivery,
      },
      this.evidenceClass,
    );
    const timeKey = [
      raw.topic,
      receipt.reportedTime?.originalField,
      receipt.reportedTime?.unit,
    ].join("\0");
    const priorReported = this.#reportedTimeByTopic.get(timeKey);
    const reported = reportedTimeOrdinal(receipt.reportedTime);
    if (
      receipt.reportedTime &&
      reported !== undefined &&
      priorReported !== undefined &&
      reported < priorReported
    ) {
      receipt.reportedTime.quality = "REPORTED_CLOCK_REGRESSION";
      receipt.diagnostics.push("SOURCE_REPORTED_CLOCK_REGRESSED");
    }
    if (reported !== undefined) this.#reportedTimeByTopic.set(timeKey, reported);
    if (this.#previousProviderUtc && raw.receivedAt < this.#previousProviderUtc)
      receipt.diagnostics.push("PROVIDER_RECEPTION_UTC_CLOCK_REGRESSED");
    this.#previousProviderUtc = raw.receivedAt;
    if (receipt.sourceReportedSequence && /^\d{1,19}$/.test(receipt.sourceReportedSequence)) {
      const sequence = BigInt(receipt.sourceReportedSequence);
      const previous = this.#reportedSequenceByTopic.get(raw.topic);
      if (previous !== undefined) {
        if (sequence === previous)
          receipt.diagnostics.push("REPORTED_SEQUENCE_REPEATED_WITHOUT_ATTESTED_EPOCH");
        else if (sequence < previous)
          receipt.diagnostics.push("REPORTED_SEQUENCE_REGRESSED_OR_REORDERED");
        else if (sequence > previous + 1n)
          receipt.diagnostics.push("REPORTED_SEQUENCE_JUMP_WITHOUT_ATTESTED_EPOCH");
      }
      this.#reportedSequenceByTopic.set(raw.topic, sequence);
    }
    this.#queueSize++;
    const result = this.#pending.then(async () => {
      if (this.#failed) throw Error("HISTORY_CAPTURE_UNAVAILABLE");
      await this.store.append(receipt);
    });
    this.#pending = result.catch(() => {
      this.#failed = true;
    });
    return result
      .then(() => true)
      .finally(() => {
        this.#queueSize--;
      });
  }
  async disconnected(): Promise<void> {
    if (this.#sessionId) await this.store.recordDisconnect(this.#sessionId);
  }
  async failed(): Promise<void> {
    this.#failed = true;
    await this.store.recordCaptureFailure();
  }
  async stopped(): Promise<void> {
    await this.#pending;
    if (this.#sessionId && !this.#failed) await this.store.closeSession(this.#sessionId);
    else await this.store.releaseWriterLease();
    this.#sessionId = undefined;
  }
}
