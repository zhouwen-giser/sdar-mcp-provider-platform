import * as grpc from "@grpc/grpc-js";
import {
  businessEventReasonFromError,
  protoStructToJson,
  type AdapterBusinessEvent,
  type GrpcAdapterGateway,
} from "../../../../packages/adapter-protocol/src/index.js";
import type {
  BusinessEventRepository,
  BusinessEventDeliverySemantics,
  BusinessEventLease,
  BusinessEventSourceFact,
} from "../../../../packages/persistence-postgres/src/index.js";

export interface AdapterBusinessEventSourceClientOptions {
  providerId: string;
  sourceId: string;
  sourceStreamId: string;
  deliverySemantics: BusinessEventDeliverySemantics;
  replicaId: string;
  leaseMs?: number;
  inboxRetentionMs?: number;
  eventRetentionMs?: number;
  mappingDeadlineMs?: number;
  generationRetentionMs?: number;
  pendingRetryMs?: number;
  metrics?: {
    increment(name: string, labels?: Record<string, string>, amount?: number): void;
    gauge(name: string, value: number, labels?: Record<string, string>): void;
    event?(name: string, body: Record<string, unknown>): void;
    trace?<T>(
      name: string,
      attributes: Record<string, string | number | boolean>,
      operation: () => Promise<T>,
    ): Promise<T>;
  };
}

type FinalizationOutcome = "idle" | "rotated";

export class AdapterBusinessEventSourceClient {
  readonly #leaseMs: number;
  readonly #inboxRetentionMs: number;
  readonly #eventRetentionMs: number;
  readonly #mappingDeadlineMs: number;
  readonly #generationRetentionMs: number;
  #finalization: Promise<void> = Promise.resolve();

  constructor(
    readonly repository: BusinessEventRepository,
    readonly gateway: GrpcAdapterGateway,
    readonly options: AdapterBusinessEventSourceClientOptions,
  ) {
    this.#leaseMs = options.leaseMs ?? 30_000;
    this.#inboxRetentionMs = options.inboxRetentionMs ?? 604_800_000;
    this.#eventRetentionMs = options.eventRetentionMs ?? 604_800_000;
    this.#mappingDeadlineMs = options.mappingDeadlineMs ?? 60_000;
    this.#generationRetentionMs = options.generationRetentionMs ?? 604_800_000;
  }

