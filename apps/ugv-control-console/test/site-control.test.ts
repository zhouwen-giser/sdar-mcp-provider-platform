import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  controlSiteFixture,
  siteStart,
  siteDestination,
} from "../../../tests/ugv-zmq-provider/site-control-fixture.js";
import { until } from "../../../tests/ugv-zmq-control-postgres/harness.js";
import { Store } from "../server/store.js";
import { Service } from "../server/service.js";
import { array, record } from "../shared/model.js";
const file = process.env.SMPP_ZMQ_TEST_CONFIG_FILE;
let f: Awaited<ReturnType<typeof controlSiteFixture>>, store: Store, service: Service;
describe.skipIf(!file)("site control panel through formal JWT MCP", () => {
  beforeAll(async () => {
    const cfg = JSON.parse(readFileSync(file ?? "", "utf8")) as { databaseUrl: string };
    f = await controlSiteFixture(cfg.databaseUrl);
    f.devices.positionOverride = siteStart;
    store = new Store(f.admin, "control-console:" + randomUUID());
    await store.migrate();
    service = new Service(f.mcp, store, "fixture-operator");
    await until(() =>
      f.provider.observer
        .snapshot()
        .observations.some((o) => o.observation.position?.longitude === siteStart.longitude),
    );
  }, 30000);
  afterAll(async () => {
    if (f) await f.close();
  });
  it("adopts only saved actual route points, creates a separate Task and preserves the preview", async () => {
    const c = await service.catalog();
    const preview = await service.execute({
      commandId: randomUUID(),
      kind: "tool",
      tool: "vehicle_zmq_plan_route",
      catalogHash: c.catalogHash,
      arguments: {
        resourceId: f.resourceId,
        start: siteStart,
        waypoints: [siteDestination],
        density: "adaptive",
      },
    });
    expect(preview?.status).toBe("completed");
    if (!preview) throw Error("FIXTURE_PREVIEW_REQUIRED");
    const before = JSON.stringify(preview),
      points = array(record(record(preview.response).structuredContent).waypoints);
    const request = {
      commandId: randomUUID(),
      kind: "tool" as const,
      tool: "vehicle_zmq_navigate",
      catalogHash: c.catalogHash,
      previewCommandId: preview.commandId,
      arguments: {
        resourceId: f.resourceId,
        operation: {
          name: "navigation.route",
          params: { waypoints: points, speedLimitMps: 1, obstacleAvoidance: true },
        },
      },
      timing: {
        start: { mode: "immediate" as const, startToleranceMs: 60000 },
        maxElapsedMs: 10000,
      },
    };
    const wrong = await service.execute({
      ...request,
      commandId: randomUUID(),
      arguments: {
        ...request.arguments,
        operation: {
          ...request.arguments.operation,
          params: { ...request.arguments.operation.params, waypoints: [siteDestination] },
        },
      },
    });
    expect(wrong?.status).toBe("rejected");
    expect(record(wrong?.response).reasonCode).toBe("ZMQ_PREVIEW_ROUTE_MISMATCH");
    const started = await service.execute(request);
    expect(started?.taskId, JSON.stringify(started)).toBeTypeOf("string");
    await until(() => f.devices.moving);
    expect(JSON.stringify(await store.command(preview.commandId))).toBe(before);
    await service.execute(request);
    expect(f.devices.commands.filter((c) => c.request.type === "pathFollow")).toHaveLength(1);
    await f.mcp.rpc("tasks/cancel", { taskId: started?.taskId });
    await until(
      async () =>
        (await f.mcp.rpc("tasks/get", { taskId: started?.taskId })).status === "cancelled",
    );
  });
  it("reads explicitly configured historical domains without duplicate rows or redispatch", async () => {
    const old = new Store(f.admin, "old-console:" + randomUUID()),
      joined = new Store(f.admin, store.domain, old.domain);
    const id = randomUUID(),
      req = {
        commandId: id,
        kind: "tool" as const,
        tool: "vehicle_zmq_camera",
        catalogHash: "historical",
        arguments: {},
      };
    await old.reserve(req);
    await old.finish(id, "unknown", { original: true });
    expect((await joined.reserve(req)).fresh).toBe(false);
    await expect(joined.reserve({ ...req, arguments: { different: true } })).rejects.toThrow(
      "COMMAND_ID_CONFLICT",
    );
    await old.saveTask(id, "old-operation", { original: true });
    await joined.saveTask(id, "old-operation", { currentRead: true });
    expect((await joined.tasks()).filter((t) => t.taskId === id)).toHaveLength(1);
    expect((await joined.task(id))?.snapshot).toEqual({ currentRead: true });
    expect((await old.task(id))?.snapshot).toEqual({ original: true });
  });
});
