import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import {
  mockNpcTankToolContracts,
  NPC_TANK_DEVICE_TOOL_ALLOWLIST,
} from "../../../packages/vehicle-device-mcp-client/src/index.js";

const port = Number(process.env.MOCK_NPC_TANK_DEVICE_MCP_PORT ?? 19003);
const scenario = process.env.MOCK_NPC_TANK_SCENARIO ?? "primary";
const missingTool = process.env.MOCK_NPC_TANK_MISSING_TOOL ?? "";
const failureMode = process.env.MOCK_NPC_TANK_FAILURE_MODE ?? "none";
const state = {
  mission: { id: "mock-npc-mission-1", state: -1, progress: 0 },
  reconnaissance: { id: "mock-npc-recon-1", state: -1, progress: 0 },
  weapon: { id: "mock-npc-fire-1", state: -1, progress: 0 },
  lockedTargetId: "target-1",
  eoScanActive: false,
  eoAngle: 0,
};

function enabled(name: string): boolean {
  if (name === missingTool) return false;
  if (scenario === "fallback" && name === "npc_tank_path_follow_mission") return false;
  if (
    scenario === "no-circular" &&
    ["npc_tank_eo_scan_start", "npc_tank_eo_scan_stop", "npc_tank_eo_set_angle"].includes(name)
  )
    return false;
  return true;
}

function server(): McpServer {
  const instance = new McpServer({ name: "mock-npc-tank-device-mcp", version: "1.0.0" });
  const contracts = new Map(
    mockNpcTankToolContracts().map((contract) => [contract.name, contract]),
  );
  for (const name of NPC_TANK_DEVICE_TOOL_ALLOWLIST) {
    if (!enabled(name)) continue;
    const contract = contracts.get(name);
    if (contract === undefined) throw new Error(`MOCK_NPC_TANK_CONTRACT_MISSING ${name}`);
    instance.registerTool(
      name,
      {
        description: `Mock-only NPC Tank fixture ${name}.`,
        inputSchema: z.fromJSONSchema(contract.inputSchema),
      },
      async (args) => {
        if (failureMode === `timeout:${name}`)
          await new Promise((resolve) => setTimeout(resolve, 120_000));
        if (failureMode === `fail:${name}`) throw new Error("MOCK_NPC_TANK_TOOL_FAILURE");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                call(
                  name,
                  args !== null && typeof args === "object"
                    ? (args as Record<string, unknown>)
                    : {},
                ),
              ),
            },
          ],
        };
      },
    );
  }
  return instance;
}

function call(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (
    [
      "npc_tank_path_follow_mission",
      "npc_tank_send_waypoints",
      "npc_tank_return_home",
      "npc_tank_move_distance",
    ].includes(name)
  ) {
    state.mission.state = 0;
    state.mission.progress = 0;
    return { accepted: true, mission_id: state.mission.id };
  }
  if (name === "npc_tank_mission_control") {
    const action = args.action;
    state.mission.state =
      action === "pause"
        ? 2
        : action === "resume"
          ? 1
          : action === "cancel" || action === "terminate" || action === "stop"
            ? 3
            : state.mission.state;
    return { accepted: true, action };
  }
  if (name === "npc_tank_stop" || name === "npc_tank_cancel_mission") {
    state.mission.state = 3;
    return { accepted: true, stopped: true };
  }
  if (name === "npc_tank_area_recon_configure")
    return { accepted: true, mission_id: state.reconnaissance.id };
  if (name === "npc_tank_area_recon_control") {
    const command = Number(args.command);
    state.reconnaissance.state = command === 1 || command === 3 ? 1 : command === 2 ? 2 : 3;
    return { accepted: true, command };
  }
  if (name === "npc_tank_area_recon_lock") {
    state.lockedTargetId = scalarText(args.target_id, "target-1");
    return { accepted: true, locked_target_id: state.lockedTargetId };
  }
  if (name === "npc_tank_area_recon_unlock") {
    state.lockedTargetId = "";
    return { accepted: true };
  }
  if (name === "npc_tank_eo_scan_start") {
    state.eoScanActive = true;
    return { accepted: true, mode: "circular" };
  }
  if (name === "npc_tank_eo_scan_stop") {
    state.eoScanActive = false;
    return { accepted: true };
  }
  if (name === "npc_tank_eo_set_angle") {
    state.eoAngle = Number(args.angle ?? 0);
    return { accepted: true, angle: state.eoAngle, angle_unit: args.angle_unit ?? "deg" };
  }
  if (name === "npc_tank_area_recon_get_status")
    return {
      online: true,
      gimbal: { yaw: 0, pitch: 0, zoom: 1 },
      reconnaissance: state.reconnaissance,
      weapon: state.weapon,
      locked_target_id: state.lockedTargetId,
      attack_ready: state.lockedTargetId.length > 0,
      eo_scan_active: state.eoScanActive,
      eo_scan_mode: state.eoScanActive ? "circular" : "unknown",
      eo_angle: state.eoAngle,
      angle_unit: "deg",
    };
  if (name === "npc_tank_area_recon_get_targets")
    return {
      targets: [{ targetId: "target-1", objectType: "tank", position: { x: 1, y: 2, z: 0 } }],
    };
  if (name === "npc_tank_area_recon_get_exceptions") return { exceptions: [] };
  if (name === "npc_tank_laser_range") return { distance_m: 95.5, valid: true };
  if (name === "npc_tank_attack_target") {
    state.weapon.state = 0;
    return {
      accepted: true,
      verdict: { hit: true, destroyed: true },
      damage: 100,
      remainingHp: 0,
      referee: { alive: false },
    };
  }
  if (name === "npc_tank_area_recon_attack_confirm") {
    state.weapon.state = 4;
    state.weapon.progress = 100;
    return { accepted: true, hit: true, miss: false };
  }
  if (name === "npc_tank_get_capabilities")
    return {
      execution_mode: "simulation",
      circular_eo_scan: scenario !== "no-circular",
      local_fire_control: true,
    };
  return { accepted: true };
}

const http = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ready", scenario }));
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
          error: { code: -32603, message: "Mock NPC Tank MCP failure" },
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