  async runOnce(): Promise<"not_owner" | "completed" | "rotated" | "degraded"> {
    return this.#trace(
      "business_events.source.connect",
      {
        sourceId: this.options.sourceId,
        deliverySemantics: this.options.deliverySemantics,
      },
      () => this.#runOnce(),
    );
  }

  async #runOnce(): Promise<"not_owner" | "completed" | "rotated" | "degraded"> {
    this.#gauge("sdar_business_event_publication_barrier_waiting", 0, {
      sourceId: this.options.sourceId,
    });
    const lease = await this.repository.acquireSourceLease(
      this.options.providerId,
      this.options.sourceId,
      this.options.sourceStreamId,
      this.options.replicaId,
      this.#leaseMs,
    );
    if (lease === undefined) return "not_owner";
    const stream = this.gateway.streamBusinessEvents({
      sourceId: this.options.sourceId,
      sourceStreamId: this.options.sourceStreamId,
      ...(this.options.deliverySemantics === "durable_at_least_once" &&
      lease.lastPersistedSourceSequence !== "0"
        ? { afterSourceSequence: lease.lastPersistedSourceSequence }
        : {}),
    });
    let retryInFlight = false;
    let rotationRequested = false;
    const wasRotationRequested = (): boolean => rotationRequested;
    const stopForRotation = (): void => {
      if (rotationRequested) return;
      rotationRequested = true;
      stream.cancel();
    };
    const retry = setInterval(() => {
      if (retryInFlight || rotationRequested) return;
      retryInFlight = true;
      void this.#queueFinalization()
        .then((outcome) => {
          if (outcome === "rotated") stopForRotation();
        })
        .catch(() => {
          this.#increment("sdar_business_event_source_blocked_total", {
            sourceId: this.options.sourceId,
            reason: "pending_finalizer_failure",
          });
        })
        .finally(() => {
          retryInFlight = false;
        });
    }, this.options.pendingRetryMs ?? 500);
    retry.unref();
    try {
      await consumeStream(stream, async (event) => {
        const outcome = await this.#handleEvent(lease, event);
        if (outcome === "rotated") stopForRotation();
      });
      if (wasRotationRequested()) return "rotated";
      this.#event("business_events.source.connection", {
        sourceId: this.options.sourceId,
        outcome: "closed",
      });
      return "completed";
    } catch (error) {
      if (wasRotationRequested()) return "rotated";
      if (isServiceError(error)) {
        const reason = businessEventReasonFromError(error) ?? "SOURCE_TEMPORARILY_UNAVAILABLE";
        this.#event("business_events.source.connection", {
          sourceId: this.options.sourceId,
          outcome: "failed",
          reasonCode: reason,
        });
        if (
          this.options.deliverySemantics === "durable_at_least_once" &&
          [
            "SOURCE_CURSOR_EXPIRED",
            "SOURCE_STREAM_RESET",
            "SOURCE_CURSOR_AHEAD",
            "SOURCE_DATA_LOSS",
          ].includes(reason)
        ) {
          await this.#trace(
            "business_events.stream.rotate",
            { sourceId: this.options.sourceId, outcome: "success", reason },
            () =>
              this.repository.rotateStream(
                this.options.providerId,
                reason,
                [this.options.sourceId],
                `${this.options.sourceStreamId}:${reason}:${lease.lastPersistedSourceSequence}`,
                this.#generationRetentionMs,
              ),
          );
          this.#increment("sdar_business_event_stream_rotations_total", { reason });
          this.#increment("sdar_business_event_continuity_loss_total", { reason });
          return "rotated";
        }
        await this.repository.markSourceUnavailable(lease, reason);
        this.#increment("sdar_business_event_source_blocked_total", {
          sourceId: this.options.sourceId,
          reason,
        });
        return "degraded";
      }
      throw error;
    } finally {
      clearInterval(retry);
      await this.#finalization;
    }
  }

  async #handleEvent(
    lease: BusinessEventLease,
    event: AdapterBusinessEvent,
  ): Promise<FinalizationOutcome> {
    const fact = normalizeAdapterEvent(event);
    const intake = await this.#trace(
      "business_events.source.ingest",
      { sourceId: this.options.sourceId, scope: fact.scope },
      () =>
        this.repository.intakeSourceFact(
          lease,
          fact,
          this.#inboxRetentionMs,
          this.#mappingDeadlineMs,
        ),
    );
    this.#increment("sdar_business_event_source_received_total", {
      sourceId: this.options.sourceId,
      outcome: intake.disposition,
    });
    if (intake.disposition === "duplicate") {
      this.#increment("sdar_business_event_source_duplicate_total", {
        sourceId: this.options.sourceId,
      });
      return "idle";
    }
    if (intake.disposition === "rejected") {
      this.#event("business_events.source.rejected", {
        sourceId: this.options.sourceId,
        scope: fact.scope,
        outcome: "rejected",
        reasonCode: intake.rejectReason ?? "SOURCE_POISON_EVENT",
      });
      this.#increment("sdar_business_event_source_rejected_total", {
        sourceId: this.options.sourceId,
        reason: "poison_event",
      });
    }
    if (
      intake.disposition === "rejected" &&
      this.options.deliverySemantics === "durable_at_least_once"
    ) {
      await this.#trace(
        "business_events.stream.rotate",
        { sourceId: this.options.sourceId, outcome: "success", reason: "SOURCE_POISON_EVENT" },
        () =>
          this.repository.rotateStream(
            this.options.providerId,
            "SOURCE_POISON_EVENT",
            [this.options.sourceId],
            `${this.options.sourceStreamId}:poison:${fact.sourceSequence}`,
            this.#generationRetentionMs,
          ),
      );
      this.#increment("sdar_business_event_stream_rotations_total", {
        reason: "SOURCE_POISON_EVENT",
      });
      this.#increment("sdar_business_event_continuity_loss_total", {
        reason: "SOURCE_POISON_EVENT",
      });
      return "rotated";
    }
    return this.#queueFinalization();
  }

  #queueFinalization(): Promise<FinalizationOutcome> {
    const work = this.#finalization.then(() => this.#finalizeBuffered());
    this.#finalization = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  }

  async #finalizeBuffered(): Promise<FinalizationOutcome> {
    // A Task-scoped source event may arrive before Runtime persists its external Execution ID.
    // Retry the durable inbox while the source stream stays open, even without another event.
    for (let index = 0; index < 100; index += 1) {
      const prepared = await this.#trace(
        "business_events.source.prepare",
        { sourceId: this.options.sourceId },
        () =>
          this.repository.prepareNextSourceEvent(this.options.providerId, this.options.sourceId),
      );
      if (prepared === "ready") {
        const finalized = await this.#trace(
          "business_events.source.finalize",
          { sourceId: this.options.sourceId, outcome: "finalized" },
          () =>
            this.repository.finalizeNextSourceEvent(
              this.options.providerId,
              this.options.sourceId,
              this.#eventRetentionMs,
            ),
        );
        if (!finalized) return "idle";
        this.#increment("sdar_business_event_finalized_total", {
          sourceId: this.options.sourceId,
          outcome: "finalized",
        });
        this.#gauge("sdar_business_event_publication_barrier_waiting", 0, {
          sourceId: this.options.sourceId,
        });
        continue;
      }
      if (prepared === "terminal" && this.options.deliverySemantics === "durable_at_least_once") {
        // Several buffered events can fail mapping without any new source
        // arrival. Each barrier needs its own rotation identity, not the last
        // received sequence shared by all those failures.
        const barrierId = await this.repository.terminalSourceBarrierId(
          this.options.providerId,
          this.options.sourceId,
          this.options.sourceStreamId,
        );
        if (barrierId === undefined) return "idle";
        this.#increment("sdar_business_event_source_mapping_failed_total", {
          sourceId: this.options.sourceId,
        });
        await this.#trace(
          "business_events.stream.rotate",
          { sourceId: this.options.sourceId, outcome: "success", reason: "SOURCE_MAPPING_FAILED" },
          () =>
            this.repository.rotateStream(
              this.options.providerId,
              "SOURCE_MAPPING_FAILED",
              [this.options.sourceId],
              `${this.options.sourceStreamId}:mapping-inbox:${barrierId}`,
              this.#generationRetentionMs,
            ),
        );
        this.#increment("sdar_business_event_stream_rotations_total", {
          reason: "SOURCE_MAPPING_FAILED",
        });
        this.#increment("sdar_business_event_continuity_loss_total", {
          reason: "SOURCE_MAPPING_FAILED",
        });
        this.#gauge("sdar_business_event_publication_barrier_waiting", 0, {
          sourceId: this.options.sourceId,
        });
        return "rotated";
      } else if (prepared === "pending") {
        this.#event("business_events.finalizer.wait", {
          sourceId: this.options.sourceId,
          outcome: "blocked",
          reasonCode: "SOURCE_MAPPING_FAILED",
        });
        this.#gauge("sdar_business_event_publication_barrier_waiting", 1, {
          sourceId: this.options.sourceId,
        });
      }
      return "idle";
    }
    return "idle";
  }

  #increment(name: string, labels: Record<string, string> = {}): void {
    try {
      this.options.metrics?.increment(name, labels);
    } catch {
      // Telemetry is best effort and cannot alter source processing.
    }
  }

  #gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    try {
      this.options.metrics?.gauge(name, value, labels);
    } catch {
      // Telemetry is best effort and cannot alter source processing.
    }
  }

  #event(name: string, body: Record<string, unknown>): void {
    try {
      this.options.metrics?.event?.(name, body);
    } catch {
      // Diagnostics cannot alter source processing.
    }
  }

  async #trace<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    operation: () => Promise<T>,
  ): Promise<T> {
    const telemetry = this.options.metrics;
    if (telemetry?.trace === undefined) return operation();
    const invocation = { started: false };
    const invoke = (): Promise<T> => {
      invocation.started = true;
      return operation();
    };
    try {
      return await telemetry.trace(name, attributes, invoke);
    } catch (error) {
      if (invocation.started) throw error;
      return operation();
    }
  }
}

