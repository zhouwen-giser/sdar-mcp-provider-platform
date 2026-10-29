import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { controlSiteFixture } from "./site-control-fixture.js";
import { viewFixture } from "./view-fixture.js";
import { until } from "../ugv-zmq-control-postgres/harness.js";
import { nativeCatalogReason } from "../../apps/ugv-control-console/shared/zmq-native.js";
import { record, type Tool } from "../../apps/ugv-control-console/shared/model.js";
import { isZmqExecution } from "../../packages/vehicle-zmq-control/src/model.js";
import { businessSnapshot } from "../../apps/ugv-control-console/server/business.js";
const file = process.env.SMPP_ZMQ_TEST_CONFIG_FILE;
const proofs: Record<string, unknown>[] = [];
let f: Awaited<ReturnType<typeof controlSiteFixture>>,
  view: Awaited<ReturnType<typeof viewFixture>>;
const args = () => ({
  resourceId: f.resourceId,
  viewId: view.settings.viewId,
  horizontalFovDeg: 60,
  acknowledgeCameraRecreation: true,
});
const request = (maxElapsedMs = 10000) => ({
  name: "simulation_adjust_view",
  arguments: args(),
  _meta: {
    "io.sdar/taskExecution": {
      profileVersion: "1.0",
      idempotencyKey: randomUUID(),
      timing: { start: { mode: "immediate", startToleranceMs: 60000 }, maxElapsedMs },
    },
  },
});
describe.skipIf(!file)("1.4.0 PostgreSQL/MCP/project-owned simulation view", () => {
  beforeAll(async () => {
    view = await viewFixture();
    f = await controlSiteFixture(
      (JSON.parse(readFileSync(file ?? "", "utf8")) as { databaseUrl: string }).databaseUrl,
      "site_anonymous",
      "zmq_v1_4_0_site_control_14",
      view.settings,
    );
    delete f.mcp.headers.authorization;
    await until(
      () =>
        f.provider.engine.availability({
          name: "camera.simulationView",
          params: {
            viewId: view.settings.viewId,
            horizontalFovDeg: 60,
            acknowledgeCameraRecreation: true,
          },
        }).available,
    );
  }, 30000);
  afterAll(async () => {
    const output = process.env.SMPP_SIMULATION_VIEW_WIRE_EVIDENCE_FILE;
    if (output)
      writeFileSync(
        output,
        JSON.stringify(
          {
            schemaVersion: "smpp.simulation-view-software-evidence/1",
            qualification: "isolated_CARLA_API_double_real_HTTP_MCP_PostgreSQL",
            fieldAcceptance: false,
            proofs,
          },
          null,
          2,
        ) + "\n",
      );
    await f?.close();
    await view?.close();
  });
  it("exposes exactly fourteen tools and a distinct non-replayable task contract", async () => {
    const list = await f.mcp.rpc("tools/list"),
      tools = list.tools as Tool[];
    expect(tools).toHaveLength(14);
    expect(nativeCatalogReason(tools, f.resourceId)).toBeNull();
    const tool = tools.find((t) => t.name === "simulation_adjust_view");
    expect(record(tool?._meta?.["io.sdar/taskExecution"])).toMatchObject({
      taskBehavior: "task_required",
      supportsCancellation: false,
      supportsPauseResume: false,
    });
    const drift = structuredClone(tools);
    drift.pop();
    expect(nativeCatalogReason(drift, f.resourceId)).toBe("ZMQ_NATIVE_TOOL_SET_MISMATCH");
    expect(await view.count()).toBe(0);
  });
  it("applies once, returns actual FOV/new image evidence, and retains the result across restart", async () => {
    const r = request(),
      accepted = await f.mcp.rpc("tools/call", r),
      id = String(accepted.taskId);
    expect(typeof accepted.taskId).toBe("string");
    expect((await f.mcp.rpc("tools/call", r)).taskId).toBe(id);
    await until(
      async () => (await f.mcp.rpc("tasks/get", { taskId: id })).status === "completed",
      15000,
    );
    const result = record(
      record((await f.mcp.rpc("tasks/get", { taskId: id })).result).structuredContent,
    );
    expect(result).toMatchObject({
      schemaVersion: "ugv.simulation-view-result/1",
      application: "applied",
      occupancy: "released",
      eoRecognitionAffected: false,
    });
    const evidence = record(result.evidence),
      frame = record(evidence.frame);
    expect(evidence.actualHorizontalFovDeg).toBe(60);
    expect(Number(frame.frameId)).toBeGreaterThan(Number(evidence.baselineFrame));
    expect(record(frame.thumbnail).base64).toMatch(/^iVBORw0KGgo/);
    proofs.push({ scenario: "applied_once", taskId: id, result, spawns: await view.count() });
    const business = await businessSnapshot(f.mcp, id);
    expect(record(record(record(business.context).summary).properties).executionResult).toEqual(
      result,
    );
    expect(await view.count()).toBe(1);
    expect(f.devices.commands.filter((c) => c.request.method === "TeleControl")).toHaveLength(0);
    await f.restartProvider();
    expect(
      record(record((await f.mcp.rpc("tasks/get", { taskId: id })).result).structuredContent),
    ).toEqual(result);
    expect(await view.count()).toBe(1);
  }, 30000);
  it("rejects incompatible SDK before task dispatch with an actionable reason", async () => {
    await until(
      () =>
        f.provider.engine.availability({
          name: "camera.simulationView",
          params: {
            viewId: view.settings.viewId,
            horizontalFovDeg: 60,
            acknowledgeCameraRecreation: true,
          },
        }).available,
    );
    await view.configure({ apiVersion: "different-sdk" });
    try {
      const check = await f.mcp.rpc("io.sdar/taskExecution/checkAvailability", {
        profileVersion: "1.0",
        checks: [
          {
            requestId: randomUUID(),
            operationName: "simulation_adjust_view",
            arguments: { state: "complete", value: args() },
          },
        ],
      });
      expect(record((check.results as unknown[])[0])).toMatchObject({
        availability: "disabled",
        reasonCode: "ZMQ_VIEW_API_VERSION_MISMATCH",
      });
      expect(await view.count()).toBe(1);
    } finally {
      await view.configure({});
    }
  });
  it("queries a timed-out receipt and proves application without repeating the camera recreation", async () => {
    await view.configure({ replyDelayMs: 1400 });
    const id = String((await f.mcp.rpc("tools/call", request())).taskId);
    await until(
      async () => (await f.mcp.rpc("tasks/get", { taskId: id })).status === "completed",
      15000,
    );
    const e = await f.provider.store.getExecution(id);
    if (!isZmqExecution(e)) throw Error("EXPECTED_VIEW_EXECUTION");
    expect(e.result).toMatchObject({ application: "applied", occupancy: "released" });
    expect(e.zmqControl.commands).toHaveLength(1);
    expect(e.zmqControl.commands[0]).toMatchObject({
      status: "uncertain",
      diagnostic: { stage: "dispatch", code: "ZMQ_VIEW_EXCHANGE_UNCONFIRMED", sendCompleted: null },
    });
    expect(await view.count()).toBe(2);
    proofs.push({
      scenario: "lost_receipt_query_only",
      taskId: id,
      result: e.result,
      commands: e.zmqControl.commands,
      spawns: await view.count(),
    });
    await view.configure({});
  }, 30000);
  it("keeps conflicting physical evidence unknown and occupied, never sending an EO stop or replay", async () => {
    await view.configure({ fovConflict: 5 });
    const id = String((await f.mcp.rpc("tools/call", request(2000))).taskId);
    await until(
      async () =>
        ["failed", "completed"].includes(
          String((await f.mcp.rpc("tasks/get", { taskId: id })).status),
        ),
      15000,
    );
    const e = await f.provider.store.getExecution(id);
    if (!isZmqExecution(e)) throw Error("EXPECTED_VIEW_EXECUTION");
    expect(e.result).toMatchObject({ application: "unknown", occupancy: "held", evidence: null });
    proofs.push({
      scenario: "conflicting_frame_remains_unknown",
      taskId: id,
      result: e.result,
      commands: e.zmqControl.commands,
      spawns: await view.count(),
    });
    expect(e.zmqControl.commands).toHaveLength(1);
    const count = await view.count();
    await f.restartProvider();
    await until(() => f.provider.observer.health.status === "running");
    expect(await view.count()).toBe(count);
    expect(f.devices.commands.filter((c) => c.request.method === "TeleControl")).toHaveLength(0);
  }, 30000);
});
