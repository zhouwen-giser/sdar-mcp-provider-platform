import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { controlSiteFixture } from "../../../tests/ugv-zmq-provider/site-control-fixture.js";
import { until } from "../../../tests/ugv-zmq-control-postgres/harness.js";
import { Service } from "../server/service.js";
import { Store } from "../server/store.js";
import { array, record } from "../shared/model.js";
const file = process.env.SMPP_ZMQ_TEST_CONFIG_FILE;
describe.skipIf(!file)("live v13 report pagination and console audit", () => {
  it("reads the new live result identity and retained default provenance", async () => {
    const cfg = JSON.parse(readFileSync(file ?? "", "utf8")) as { databaseUrl: string };
    const f = await controlSiteFixture(
      cfg.databaseUrl,
      "site_anonymous",
      "zmq_v1_3_0_site_control_13",
    );
    try {
      delete f.mcp.headers.authorization;
      await until(
        () =>
          f.provider.engine.availability({
            name: "camera.zoom",
            params: { zoom_ratio: 2, zoom_timeout_ms: 1000 },
          }).available,
      );
      const store = new Store(f.admin, "v13-pagination:" + randomUUID());
      await store.migrate();
      const service = new Service(f.mcp, store, "test-operator");
      const catalog = await service.catalog();
      const created = await service.execute({
        commandId: randomUUID(),
        kind: "tool",
        tool: "vehicle_zmq_inspect_area",
        catalogHash: catalog.catalogHash,
        arguments: {
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
        },
        timing: { start: { mode: "immediate", startToleranceMs: 60000 }, maxElapsedMs: 10000 },
      });
      expect(created?.taskId).toBeTypeOf("string");
      await until(() => f.devices.taskState === "searching");
      f.devices.completeRecon();
      await until(
        async () =>
          (await f.mcp.rpc("tasks/get", { taskId: created?.taskId })).status === "completed",
      );
      if (!created?.taskId) throw Error("ACCEPTED_TASK_ID_REQUIRED");
      const page = await service.supplement(created.taskId);
      expect(record(page.page).schemaVersion).toBe("ugv.zmq-result-page/2");
      expect(record(page.parameterResolution).vertices).toEqual(
        [0, 1, 2, 3].map((index) => ({ index, source: "default_zero", ellipsoidHeightM: 0 })),
      );
      const retained = await store.command(created.commandId);
      const requestedVertices = array(
        record(record(retained?.request.arguments).area).vertices,
      ).map(record);
      expect(requestedVertices).toHaveLength(4);
      expect(requestedVertices.every((p) => !Object.hasOwn(p, "ellipsoidHeightM"))).toBe(true);
    } finally {
      await f.close();
    }
  }, 30000);
});
