import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import { canonical, sha256 } from "../../vehicle-zmq-observer/src/config.js";
import type { WireCommand } from "./model.js";
import type { DispatchResult } from "./transport.js";
import {
  ViewBackendSettings,
  decodeViewRequest,
  validateViewReply,
  type ViewReply,
  VIEW_PROTOCOL,
} from "./simulation-view-contract.js";
import { safeFailureCode, type TransportDiagnostic } from "./transport-diagnostics.js";

const statusSchema = z
  .object({
    protocol: z.literal(VIEW_PROTOCOL),
    viewId: z.string(),
    ownershipId: z.uuid(),
    resourceId: z.string(),
    apiVersion: z.string(),
    worldId: z.string().regex(/^[0-9]+$/),
    parentActorId: z.number().int(),
    parentRoleName: z.string(),
    minFovDeg: z.number(),
    maxFovDeg: z.number(),
    ownership: z.literal("project_owned"),
    eoRecognitionAffected: z.literal(false),
    observedAt: z.iso.datetime(),
  })
  .strict();
export class SimulationViewClient {
  readonly config: ViewBackendSettings;
  readonly #token: string;
  readonly #close = new AbortController();
  constructor(config: ViewBackendSettings) {
    this.config = ViewBackendSettings.parse(config);
    if (statSync(this.config.tokenFile).mode & 0o077)
      throw Error("ZMQ_VIEW_PRIVATE_TOKEN_REQUIRED");
    this.#token = readFileSync(this.config.tokenFile, "utf8").trim();
    if (this.#token.length < 32) throw Error("ZMQ_VIEW_TOKEN_INVALID");
  }
  close() {
    this.#close.abort();
  }
  private async call(path: string, body?: string, timeoutMs = this.config.exchangeTimeoutMs) {
    const response = await fetch(new URL(path, this.config.endpoint), {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${this.#token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.any([
        this.#close.signal,
        AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs))),
      ]),
    });
    const reader = response.body?.getReader(),
      chunks: Uint8Array[] = [];
    let bytes = 0;
    if (!reader) throw Error("ZMQ_VIEW_RESPONSE_EMPTY");
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        const chunk: unknown = next.value;
        if (!(chunk instanceof Uint8Array)) throw Error("ZMQ_VIEW_RESPONSE_INVALID");
        bytes += chunk.byteLength;
        if (bytes > 131072) throw Error("ZMQ_VIEW_RESPONSE_TOO_LARGE");
        chunks.push(chunk);
      }
    } finally {
      await reader.cancel();
    }
    const text = Buffer.concat(chunks).toString("utf8");
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw Error("ZMQ_VIEW_RESPONSE_INVALID");
    }
    if (!response.ok) {
      const code = value && typeof value === "object" && "error" in value ? value.error : null;
      throw Error(
        typeof code === "string" && /^ZMQ_VIEW_[A-Z0-9_]+$/.test(code)
          ? code
          : "ZMQ_VIEW_HTTP_REJECTED",
      );
    }
    return { value, bytes, sha256: sha256(text) };
  }
  async check(resourceId: string) {
    const r = statusSchema.parse((await this.call("/v1/status", undefined, 2000)).value),
      c = this.config;
    if (
      r.resourceId !== resourceId ||
      r.viewId !== c.viewId ||
      r.ownershipId !== c.ownershipId ||
      r.apiVersion !== c.apiVersion ||
      r.worldId !== c.worldId ||
      r.parentActorId !== c.parentActorId ||
      r.parentRoleName !== c.parentRoleName ||
      r.minFovDeg !== c.minFovDeg ||
      r.maxFovDeg !== c.maxFovDeg ||
      Math.abs(Date.now() - Date.parse(r.observedAt)) > 3000
    )
      throw Error("ZMQ_VIEW_BACKEND_IDENTITY_OR_FRESHNESS_INVALID");
  }
  request(command: WireCommand) {
    if (
      command.method !== "SimulationView" ||
      command.action !== "camera" ||
      command.frames.length !== 1
    )
      throw Error("ZMQ_VIEW_COMMAND_INVALID");
    const request = decodeViewRequest(command.frames);
    if (request.requestId !== command.requestId || request.parameters.viewId !== this.config.viewId)
      throw Error("ZMQ_VIEW_COMMAND_IDENTITY_INVALID");
    return request;
  }
  async query(command: WireCommand): Promise<ViewReply> {
    const request = this.request(command);
    return validateViewReply(
      (await this.call(`/v1/commands/${encodeURIComponent(request.requestId)}`)).value,
      request,
      sha256(canonical(request)),
    );
  }
  async dispatch(command: WireCommand, permit: () => void): Promise<DispatchResult> {
    const started = performance.now();
    const facts: TransportDiagnostic = {
      schemaVersion: "ugv.zmq-command-diagnostic/1",
      stage: "guard",
      code: "ZMQ_DISPATCH_REVOKED",
      elapsedMs: 0,
      sendTimeoutMs: this.config.exchangeTimeoutMs,
      receiveTimeoutMs: this.config.exchangeTimeoutMs,
      sendAttempted: false,
      sendCompleted: false,
      sendCompletedAfterMs: null,
      receiveCompletedAfterMs: null,
      nativeErrorCode: null,
      validationCode: null,
      response: null,
    };
    try {
      const request = this.request(command);
      await this.check(request.resourceId);
      permit();
      const remaining = Date.parse(request.deadlineAt) - Date.now();
      if (remaining <= 0) throw Error("ZMQ_VIEW_DEADLINE_EXPIRED");
      facts.stage = "dispatch";
      facts.sendAttempted = true;
      facts.sendCompleted = null;
      const received = await this.call(
        "/v1/commands",
        canonical(request),
        Math.min(remaining, this.config.exchangeTimeoutMs),
      );
      facts.sendCompleted = true;
      facts.receiveCompletedAfterMs = performance.now() - started;
      facts.response = { frameCount: 1, bytes: received.bytes, frameSha256: [received.sha256] };
      facts.stage = "validate";
      const reply = validateViewReply(received.value, request, sha256(canonical(request)));
      facts.stage = "complete";
      facts.code = reply.status === "rejected" ? "ZMQ_REQUEST_REJECTED" : "ZMQ_REQUEST_ACCEPTED";
      return {
        outcome:
          reply.status === "rejected"
            ? "rejected"
            : reply.status === "unknown"
              ? "uncertain"
              : "accepted",
        response: {
          viewReply: reply,
          ok: reply.status !== "rejected",
          error: reply.status === "rejected" ? { code: reply.reasonCode } : null,
        },
        diagnostic: { ...facts, elapsedMs: performance.now() - started },
      };
    } catch (error) {
      facts.nativeErrorCode = safeFailureCode(error);
      facts.code =
        facts.stage === "guard"
          ? "ZMQ_DISPATCH_REVOKED"
          : facts.stage === "validate"
            ? "ZMQ_VIEW_RESPONSE_INVALID"
            : "ZMQ_VIEW_EXCHANGE_UNCONFIRMED";
      return {
        outcome: "uncertain",
        response: null,
        diagnostic: { ...facts, elapsedMs: performance.now() - started },
      };
    }
  }
}
