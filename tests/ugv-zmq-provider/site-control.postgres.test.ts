import { decodeChassisFrame } from "../../packages/vehicle-zmq-contract/src/index.js";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { controlSiteFixture } from "./site-control-fixture.js";
import { until } from "../ugv-zmq-control-postgres/harness.js";
import { area } from "../ugv-zmq-control/helpers.js";
import { Mcp } from "../../apps/ugv-control-console/server/mcp.js";
import { record } from "../../apps/ugv-control-console/shared/model.js";
import { nativeCatalogReason } from "../../apps/ugv-control-console/shared/zmq-native.js";
import { siteControlOperation } from "../../packages/vehicle-zmq-control/src/site-control-catalog.js";
import type { Tool } from "../../apps/ugv-control-console/shared/model.js";
const file = process.env.SMPP_ZMQ_TEST_CONFIG_FILE;
let f: Awaited<ReturnType<typeof controlSiteFixture>>;
const timing = { start: { mode: "immediate", startToleranceMs: 60000 }, maxElapsedMs: 10000 };
async function call(name: string, args: Record<string, unknown>, key = randomUUID()) {
  return f.mcp.rpc("tools/call", {
    name,
    arguments: { resourceId: f.resourceId, ...args },
    _meta: { "io.sdar/taskExecution": { profileVersion: "1.0", idempotencyKey: key, timing } },
  });
}
async function commandAcknowledged(taskId: string, action: string) {
  await until(
    async () =>
      (
        await f.runtime.pool.query<{ state: string }>(
          "SELECT state FROM task_command WHERE task_id=$1 AND command_type=$2",
          [taskId, action],
        )
      ).rows[0]?.state === "ACKNOWLEDGED",
  );
}
async function done(taskId: string) {
  let value: Record<string, unknown> = {};
  await until(async () => {
    value = await f.mcp.rpc("tasks/get", { taskId });
    return ["completed", "cancelled", "failed"].includes(String(value.status));
  }, 15000);
  return value;
}
describe.skipIf(!file)("site-control JWT / real PostgreSQL / native sockets", () => {
  beforeAll(async () => {
    const cfg = JSON.parse(readFileSync(file ?? "", "utf8")) as { databaseUrl: string };
    f = await controlSiteFixture(cfg.databaseUrl);
    await until(
      () =>
        f.provider.engine.availability({
          name: "camera.zoom",
          params: { zoom_ratio: 2, zoom_timeout_ms: 1000 },
        }).available,
    );
  }, 30000);
  afterAll(async () => {
    if (f && process.env.SMPP_ZMQ_SITE_CONTROL_WIRE_EVIDENCE_FILE)
      writeFileSync(
        process.env.SMPP_ZMQ_SITE_CONTROL_WIRE_EVIDENCE_FILE,
        JSON.stringify(
          {
            schemaVersion: "ugv.zmq-site-control-software-wire/1",
            source: "isolated_wire_simulator_not_field_acceptance",
            frames: f.devices.rawChassisFrames.map((frame) => ({
              base64: frame.toString("base64"),
              sha256: createHash("sha256").update(frame).digest("hex"),
              decoded: decodeChassisFrame(frame),
            })),
          },
          null,
          2,
        ) + "\n",
      );
    await f?.close();
  });
  it("requires JWT and publishes only the exact site-control 13-tool catalog", async () => {
    const anonymous = new Mcp(f.mcp.url, { "x-sdar-execution-mode": "live" });
    await expect(anonymous.rpc("tools/list")).rejects.toThrow();
    const list = await f.mcp.rpc("tools/list");
    const tools = list.tools as Tool[];
    expect(tools).toHaveLength(13);
    expect(nativeCatalogReason(tools, f.resourceId)).toBeNull();
    expect(nativeCatalogReason(tools.slice(1), f.resourceId)).toBe("ZMQ_NATIVE_TOOL_SET_MISMATCH");
  });
  it("executes camera actions as live tasks without changing the old result contract", async () => {
    for (const operation of [
      { name: "camera.position", params: { yaw_rad: 0.1, pitch_rad: -0.1, move_timeout_ms: 1000 } },
      { name: "camera.zoom", params: { zoom_ratio: 2, zoom_timeout_ms: 1000 } },
      {
        name: "camera.velocity",
        params: { yaw_rate_rad_s: 0.1, pitch_rate_rad_s: 0, hold_ms: 100 },
      },
    ]) {
      const accepted = await call("vehicle_zmq_camera", { operation });
      expect(accepted.taskId).toBeTypeOf("string");
      const value = await done(String(accepted.taskId));
      expect(value.status).toBe("completed");
      const result = record(record(value.result).structuredContent);
      expect(result.schemaVersion).toBe("ugv.zmq-control-result/2");
      expect(result.qualification).toBe("site_control");
    }
  });
  it("uses default sender zero and rejects duplicate navigation dispatch", async () => {
    const key = randomUUID(),
      args = {
        operation: {
          name: "navigation.point",
          params: {
            destination: { longitude: 106.001, latitude: 29 },
            speedLimitMps: 1,
            obstacleAvoidance: true,
          },
        },
      };
    const accepted = await call("vehicle_zmq_navigate", args, key);
    expect(accepted.taskId).toBeTypeOf("string");
    await until(() => f.devices.moving);
    const again = await call("vehicle_zmq_navigate", args, key);
    expect(again.taskId).toBe(accepted.taskId);
    await f.mcp.rpc("tasks/cancel", { taskId: accepted.taskId });
    expect((await done(String(accepted.taskId))).status).toBe("cancelled");
    expect(f.devices.errors).toEqual([]);
    expect(f.devices.rawChassisFrames.length).toBeGreaterThan(0);
    expect(
      f.devices.rawChassisFrames.every((frame) => {
        const d = decodeChassisFrame(frame);
        return d.systemId === "0" && d.targetSystemId === "1";
      }),
    ).toBe(true);
    expect(
      f.devices.commands.filter(
        (c) => c.component === "chassis" && c.request.type === "targetPoint",
      ),
    ).toHaveLength(1);
  });
  it("executes manual simulated effects once and preserves honest provenance", async () => {
    const args = {
        targetSource: "manual",
        sourceNote: "fixture operator selected simulated entity",
        targetId: "object-1",
        position: { longitude_deg: 106.001, latitude_deg: 29, ellipsoid_height_m: null },
      },
      key = randomUUID();
    const accepted = await call("simulation_apply_effect", args, key);
    expect(accepted.taskId).toBeTypeOf("string");
    const value = await done(String(accepted.taskId));
    const result = record(record(value.result).structuredContent);
    expect(result.schemaVersion).toBe("ugv.zmq-effect-result/2");
    expect(record(result.targetProvenance).kind).toBe("manual");
    expect(result.effect).toBe("hit");
    await call("simulation_apply_effect", args, key);
    expect(f.devices.commands.filter((c) => c.component === "simulationEffect")).toHaveLength(1);
  });
  it("scans and reports inspection incompleteness instead of fabricating empty findings", async () => {
    const args = {
      area: {
        crs: "OGC:CRS84",
        searchStrategy: "recognize",
        vertices: area.params.region_wgs84.map((p) => ({
          longitude: p.longitude_deg,
          latitude: p.latitude_deg,
          ellipsoidHeightM: p.ellipsoid_height_m,
        })),
      },
    };
    const accepted = await call("vehicle_zmq_inspect_area", args);
    expect(accepted.taskId).toBeTypeOf("string");
    await until(() => f.devices.taskState === "searching");
    await f.mcp.rpc("io.sdar/taskExecution/tasks/pause", { taskId: accepted.taskId });
    await until(() => f.devices.taskState === "paused");
    await commandAcknowledged(String(accepted.taskId), "PAUSE");
    await f.mcp.rpc("io.sdar/taskExecution/tasks/resume", { taskId: accepted.taskId });
    await until(() => f.devices.taskState === "searching");
    await commandAcknowledged(String(accepted.taskId), "RESUME");
    f.devices.completeRecon();
    const value = await done(String(accepted.taskId));
    expect(value.status).toBe("completed");
    const result = record(record(value.result).structuredContent);
    expect(result.schemaVersion).toBe("ugv.zmq-inspection-result/2");
    expect(record(result.inspectionReport).complete).toBe(false);
  });
  it("offers only task-associated device observations and records the effect source", async () => {
    const accepted = await call("vehicle_zmq_inspect_area", {
        area: {
          crs: "OGC:CRS84",
          searchStrategy: "track",
          vertices: area.params.region_wgs84.map((p) => ({
            longitude: p.longitude_deg,
            latitude: p.latitude_deg,
            ellipsoidHeightM: p.ellipsoid_height_m,
          })),
        },
      }),
      id = String(accepted.taskId);
    await until(() => f.devices.taskState === "searching");
    const execution = await f.provider.repository.get(id);
    if (!execution) throw Error("FIXTURE_EXECUTION_REQUIRED");
    const position = { longitude_deg: 106.001, latitude_deg: 29, ellipsoid_height_m: 10 };
    await f.devices.publishReport("tracklist", {
      task_id: execution.zmqControl.nativeTaskId,
      track_state: "tracking",
      track_id: "fixture-track",
      target_id: "object-1",
      observed_at_utc_ms: Date.now(),
      data_origin: "simulated",
      targets: [
        {
          image: {
            camera_id: "fixture-camera",
            frame_id: randomUUID(),
            width_px: 100,
            height_px: 100,
          },
          pixel: { x_px: 1, y_px: 1 },
          position,
          range_m: 20,
          range_source: "simulated_radial_depth",
          reason: null,
        },
      ],
    });
    let candidate: Record<string, unknown> = {};
    await until(async () => {
      const targets = await f.mcp.tool("vehicle_get_targets", { resourceId: f.resourceId });
      const candidates = record(targets.structuredContent).effectCandidates as Record<
        string,
        unknown
      >[];
      candidate = candidates[0] ?? {};
      return !!candidate.targetId;
    });
    const effect = await call("simulation_apply_effect", {
      targetId: candidate.targetId,
      position: candidate.position,
      observation: candidate.observation,
    });
    const result = record(record((await done(String(effect.taskId))).result).structuredContent);
    expect(record(result.targetProvenance).kind).toBe("observation");
    f.devices.completeRecon();
    await done(id);
  });
  it("runs area reconnaissance and circular search with real lifecycle receipts", async () => {
    for (const [tool, args] of [
      [
        "vehicle_zmq_area_recon",
        {
          area: {
            crs: "OGC:CRS84",
            searchStrategy: "recognize",
            vertices: area.params.region_wgs84.map((p) => ({
              longitude: p.longitude_deg,
              latitude: p.latitude_deg,
              ellipsoidHeightM: p.ellipsoid_height_m,
            })),
          },
        },
      ],
      [
        "vehicle_zmq_circular_recon",
        {
          params: {
            scan_mode: "circular",
            yaw_center_rad: null,
            yaw_span_rad: null,
            pitch_rad: 0,
            yaw_speed_rad_s: 0.2,
            cycle_count: 1,
            task_timeout_ms: 10000,
            search_strategy: "recognize",
          },
        },
      ],
    ] as const) {
      const accepted = await call(tool, args);
      expect(accepted.taskId).toBeTypeOf("string");
      await until(() => f.devices.taskState === "searching");
      f.devices.completeRecon();
      expect((await done(String(accepted.taskId))).status).toBe("completed");
    }
  });
  it("supports route and return-home navigation, then keeps restart outcomes unknown without replay", async () => {
    for (const op of [
      {
        name: "navigation.route",
        params: {
          waypoints: [
            { longitude: 106.001, latitude: 29 },
            { longitude: 106.002, latitude: 29 },
          ],
          speedLimitMps: 1,
          obstacleAvoidance: true,
        },
      },
      {
        name: "navigation.returnHome",
        params: { returnType: 0, waypoints: [], speedLimitMps: 1, obstacleAvoidance: true },
      },
    ]) {
      const accepted = await call("vehicle_zmq_navigate", { operation: op });
      expect(accepted.taskId).toBeTypeOf("string");
      await until(() => f.devices.moving);
      f.devices.completeNavigation();
      expect((await done(String(accepted.taskId))).status).toBe("completed");
    }
    const accepted = await call("vehicle_zmq_navigate", {
      operation: {
        name: "navigation.point",
        params: {
          destination: { longitude: 106.001, latitude: 29 },
          speedLimitMps: 1,
          obstacleAvoidance: true,
        },
      },
    });
    const id = String(accepted.taskId);
    await until(() => f.devices.moving);
    const before = f.devices.commands.length;
    await f.restartProvider();
    await until(
      async () =>
        (await f.provider.repository.get(id))?.reasonCode === "ZMQ_RESTART_OUTCOME_UNKNOWN",
    );
    expect(f.devices.commands).toHaveLength(before);
    const context = (await f.provider.repository.get(id))?.executionContext;
    if (!context) throw Error("FIXTURE_IDENTITY_REQUIRED");
    const reconciliation = {
      component: "chassis" as const,
      taskId: id,
      commandId: randomUUID(),
      reason: "fixture fresh idle and two stationary samples",
    };
    await expect(f.provider.engine.reconcileComponent(reconciliation, context)).rejects.toThrow(
      "ZMQ_",
    );
    f.devices.completeNavigation();
    await until(() => f.provider.observer.snapshot().channels.chassis.receiptFresh);
    let reconciled = false;
    await until(async () => {
      try {
        await f.provider.engine.reconcileComponent(reconciliation, context);
        reconciled = true;
        return true;
      } catch {
        return false;
      }
    });
    expect(reconciled).toBe(true);
    const original = await f.provider.repository.get(id);
    expect(original).toMatchObject({
      reasonCode: "ZMQ_RESTART_OUTCOME_UNKNOWN",
      state: "TECHNICAL_FAILED",
      zmqControl: { occupancy: "released" },
    });
    expect(await f.provider.engine.reconcileComponent(reconciliation, context)).toMatchObject({
      reasonCode: "ZMQ_RESTART_OUTCOME_UNKNOWN",
    });
    expect(f.devices.commands).toHaveLength(before);
  }, 20000);
  it("keeps prior simulation authority outside all site workers", async () => {
    const snapshot = await f.runtime.pool.query<{ snapshot_id: string }>(
        "SELECT snapshot_id FROM operation_snapshot WHERE operation_name='vehicle_zmq_camera' LIMIT 1",
      ),
      snapshotId = snapshot.rows[0]?.snapshot_id,
      id = randomUUID();
    if (!snapshotId) throw Error("FIXTURE_SNAPSHOT_REQUIRED");
    await f.runtime.pool.query(
      `INSERT INTO provider_task(task_id,provider_id,operation_name,operation_snapshot_id,authorization_context_hash,execution_mode,simulation_id,arguments,argument_hash,external_execution_id,internal_state,mcp_status,substate,accepted_at) VALUES($1,$2,'vehicle_zmq_camera',$3,$4,'simulation','SIMULATED-prior-authority',$5,$6,$7,'RUNNING','working','running',clock_timestamp())`,
      [
        id,
        f.profile.providerBinding.providerId,
        snapshotId,
        "a".repeat(64),
        { resourceId: f.resourceId },
        "b".repeat(64),
        randomUUID(),
      ],
    );
    const before = await f.runtime.pool.query(
      "SELECT version,internal_state,error,next_recovery_at FROM provider_task WHERE task_id=$1",
      [id],
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(
      (
        await f.runtime.pool.query(
          "SELECT version,internal_state,error,next_recovery_at FROM provider_task WHERE task_id=$1",
          [id],
        )
      ).rows,
    ).toEqual(before.rows);
    await f.runtime.pool.query("DELETE FROM provider_task WHERE task_id=$1", [id]);
  });
  it("validates manual provenance and rejects mixing an observed reference with manual input", () => {
    expect(() =>
      siteControlOperation("simulation_apply_effect", {
        resourceId: f.resourceId,
        targetSource: "manual",
        targetId: "manual",
        position: { longitude_deg: 106, latitude_deg: 29, ellipsoid_height_m: null },
      }),
    ).toThrow();
  });
});
