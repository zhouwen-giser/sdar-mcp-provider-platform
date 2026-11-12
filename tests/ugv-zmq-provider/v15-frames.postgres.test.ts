import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { siteFixture } from "./site-fixture.js";
import { controlSiteFixture } from "./site-control-fixture.js";
import { until } from "../ugv-zmq-control-postgres/harness.js";
import { toolContent } from "../../apps/ugv-control-console/server/mcp.js";
import { array, record, type Tool } from "../../apps/ugv-control-console/shared/model.js";
import { nativeCatalogReason } from "../../apps/ugv-control-console/shared/zmq-native.js";
const file = process.env.SMPP_ZMQ_TEST_CONFIG_FILE;
for (const readonly of [true, false])
  describe.skipIf(!file)(
    `1.5 frame MCP + PostgreSQL (${readonly ? "readonly" : "control"})`,
    () => {
      let f:
        Awaited<ReturnType<typeof siteFixture>> | Awaited<ReturnType<typeof controlSiteFixture>>;
      beforeAll(async () => {
        const db = (JSON.parse(readFileSync(file ?? "", "utf8")) as { databaseUrl: string })
          .databaseUrl;
        f = readonly
          ? await siteFixture(db, true)
          : await controlSiteFixture(db, "site_anonymous", "zmq_v1_5_0_site_control_15");
        delete f.mcp.headers.authorization;
        await until(() =>
          f.provider.observer
            .snapshot()
            .observations.some((o) => o.observation.key === "frame_header"),
        );
      }, 30000);
      afterAll(async () => {
        await f?.close();
      });
      it("publishes exact fifteen tools with selected profile and refuses drift", async () => {
        const tools = (await f.mcp.rpc("tools/list")).tools as Tool[];
        expect(tools).toHaveLength(15);
        expect(nativeCatalogReason(tools, f.resourceId)).toBeNull();
        expect(record(tools[0]?._meta?.["io.sdar/ugvZmq"]).catalogProfile).toBe(
          readonly ? "zmq_v1_5_0_readonly_15" : "zmq_v1_5_0_site_control_15",
        );
        const bad = structuredClone(tools);
        bad[0]!.inputSchema.additionalProperties = true;
        expect(nativeCatalogReason(bad, f.resourceId)).toBe("ZMQ_NATIVE_CONTRACT_MISMATCH");
        const caps = toolContent(
          await f.mcp.tool("vehicle_get_capabilities", { resourceId: f.resourceId }),
        );
        expect(caps.catalogProfile).toBe(
          readonly ? "zmq_v1_5_0_readonly_15" : "zmq_v1_5_0_site_control_15",
        );
      });
      it("reads an exact frame, verifies image hashes, and persists metadata without creating tasks", async () => {
        const header = f.provider.observer
          .snapshot()
          .observations.find((o) => o.observation.key === "frame_header")!.observation.data;
        const result = toolContent(
          await f.mcp.tool("vehicle_zmq_get_frame", {
            resourceId: f.resourceId,
            cameraId: header.camera_id,
            frameId: header.frame_id,
          }),
        );
        expect(result.schemaVersion).toBe("ugv.zmq-frame/1");
        expect(result.taskId).toBeUndefined();
        expect(record(result.metadata).frame_id).toBe(header.frame_id);
        expect(record(result.metadata).exposure_utc_ms).toBeNull();
        const image = Buffer.from(String(result.dataBase64), "base64");
        expect(image).toEqual(f.devices.jpegBytes);
        expect(result.sha256).toBe(createHash("sha256").update(image).digest("hex"));
        const rows = await f.provider.store.pool.query<{ snapshot: Record<string, unknown> }>(
          "SELECT snapshot FROM ugv_state_snapshot WHERE snapshot->>'schemaVersion'='ugv.zmq-frame-access/1'",
        );
        expect(rows.rows.length).toBeGreaterThan(0);
        expect(JSON.stringify(rows.rows)).not.toContain("dataBase64");
        const executions = await f.provider.store.pool.query<{ count: string }>(
          "SELECT count(*) FROM ugv_execution WHERE payload->>'operationName'='vehicle_zmq_get_frame'",
        );
        expect(executions.rows[0]?.count).toBe("0");
        expect(f.devices.commands).toHaveLength(0);
        const id = String(result.retrievalId);
        await f.restartProvider();
        await until(async () => {
          try {
            return (
              (await f.mcp.tool("vehicle_get_state", { resourceId: f.resourceId })).isError ===
              false
            );
          } catch {
            return false;
          }
        }, 10000);
        const expired = await f.mcp.tool("vehicle_zmq_get_frame", {
          resourceId: f.resourceId,
          retrievalId: id,
          offset: 0,
        });
        expect(expired.isError).toBe(true);
        expect(JSON.stringify(expired)).toContain("ZMQ_FRAME_CACHE_EXPIRED_OR_UNAUTHORIZED");
        expect(f.devices.commands).toHaveLength(0);
      }, 30000);
      it("keeps readonly controls disabled, including the independent simulation camera", async () => {
        if (!readonly) return;
        for (const name of [
          "vehicle_zmq_navigate",
          "vehicle_zmq_camera",
          "vehicle_zmq_area_recon",
          "vehicle_zmq_circular_recon",
          "vehicle_zmq_inspect_area",
          "simulation_apply_effect",
          "simulation_adjust_view",
        ])
          await expect(
            f.provider.runtime.start({
              taskId: randomUUID(),
              operationName: name,
              argumentHash: "a".repeat(64),
              arguments: {},
              executionContext: {
                authorizationContextHash: "a".repeat(64),
                executionMode: "LIVE",
                simulationId: "",
                correlationId: "test",
              },
            }),
          ).rejects.toThrow("ZMQ_SITE_READONLY_CONTROL_DISABLED");
        expect(f.devices.commands).toHaveLength(0);
        const caps = toolContent(
          await f.mcp.tool("vehicle_get_capabilities", { resourceId: f.resourceId }),
        );
        expect(
          array(caps.tools)
            .map(record)
            .filter((t) => t.name === "simulation_adjust_view")[0]?.available,
        ).toBe(false);
      });
      it("does not delay owned navigation cancellation while a frame response is pending", async () => {
        if (readonly) return;
        const control = f as Awaited<ReturnType<typeof controlSiteFixture>>;
        await until(
          () =>
            control.provider.engine.availability({
              name: "navigation.point",
              params: {
                destination: { longitude: 106.001, latitude: 29 },
                speedLimitMps: 0.5,
                obstacleAvoidance: true,
              },
            }).available,
        );
        const task = await f.mcp.rpc("tools/call", {
          name: "vehicle_zmq_navigate",
          arguments: {
            resourceId: f.resourceId,
            operation: {
              name: "navigation.point",
              params: {
                destination: { longitude: 106.001, latitude: 29 },
                speedLimitMps: 0.5,
                obstacleAvoidance: true,
              },
            },
          },
          _meta: {
            "io.sdar/taskExecution": {
              profileVersion: "1.0",
              idempotencyKey: randomUUID(),
              timing: {
                start: { mode: "immediate", startToleranceMs: 60000 },
                maxElapsedMs: 10000,
              },
            },
          },
        });
        await until(() => f.devices.moving);
        const header = f.provider.observer
          .snapshot()
          .observations.find((o) => o.observation.key === "frame_header")!.observation.data;
        const before = f.devices.frameRequests;
        f.devices.frameReplyDelayMs = 1500;
        let frameFinished = false;
        const image = f.mcp
          .tool("vehicle_zmq_get_frame", {
            resourceId: f.resourceId,
            cameraId: header.camera_id,
            frameId: header.frame_id,
          })
          .finally(() => {
            frameFinished = true;
          });
        await until(() => f.devices.frameRequests > before);
        await f.mcp.rpc("tasks/cancel", { taskId: task.taskId });
        await until(
          async () =>
            (await f.mcp.rpc("tasks/get", { taskId: task.taskId })).status === "cancelled",
        );
        expect(f.devices.moving).toBe(false);
        expect(frameFinished).toBe(false);
        expect((await image).isError).toBe(false);
        f.devices.frameReplyDelayMs = 0;
      }, 20000);
    },
  );
