import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { UGV_DEVICE_TOOL_ALLOWLIST } from "../../../packages/vehicle-device-mcp-client/src/index.js";

const port = Number(process.env.MOCK_UGV_DEVICE_MCP_PORT ?? 19000);
const missingTool = process.env.MOCK_UGV_MISSING_TOOL ?? "";
const failureMode = process.env.MOCK_UGV_FAILURE_MODE ?? "none";
const state = {
  mission: { id: "mock-mission-1", state: -1, progress: 0 },
  reconnaissance: { id: "mock-recon-1", state: -1, progress: 0 },
  weapon: { id: "mock-fire-1", state: -1, progress: 0 },
  lockedTargetId: "target-1",
};

function server(): McpServer {
  const instance = new McpServer({ name: "mock-ugv-device-mcp", version: "1.0.0" });
  for (const name of UGV_DEVICE_TOOL_ALLOWLIST) {
    if (name === missingTool) continue;
    instance.registerTool(
      name,
      { description: `Mock-only UGV fixture tool ${name}.`, inputSchema: {} },
      async (args) => {
        if (failureMode === `timeout:${name}`)
          await new Promise((resolve) => setTimeout(resolve, 120_000));
        if (failureMode === `fail:${name}`) throw new Error("MOCK_UGV_TOOL_FAILURE");
        const result = call(name, args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    );
  }
  return instance;
}

function call(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (["ugv_path_follow_mission", "ugv_return_home", "ugv_move_distance"].includes(name)) {
    state.mission.state = 0;
    state.mission.progress = 0;
    return { accepted: true, mission_id: state.mission.id };
  }
  if (name === "ugv_mission_control") {
    const action = args.action;
    state.mission.state =
      action === "pause"
        ? 2
        : action === "resume"
          ? 1
          : action === "cancel" || action === "stop"
            ? 3
            : state.mission.state;
    return { accepted: true, action };
  }
  if (name === "ugv_stop") {
    state.mission.state = 3;
    return { accepted: true, stopped: true };
  }
  if (name === "ugv_area_recon_configure")
    return { accepted: true, mission_id: state.reconnaissance.id };
  if (name === "ugv_area_recon_control") {
    const command = Number(args.command);
    state.reconnaissance.state = command === 1 || command === 3 ? 1 : command === 2 ? 2 : 3;
    return { accepted: true, command };
  }
  if (name === "ugv_area_recon_lock") {
    state.lockedTargetId = scalarText(args.target_id, "target-1");
    return { accepted: true, locked_target_id: state.lockedTargetId };
  }
  if (name === "ugv_area_recon_unlock") {
    state.lockedTargetId = "";
    return { accepted: true };
  }
  if (name === "ugv_area_recon_get_status")
    return {
      online: true,
      gimbal: { yaw: 0, pitch: 0, zoom: 1 },
      reconnaissance: state.reconnaissance,
      weapon: state.weapon,
      locked_target_id: state.lockedTargetId,
      attack_ready: state.lockedTargetId.length > 0,
    };
  if (name === "ugv_area_recon_get_targets")
    return {
      targets: [{ targetId: "target-1", objectType: "tank", position: { x: 1, y: 2, z: 0 } }],
    };
  if (name === "ugv_area_recon_get_exceptions") return { exceptions: [] };
  if (name === "ugv_laser_range") return { distance_m: 120.5, valid: true };
  if (name === "ugv_attack_target") {
    state.weapon.state = 0;
    return { accepted: true, destroyed: true, damage: 100, remaining_hp: 0 };
  }
  if (name === "ugv_area_recon_attack_confirm") {
    state.weapon.state = 4;
    state.weapon.progress = 100;
    return { accepted: true, hit: true };
  }
  if (name === "ugv_get_capabilities")
    return { execution_mode: "simulation", local_fire_control: true };
  return { accepted: true };
}

const http = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ready" }));
    return;
  }
  if (url.pathname !== "/mcp" || request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }
  const instance = server();
  const transport = new StreamableHTTPServerTransport();
  try {
    const body = await jsonBody(request);
    await instance.connect(transport as unknown as Transport);
    await transport.handleRequest(request, response, body);
  } catch {
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Mock UGV MCP failure" },
          id: null,
        }),
      );
    }
  } finally {
    response.on("close", () => {
      void transport.close();
      void instance.close();
    });
  }
});
http.listen(port, "0.0.0.0");

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buffer.length;
    if (bytes > 1_048_576) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function scalarText(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}
