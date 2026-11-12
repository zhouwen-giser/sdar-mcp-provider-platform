import { randomUUID, createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { ExecutionContextRecord } from "../../provider-adapter-kit/src/types.js";
import {
  FrameInput,
  FRAME_CHUNK_BYTES,
  FrameResult,
  type FrameReference,
  type FrameSettings,
} from "./contract.js";
import type { NativeFrameClient } from "./client.js";
import type { FrameObservationIndex } from "./observations.js";
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
type Entry = FrameReference & {
  id: string;
  owner: string;
  bytes: Buffer;
  sha256: string;
  expires: number;
  expiresAt: string;
  cost: number;
};
export type FrameAudit = (record: Record<string, unknown>) => Promise<void>;
export class FrameService {
  #entries = new Map<string, Entry>();
  #bytes = 0;
  #pulling = false;
  #reads = 0;
  #closed = false;
  readonly #sweeper: ReturnType<typeof setInterval>;
  constructor(
    readonly resourceId: string,
    readonly client: NativeFrameClient,
    readonly observations: FrameObservationIndex,
    readonly settings: FrameSettings,
    readonly audit: FrameAudit,
    readonly clock = () => performance.now(),
  ) {
    this.#sweeper = setInterval(() => this.prune(), Math.min(1000, this.settings.cacheTtlMs));
    this.#sweeper.unref();
  }
  private owner(context: ExecutionContextRecord) {
    if (!/^[a-f0-9]{64}$/.test(context.authorizationContextHash))
      throw Error("ZMQ_FRAME_IDENTITY_INVALID");
    return hash(
      JSON.stringify([
        context.authorizationContextHash,
        context.executionMode.toLowerCase(),
        context.simulationId,
        this.resourceId,
      ]),
    );
  }
  check(input: unknown, context: ExecutionContextRecord) {
    const args = FrameInput.parse(input),
      owner = this.owner(context);
    if (args.resourceId !== this.resourceId) throw Error("ZMQ_FRAME_RESOURCE_UNAUTHORIZED");
    if (this.#closed) throw Error("ZMQ_FRAME_CLIENT_CLOSED");
    if (this.#reads >= 8) throw Error("ZMQ_FRAME_CHANNEL_BUSY");
    this.prune();
    if (args.retrievalId) {
      const entry = this.#entries.get(args.retrievalId);
      if (!entry || entry.owner !== owner) throw Error("ZMQ_FRAME_CACHE_EXPIRED_OR_UNAUTHORIZED");
      if ((args.offset ?? 0) >= entry.bytes.length) throw Error("ZMQ_FRAME_OFFSET_INVALID");
    } else {
      const cached = [...this.#entries.values()].some(
        (e) =>
          e.owner === owner &&
          e.metadata.camera_id === args.cameraId &&
          e.metadata.frame_id === args.frameId,
      );
      if (!cached) {
        if (this.#pulling) throw Error("ZMQ_FRAME_CHANNEL_BUSY");
        this.observations.get(args.cameraId!, args.frameId!);
      }
    }
  }
  async read(
    input: unknown,
    context: ExecutionContextRecord,
    signal?: AbortSignal,
  ): Promise<FrameResult> {
    if (this.#reads >= 8) throw Error("ZMQ_FRAME_CHANNEL_BUSY");
    this.#reads++;
    try {
      return await this.readBounded(input, context, signal);
    } finally {
      this.#reads--;
    }
  }
  private async readBounded(
    input: unknown,
    context: ExecutionContextRecord,
    signal?: AbortSignal,
  ): Promise<FrameResult> {
    const args = FrameInput.parse(input),
      owner = this.owner(context);
    if (args.resourceId !== this.resourceId) throw Error("ZMQ_FRAME_RESOURCE_UNAUTHORIZED");
    if (this.#closed) throw Error("ZMQ_FRAME_CLIENT_CLOSED");
    this.prune();
    let entry: Entry | undefined;
    if (args.retrievalId) {
      entry = this.#entries.get(args.retrievalId);
      if (!entry || entry.owner !== owner) {
        await this.recordAudit({
          schemaVersion: "ugv.zmq-frame-access/1",
          owner,
          resourceId: this.resourceId,
          action: "chunk.denied",
          retrievalIdHash: hash(args.retrievalId),
          reason: "ZMQ_FRAME_CACHE_EXPIRED_OR_UNAUTHORIZED",
        });
        throw Error("ZMQ_FRAME_CACHE_EXPIRED_OR_UNAUTHORIZED");
      }
    } else {
      const cameraId = args.cameraId!,
        frameId = args.frameId!;
      entry = [...this.#entries.values()].find(
        (e) =>
          e.owner === owner && e.metadata.camera_id === cameraId && e.metadata.frame_id === frameId,
      );
      if (!entry) {
        if (this.#pulling) throw Error("ZMQ_FRAME_CHANNEL_BUSY");
        const reference = this.observations.get(cameraId, frameId);
        this.#pulling = true;
        try {
          const pulled = await this.client.pull(cameraId, frameId, signal);
          if (this.#closed) throw Error("ZMQ_FRAME_CLIENT_CLOSED");
          const { encoding: _encoding, byte_length: _byteLength, ...metadata } = pulled.metadata;
          void _encoding;
          void _byteLength;
          if (JSON.stringify(metadata) !== JSON.stringify(reference.metadata))
            // Compare semantic fields below; property order from native JSON is immaterial.
            if (
              Object.keys(metadata).some(
                (k) =>
                  metadata[k as keyof typeof metadata] !==
                  reference.metadata[k as keyof typeof metadata],
              )
            )
              throw Error("ZMQ_FRAME_OBSERVATION_MISMATCH");
          const id = randomUUID(),
            sha256 = hash(pulled.bytes),
            expiresAt = new Date(Date.now() + this.settings.cacheTtlMs).toISOString();
          entry = {
            ...reference,
            metadata,
            id,
            sha256,
            owner,
            bytes: pulled.bytes,
            expires: this.clock() + this.settings.cacheTtlMs,
            expiresAt,
            cost: 0,
          };
          entry.cost = entry.bytes.length + Buffer.byteLength(JSON.stringify(reference));
          await this.recordAudit({
            schemaVersion: "ugv.zmq-frame-access/1",
            action: "frame.validated",
            owner,
            resourceId: this.resourceId,
            deviceId: this.client.deviceId,
            metadata,
            sha256,
            byteLength: pulled.bytes.length,
            reference: reference.reference,
            expiresAt,
          });
          if (this.#closed) throw Error("ZMQ_FRAME_CLIENT_CLOSED");
          this.#entries.set(id, entry);
          this.#bytes += entry.cost;
          this.prune();
        } catch (error) {
          await this.recordAudit({
            schemaVersion: "ugv.zmq-frame-access/1",
            action: "frame.failed",
            owner,
            resourceId: this.resourceId,
            cameraId,
            frameId,
            reason:
              error instanceof Error && /^ZMQ_FRAME_[A-Z_]+$/.test(error.message)
                ? error.message
                : "ZMQ_FRAME_RESPONSE_INVALID",
          });
          throw error;
        } finally {
          this.#pulling = false;
        }
      }
    }
    try {
      const current = this.observations.get(entry.metadata.camera_id, entry.metadata.frame_id);
      if (
        Object.keys(entry.metadata).some(
          (k) =>
            entry.metadata[k as keyof typeof entry.metadata] !==
            current.metadata[k as keyof typeof current.metadata],
        )
      )
        throw Error("ZMQ_FRAME_OBSERVATION_MISMATCH");
      const oldCost = entry.cost;
      entry.overlays = current.overlays;
      entry.overlaysTruncated = current.overlaysTruncated;
      entry.cost =
        entry.bytes.length +
        Buffer.byteLength(
          JSON.stringify({
            metadata: entry.metadata,
            reference: entry.reference,
            overlays: entry.overlays,
            overlaysTruncated: entry.overlaysTruncated,
          }),
        );
      this.#bytes += entry.cost - oldCost;
      this.prune();
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "ZMQ_FRAME_NOT_OBSERVED_OR_EXPIRED")
        throw error;
    }
    const offset = args.offset ?? 0;
    if (offset >= entry.bytes.length) throw Error("ZMQ_FRAME_OFFSET_INVALID");
    const end = Math.min(entry.bytes.length, offset + (args.maxBytes ?? FRAME_CHUNK_BYTES)),
      chunk = entry.bytes.subarray(offset, end);
    await this.recordAudit({
      schemaVersion: "ugv.zmq-frame-access/1",
      action: "chunk.read",
      owner,
      resourceId: this.resourceId,
      metadata: entry.metadata,
      sha256: entry.sha256,
      offset,
      chunkBytes: chunk.length,
      chunkSha256: hash(chunk),
    });
    const diagnostics = [
      "SHORT_TERM_CACHE_EARLY_EVICTION_POSSIBLE",
      "FRAME_NOT_COVERAGE_OR_STREAM_COMPLETENESS_EVIDENCE",
    ];
    if (entry.metadata.exposure_utc_ms === null) diagnostics.push("EXPOSURE_UTC_UNKNOWN");
    if (!entry.overlays.length) diagnostics.push("SAME_FRAME_DETECTIONS_NOT_AVAILABLE");
    return FrameResult.parse({
      schemaVersion: "ugv.zmq-frame/1",
      resourceId: this.resourceId,
      deviceId: this.client.deviceId,
      metadata: entry.metadata,
      encoding: "jpeg",
      byteLength: entry.bytes.length,
      sha256: entry.sha256,
      retrievalId: entry.id,
      expiresAt: entry.expiresAt,
      offset,
      chunkBytes: chunk.length,
      chunkSha256: hash(chunk),
      dataBase64: chunk.toString("base64"),
      nextOffset: end < entry.bytes.length ? end : null,
      reference: entry.reference,
      overlays: entry.overlays,
      overlaysTruncated: entry.overlaysTruncated,
      diagnostics,
    });
  }
  private async recordAudit(record: Record<string, unknown>) {
    try {
      await this.audit(record);
    } catch (error) {
      throw Error("ZMQ_FRAME_AUDIT_UNAVAILABLE", { cause: error });
    }
  }
  private prune() {
    for (const [id, e] of this.#entries)
      if (
        e.expires <= this.clock() ||
        this.#bytes > this.settings.cacheMaxBytes ||
        this.#entries.size > this.settings.maxCacheEntries
      ) {
        this.#bytes -= e.cost;
        this.#entries.delete(id);
      }
  }
  get usage() {
    return { bytes: this.#bytes, entries: this.#entries.size };
  }
  close() {
    this.#closed = true;
    clearInterval(this.#sweeper);
    this.client.close();
    this.#entries.clear();
    this.#bytes = 0;
    this.observations.clear();
  }
}
