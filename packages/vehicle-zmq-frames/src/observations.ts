import { performance } from "node:perf_hooks";
import type { Reception } from "../../vehicle-zmq-observer/src/model.js";
import { FrameMetadata } from "../../vehicle-zmq-contract/src/schema-v23.js";
import type { FrameReference } from "./contract.js";
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
/** Session-local, bounded association index. It cannot assert complete detection streams. */
export class FrameObservationIndex {
  #entries = new Map<
    string,
    { value: FrameReference; expires: number; bytes: number; conflict: boolean }
  >();
  #bytes = 0;
  constructor(readonly now = () => performance.now()) {}
  observe(receipt: Reception, sessionId: string) {
    if (!receipt.projectable || receipt.component !== "eo" || !receipt.observation) return;
    const o = receipt.observation,
      data = o.data;
    let image: Record<string, unknown>,
      overlays: Record<string, unknown>[] = [];
    let truncated = false;
    if (o.key === "frame_header") image = data;
    else if (o.key === "targetlist") {
      image = object(data.image);
      overlays = Array.isArray(data.targets) ? data.targets.slice(0, 256).map(object) : [];
      truncated =
        data.truncated === true || (Array.isArray(data.targets) && data.targets.length > 256);
    } else if (o.key === "tracklist") {
      const targets = Array.isArray(data.targets) ? data.targets.map(object) : [];
      if (targets.length !== 1) return;
      image = object(targets[0]?.image);
      overlays = targets.map((t) => ({ ...t, target_id: data.target_id, track_id: data.track_id }));
    } else return;
    const result = FrameMetadata.safeParse({
      camera_id: image.camera_id,
      frame_id: image.frame_id,
      width_px: image.width_px,
      height_px: image.height_px,
      exposure_utc_ms: o.key === "frame_header" ? data.exposure_utc_ms : data.observed_at_utc_ms,
    });
    if (!result.success) return;
    const metadata = result.data,
      key = `${metadata.camera_id}/${metadata.frame_id}`,
      prior = this.#entries.get(key);
    const reference = { receptionId: receipt.eventId, sessionId, receivedAt: receipt.receivedAt };
    const value: FrameReference = {
      metadata,
      reference: prior?.value.reference ?? reference,
      overlays: overlays.length ? overlays : (prior?.value.overlays ?? []),
      overlaysTruncated: truncated || (prior?.value.overlaysTruncated ?? false),
    };
    const conflict =
      !!prior &&
      (prior.conflict || JSON.stringify(prior.value.metadata) !== JSON.stringify(metadata));
    if (prior) this.#bytes -= prior.bytes;
    const bytes = Buffer.byteLength(JSON.stringify(value));
    this.#entries.delete(key);
    this.#entries.set(key, { value, bytes, expires: this.now() + 300000, conflict });
    this.#bytes += bytes;
    this.prune();
  }
  get(cameraId: string, frameId: string): FrameReference {
    this.prune();
    const entry = this.#entries.get(`${cameraId}/${frameId}`);
    if (!entry) throw Error("ZMQ_FRAME_NOT_OBSERVED_OR_EXPIRED");
    if (entry.conflict) throw Error("ZMQ_FRAME_OBSERVATION_CONFLICT");
    return structuredClone(entry.value);
  }
  private prune() {
    for (const [key, e] of this.#entries) {
      if (e.expires <= this.now() || this.#entries.size > 4096 || this.#bytes > 8388608) {
        this.#bytes -= e.bytes;
        this.#entries.delete(key);
      }
    }
  }
  clear() {
    this.#entries.clear();
    this.#bytes = 0;
  }
  get size() {
    return this.#entries.size;
  }
}
