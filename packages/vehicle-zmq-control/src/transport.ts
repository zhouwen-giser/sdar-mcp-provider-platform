import { Publisher, Request } from "zeromq";
import { parseResponse } from "../../vehicle-zmq-contract/src/index.js";
import { controlScope, type ControlScope, type WireCommand } from "./model.js";

export interface DispatchResult {
  outcome: "accepted" | "rejected" | "sent_unconfirmed" | "uncertain";
  response: Record<string, unknown> | null;
}
export interface CommandTransport {
  dispatch(command: WireCommand, permit: () => void): Promise<DispatchResult>;
  close(): void;
}
/** One bounded exchange per REQ socket. There is no action retry or relaxed REQ mode. */
export class NativeControlTransport implements CommandTransport {
  #publisher: Publisher | undefined;
  readonly #requests = new Map<string, Request>();
  #closed = false;
  readonly #busy = new Set<string>();
  #publisherConnected = false;
  readonly scope: ControlScope;
  constructor(scope: ControlScope) {
    // Recheck at the socket boundary as well as coordinator admission.
    this.scope = controlScope(scope.profile, scope.settings);
    this.#publisher = new Publisher({
      linger: 0,
      sendTimeout: scope.settings.transportTimeoutMs,
      sendHighWaterMark: 8,
      reconnectInterval: 1000,
      reconnectMaxInterval: 5000,
    });
    this.#publisher.connect(this.scope.profile.components.chassis.commandEndpoint);
    this.#publisherConnected = true;
  }
  async dispatch(command: WireCommand, permit: () => void): Promise<DispatchResult> {
    if (this.#closed) throw Error("ZMQ_CONTROL_TRANSPORT_CLOSED");
    const frames = command.frames.map((f) => Buffer.from(f, "base64")),
      timeout = this.scope.settings.transportTimeoutMs;
    if (command.component === "chassis") {
      this.#publisher ??= new Publisher({
        linger: 0,
        sendTimeout: timeout,
        sendHighWaterMark: 8,
        reconnectInterval: 1000,
        reconnectMaxInterval: 5000,
      });
      const endpoint = this.scope.profile.components.chassis.commandEndpoint;
      if (!this.#publisherConnected) {
        this.#publisher.connect(endpoint);
        this.#publisherConnected = true;
      }
      permit();
      try {
        await this.#publisher.send(frames);
        return { outcome: "sent_unconfirmed", response: null };
      } catch {
        return { outcome: "uncertain", response: null };
      }
    }
    if (this.#busy.has(command.component)) throw Error("ZMQ_REQ_EXCHANGE_ALREADY_ACTIVE");
    this.#busy.add(command.component);
    const socket = new Request({
      linger: 0,
      immediate: true,
      sendTimeout: timeout,
      receiveTimeout: timeout,
      sendHighWaterMark: 1,
      receiveHighWaterMark: 1,
      maxMessageSize: 65536,
      reconnectInterval: 100,
      reconnectMaxInterval: 1000,
    });
    this.#requests.set(command.component, socket);
    try {
      socket.connect(this.scope.profile.components[command.component].commandEndpoint);
      permit();
      await socket.send(frames);
      const response = parseResponse(command.component, await socket.receive(), {
        deviceId: this.scope.profile.components[command.component].deviceId,
        requestId: command.requestId ?? "",
        method: command.method,
      });
      return { outcome: response.ok ? "accepted" : "rejected", response };
    } catch {
      return { outcome: "uncertain", response: null };
    } finally {
      socket.close();
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
