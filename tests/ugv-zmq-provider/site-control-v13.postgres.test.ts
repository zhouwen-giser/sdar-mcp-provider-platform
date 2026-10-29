import { businessSnapshot } from "../../apps/ugv-control-console/server/business.js";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { controlSiteFixture } from "./site-control-fixture.js";
import { until } from "../ugv-zmq-control-postgres/harness.js";
import { nativeCatalogReason } from "../../apps/ugv-control-console/shared/zmq-native.js";
import { array, record, type Tool } from "../../apps/ugv-control-console/shared/model.js";
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
  it("exposes action-specific refusal and blocks direct MCP admission without any device request", async () => {
    const settings = f.provider.engine.scope.settings;
    if (!settings.operationSupport) throw Error("FIXTURE_OPERATION_SUPPORT_REQUIRED");
    const before = settings.operationSupport["camera.zoom"];
    settings.operationSupport["camera.zoom"] = {
      status: "unsupported",
      reasonCode: "ZMQ_OPTICAL_ZOOM_UNSUPPORTED",
      description: "仿真镜头没有光学停止反馈",
      evidenceRef: "SIMULATED:negative-case",
    };
    try {
      const capabilities = record(
        (await f.mcp.tool("vehicle_get_capabilities", { resourceId: f.resourceId }))
          .structuredContent,
      );
      expect(
        array(capabilities.operationSupport)
          .map(record)
          .find((x) => x.operation === "camera.zoom"),
      ).toMatchObject({
        status: "unsupported",
        available: false,
        reasonCode: "ZMQ_OPTICAL_ZOOM_UNSUPPORTED",
      });
      const args = {
        resourceId: f.resourceId,
        operation: { name: "camera.zoom", params: { zoom_ratio: 2, zoom_timeout_ms: 1000 } },
      };
      const timing = { start: { mode: "immediate", startToleranceMs: 60000 }, maxElapsedMs: 10000 };
      const checked = await f.mcp.rpc("io.sdar/taskExecution/checkAvailability", {
        profileVersion: "1.0",
        checks: [
          {
            requestId: randomUUID(),
            operationName: "vehicle_zmq_camera",
            arguments: { state: "complete", value: args },
            timing,
          },
        ],
      });
      expect(array(checked.results).map(record)[0]).toMatchObject({
        availability: "disabled",
        reasonCode: "ZMQ_OPTICAL_ZOOM_UNSUPPORTED",
      });
      const count = f.devices.commands.length;
      const direct = await f.mcp.open(
        "tools/call",
        {
          name: "vehicle_zmq_camera",
          arguments: args,
          _meta: {
            "io.sdar/taskExecution": {
              profileVersion: "1.0",
              idempotencyKey: randomUUID(),
              timing,
            },
          },
        },
        AbortSignal.timeout(10000),
      );
      const envelope = (await direct.json()) as {
        result?: Record<string, unknown>;
        error?: { data?: Record<string, unknown> };
      };
      // Public MCP rejection is an execution admission result, with no native dispatch.
      expect(JSON.stringify(envelope)).toContain("ZMQ_OPTICAL_ZOOM_UNSUPPORTED");
      expect(f.devices.commands.length).toBe(count);
      expect(
        f.provider.engine.availability({
          name: "camera.position",
          params: { yaw_rad: 0, pitch_rad: 0, move_timeout_ms: 1000 },
        }).available,
      ).toBe(true);
    } finally {
      if (before) settings.operationSupport["camera.zoom"] = before;
      else delete settings.operationSupport["camera.zoom"];
    }
  });
  it("stores successful exchange stages in real PostgreSQL and retains them after provider restart", async () => {
    const accepted = await f.mcp.rpc("tools/call", {
      name: "vehicle_zmq_camera",
      arguments: {
        resourceId: f.resourceId,
        operation: {
          name: "camera.position",
          params: { yaw_rad: 0.2, pitch_rad: 0, move_timeout_ms: 1000 },
        },
      },
      _meta: {
        "io.sdar/taskExecution": {
          profileVersion: "1.0",
          idempotencyKey: randomUUID(),
          timing: { start: { mode: "immediate", startToleranceMs: 60000 }, maxElapsedMs: 10000 },
        },
      },
    });
    const taskId = String(accepted.taskId);
    await until(async () => (await f.mcp.rpc("tasks/get", { taskId })).status === "completed");
    const query = `SELECT payload->'zmqControl'->'commands' AS commands FROM ${f.schemas[0]}.ugv_execution WHERE task_id=$1`;
    const before = await f.admin.query<{ commands: Record<string, unknown>[] }>(query, [taskId]);
    const diagnostic = record(before.rows[0]?.commands[0]?.diagnostic);
    expect(diagnostic).toMatchObject({
      stage: "complete",
      code: "ZMQ_REQUEST_ACCEPTED",
      sendCompleted: true,
      receiveTimeoutMs: 2000,
    });
    expect(record(diagnostic.response).frameSha256).toHaveLength(1);
    const business = await businessSnapshot(f.mcp, taskId);
    const diagnostics = array(
      record(record(business.context.summary).properties).commandDiagnostics,
    ).map(record);
    expect(diagnostics[0]).toMatchObject({
      diagnostic: { stage: "complete", code: "ZMQ_REQUEST_ACCEPTED" },
    });
    await f.restartProvider();
    const after = await f.admin.query<{ commands: Record<string, unknown>[] }>(query, [taskId]);
    expect(after.rows).toEqual(before.rows);
    const retained = await f.mcp.rpc("tasks/get", { taskId });
    expect(retained.status).toBe("completed");
  }, 30000);
  it("persists a lost REP stage even when later correlated physical feedback resolves the action, with no replay", async () => {
    const settings = f.providerOptions.controlSettings;
    const previousReceive = settings.transportReceiveTimeoutMs;
    settings.transportReceiveTimeoutMs = 100;
    await f.restartProvider();
    try {
      await until(
        () =>
          f.provider.engine.availability({
            name: "camera.position",
            params: { yaw_rad: 0.3, pitch_rad: 0, move_timeout_ms: 1000 },
          }).available,
      );
      f.devices.replyDelayMs = 350;
      const accepted = await f.mcp.rpc("tools/call", {
        name: "vehicle_zmq_camera",
        arguments: {
          resourceId: f.resourceId,
          operation: {
            name: "camera.position",
            params: { yaw_rad: 0.3, pitch_rad: 0, move_timeout_ms: 1000 },
          },
        },
        _meta: {
          "io.sdar/taskExecution": {
            profileVersion: "1.0",
            idempotencyKey: randomUUID(),
            timing: { start: { mode: "immediate", startToleranceMs: 60000 }, maxElapsedMs: 10000 },
          },
        },
      });
      const taskId = String(accepted.taskId);
      await until(async () => (await f.mcp.rpc("tasks/get", { taskId })).status === "completed");
      const query = `SELECT payload->'zmqControl'->'commands' AS commands FROM ${f.schemas[0]}.ugv_execution WHERE task_id=$1`;
      const before = await f.admin.query<{ commands: Record<string, unknown>[] }>(query, [taskId]);
      const command = record(before.rows[0]?.commands[0]);
      expect(command).toMatchObject({
        status: "uncertain",
        response: null,
        diagnostic: {
          stage: "receive",
          code: "ZMQ_RECEIVE_TIMEOUT",
          nativeErrorCode: "EAGAIN",
          sendCompleted: true,
        },
      });
      expect(
        f.devices.commands.filter((c) => c.request.request_id === command.requestId),
      ).toHaveLength(1);
      const business = await businessSnapshot(f.mcp, taskId);
      const diagnostics = array(
        record(record(business.context.summary).properties).commandDiagnostics,
      ).map(record);
      expect(diagnostics[0]).toMatchObject({
        diagnostic: { stage: "receive", code: "ZMQ_RECEIVE_TIMEOUT" },
      });
      f.devices.replyDelayMs = 0;
      settings.transportReceiveTimeoutMs = previousReceive;
      await f.restartProvider();
      const after = await f.admin.query<{ commands: Record<string, unknown>[] }>(query, [taskId]);
      expect(after.rows).toEqual(before.rows);
      expect(
        f.devices.commands.filter((c) => c.request.request_id === command.requestId),
      ).toHaveLength(1);
    } finally {
      f.devices.replyDelayMs = 0;
      settings.transportReceiveTimeoutMs = previousReceive;
    }
  }, 30000);
});