function normalizeAdapterEvent(event: AdapterBusinessEvent): BusinessEventSourceFact {
  const occurredAt = timestampToRfc3339Nano(event.occurredAt);
  return {
    sourceEventId: event.sourceEventId,
    sourceSequence: event.sourceSequence,
    sourceStreamId: event.sourceStreamId,
    scope: event.scope,
    occurredAt,
    eventType: event.eventType,
    description: event.description,
    ...(event.externalExecutionId === undefined || event.externalExecutionId === ""
      ? {}
      : { externalExecutionId: event.externalExecutionId }),
    ...(event.resourceRef === undefined || event.resourceRef === ""
      ? {}
      : { resourceRef: event.resourceRef }),
    ...(event.severityHint === "" ? {} : { severityHint: event.severityHint }),
    ...(event.reasonCode === "" ? {} : { reasonCode: event.reasonCode }),
    rawPayload: protoStructToJson(event.rawPayload),
  };
}

function timestampToRfc3339Nano(timestamp: { seconds?: string; nanos?: number }): string {
  const seconds = BigInt(timestamp.seconds ?? "0");
  const base = new Date(Number(seconds) * 1_000).toISOString().slice(0, 19);
  const nanos = timestamp.nanos ?? 0;
  const fraction = nanos === 0 ? "" : `.${String(nanos).padStart(9, "0").replace(/0+$/, "")}`;
  return `${base}${fraction}Z`;
}

function consumeStream(
  stream: grpc.ClientReadableStream<AdapterBusinessEvent>,
  onEvent: (event: AdapterBusinessEvent) => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let chain = Promise.resolve();
    let ended = false;
    stream.on("data", (event: AdapterBusinessEvent) => {
      stream.pause();
      chain = chain
        .then(() => onEvent(event))
        .then(
          () => {
            stream.resume();
          },
          (error: unknown) => {
            stream.cancel();
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
    });
    stream.on("error", (error: grpc.ServiceError) => {
      if (!ended && error.code !== grpc.status.CANCELLED) reject(error);
    });
    stream.on("end", () => {
      ended = true;
      void chain.then(resolve, reject);
    });
  });
}

function isServiceError(error: unknown): error is grpc.ServiceError {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "number" &&
    "metadata" in error
  );
}
