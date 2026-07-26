import { EventEmitter } from "node:events";
import WebSocket, { type RawData } from "ws";
import { z } from "zod";
import { ClimateProviderError, safeClimateError } from "./errors.js";
import type { HomeAssistantState, NormalizedClimateState } from "./types.js";

const stateSchema = z.object({
  entity_id: z.string(),
  state: z.string(),
  attributes: z.record(z.string(), z.unknown()),
  last_changed: z.string(),
  last_updated: z.string(),
});
export class HomeAssistantClimateClient {
  readonly #url: string;
  constructor(readonly options: { baseUrl: string; token: string; timeoutMs: number }) {
    this.#url = options.baseUrl.replace(/\/$/, "");
  }
  async checkApi(): Promise<void> {
    await this.#request("/api/");
  }
  async getState(entityId: string): Promise<HomeAssistantState> {
    const parsed = stateSchema.safeParse(
      await this.#request(`/api/states/${encodeURIComponent(entityId)}`),
    );
    if (!parsed.success) throw new ClimateProviderError("HOME_ASSISTANT_PROTOCOL_ERROR", false);
    return parsed.data;
  }
  async callService(
    service: "turn_on" | "turn_off" | "set_hvac_mode" | "set_temperature",
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.#request(`/api/services/climate/${service}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
  async #request(path: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(`${this.#url}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.options.token}`,
          "content-type": "application/json",
        },
      });
      if (!response.ok) throw statusError(response.status);
      const text = await response.text();
      if (!text) return {};
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new ClimateProviderError("HOME_ASSISTANT_PROTOCOL_ERROR", false);
      }
    } catch (error) {
      throw safeClimateError(error);
    } finally {
      clearTimeout(timer);
    }
  }
}
function statusError(status: number): ClimateProviderError {
  if (status === 401) return new ClimateProviderError("HOME_ASSISTANT_UNAUTHORIZED", false);
  if (status === 403) return new ClimateProviderError("HOME_ASSISTANT_FORBIDDEN", false);
  if (status === 404) return new ClimateProviderError("HOME_ASSISTANT_NOT_FOUND", false);
  if (status === 400 || status === 422)
    return new ClimateProviderError("HOME_ASSISTANT_BAD_REQUEST", false);
  return new ClimateProviderError("HOME_ASSISTANT_UNAVAILABLE", status === 429 || status >= 500);
}

export function normalizeClimateState(
  resourceId: string,
  state: HomeAssistantState,
): NormalizedClimateState {
  const modes = strings(state.attributes.hvac_modes);
  const reachable = state.state !== "unavailable" && state.state !== "unknown";
  const power =
    state.state === "off"
      ? "off"
      : state.state === "unavailable"
        ? "unavailable"
        : state.state === "unknown"
          ? "unknown"
          : "on";
  return {
    resourceId,
    power,
    reachable,
    hvacMode: reachable ? state.state : null,
    currentTemperature: number(state.attributes.current_temperature),
    targetTemperature: number(state.attributes.temperature),
    temperatureUnit:
      typeof state.attributes.temperature_unit === "string"
        ? state.attributes.temperature_unit
        : "°C",
    minTemperature: number(state.attributes.min_temp),
    maxTemperature: number(state.attributes.max_temp),
    supportedHvacModes: modes,
    observedAt: state.last_updated,
  };
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class HomeAssistantClimateWebSocket {
  readonly #events = new EventEmitter();
  #socket: WebSocket | undefined;
  #stopped = true;
  #id = 1;
  #delay: number;
  #reconnect: NodeJS.Timeout | undefined;
  constructor(
    readonly options: {
      baseUrl: string;
      token: string;
      entityIds: ReadonlySet<string>;
      reconnectMinMs: number;
      reconnectMaxMs: number;
      authTimeoutMs?: number;
    },
  ) {
    this.#delay = options.reconnectMinMs;
  }
  onState(listener: (state: HomeAssistantState) => void): () => void {
    this.#events.on("state", listener);
    return () => this.#events.off("state", listener);
  }
  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#connect();
  }
  stop(): void {
    this.#stopped = true;
    if (this.#reconnect !== undefined) clearTimeout(this.#reconnect);
    this.#socket?.close();
  }
  #connect(): void {
    if (this.#stopped) return;
    const url = new URL(this.options.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/api/websocket`;
    const socket = new WebSocket(url);
    this.#socket = socket;
    const auth = setTimeout(() => socket.terminate(), this.options.authTimeoutMs ?? 5000);
    socket.on("message", (raw) => {
      const message = parse(raw);
      if (message === undefined) return;
      if (message.type === "auth_required") {
        socket.send(JSON.stringify({ type: "auth", access_token: this.options.token }));
        return;
      }
      if (message.type === "auth_ok") {
        clearTimeout(auth);
        this.#delay = this.options.reconnectMinMs;
        socket.send(
          JSON.stringify({ id: this.#id++, type: "subscribe_events", event_type: "state_changed" }),
        );
        return;
      }
      if (message.type === "auth_invalid") {
        socket.close();
        return;
      }
      const state = eventState(message);
      if (state !== undefined && this.options.entityIds.has(state.entity_id))
        this.#events.emit("state", state);
    });
    socket.on("error", () => undefined);
    socket.on("close", () => {
      clearTimeout(auth);
      if (!this.#stopped) {
        this.#reconnect = setTimeout(() => this.#connect(), this.#delay);
        this.#delay = Math.min(this.options.reconnectMaxMs, this.#delay * 2);
      }
    });
  }
}
function parse(raw: RawData): Record<string, unknown> | undefined {
  try {
    const text =
      raw instanceof ArrayBuffer
        ? Buffer.from(raw).toString("utf8")
        : Array.isArray(raw)
          ? Buffer.concat(raw).toString("utf8")
          : Buffer.from(raw).toString("utf8");
    const value: unknown = JSON.parse(text);
    return record(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
function eventState(message: Record<string, unknown>): HomeAssistantState | undefined {
  if (
    message.type !== "event" ||
    !record(message.event) ||
    message.event.event_type !== "state_changed" ||
    !record(message.event.data)
  )
    return undefined;
  const parsed = stateSchema.safeParse(message.event.data.new_state);
  return parsed.success ? parsed.data : undefined;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
