import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import {
  UGV_DEVICE_TOOL_ALLOWLIST,
  type UgvDeviceToolName,
} from "../../../packages/vehicle-device-mcp-client/src/index.js";

const port = Number(process.env.MOCK_UGV_DEVICE_MCP_PORT ?? 19000);
const missingTool = process.env.MOCK_UGV_MISSING_TOOL ?? "";
const failureMode = process.env.MOCK_UGV_FAILURE_MODE ?? "none";
const state = {
  mission: { id: 1001, state: 0, progress: 0 },
  reconnaissance: { id: 2001, status: 1, progress: 0 },
  weapon: { id: 4001, state: 0, progress: 0 },
  gimbal: { id: 3001, state: 0, progress: 0 },
  lockedTargetId: 101,
};

function server(): McpServer {
  const instance = new McpServer({ name: "mock-ugv-device-mcp", version: "1.0.0" });
  for (const name of UGV_DEVICE_TOOL_ALLOWLIST) {
    if (name === missingTool) continue;
    const inputSchema = mockInputSchema(name);
    instance.registerTool(
      name,
      { description: `Mock-only UGV fixture tool ${name}.`, inputSchema },
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
    state.mission.id = suppliedMissionId(args, state.mission.id);
    state.mission.state = 0;
    state.mission.progress = 0;
    return common(state.mission.id, 0, "mission accepted");
  }
  if (name === "ugv_mission_control") {
    state.mission.id = suppliedMissionId(args, state.mission.id);
    const action = args.action;
    state.mission.state =
      action === "pause"
        ? 2
        : action === "start"
          ? 1
          : action === "terminate"
            ? 3
            : state.mission.state;
    return common(state.mission.id, state.mission.state, `mission ${String(action)}`);
  }
  if (name === "ugv_motion_stop") {
    state.mission.state = 3;
    return common(state.mission.id, 3, "motion stopped");
  }
  if (name === "ugv_area_recon_configure") {
    state.reconnaissance.id = suppliedMissionId(args, state.reconnaissance.id);
    return {
      ...common(state.reconnaissance.id, 0, "recon configured"),
      res: true,
      fail_data: "",
      coverability: {
        coverable: "full",
        coverable_label: "full",
        region_min_dist_m: 1,
        region_max_dist_m: 10,
        detection_range_m: 100,
      },
    };
  }
  if (name === "ugv_area_recon_control") {
    state.reconnaissance.id = suppliedMissionId(args, state.reconnaissance.id);
    const command = Number(args.cmd_type);
    state.reconnaissance.status = command === 1 || command === 3 ? 5 : command === 2 ? 8 : 9;
    return {
      ...common(state.reconnaissance.id, command === 4 ? 3 : 1, `recon command ${command}`),
      cmd_res: 0,
      fail_data: "",
    };
  }
  if (name === "ugv_area_recon_lock") {
    state.reconnaissance.id = suppliedMissionId(args, state.reconnaissance.id);
    state.lockedTargetId = args.lock === true ? numeric(args.target_id, 101) : 0;
    return {
      ...common(
        state.reconnaissance.id,
        1,
        args.lock === true ? "target locked" : "target unlocked",
      ),
      cmd_res: 0,
      fail_data: "",
    };
  }
  if (name === "ugv_area_recon_get_status")
    return {
      status: state.reconnaissance.status,
      status_label: "mock",
      scan_mode: 1,
      scan_mode_label: "area",
      scan_pitch: 0,
      out_of_range: false,
      camera_fault: false,
      scan_num: 1,
      progress: state.reconnaissance.progress,
      coverage: state.reconnaissance.progress,
      work_mode: 1,
      recon_type: 1,
      load_status: 1,
      load_status_label: "normal",
      lock: {
        stage: state.lockedTargetId > 0 ? 3 : 1,
        target_id: state.lockedTargetId,
        role_name: state.lockedTargetId > 0 ? "target-vehicle" : "",
        duration_sec: 0,
      },
      attack_ready: state.lockedTargetId > 0,
      online: true,
      gimbal: { yaw: 0, pitch: 0, zoom: 1 },
    };
  if (name === "ugv_area_recon_get_targets")
    return {
      targets: [
        {
          capture_time_us: 1_786_320_000_000_000,
          target_id: 101,
          type: 3,
          position: { longitude: 114.2, latitude: 30.2, altitude: 0 },
          velocity: { vel_e: 0, vel_n: 0, vel_u: 0 },
          distance: 20,
          confidence: 0.9,
          threat: 1,
          iff: 0,
          lock_time: 0,
          pixel_pos: { x: 100, y: 100, theta: 0, w: 20, h: 20 },
          role_name: "target-vehicle",
        },
      ],
    };
  if (name === "ugv_laser_range") return { distance_m: 120.5, valid: true };
  if (name === "ugv_area_recon_attack_confirm") {
    state.weapon.id = suppliedMissionId(args, state.weapon.id);
    state.weapon.state = 4;
    state.weapon.progress = 100;
    return { ...common(state.weapon.id, 4, "fire cycle accepted"), cmd_res: 0, fail_data: "" };
  }
  if (name === "get_status")
    return {
      available: true,
      heading: 0,
      veh_speed: 0,
      chassis_task: state.mission,
      eo_task: state.gimbal,
      weapon_task: state.weapon,
      gimbal: { yaw: 0, pitch: 0, zoom: 1 },
    };
  if (name === "get_capabilities")
    return {
      execution_mode: "simulation",
      sensors: { gnss: true, electro_optical: true },
      max_speed_kmh: 25,
    };
  if (name === "ugv_gimbal_move") {
    state.gimbal.id = suppliedMissionId(args, state.gimbal.id);
    state.gimbal.state = 0;
    return common(state.gimbal.id, 0, "gimbal accepted");
  }
  if (name === "ugv_area_recon_reset") {
    state.reconnaissance.status = 1;
    return { ...common(state.reconnaissance.id, 4, "recon reset"), cmd_res: 0, fail_data: "" };
  }
  return common(0, 4, "mock command completed");
}

function mockInputSchema(name: UgvDeviceToolName): z.ZodType<Record<string, unknown>> {
  const missionId = z.number().int().nonnegative().default(0);
  const point = z.object({
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-90).max(90),
    altitude: z.number().default(0),
  });
  if (name === "ugv_path_follow_mission")
    return z.object({
      task_points: z.array(point).nullable().default(null),
      json_url: z.string().default(""),
      need_plan: z.boolean().nullable().default(null),
      density: z.string().default("adaptive"),
      mission_id: missionId,
    });
  if (name === "ugv_return_home" || name === "ugv_area_recon_reset")
    return z.object({ mission_id: missionId });
  if (name === "ugv_move_distance")
    return z.object({
      direction: z.string(),
      distance: z.number(),
      mission_id: missionId,
    });
  if (name === "ugv_mission_control")
    return z.object({ action: z.string(), mission_id: missionId });
  if (name === "ugv_area_recon_configure")
    return z.object({
      region_points: z.array(point).nullable().default(null),
      region_type: z.number().int().default(5),
      target_types: z.array(z.number().int()).nullable().default(null),
      scan_num: z.number().int().default(0),
      lock_duration_limit: z.number().int().default(0),
      recon_type: z.number().int().default(1),
      scan_speed: z.number().default(30),
      scan_mode: z.number().int().default(1),
      scan_pitch: z.number().default(0),
      mission_id: missionId,
    });
  if (name === "ugv_area_recon_control")
    return z.object({ cmd_type: z.number().int(), mission_id: missionId });
  if (name === "ugv_area_recon_lock")
    return z.object({
      lock: z.boolean(),
      target_id: z.number().int().default(0),
      mission_id: missionId,
    });
  if (name === "ugv_area_recon_attack_confirm")
    return z.object({ confirm: z.number().int(), mission_id: missionId });
  if (name === "ugv_gimbal_move")
    return z.object({
      mode: z.string(),
      yaw: z.number().default(0),
      pitch: z.number().default(0),
      yaw_speed: z.number().default(30),
      pitch_speed: z.number().default(30),
      delta_zoom: z.number().default(0),
      mission_id: missionId,
    });
  return z.object({});
}

function common(missionId: number, missionState: number, message: string) {
  const labels = ["not_started", "running", "paused", "terminated", "finished", "failed"];
  return {
    mission_id: missionId,
    state: missionState,
    state_label: labels[missionState] ?? "unknown",
    message,
    error_code: 0,
  };
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

function numeric(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  return fallback;
}

function suppliedMissionId(args: Record<string, unknown>, fallback: number): number {
  const missionId = numeric(args.mission_id, fallback);
  return missionId > 0 ? missionId : fallback;
}
