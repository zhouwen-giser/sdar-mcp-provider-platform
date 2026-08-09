import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { HomeAssistantState } from "../../apps/home-assistant-light-provider/src/types.js";

export class FakeHomeAssistantLight {
  readonly token = "fake-light-secret";
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
    const server = createServer((request, response) => void this.#handle(request, response));
    const ws = new WebSocketServer({ noServer: true });
    server.on("upgrade", (request, socket, head) => {
      if (request.url !== "/api/websocket") {
        socket.destroy();
        return;
      }
      ws.handleUpgrade(request, socket, head, (client) => ws.emit("connection", client, request));
    });
    ws.on("connection", (client) => {
      this.#clients.add(client);
      client.send(JSON.stringify({ type: "auth_required" }));
      client.on("message", (raw) => {
        const message = JSON.parse(Buffer.from(raw as Uint8Array).toString("utf8")) as Record<
          string,
          unknown
        >;
        if (message.type === "auth")
          client.send(
            JSON.stringify(
              message.access_token === this.token ? { type: "auth_ok" } : { type: "auth_invalid" },
            ),
          );
        if (message.type === "subscribe_events")
          client.send(
            JSON.stringify({ id: message.id, type: "result", success: true, result: null }),
          );
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
    for (const client of this.#clients) client.terminate();
    this.#ws?.close();
    if (this.#server !== undefined)
      await new Promise<void>((resolve) => this.#server?.close(() => resolve()));
  }
  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers.authorization !== `Bearer ${this.token}`) {
      json(response, 401, { message: "unauthorized" });
      return;
    }
    if (this.statusOverride !== undefined) {
      json(response, this.statusOverride, { message: "injected" });
      return;
    }
    if (request.method === "GET" && request.url === "/api/") {
      json(response, 200, { message: "API running" });
      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/api/states/") === true) {
      const state = this.#states.get(decodeURIComponent(request.url.slice(12)));
      if (state === undefined) json(response, 404, {});
      else json(response, 200, state);
      return;
    }
    const match = /^\/api\/services\/light\/(turn_on|turn_off)$/.exec(request.url ?? "");
    if (request.method === "POST" && match?.[1] !== undefined) {
      const data = await body(request);
      this.serviceCalls.push({ service: match[1], data });
      json(response, 200, []);
      if (!this.suppressChanges)
        setTimeout(() => this.#apply(match[1] ?? "", data), this.applyDelayMs);
      return;
    }
    json(response, 404, {});
  }
  #apply(service: string, data: Record<string, unknown>): void {
    const entity = typeof data.entity_id === "string" ? data.entity_id : "";
    const old = this.#states.get(entity);
    if (old === undefined) return;
    const now = new Date().toISOString();
    const brightness =
      typeof data.brightness_pct === "number"
        ? Math.round((data.brightness_pct * 255) / 100)
        : old.attributes.brightness;
    const next = {
      ...old,
      state: service === "turn_off" ? "off" : "on",
      attributes: { ...old.attributes, ...(brightness === undefined ? {} : { brightness }) },
      last_changed: now,
      last_updated: now,
    };
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
    for (const client of this.#clients)
      if (client.readyState === client.OPEN) client.send(JSON.stringify(event));
  }
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
