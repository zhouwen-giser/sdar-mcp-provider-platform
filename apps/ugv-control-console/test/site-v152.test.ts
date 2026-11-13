import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { siteFixture } from "../../../tests/ugv-zmq-provider/site-fixture.js";
import { present } from "../../../tests/ugv-zmq-control/helpers.js";
import { until } from "../../../tests/ugv-zmq-control-postgres/harness.js";
import { Service } from "../server/service.js";
import { Store } from "../server/store.js";
import { record } from "../shared/model.js";
const file = process.env.SMPP_ZMQ_TEST_CONFIG_FILE;
describe.skipIf(!file)("console V3 preview persistence and replay boundary", () => {
  let f: Awaited<ReturnType<typeof siteFixture>>, store: Store, service: Service;
  beforeAll(async () => {
    const config = JSON.parse(readFileSync(file ?? "", "utf8")) as { databaseUrl: string };
    f = await siteFixture(config.databaseUrl, true, true, true);
    store = new Store(f.admin, "v152-fixture:" + randomUUID());
    await store.migrate();
    service = new Service(f.mcp, store, "SIMULATED-operator");
    await until(() =>
      Object.values(f.provider.observer.snapshot().channels).every((c) => c.receiptFresh),
    );
  }, 30000);
  afterAll(async () => {
    await f?.close();
  });
  async function request() {
    const c = await service.catalog(),
      p = present(f.plannerV2);
    return {
      commandId: randomUUID(),
      kind: "tool" as const,
      tool: "vehicle_zmq_plan_route",
      catalogHash: c.catalogHash,
      arguments: {
        resourceId: f.resourceId,
        start: { longitude: p.start.longitude, latitude: p.start.latitude },
        waypoints: [{ longitude: p.destination.longitude, latitude: p.destination.latitude }],
      },
    };
  }
  it("accepts only the exact new catalog and exposes qualified map reference", async () => {
    const c = await service.catalog();
    expect(c.tools).toHaveLength(15);
    const current = record((await service.state()).data),
      caps = record(current.vehicle_get_capabilities);
    expect(caps.catalogProfile).toBe("zmq_v1_5_2_readonly_15");
    expect(record(caps.planner).coordinateFrame).toBe("map_enu");
    expect(record(record(caps.planner).mapReference).mapId).toBe("yuan_qu");
  });
  it("retains one exact preview across duplicate clicks and service reconstruction", async () => {
    const input = await request(),
      planner = present(f.plannerV2),
      before = planner.state.calls;
    const first = present(await service.execute(input));
    expect(first.status).toBe("completed");
    expect(record(record(first.response).structuredContent).schemaVersion).toBe(
      "ugv.zmq-route-preview/3",
    );
    const next = new Service(f.mcp, store, "SIMULATED-operator"),
      duplicate = present(await next.execute(input));
    expect(duplicate.response).toEqual(first.response);
    expect(planner.state.calls - before).toBe(1);
    await expect(
      next.execute({ ...input, arguments: { ...input.arguments, density: "dense" } }),
    ).rejects.toThrow(/CONFLICT/);
    expect(planner.state.calls - before).toBe(1);
    expect(f.devices.commands).toHaveLength(0);
  });
  it("persists a specific upstream rejection without retrying or dispatching navigation", async () => {
    const planner = present(f.plannerV2),
      input = await request();
    planner.state.ackError = "Dashboard mission changed or its identity is missing";
    try {
      const result = present(await service.execute(input));
      expect(result.status).toBe("rejected");
      expect(JSON.stringify(result.response)).toContain("UGV_PLANNER_MISSION_CHANGED");
      expect((await store.command(input.commandId))?.response).toEqual(result.response);
    } finally {
      planner.state.ackError = "";
    }
    expect(f.devices.commands).toHaveLength(0);
  });
});
