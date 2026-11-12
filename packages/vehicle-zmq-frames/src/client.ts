import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { Request } from "zeromq";
import { FramePullRequest, FramePullResponse } from "../../vehicle-zmq-contract/src/schema-v23.js";
import { parseWireJson } from "../../vehicle-zmq-contract/src/json.js";
import { FRAME_MAX_BYTES, type FrameSettings } from "./contract.js";

// Decoder runs outside the control/event loop, with explicit pixel and allocation limits.
const decoder = `const { parentPort, workerData } = require('node:worker_threads');
try { const jpeg = require(workerData.decoder);
const image = jpeg.decode(workerData.bytes, {useTArray:true, formatAsRGBA:false,
 tolerantDecoding:false,maxResolutionInMP:16,maxMemoryUsageInMB:128});
parentPort.postMessage({width:image.width,height:image.height});
} catch { parentPort.postMessage({invalid:true}); }`;
export async function validateJpeg(
  bytes: Buffer,
  width: number,
  height: number,
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw Error("ZMQ_FRAME_READ_CANCELLED");
  if (
    bytes.length < 4 ||
    bytes.length > FRAME_MAX_BYTES ||
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes[bytes.length - 2] !== 255 ||
    bytes[bytes.length - 1] !== 217 ||
    width * height > 16_000_000
  )
    throw Error("ZMQ_FRAME_JPEG_INVALID");
  const result = await new Promise<{ width?: number; height?: number }>((resolve, reject) => {
    const worker = new Worker(decoder, {
      eval: true,
      workerData: {
        decoder: createRequire(import.meta.url).resolve("jpeg-js"),
        bytes,
      },
      resourceLimits: { maxOldGenerationSizeMb: 160 },
    });
    let settled = false;
    const finish = (value?: { width?: number; height?: number }, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      void worker.terminate();
      if (error) reject(error);
      else resolve(value ?? {});
    };
    const abort = () => finish(undefined, Error("ZMQ_FRAME_READ_CANCELLED"));
    const timer = setTimeout(() => finish(undefined, Error("ZMQ_FRAME_DECODE_TIMEOUT")), 2000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    worker.once("message", (v: { width?: number; height?: number }) => finish(v));
    worker.once("error", () => finish(undefined, Error("ZMQ_FRAME_JPEG_INVALID")));
    worker.once("exit", () => finish(undefined, Error("ZMQ_FRAME_JPEG_INVALID")));
  });
  if (result.width !== width || result.height !== height)
    throw Error("ZMQ_FRAME_JPEG_DIMENSIONS_INVALID");
}

export class NativeFrameClient {
  #socket: Request | undefined;
  #abort: AbortController | undefined;
  #busy = false;
  #closed = false;
  constructor(
    readonly endpoint: string,
    readonly deviceId: string,
    readonly settings: FrameSettings,
  ) {}
  async pull(cameraId: string, frameId: string, signal?: AbortSignal) {
    if (this.#closed) throw Error("ZMQ_FRAME_CLIENT_CLOSED");
    if (this.#busy) throw Error("ZMQ_FRAME_CHANNEL_BUSY");
    if (signal?.aborted) throw Error("ZMQ_FRAME_READ_CANCELLED");
    this.#busy = true;
    this.#abort = new AbortController();
    const activeSignal = signal
      ? AbortSignal.any([signal, this.#abort.signal])
      : this.#abort.signal;
    const socket = new Request({
      linger: 0,
      immediate: true,
      sendTimeout: this.settings.sendTimeoutMs,
      receiveTimeout: this.settings.receiveTimeoutMs,
      sendHighWaterMark: 1,
      receiveHighWaterMark: 1,
      maxMessageSize: FRAME_MAX_BYTES,
      reconnectInterval: 1000,
    });
    this.#socket = socket;
    let stage = "send";
    const abort = () => socket.close();
    activeSignal.addEventListener("abort", abort, { once: true });
    try {
      socket.connect(this.endpoint);
      const request = FramePullRequest.parse({
        protocol: "2.3",
        kind: "request",
        device_id: this.deviceId,
        request_id: `frame-${randomUUID()}`,
        method: "FramePull",
        params: { camera_id: cameraId, frame_id: frameId },
      });
      await socket.send(JSON.stringify(request));
      stage = "receive";
      const frames = await socket.receive();
      stage = "validate";
      if (frames.length < 1 || frames.length > 2 || !frames[0])
        throw Error("ZMQ_FRAME_RESPONSE_INVALID");
      const reply = FramePullResponse.parse(parseWireJson(frames[0]));
      if (
        reply.device_id !== this.deviceId ||
        reply.response_id !== request.request_id ||
        reply.method !== "FramePull"
      )
        throw Error("ZMQ_FRAME_RESPONSE_ASSOCIATION_INVALID");
      if (!reply.ok) {
        if (frames.length !== 1) throw Error("ZMQ_FRAME_RESPONSE_INVALID");
        const code = reply.error?.code;
        throw Error(
          code === "FRAME_UNAVAILABLE"
            ? "ZMQ_FRAME_EVICTED"
            : code === "NOT_FOUND"
              ? "ZMQ_FRAME_CAMERA_NOT_FOUND"
              : "ZMQ_FRAME_UPSTREAM_REJECTED",
        );
      }
      const bytes = frames[1],
        metadata = reply.result;
      if (
        frames.length !== 2 ||
        !bytes ||
        !metadata ||
        bytes.length !== metadata.byte_length ||
        metadata.camera_id !== cameraId ||
        metadata.frame_id !== frameId
      )
        throw Error("ZMQ_FRAME_RESPONSE_ASSOCIATION_INVALID");
      await validateJpeg(bytes, metadata.width_px, metadata.height_px, activeSignal);
      if (this.#closed) throw Error("ZMQ_FRAME_CLIENT_CLOSED");
      return { bytes, metadata };
    } catch (error) {
      if (this.#closed) throw Error("ZMQ_FRAME_CLIENT_CLOSED");
      if (activeSignal.aborted) throw Error("ZMQ_FRAME_READ_CANCELLED");
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code === "EAGAIN")
        throw Error(stage === "send" ? "ZMQ_FRAME_SEND_TIMEOUT" : "ZMQ_FRAME_RECEIVE_TIMEOUT");
      if (error instanceof Error && /^ZMQ_FRAME_[A-Z_]+$/.test(error.message)) throw error;
      throw Error("ZMQ_FRAME_RESPONSE_INVALID");
    } finally {
      activeSignal.removeEventListener("abort", abort);
      socket.close();
      this.#socket = undefined;
      this.#abort = undefined;
      this.#busy = false;
    }
  }
  close() {
    this.#closed = true;
    this.#abort?.abort();
    this.#socket?.close();
  }
}
