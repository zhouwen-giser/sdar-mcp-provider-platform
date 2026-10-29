import { performance } from "node:perf_hooks";
import { Publisher, Request } from "zeromq";
import { parseResponse } from "../../vehicle-zmq-contract/src/index.js";
import { controlScope, type ControlScope, type WireCommand } from "./model.js";
import {
  exchangeTimeouts,
  failureDiagnostic,
  responseEvidence,
  type ExchangeStage,
  type TransportDiagnostic,
} from "./transport-diagnostics.js";

export interface DispatchResult {
  outcome: "accepted" | "rejected" | "sent_unconfirmed" | "uncertain";
  response: Record<string, unknown> | null;
  diagnostic?: TransportDiagnostic;
}
export interface CommandTransport {
  prepare?(): void;
  dispatch(command: WireCommand, permit: () => void): Promise<DispatchResult>;
  close(): void;
}
/** One bounded exchange per REQ socket. No action retry or relaxed REQ mode. */
export class NativeControlTransport implements CommandTransport {
  #publisher: Publisher | undefined;
  readonly #requests = new Map<string, Request>();
  #closed = false;
  readonly #busy = new Set<string>();
  #publisherConnected = false;
  readonly scope: ControlScope;
  constructor(scope: ControlScope) {
    this.scope = controlScope(scope.profile, scope.settings);
    if (scope.settings.mode === "isolated_simulator") this.prepare();
  }
  prepare(): void {
    if (this.#closed) throw Error("ZMQ_CONTROL_TRANSPORT_CLOSED");
    if (this.#publisherConnected) return;
    this.#publisher = new Publisher({
      linger: 0,
      sendTimeout: exchangeTimeouts(this.scope.settings).sendMs,
      sendHighWaterMark: 8,
      reconnectInterval: 1000,
      reconnectMaxInterval: 5000,
    });
    this.#publisher.connect(this.scope.profile.components.chassis.commandEndpoint);
    this.#publisherConnected = true;
  }
  async dispatch(command: WireCommand, permit: () => void): Promise<DispatchResult> {
    const started = performance.now(),
      frames = command.frames.map((f) => Buffer.from(f, "base64")),
      { sendMs, receiveMs } = exchangeTimeouts(this.scope.settings);
    let stage: ExchangeStage = "connect";
    const facts = {
      schemaVersion: "ugv.zmq-command-diagnostic/1" as const,
      elapsedMs: 0,
      sendTimeoutMs: sendMs,
      receiveTimeoutMs: receiveMs,
      sendAttempted: false,
      sendCompleted: false,
      sendCompletedAfterMs: null as number | null,
      receiveCompletedAfterMs: null as number | null,
      response: null as TransportDiagnostic["response"],
    };
    const elapsed = () => Math.max(0, Math.round((performance.now() - started) * 1000) / 1000);
    const failed = (error: unknown): DispatchResult => ({
      outcome: "uncertain",
      response: null,
      diagnostic: failureDiagnostic(stage, error, { ...facts, elapsedMs: elapsed() }),
    });
    const complete = (
      outcome: DispatchResult["outcome"],
      response: Record<string, unknown> | null,
    ): DispatchResult => ({
      outcome,
      response,
      diagnostic: {
        ...facts,
        stage: "complete",
        elapsedMs: elapsed(),
        code:
          outcome === "accepted"
            ? "ZMQ_REQUEST_ACCEPTED"
            : outcome === "rejected"
              ? "ZMQ_REQUEST_REJECTED"
              : "ZMQ_PUBLISH_QUEUED_UNCONFIRMED",
        nativeErrorCode: null,
        validationCode: null,
      },
    });
    if (this.#closed) {
      stage = "guard";
      return failed(Error("ZMQ_CONTROL_TRANSPORT_CLOSED"));
    }
    if (command.component === "chassis") {
      try {
        if (!this.#publisherConnected) this.prepare();
        stage = "guard";
        permit();
        stage = "send";
        facts.sendAttempted = true;
        if (!this.#publisher) throw Error("ZMQ_PUBLISHER_NOT_PREPARED");
        await this.#publisher.send(frames);
        facts.sendCompleted = true;
        facts.sendCompletedAfterMs = elapsed();
        return complete("sent_unconfirmed", null);
      } catch (error) {
        return failed(error);
      }
    }
    if (this.#busy.has(command.component)) {
      stage = "guard";
      return failed(Error("ZMQ_REQ_EXCHANGE_ALREADY_ACTIVE"));
    }
    this.#busy.add(command.component);
    let socket: Request | undefined;
    try {
      socket = new Request({
        linger: 0,
        immediate: true,
        sendTimeout: sendMs,
        receiveTimeout: receiveMs,
        sendHighWaterMark: 1,
        receiveHighWaterMark: 1,
        maxMessageSize: 65536,
        reconnectInterval: 100,
        reconnectMaxInterval: 1000,
      });
      this.#requests.set(command.component, socket);
      socket.connect(this.scope.profile.components[command.component].commandEndpoint);
      stage = "guard";
      permit();
      stage = "send";
      facts.sendAttempted = true;
      await socket.send(frames);
      facts.sendCompleted = true;
      facts.sendCompletedAfterMs = elapsed();
      stage = "receive";
      const reply = await socket.receive();
      facts.receiveCompletedAfterMs = elapsed();
      facts.response = responseEvidence(reply);
      stage = "validate";
      const response = parseResponse(command.component, reply, {
        deviceId: this.scope.profile.components[command.component].deviceId,
        requestId: command.requestId ?? "",
        method: command.method,
      });
      return complete(response.ok ? "accepted" : "rejected", response);
    } catch (error) {
      return failed(error);
    } finally {
      socket?.close();
      this.#requests.delete(command.component);
      this.#busy.delete(command.component);
    }
  }
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#publisher?.close();
    for (const request of this.#requests.values()) request.close();
  }
}
