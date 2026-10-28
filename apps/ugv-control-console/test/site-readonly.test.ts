import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import {
  siteFixture,
  siteStart,
  siteDestination,
} from "../../../tests/ugv-zmq-provider/site-fixture.js";
import { ZMQ_CONTROL_TOOLS } from "../../../packages/vehicle-zmq-control/src/catalog.js";
import {
  SITE_PROFILE,
  PLAN_ROUTE,
  SITE_READONLY_REASON,
} from "../../../packages/vehicle-zmq-control/src/site-catalog.js";
import { RecoveryManager } from "../../../packages/task-engine/src/recovery.js";
import { DurableScheduler } from "../../../packages/task-engine/src/scheduler.js";
import { DurableCommandDispatcher } from "../../../packages/task-engine/src/command-dispatcher.js";
import { createHash } from "node:crypto";
import { ZmqControlEngine } from "../../../packages/vehicle-zmq-control/src/engine.js";
import { toolContent } from "../server/mcp.js";
import { Service } from "../server/service.js";
import { Store } from "../server/store.js";
import { array, record } from "../shared/model.js";
import { nativeCatalogReason } from "../shared/zmq-native.js";
import { until } from "../../../tests/ugv-zmq-control-postgres/harness.js";
const file = process.env.SMPP_ZMQ_TEST_CONFIG_FILE;
let f: Awaited<ReturnType<typeof siteFixture>>, store: Store, service: Service;
let engineInit: ReturnType<typeof vi.spyOn>;
const workerSpies: ReturnType<typeof vi.spyOn>[] = [];
describe.skipIf(!file)("site read-only formal MCP and PostgreSQL", () => {
  beforeAll(async () => {
    engineInit = vi.spyOn(ZmqControlEngine.prototype, "initialize");
    workerSpies.push(
      vi.spyOn(RecoveryManager.prototype, "scan"),
      vi.spyOn(DurableScheduler.prototype, "tick"),
      vi.spyOn(DurableCommandDispatcher.prototype, "tick"),
    );
    const config = JSON.parse(readFileSync(file ?? "", "utf8")) as { databaseUrl: string };
    f = await siteFixture(config.databaseUrl);
    store = new Store(f.admin, "site-fixture:" + randomUUID());
    await store.migrate();
    service = new Service(f.mcp, store, "fixture-operator");
    await until(() =>
      Object.values(f.provider.observer.snapshot().channels).every((c) => c.receiptFresh),
    );
  }, 30000);
  afterAll(async () => {
    if (f) await f.close();
  });
  it("publishes the exact thirteen-tool read-only profile without a simulation identity", async () => {
    const catalog = await service.catalog();
    expect(catalog.tools).toHaveLength(13);
    expect(nativeCatalogReason(catalog.tools, f.resourceId)).toBeNull();
    const caps = toolContent(
      await f.mcp.tool("vehicle_get_capabilities", { resourceId: f.resourceId }),
    );
    expect(caps).toMatchObject({
      catalogProfile: SITE_PROFILE,
      controlAvailable: false,
      controlAdmission: "disabled",
      executionDomain: { simulationId: null },
    });
    expect(engineInit).not.toHaveBeenCalled();
    for (const spy of workerSpies) expect(spy).not.toHaveBeenCalled();
  });
  it("retains real wire reception provenance and does not promote receiver freshness", async () => {
    const state = toolContent(await f.mcp.tool("vehicle_get_state", { resourceId: f.resourceId }));
    expect(state).toMatchObject({
      readOnly: true,
      sourceProducerEpoch: null,
      completeEvidence: false,
    });
    expect(array(state.observations).length).toBeGreaterThan(2);
    for (const item of array(state.observations).map(record))
      expect(item).toMatchObject({ sourceFreshness: "unverified" });
    expect(f.provider.observer.snapshot().archive.committedReceptions).toBeGreaterThan(0);
  });
  it("attests each synchronous report for native SDAR evidence gates without claiming physical coverage", async () => {
    for (const name of ["vehicle_get_capabilities", "vehicle_get_state"]) {
      const result = await f.mcp.tool(name, { resourceId: f.resourceId });
      expect(result.isError).toBe(false);
      const evidence = record(record(result._meta)["io.sdar/evidence"]);
      expect(evidence.profileVersion).toBe("1.0");
      const items = array(evidence.items);
      expect(items).toHaveLength(1);
      const item = record(items[0]);
      expect(item.evidenceId).toMatch(/^[a-f0-9]{64}$/);
      expect(typeof item.observedAt).toBe("string");
      expect(Number.isFinite(Date.parse(String(item.observedAt)))).toBe(true);
      expect(item).toMatchObject({
        evidenceType: "ugv.zmq.retained_report",
        subjectRef: f.resourceId,
        payloadRef: { kind: "structured_content", jsonPointer: "" },
      });
      const report = toolContent(result);
      expect(report).toMatchObject(
        name === "vehicle_get_state"
          ? { completeEvidence: false }
          : { completeSpatialEvidence: false, controlAvailable: false },
      );
    }
    expect(f.devices.commands).toHaveLength(0);
  });
  it("rejects all controls and lifecycle entrypoints without native dispatch", async () => {
    const c = {
      authorizationContextHash: "d".repeat(64),
      executionMode: "LIVE",
      simulationId: "",
      correlationId: "test",
    };
    for (const name of ZMQ_CONTROL_TOOLS)
      await expect(
        f.provider.runtime.start({
          taskId: randomUUID(),
          operationName: name,
          argumentHash: "d".repeat(64),
          arguments: {},
          executionContext: c,
        }),
      ).rejects.toThrow(SITE_READONLY_REASON);
    for (const action of ["pause", "resume", "cancel"] as const)
      await expect(
        f.provider.runtime.command(action, {
          taskId: "none",
          externalExecutionId: "none",
          operationName: "vehicle_zmq_navigate",
          argumentHash: "d".repeat(64),
          commandSequence: "1",
          executionContext: c,
        }),
      ).rejects.toThrow(SITE_READONLY_REASON);
    await expect(
      f.provider.runtime.updateFire(
        {
          taskId: "none",
          externalExecutionId: "none",
          operationName: "vehicle_zmq_navigate",
          argumentHash: "d".repeat(64),
          commandSequence: "1",
          executionContext: c,
        },
        {},
      ),
    ).rejects.toThrow(SITE_READONLY_REASON);
    await expect(f.provider.runtime.applyIntervention()).rejects.toThrow(SITE_READONLY_REASON);
    expect(f.devices.commands).toHaveLength(0);
  });
  it("rejects formal MCP control and lifecycle calls before any task or command record", async () => {
    const args = {
      resourceId: f.resourceId,
      operation: {
        name: "navigation.point",
        params: { destination: siteDestination, speedLimitMps: 1, obstacleAvoidance: true },
      },
    };
    const result = await f.mcp.rpc("tools/call", {
      name: "vehicle_zmq_navigate",
      arguments: args,
      _meta: { "io.sdar/taskExecution": { profileVersion: "1.0", idempotencyKey: randomUUID() } },
    });
    expect(result.isError).toBe(true);
    expect(record(result.structuredContent).reasonCode).toBe(SITE_READONLY_REASON);
    for (const method of [
      "tasks/cancel",
      "io.sdar/taskExecution/tasks/pause",
      "io.sdar/taskExecution/tasks/resume",
    ])
      await expect(f.mcp.rpc(method, { taskId: randomUUID() })).rejects.toThrow(
        SITE_READONLY_REASON,
      );
    expect(
      (
        await f.runtime.pool.query<{ count: number }>(
          "SELECT count(*)::int count FROM provider_task",
        )
      ).rows[0]?.count,
    ).toBe(0);
    expect(
      (
        await f.runtime.pool.query<{ count: number }>(
          "SELECT count(*)::int count FROM task_command",
        )
      ).rows[0]?.count,
    ).toBe(0);
    expect(f.devices.commands).toHaveLength(0);
  });
  it("audits one preview, deduplicates two browsers and never creates a navigation task", async () => {
    const c = await service.catalog(),
      command = {
        commandId: randomUUID(),
        kind: "tool" as const,
        tool: PLAN_ROUTE,
        arguments: {
          resourceId: f.resourceId,
          start: siteStart,
          waypoints: [siteDestination],
          density: "adaptive",
        },
        catalogHash: c.catalogHash,
      };
    const before = f.plannerState.calls,
      rows = await Promise.all([service.execute(command), service.execute(command)]);
    expect(rows.some((r) => r?.status === "completed")).toBe(true);
    const saved = await store.command(command.commandId);
    expect(saved?.status).toBe("completed");
    expect(saved?.taskId).toBeNull();
    const preview = record(record(saved?.response).structuredContent);
    expect(preview).toMatchObject({
      adoption: "preview_only",
      correlation: "geometry_only_no_request_id",
      sourceFreshness: "unverified",
    });
    expect(array(preview.waypoints)).toHaveLength(2);
    const sourceMessage = preview.sourceMessage;
    if (typeof sourceMessage !== "string") throw Error("PREVIEW_SOURCE_MESSAGE_MISSING");
    expect(preview.sourceMessageSha256).toBe(
      createHash("sha256").update(sourceMessage).digest("hex"),
    );
    expect(f.plannerState.calls).toBe(before + 1);
    expect((await service.execute(command))?.status).toBe("completed");
    expect(f.plannerState.calls).toBe(before + 1);
    await expect(
      service.execute({ ...command, arguments: { ...command.arguments, density: "dense" } }),
    ).rejects.toThrow("COMMAND_ID_CONFLICT");
    expect(
      (
        await f.provider.store.pool.query<{ count: number }>(
          "SELECT count(*)::int count FROM ugv_execution",
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await f.runtime.pool.query<{ count: number }>(
          "SELECT count(*)::int count FROM provider_task",
        )
      ).rows[0]?.count,
    ).toBe(0);
    expect(f.devices.commands).toHaveLength(0);
  });
  it("rejects URL injection and contract drift before planner traffic", async () => {
    const before = f.plannerState.calls;
    await expect(service.readTool(PLAN_ROUTE, {})).rejects.toThrow("USE_COMMAND_PREVIEW_ROUTE");
    const response = await f.mcp
      .tool(PLAN_ROUTE, {
        resourceId: f.resourceId,
        start: siteStart,
        waypoints: [siteDestination],
        density: "adaptive",
        endpoint: "http://other",
      })
      .catch((error: unknown) => ({
        rejected: error instanceof Error ? error.message : "MCP_REQUEST_REJECTED",
      }));
    expect(record(response).isError === true || "rejected" in response).toBe(true);
    expect(f.plannerState.calls).toBe(before);
    const c = await service.catalog(),
      tools = structuredClone(c.tools);
    record(record(tools[0]?.inputSchema).properties).injected = { type: "string" };
    expect(nativeCatalogReason(tools, f.resourceId)).toBe("ZMQ_NATIVE_CONTRACT_MISMATCH");
  });
  it("serializes planner sessions across Provider objects and fails on unrelated geometry", async () => {
    f.plannerState.delayMs = 300;
    const args = {
      resourceId: f.resourceId,
      start: siteStart,
      waypoints: [siteDestination],
      density: "adaptive",
    };
    const first = f.mcp.tool(PLAN_ROUTE, args);
    await until(() => f.plannerState.calls > 1);
    const second = await f.mcp.tool(PLAN_ROUTE, args);
    expect(second.isError).toBe(true);
    expect(record(second.structuredContent).reasonCode).toBe("UGV_PLANNER_BUSY");
    await first;
    f.plannerState.delayMs = 0;
    f.plannerState.mismatch = true;
    const mismatch = await f.mcp.tool(PLAN_ROUTE, args);
    expect(mismatch.isError).toBe(true);
    expect(record(mismatch.structuredContent).reasonCode).toBe("UGV_PLANNER_TIMEOUT");
    f.plannerState.mismatch = false;
  }, 10000);
  it("restarts subscriptions and historical queries without creating a control engine", async () => {
    await f.restartProvider();
    await until(() =>
      Object.values(f.provider.observer.snapshot().channels).every((c) => c.receiptFresh),
    );
    await until(async () => {
      try {
        return (
          (await f.mcp.tool("vehicle_get_state", { resourceId: f.resourceId })).isError === false
        );
      } catch {
        return false;
      }
    });
    expect(engineInit).not.toHaveBeenCalled();
    for (const spy of workerSpies) expect(spy).not.toHaveBeenCalled();
    expect(f.devices.commands).toHaveLength(0);
    expect(await f.provider.store.listActiveExecutions()).toHaveLength(0);
    const q = await f.mcp.tool("vehicle_get_inspection_result", {
      resourceId: f.resourceId,
      taskId: randomUUID(),
      executionId: randomUUID(),
      afterRevision: 0,
      limit: 8,
    });
    expect(q.isError).toBe(true);
  });
});
