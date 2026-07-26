import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { HomeAssistantState } from "../../apps/home-assistant-climate-provider/src/types.js";
export class FakeHomeAssistantClimate {
  readonly token = "fake-climate-secret";
  readonly serviceCalls: { service: string; data: Record<string, unknown> }[] = [];
  readonly #states = new Map<string, HomeAssistantState>();
  readonly #clients = new Set<WebSocket>();
  #server: Server | undefined;
  #ws: WebSocketServer | undefined;
  url = "";
  applyDelayMs = 0;
  suppressChanges = false;
  statusOverride: number | undefined;
  setState(entity: string, state: string, attributes: Record<string, unknown>): void {
    const now = new Date().toISOString();
    this.#states.set(entity, {
      entity_id: entity,
      state,
      attributes,
      last_changed: now,
      last_updated: now,
    });
  }
  async start(): Promise<void> {
    const server = createServer((q, s) => void this.#handle(q, s));
    const ws = new WebSocketServer({ noServer: true });
    server.on("upgrade", (q, s, h) => {
      if (q.url !== "/api/websocket") {
        s.destroy();
        return;
      }
      ws.handleUpgrade(q, s, h, (c) => ws.emit("connection", c, q));
    });
    ws.on("connection", (client) => {
      this.#clients.add(client);
      client.send(JSON.stringify({ type: "auth_required" }));
      client.on("message", (raw) => {
        const m = JSON.parse(Buffer.from(raw as Uint8Array).toString("utf8")) as Record<
          string,
          unknown
        >;
        if (m.type === "auth")
          client.send(
            JSON.stringify(
              m.access_token === this.token ? { type: "auth_ok" } : { type: "auth_invalid" },
            ),
          );
        if (m.type === "subscribe_events")
          client.send(JSON.stringify({ id: m.id, type: "result", success: true, result: null }));
      });
      client.on("close", () => this.#clients.delete(client));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("FAKE_HA_BIND_FAILED");
    this.url = `http://127.0.0.1:${String(address.port)}`;
    this.#server = server;
    this.#ws = ws;
  }
  async close(): Promise<void> {
    for (const c of this.#clients) c.terminate();
    this.#ws?.close();
    if (this.#server !== undefined)
      await new Promise<void>((resolve) => this.#server?.close(() => resolve()));
  }
  async #handle(q: IncomingMessage, s: ServerResponse): Promise<void> {
    if (q.headers.authorization !== `Bearer ${this.token}`) {
      json(s, 401, { message: "unauthorized" });
      return;
    }
    if (this.statusOverride !== undefined) {
      json(s, this.statusOverride, { message: "injected" });
      return;
    }
    if (q.method === "GET" && q.url === "/api/") {
      json(s, 200, { message: "API running" });
      return;
    }
    if (q.method === "GET" && q.url?.startsWith("/api/states/") === true) {
      const state = this.#states.get(decodeURIComponent(q.url.slice(12)));
      if (state === undefined) json(s, 404, {});
      else json(s, 200, state);
      return;
    }
    const match =
      /^\/api\/services\/climate\/(turn_on|turn_off|set_hvac_mode|set_temperature)$/.exec(
        q.url ?? "",
      );
    if (q.method === "POST" && match?.[1] !== undefined) {
      const data = await body(q);
      this.serviceCalls.push({ service: match[1], data });
      json(s, 200, []);
      if (!this.suppressChanges)
        setTimeout(() => this.#apply(match[1] ?? "", data), this.applyDelayMs);
      return;
    }
    json(s, 404, {});
  }
  #apply(service: string, data: Record<string, unknown>): void {
    const entity = typeof data.entity_id === "string" ? data.entity_id : "";
    const old = this.#states.get(entity);
    if (old === undefined) return;
    const now = new Date().toISOString();
    const configuredModes = old.attributes.hvac_modes;
    const firstMode =
      Array.isArray(configuredModes) && typeof configuredModes[0] === "string"
        ? configuredModes[0]
        : "cool";
    const state =
      service === "turn_off"
        ? "off"
        : service === "set_hvac_mode" && typeof data.hvac_mode === "string"
          ? data.hvac_mode
          : service === "turn_on" && old.state === "off"
            ? firstMode
            : old.state;
    const attributes = {
      ...old.attributes,
      ...(typeof data.temperature === "number" ? { temperature: data.temperature } : {}),
    };
    const next = { ...old, state, attributes, last_changed: now, last_updated: now };
    this.#states.set(entity, next);
    const event = {
      id: 1,
      type: "event",
      event: {
        event_type: "state_changed",
        data: { entity_id: entity, old_state: old, new_state: next },
        time_fired: now,
      },
    };
    for (const c of this.#clients) if (c.readyState === c.OPEN) c.send(JSON.stringify(event));
  }
}
function json(s: ServerResponse, status: number, v: unknown): void {
  s.writeHead(status, { "content-type": "application/json" });
  s.end(JSON.stringify(v));
}
async function body(q: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of q) chunks.push(Buffer.from(c as Uint8Array));
  const v: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
