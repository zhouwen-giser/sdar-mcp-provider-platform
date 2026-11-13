import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { siteFixture } from "./site-fixture.js";
import { present } from "../ugv-zmq-control/helpers.js";
import { until } from "../ugv-zmq-control-postgres/harness.js";
import { toolContent } from "../../apps/ugv-control-console/server/mcp.js";
import { record, array } from "../../apps/ugv-control-console/shared/model.js";
import { nativeCatalogReason } from "../../apps/ugv-control-console/shared/zmq-native.js";
const file = process.env.SMPP_ZMQ_TEST_CONFIG_FILE;
describe.skipIf(!file)(
  "1.5.2 per-component planner admission through PostgreSQL and formal MCP",
  () => {
    let f: Awaited<ReturnType<typeof siteFixture>>;
    const args = () => {
      const p = present(f.plannerV2);
      return {
        resourceId: f.resourceId,
        start: { longitude: p.start.longitude, latitude: p.start.latitude },
        waypoints: [{ longitude: p.destination.longitude, latitude: p.destination.latitude }],
      };
    };
    beforeAll(async () => {
      const c = JSON.parse(readFileSync(file ?? "", "utf8")) as { databaseUrl: string };
      f = await siteFixture(c.databaseUrl, true, true, true);
      await until(() =>
        Object.values(f.provider.observer.snapshot().channels).every((c) => c.receiptFresh),
      );
    }, 30000);
    afterAll(async () => {
      await f?.close();
    });
    it("publishes exact separate fifteen-tool catalog and retains receive variant provenance", async () => {
      const list = await f.mcp.rpc("tools/list", {}),
        tools = array(list.tools) as Parameters<typeof nativeCatalogReason>[0];
      expect(tools).toHaveLength(15);
      expect(nativeCatalogReason(tools, f.resourceId)).toBeNull();
      const caps = toolContent(
        await f.mcp.tool("vehicle_get_capabilities", { resourceId: f.resourceId }),
      );
      expect(caps.catalogProfile).toBe("zmq_v1_5_2_readonly_15");
      expect(caps.chassisWire).toMatchObject({
        publicationFraming: "prefix_business_length_crc",
        commandFraming: "prefix_wire_length_crc",
        standard21Conformance: false,
      });
      const state = toolContent(
        await f.mcp.tool("vehicle_get_state", { resourceId: f.resourceId }),
      );
      expect(
        array(state.observations)
          .map(record)
          .some(
            (o) =>
              record(o.observation).protocolVersion === "2.1-site-rx/1" && o.receiptFresh === true,
          ),
      ).toBe(true);
    });
    it("returns a context/scene/geometry qualified preview without creating navigation or tasks", async () => {
      const result = await f.mcp.tool("vehicle_zmq_plan_route", args());
      expect(result.isError).toBe(false);
      const p = toolContent(result);
      expect(p).toMatchObject({
        schemaVersion: "ugv.zmq-route-preview/3",
        adoption: "preview_only",
        correlation: "request_id_epoch_context_and_geometry",
        context: { entity_id: "ugv" },
        transform: { policy: "scene_enu_wgs84_v1" },
      });
      const rows = await f.provider.store.pool.query<{ count: string }>(
        "SELECT count(*) FROM ugv_execution WHERE payload->>'operationName' IN ('vehicle_zmq_plan_route','vehicle_zmq_navigate')",
      );
      expect(rows.rows[0]?.count).toBe("0");
      expect(f.devices.commands).toHaveLength(0);
    });
    it("preserves overall degradation and rejects genuinely closed admission without navigation", async () => {
      const planner = present(f.plannerV2);
      planner.state.scenePhase = "failed";
      planner.state.sceneOverrides = { error: "SIMULATED dashboard check timeout" };
      planner.state.runtimeOverrides = {
        phase: "DEGRADED",
        fault_component: "dashboard",
        reason: "SIMULATED dashboard check timeout",
      };
      try {
        const p = toolContent(await f.mcp.tool("vehicle_zmq_plan_route", args()));
        expect(p.plannerAdmission).toMatchObject({
          degraded: true,
          runtimePhase: "DEGRADED",
          acceptingCommands: true,
        });
        planner.state.runtimeOverrides.accepting_commands = false;
        const before = planner.state.calls;
        const rejection = await f.mcp.tool("vehicle_zmq_plan_route", args());
        expect(rejection.isError).toBe(true);
        expect(JSON.stringify(rejection)).toContain("UGV_PLANNER_COMPONENT_UNAVAILABLE");
        expect(planner.state.calls).toBe(before);
      } finally {
        planner.state.scenePhase = "ready";
        planner.state.sceneOverrides = {};
        planner.state.runtimeOverrides = {};
      }
      expect(f.devices.commands).toHaveLength(0);
    });
    it("reports explicit ACK rejection instead of a timeout", async () => {
      const planner = present(f.plannerV2);
      planner.state.ackError = "Dashboard controlled entity changed or is missing";
      try {
        const r = await f.mcp.tool("vehicle_zmq_plan_route", args());
        expect(r.isError).toBe(true);
        expect(JSON.stringify(r)).toContain("UGV_PLANNER_ENTITY_MISMATCH");
      } finally {
        planner.state.ackError = "";
      }
      expect(f.devices.commands).toHaveLength(0);
    });
    it("serializes one endpoint across simultaneous public calls", async () => {
      const planner = present(f.plannerV2);
      planner.state.delayMs = 250;
      try {
        const results = await Promise.all([
          f.mcp.tool("vehicle_zmq_plan_route", args()),
          f.mcp.tool("vehicle_zmq_plan_route", args()),
        ]);
        expect(results.filter((r) => r.isError === false)).toHaveLength(1);
        expect(JSON.stringify(results)).toContain("UGV_PLANNER_BUSY");
      } finally {
        planner.state.delayMs = 0;
      }
      expect(f.devices.commands).toHaveLength(0);
    });
    it("rejects control and restarts without constructing a native write path", async () => {
      const response = await f.mcp.rpc("tools/call", {
        name: "vehicle_zmq_navigate",
        arguments: {
          resourceId: f.resourceId,
          operation: {
            name: "navigation.point",
            params: {
              destination: present(args().waypoints[0]),
              speedLimitMps: 0.5,
              obstacleAvoidance: true,
            },
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
      expect(response.isError).toBe(true);
      await f.restartProvider();
      await until(() =>
        Object.values(f.provider.observer.snapshot().channels).every((c) => c.receiptFresh),
      );
      expect(f.devices.commands).toHaveLength(0);
      await until(async () => {
        try {
          return (
            (await f.mcp.tool("vehicle_get_state", { resourceId: f.resourceId })).isError === false
          );
        } catch {
          return false;
        }
      });
      const p = toolContent(await f.mcp.tool("vehicle_zmq_plan_route", args()));
      expect(p.schemaVersion).toBe("ugv.zmq-route-preview/3");
    }, 20000);
  },
);
