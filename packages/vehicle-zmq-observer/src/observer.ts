import { randomUUID } from "node:crypto";
import type { ControlDeploymentProfile as DeploymentProfile } from "../../vehicle-zmq-contract/src/site-profile.js";
import {
  canonical,
  type Component,
  type ObserverIdentity,
  type ObserverSettings,
} from "./config.js";
import {
  gap,
  stamp,
  type ArchiveSession,
  type ArchiveEntry,
  type ClockStamp,
  type ObservationArchive,
  type ObservationEvent,
} from "./model.js";
import { ObservationNormalizer, safeCode } from "./normalize.js";
import { ObservationState, type ArchiveHealth } from "./state.js";

export class ZmqObservationObserver {
  readonly clockId = `zmq-receiver:${randomUUID()}`;
  readonly state: ObservationState;
  readonly normalizer: ObservationNormalizer;
  readonly health: ArchiveHealth = {
    status: "starting",
    pendingRecords: 0,
    pendingBytes: 0,
    committedEvents: 0,
    receivedMessages: 0,
    committedReceptions: 0,
    unconfirmedReceptions: 0,
    locallyDiscardedMessages: 0,
    failureCode: null,
    failureRecorded: null,
  };
  #session: ArchiveSession | undefined;
  #started = false;
  #queue: { event: ObservationEvent; bytes: number }[] = [];
  #timer: ReturnType<typeof setTimeout> | undefined;
  #pump: Promise<void> | undefined;
  #failure: Promise<void> | undefined;
  #stopping: Promise<void> | undefined;
  readonly #committedListeners = new Set<(entry: ArchiveEntry) => void>();
  onFailure: (() => void) | undefined;
  constructor(
    readonly profile: DeploymentProfile,
    readonly settings: ObserverSettings,
    readonly scope: ObserverIdentity,
    readonly archive: ObservationArchive,
  ) {
    this.state = new ObservationState(scope, settings);
    this.normalizer = new ObservationNormalizer(profile, settings);
    archive.setFailureHandler?.((code) => this.fail(code));
  }
  get sessionId() {
    return this.#session?.sessionId ?? null;
  }
  /** Consumers see confirmed archive entries only; consumer failure does not undo a commit. */
  subscribeCommitted(listener: (entry: ArchiveEntry) => void): () => void {
    this.#committedListeners.add(listener);
    return () => this.#committedListeners.delete(listener);
  }
  async start(): Promise<void> {
    if (this.#started) throw Error("ZMQ_OBSERVER_ALREADY_STARTED");
    this.#started = true;
    try {
      this.#session = await this.archive.start();
      if (this.health.status === "failed")
        throw Error(this.health.failureCode ?? "ZMQ_ARCHIVE_START_UNCONFIRMED");
      this.health.status = "running";
    } catch (error) {
      this.health.status = "failed";
      this.health.failureCode = safeCode(error);
      throw error;
    }
  }
  receive(component: Component, frames: readonly Buffer[], clock = stamp(this.clockId)): boolean {
    this.health.receivedMessages++;
    if (this.health.status !== "running") {
      this.health.locallyDiscardedMessages++;
      return false;
    }
    return this.enqueue(this.normalizer.receive(component, frames, clock));
  }
  transport(
    component: Component,
    state: "connecting" | "connected" | "disconnected" | "closed",
    clock = stamp(this.clockId),
  ): boolean {
    return this.enqueue({
      ...clock,
      schemaVersion: "ugv.zmq-observation-event/2.0",
      eventId: randomUUID(),
      type: "transport",
      component,
      state,
    });
  }
  diagnostic(component: Component, code: string, clock: ClockStamp = stamp(this.clockId)): boolean {
    return this.enqueue(gap(clock, code, component));
  }
  private enqueue(event: ObservationEvent): boolean {
    if (this.health.status !== "running") return false;
    const bytes = Buffer.byteLength(canonical(event));
    if (
      this.health.pendingRecords >= this.settings.maxPendingRecords ||
      this.health.pendingBytes + bytes > this.settings.maxPendingBytes
    ) {
      if (event.type === "reception") this.health.locallyDiscardedMessages++;
      this.fail("ZMQ_OBSERVER_QUEUE_EXHAUSTED");
      return false;
    }
    this.#queue.push({ event, bytes });
    this.health.pendingRecords++;
    this.health.pendingBytes += bytes;
    if (!this.#pump && !this.#timer)
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        void this.flush();
      }, this.settings.flushIntervalMs);
    return true;
  }
  fail(code: string): void {
    if (this.health.status === "failed" || this.health.status === "stopped") return;
    this.health.status = "failed";
    this.health.failureCode = code;
    this.onFailure?.();
    if (!this.#pump) void this.flush();
  }
  async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    if (this.#pump) {
      await this.#pump;
      if (this.#queue.length > 0) await this.flush();
      return;
    }
    const work = async () => {
      while (this.#queue.length > 0) {
        const batch: { event: ObservationEvent; bytes: number }[] = [];
        let size = 0;
        while (this.#queue.length > 0 && batch.length < this.settings.maxBatchRecords) {
          const next = this.#queue[0];
          if (!next) break;
          if (batch.length > 0 && size + next.bytes > this.settings.maxBatchBytes) break;
          this.#queue.shift();
          batch.push(next);
          size += next.bytes;
        }
        try {
          const entries = await this.archive.append(batch.map((item) => item.event));
          if (entries.length !== batch.length) throw Error("ZMQ_ARCHIVE_BATCH_RECEIPT_UNCONFIRMED");
          for (const entry of entries) {
            this.state.apply(entry.payload);
            for (const listener of this.#committedListeners) {
              try {
                listener(structuredClone(entry));
              } catch {
                this.#committedListeners.delete(listener);
              }
            }
          }
          this.health.committedEvents += entries.length;
          this.health.committedReceptions += entries.filter(
            (entry) => entry.payload.type === "reception",
          ).length;
        } catch (error) {
          const code = safeCode(error),
            batchReceptions = batch.filter((item) => item.event.type === "reception").length;
          if (code === "ZMQ_ARCHIVE_PAYLOAD_BUDGET_EXHAUSTED")
            this.health.locallyDiscardedMessages += batchReceptions;
          else this.health.unconfirmedReceptions += batchReceptions;
          const queuedReceipts = this.#queue.filter(
            (item) => item.event.type === "reception",
          ).length;
          this.health.locallyDiscardedMessages += queuedReceipts;
          this.#queue = [];
          this.health.pendingBytes = size;
          this.health.pendingRecords = batch.length;
          this.fail(code);
        } finally {
          this.health.pendingRecords -= batch.length;
          this.health.pendingBytes -= size;
        }
      }
      if (this.health.status === "failed") await this.finalizeFailure();
    };
    this.#pump = work();
    try {
      await this.#pump;
    } finally {
      this.#pump = undefined;
    }
    if (this.#queue.length > 0) await this.flush();
  }
  private async finalizeFailure(): Promise<void> {
    if (!this.#session) {
      this.health.failureRecorded = false;
      return;
    }
    this.#failure ??= (async () => {
      try {
        await this.archive.fail(
          this.health.failureCode ?? "ZMQ_OBSERVATION_FAILED",
          this.health.locallyDiscardedMessages,
        );
        this.health.failureRecorded = true;
      } catch {
        this.health.failureRecorded = false;
      }
    })();
    await this.#failure;
  }
  stop(): Promise<void> {
    this.#stopping ??= this.finish();
    return this.#stopping;
  }
  private async finish(): Promise<void> {
    if (this.health.status === "running") this.health.status = "stopping";
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const close = async () => {
      await this.flush();
      if (this.health.status === "failed") await this.finalizeFailure();
      await this.archive.close();
      if (this.health.status !== "failed") this.health.status = "stopped";
    };
    try {
      await Promise.race([
        close(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(Error("ZMQ_OBSERVER_SHUTDOWN_UNCONFIRMED")),
            this.settings.shutdownTimeoutMs,
          );
        }),
      ]);
    } catch (error) {
      this.fail(safeCode(error));
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  snapshot(nowNs = process.hrtime.bigint()) {
    return this.state.snapshot(this.sessionId, { ...this.health }, nowNs);
  }
}
