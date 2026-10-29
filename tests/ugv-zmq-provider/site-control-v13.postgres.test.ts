import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { controlSiteFixture } from "./site-control-fixture.js";
import { until } from "../ugv-zmq-control-postgres/harness.js";
import { nativeCatalogReason } from "../../apps/ugv-control-console/shared/zmq-native.js";
import { record, type Tool } from "../../apps/ugv-control-console/shared/model.js";
let f: Awaited<ReturnType<typeof controlSiteFixture>>;
const file = process.env.SMPP_ZMQ_TEST_CONFIG_FILE;
describe.skipIf(!file)("1.3.0 anonymous real PostgreSQL / MCP / native ZMQ", () => {
  beforeAll(async () => {
    const config = JSON.parse(readFileSync(file ?? "", "utf8")) as { databaseUrl: string };
    f = await controlSiteFixture(
      config.databaseUrl,
      "site_anonymous",
      "zmq_v1_3_0_site_control_13",
    );
    delete f.mcp.headers.authorization;
    await until(
      () =>
        f.provider.engine.availability({
          name: "camera.zoom",
          params: { zoom_ratio: 2, zoom_timeout_ms: 1000 },
        }).available,
    );
  }, 30000);
  afterAll(async () => {
    await f?.close();
  });
  it("discovers only the exact new catalog", async () => {
    const list = await f.mcp.rpc("tools/list");
    expect(nativeCatalogReason(list.tools as Tool[], f.resourceId)).toBeNull();
    expect(record((list.tools as Tool[])[0]?._meta?.["io.sdar/ugvZmq"]).catalogProfile).toBe(
      "zmq_v1_3_0_site_control_13",
    );
  });
  it("persists requested/default/effective heights, deduplicates and restores the report after restart", async () => {
    const args = {
      resourceId: f.resourceId,
      area: {
        crs: "OGC:CRS84",
        searchStrategy: "recognize",
        vertices: [
          { longitude: 106, latitude: 29 },
          { longitude: 106.001, latitude: 29 },
          { longitude: 106.001, latitude: 29.001 },
          { longitude: 106, latitude: 29.001 },
        ],
      },
    };
    const request = {
      name: "vehicle_zmq_inspect_area",
      arguments: args,
      _meta: {
        "io.sdar/taskExecution": {
          profileVersion: "1.0",
          idempotencyKey: randomUUID(),
          timing: { start: { mode: "immediate", startToleranceMs: 60000 }, maxElapsedMs: 10000 },
        },
      },
    };
    const accepted = await f.mcp.rpc("tools/call", request),
      id = String(accepted.taskId);
    await f.mcp.rpc("tools/call", request);
    await until(() => f.devices.taskState === "searching");
    f.devices.completeRecon();
    await until(
      async () => (await f.mcp.rpc("tasks/get", { taskId: id })).status === "completed",
      15000,
    );
    const task = await f.mcp.rpc("tasks/get", { taskId: id });
    const result = record(record(task.result).structuredContent),
      resolution = record(result.parameterResolution);
    expect(resolution.policy).toBe("missing_height_zero");
    expect(resolution.requestedArguments).toEqual(args);
    expect(resolution.vertices).toEqual(
      [0, 1, 2, 3].map((index) => ({ index, source: "default_zero", ellipsoidHeightM: 0 })),
    );
    expect(f.devices.commands.filter((c) => c.request.method === "AreaSearch")).toHaveLength(1);
    await f.restartProvider();
    const retained = await f.mcp.rpc("tasks/get", { taskId: id });
    expect(record(record(retained.result).structuredContent).parameterResolution).toEqual(
      resolution,
    );
  }, 30000);
});
