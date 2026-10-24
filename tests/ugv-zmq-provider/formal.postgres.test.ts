import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readZmqHandoffState } from "../../packages/vehicle-zmq-control/src/handoff.js";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { createRuntime } from "../../apps/runtime/src/runtime.js";
import { loadRuntimeConfig } from "../../apps/runtime/src/config.js";
import { openZmqProvider } from "../../apps/ugv-zmq-provider-adapter/src/bootstrap.js";
import { runUgvProviderMigrations } from "../../apps/ugv-provider-adapter/src/migrate.js";
import { installObservationArchive } from "../../packages/vehicle-zmq-observer/src/index.js";
import {
  BoundExecutionScope,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";
import { isZmqExecution, resultIdentity } from "../../packages/vehicle-zmq-control/src/index.js";
import { ZMQ_PROVIDER_TOOLS } from "../../packages/vehicle-zmq-control/src/catalog.js";
import { nativeCatalogReason } from "../../apps/ugv-control-console/shared/zmq-native.js";
import type { Tool } from "../../apps/ugv-control-console/shared/model.js";
import { settings, emptyReport } from "../ugv-zmq-observer/helpers.js";
import { area, testScope, present } from "../ugv-zmq-control/helpers.js";
import {
  SimulatedZmqDevices,
  releaseSimulatorEndpoints,
} from "../ugv-zmq-control-postgres/simulator.js";
import { until } from "../ugv-zmq-control-postgres/harness.js";
const file = process.env.SMPP_ZMQ_TEST_CONFIG_FILE,
  suffix = randomUUID().replaceAll("-", "");
const schemas = ["zmq5_provider_" + suffix, "zmq5_runtime_" + suffix, "zmq5_archive_" + suffix];
let provider: Awaited<ReturnType<typeof openZmqProvider>>,
  runtime: ReturnType<typeof createRuntime>,
  device: SimulatedZmqDevices,
  admin: Pool,
  endpoint: string,
  resourceId: string,
  simId: string;
const evidence: Record<string, unknown>[] = [];
async function rpc(
  method: string,
  params: Record<string, unknown>,
  name?: string,
  simulationId = simId,
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...(name ? { "mcp-name": name } : {}),
      "x-sdar-execution-mode": "simulation",
      "x-sdar-simulation-id": simulationId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "zmq-formal-native-test", version: "1.0" },
          "io.modelcontextprotocol/clientCapabilities": {
            extensions: {
              "io.modelcontextprotocol/tasks": {},
              "io.sdar/taskBusiness": { profileVersion: "1.0-rc2" },
            },
          },
          ...((params._meta as Record<string, unknown>) ?? {}),
        },
      },
    }),
  });
  const body = (await response.json()) as { result?: Record<string, unknown>; error?: unknown };
  evidence.push({ method, params, httpStatus: response.status, body });
  return body;
}
async function call(
  name: string,
  args: Record<string, unknown>,
  budget = 10000,
  key = randomUUID(),
) {
  return rpc(
    "tools/call",
    {
      name,
      arguments: args,
      _meta: {
        "io.sdar/taskExecution": {
          profileVersion: "1.0",
          idempotencyKey: key,
          timing: { start: { mode: "immediate", startToleranceMs: 60000 }, maxElapsedMs: budget },
        },
      },
    },
    name,
  );
}
async function task(taskId: string) {
  return present((await rpc("tasks/get", { taskId }, taskId)).result);
}
async function done(taskId: string) {
  await until(async () =>
    ["completed", "failed", "cancelled"].includes(String((await task(taskId)).status)),
  );
  return task(taskId);
}
const args = () => ({
  resourceId,
  area: {
    crs: "OGC:CRS84",
    searchStrategy: "track",
    vertices: area.params.region_wgs84.map((p) => ({
      longitude: p.longitude_deg,
      latitude: p.latitude_deg,
      ellipsoidHeightM: p.ellipsoid_height_m,
    })),
  },
});
let inspectionTaskId: string;
describe.skipIf(!file)("formal Runtime -> gRPC -> native ZMQ -> PostgreSQL", () => {
  beforeAll(async () => {
    const config = JSON.parse(readFileSync(present(file), "utf8")) as { databaseUrl: string };
    if (new URL(config.databaseUrl).hostname !== "127.0.0.1")
      throw Error("ISOLATED_DATABASE_REQUIRED");
    admin = new Pool({ connectionString: config.databaseUrl, max: 2 });
    for (const name of schemas) await admin.query(`CREATE SCHEMA ${name}`);
    const db = (schema: string) => {
      const u = new URL(config.databaseUrl);
      u.searchParams.set("options", "-c search_path=" + schema);
      return u.toString();
    };
    const migration = new Pool({ connectionString: db(present(schemas[0])), max: 1 });
    try {
      await runUgvProviderMigrations(migration);
    } finally {
      await migration.end();
    }
    await installObservationArchive(admin, present(schemas[2]));
    device = new SimulatedZmqDevices();
    const profile = await device.start();
    resourceId = present(profile.providerBinding.resourceId);
    simId = present(profile.executionDomain.simulationId);
    provider = await openZmqProvider({
      databaseUrl: db(present(schemas[0])),
      observationDatabaseUrl: config.databaseUrl,
      profile,
      observerSettings: settings({
        schema: present(schemas[2]),
        diagnosticPartition: "SIMULATED-formal:" + suffix,
        flushIntervalMs: 5,
      }),
      controlSettings: testScope().settings,
    });
    await until(
      () =>
        provider.engine.availability({
          name: "camera.zoom",
          params: { zoom_ratio: 2, zoom_timeout_ms: 1000 },
        }).available,
    );
    runtime = createRuntime(
      loadRuntimeConfig({
        RUNTIME_ENV: "test",
        PROVIDER_ID: present(profile.providerBinding.providerId),
        DATABASE_URL: db(present(schemas[1])),
        ADAPTER_ENDPOINT: `127.0.0.1:${provider.port}`,
        ADAPTER_TLS_MODE: "disabled",
        AUTH_MODE: "development",
        LOG_LEVEL: "error",
        OTEL_ENABLED: "false",
        PROVIDER_TELEMETRY_INGRESS_ENABLED: "false",
        BUSINESS_EVENTS_ENABLED: "true",
        SCHEDULER_POLL_MS: "100",
        BUSINESS_EVENTS_POLL_INTERVAL_MS: "100",
        RATE_LIMIT_MAX: "100000",
      }),
    );
    await runtime.initialize();
    await runtime.app.listen({ host: "127.0.0.1", port: 0 });
    const address = runtime.app.server.address();
    if (!address || typeof address === "string") throw Error("HTTP_FIXTURE_REQUIRED");
    endpoint = `http://127.0.0.1:${address.port}/mcp`;
  }, 30000);
  afterAll(async () => {
    try {
      if (provider) {
        await provider.engine.close();
        await provider.driver.stop();
        await provider.observer.stop();
        const raw = process.env.SMPP_ZMQ_FORMAL_RAW_FILE;
        if (raw) {
          writeFileSync(raw, "");
          for (const s of await provider.archive.sessions()) {
            appendFileSync(
              raw,
              JSON.stringify({
                kind: "session",
                partitionHash: provider.scope.settings.observerPartitionHash,
                session: s,
              }) + "\n",
            );
            let cursor = "0";
            for (let n = 0; n < 100; n++) {
              const p = await provider.archive.page(s.sessionId, cursor, 200);
              for (const entry of p.entries)
                appendFileSync(
                  raw,
                  JSON.stringify({
                    kind: "entry",
                    partitionHash: provider.scope.settings.observerPartitionHash,
                    sessionId: s.sessionId,
                    entry,
                  }) + "\n",
                );
              if (!p.nextCursor) break;
              cursor = p.nextCursor;
              if (n === 99) throw Error("EVIDENCE_EXPORT_BOUND");
            }
          }
        }
        const retained = await provider.store.pool.query<{ payload: ProviderExecution }>(
          "SELECT payload FROM ugv_execution",
        );
        for (const row of retained.rows) {
          const e = row.payload;
          if (!isZmqExecution(e)) continue;
          const pages = [];
          let after = 0;
          for (let n = 0; n < 100; n++) {
            const page = await provider.repository.resultPage(resultIdentity(e), after);
            pages.push(page);
            if (!page.hasMore) break;
            after = page.nextRevision;
            if (n === 99) throw Error("RESULT_EXPORT_BOUND");
          }
          evidence.push({ final: e, resultPages: pages });
        }
        evidence.push({
          commands: device.commands,
          executions: (await provider.store.pool.query("SELECT payload FROM ugv_execution")).rows,
          journal: (await provider.store.pool.query("SELECT payload FROM ugv_mutation_journal"))
            .rows,
          runtimeCommands: (
            await runtime.pool.query(
              "SELECT task_id,command_sequence,command_type,state,adapter_ack,last_error_code,attempt_count FROM task_command",
            )
          ).rows,
        });
      }
    } finally {
      await runtime?.app.close();
      await provider?.close();
      await device?.close();
      releaseSimulatorEndpoints();
      if (admin) {
        for (const schema of schemas) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      }
      if (process.env.SMPP_ZMQ_FORMAL_EVIDENCE_FILE)
        writeFileSync(
          process.env.SMPP_ZMQ_FORMAL_EVIDENCE_FILE,
          JSON.stringify(
            { classification: "ISOLATED_FORMAL_RUNTIME_SIMULATED_ONLY", evidence },
            null,
            2,
          ),
        );
    }
  }, 30000);
  it("discovers the exact formal catalog and reads the V2 state without MQTT fields", async () => {
    const tools = present((await rpc("tools/list", {})).result).tools as Tool[];
    expect(tools.map((t) => t.name).sort()).toEqual([...ZMQ_PROVIDER_TOOLS].sort());
    expect(nativeCatalogReason(tools, resourceId)).toBeNull();
    expect(
      tools.find((t) => t.name === "simulation_apply_effect")?._meta?.["io.sdar/taskExecution"],
    ).toMatchObject({
      taskBehavior: "task_required",
      supportsCancellation: false,
      supportsPauseResume: false,
    });
    const read = await rpc(
      "tools/call",
      { name: "vehicle_get_state", arguments: { resourceId } },
      "vehicle_get_state",
    );
    expect(read.error).toBeUndefined();
    expect(read.result?.structuredContent).toMatchObject({
      schemaVersion: "ugv.vehicle-observation-state/2.0",
      readOnly: true,
      sourceProducerEpoch: null,
    });
    expect(JSON.stringify(read.result)).not.toContain("mqttConnected");
  });
  it.skipIf(!process.env.SMPP_ZMQ_SDAR_ROOT)(
    "matches the catalog through the real SDAR frozen discovery adapter without controls",
    async () => {
      const root = present(process.env.SMPP_ZMQ_SDAR_ROOT),
        before = device.commands.length;
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ["--import", "tsx", "scripts/ugv-zmq/verify-smpp-catalog.mts", endpoint],
        { cwd: root, timeout: 15000, maxBuffer: 1048576 },
      );
      const report = JSON.parse(stdout) as Record<string, unknown>;
      expect(report).toMatchObject({
        toolCount: 12,
        physicalInvocationCount: 0,
        sdarGovernancePublication: false,
      });
      expect(device.commands).toHaveLength(before);
      evidence.push({ crossRepositoryCatalog: report });
    },
    20000,
  );
  it("rejects invalid areas, excess timing and simulation-domain drift before dispatch", async () => {
    const before = device.commands.length;
    expect(
      (
        await call("vehicle_zmq_inspect_area", {
          ...args(),
          area: { ...args().area, excludedZones: [] },
        })
      ).error,
    ).toBeDefined();
    const old = await call("vehicle_zmq_inspect_area", args(), 300001);
    expect(old.error ?? old.result?.isError).toBeTruthy();
    const other = await rpc(
      "tools/call",
      { name: "vehicle_zmq_inspect_area", arguments: args() },
      "vehicle_zmq_inspect_area",
      "other-simulation",
    );
    expect(other.error ?? other.result?.isError).toBeTruthy();
    expect(device.commands).toHaveLength(before);
  });
  it("keeps public inspection identity, supports lifecycle and finalizes an incomplete report", async () => {
    const key = randomUUID(),
      first = await call("vehicle_zmq_inspect_area", args(), 10000, key);
    expect(first.error).toBeUndefined();
    expect(first.result?.resultType).toBe("task");
    inspectionTaskId = String(first.result?.taskId);
    const again = await call("vehicle_zmq_inspect_area", args(), 10000, key);
    expect(again.result?.taskId).toBe(inspectionTaskId);
    await until(async () => (await provider.repository.get(inspectionTaskId))?.state === "RUNNING");
    let e = present(await provider.repository.get(inspectionTaskId));
    expect(e.operationName).toBe("vehicle_zmq_inspect_area");
    expect(e.zmqControl.timing.maxElapsedMs).toBe(10000);
    expect(e.zmqControl.timing.parentDeadlineAt).not.toBeNull();
    const c = await rpc(
      "io.sdar/taskBusiness/context/get",
      { taskId: inspectionTaskId, maxPageBytes: 65536 },
      inspectionTaskId,
    );
    expect(c.result?.snapshot).toMatchObject({
      context: {
        identity: { taskId: inspectionTaskId, operationName: "vehicle_zmq_inspect_area" },
      },
    });
    await rpc("io.sdar/taskExecution/tasks/pause", { taskId: inspectionTaskId }, inspectionTaskId);
    await until(async () => {
      const r = await runtime.pool.query<{ state: string }>(
        "SELECT state FROM task_command WHERE task_id=$1 AND command_type='PAUSE'",
        [inspectionTaskId],
      );
      return r.rows[0]?.state === "ACKNOWLEDGED";
    });
    await until(async () => (await provider.repository.get(inspectionTaskId))?.state === "PAUSED");
    await rpc("io.sdar/taskExecution/tasks/resume", { taskId: inspectionTaskId }, inspectionTaskId);
    await until(async () => {
      const r = await runtime.pool.query<{ state: string }>(
        "SELECT state FROM task_command WHERE task_id=$1 AND command_type='RESUME'",
        [inspectionTaskId],
      );
      return r.rows[0]?.state === "ACKNOWLEDGED";
    });
    await until(async () => (await provider.repository.get(inspectionTaskId))?.state === "RUNNING");
    e = present(await provider.repository.get(inspectionTaskId));
    await device.publishReport(
      "targetlist",
      emptyReport({
        task_id: e.zmqControl.nativeTaskId,
        observed_at_utc_ms: Date.now(),
        targets: [],
      }),
    );
    await until(
      async () =>
        (await provider.repository.get(inspectionTaskId))?.zmqInspection?.targetReportCount === 1,
    );
    device.completeRecon();
    const final = await done(inspectionTaskId);
    expect(final.result).toMatchObject({
      structuredContent: {
        schemaVersion: "ugv.zmq-inspection-result/1",
        inspectionReport: { absenceConclusion: "no_observations_in_received_frames" },
      },
    });
    const context = await provider.business.service.business.getContext(
      BoundExecutionScope.fromExecution(
        present(await provider.store.getExecution(inspectionTaskId)),
      ),
    );
    expect(context?.summary.status).toBe("finalized");
    expect(context?.artifactRefs).toEqual([]);
    expect(context?.summary.properties).toMatchObject({ completeSpatialEvidence: false });
    const queryResult = await rpc(
      "tools/call",
      {
        name: "vehicle_get_inspection_result",
        arguments: {
          resourceId,
          taskId: inspectionTaskId,
          executionId: e.externalExecutionId,
          afterRevision: 0,
          limit: 8,
        },
      },
      "vehicle_get_inspection_result",
    );
    expect(queryResult.error).toBeUndefined();
    expect(queryResult.result?.structuredContent).toMatchObject({
      identity: { operationName: "vehicle_zmq_inspect_area" },
      page: { historySource: "platform_retained_only" },
    });
    expect(device.commands.filter((d) => d.request.method === "AreaSearch")).toHaveLength(1);
  });
  it("executes native navigation and camera through Task-required tools", async () => {
    const n = await call("vehicle_zmq_navigate", {
      resourceId,
      operation: {
        name: "navigation.point",
        params: {
          destination: { longitude: 106.001, latitude: 29 },
          speedLimitMps: 1,
          obstacleAvoidance: true,
        },
      },
    });
    expect(n.error).toBeUndefined();
    const id = String(n.result?.taskId);
    await until(async () => (await provider.repository.get(id))?.state === "RUNNING");
    device.completeNavigation();
    expect((await done(id)).status).toBe("completed");
    const camera = await call("vehicle_zmq_camera", {
      resourceId,
      operation: { name: "camera.zoom", params: { zoom_ratio: 2, zoom_timeout_ms: 1000 } },
    });
    expect(camera.error).toBeUndefined();
    expect((await done(String(camera.result?.taskId))).status).toBe("completed");
  });
  it("retains a terminal Context while a timed-out simulated effect acquires a late result", async () => {
    const scan = await call("vehicle_zmq_inspect_area", args(), 10000);
    const scanId = String(scan.result?.taskId);
    await until(async () => (await provider.repository.get(scanId))?.state === "RUNNING");
    let s = present(await provider.repository.get(scanId));
    const position = { longitude_deg: 106.001, latitude_deg: 29, ellipsoid_height_m: 10 };
    await device.publishReport("tracklist", {
      task_id: s.zmqControl.nativeTaskId,
      track_state: "tracking",
      track_id: "track-1",
      target_id: "object-1",
      observed_at_utc_ms: Date.now(),
      data_origin: "simulated",
      targets: [
        {
          image: { camera_id: "camera-1", frame_id: randomUUID(), width_px: 100, height_px: 100 },
          pixel: { x_px: 1, y_px: 1 },
          position,
          range_m: 20,
          range_source: "simulated_radial_depth",
          reason: null,
        },
      ],
    });
    await until(
      async () => (await provider.repository.get(scanId))?.zmqInspection?.observationCount === 1,
    );
    s = present(await provider.repository.get(scanId));
    const records = (await provider.engine.results(resultIdentity(s), s.executionContext)).records;
    const rev = present(records.find((r) => r.kind === "inspection_frame")).revision;
    device.effectDelayMs = 2400;
    const effect = await call(
      "simulation_apply_effect",
      {
        resourceId,
        targetId: "object-1",
        position,
        observation: { taskId: scanId, externalExecutionId: s.externalExecutionId, revision: rev },
      },
      1000,
    );
    expect(effect.error).toBeUndefined();
    const effectId = String(effect.result?.taskId);
    await until(async () => Boolean((await provider.repository.get(effectId))?.terminalAt));
    const e = present(await provider.repository.get(effectId));
    const original = structuredClone(e.result),
      scope = BoundExecutionScope.fromExecution(e);
    await until(
      async () =>
        (await provider.business.service.business.getContext(scope))?.summary.status ===
        "finalized",
    );
    const context = await provider.business.service.business.getContext(scope);
    expect(context?.summary.status).toBe("finalized");
    await until(
      async () => (await provider.repository.get(effectId))?.zmqEffect?.executionFinished === true,
    );
    await until(
      async () => (await provider.repository.get(effectId))?.zmqControl.occupancy === "released",
    );
    const supplemental = await rpc(
      "tools/call",
      {
        name: "simulation_get_effect_result",
        arguments: {
          resourceId,
          taskId: effectId,
          executionId: e.externalExecutionId,
          afterRevision: 0,
          limit: 8,
        },
      },
      "simulation_get_effect_result",
    );
    expect(supplemental.error).toBeUndefined();
    expect(supplemental.result?.structuredContent).toMatchObject({
      executionFinished: true,
      occupancy: "released",
      latest: { nativeTask: { effect: "hit" } },
    });
    expect((await provider.repository.get(effectId))?.result).toEqual(original);
    expect(await provider.business.service.business.getContext(scope)).toEqual(context);
    const foreign = await rpc(
      "tools/call",
      {
        name: "simulation_get_effect_result",
        arguments: {
          resourceId,
          taskId: effectId,
          executionId: e.externalExecutionId,
          afterRevision: 0,
          limit: 8,
        },
      },
      "simulation_get_effect_result",
      "other-simulation",
    );
    expect(foreign.error ?? foreign.result?.isError).toBeTruthy();
    device.completeRecon();
    await done(scanId);
    expect(device.commands.filter((d) => d.request.method === "AttackTarget")).toHaveLength(1);
  }, 20000);
  it("checks durable handoff state without treating idle counts as switching authority", async () => {
    await until(
      async () =>
        (
          await readZmqHandoffState(
            runtime.pool,
            provider.store.pool,
            present(provider.scope.profile.providerBinding.providerId),
          )
        ).databaseIdle,
    );
    const report = await readZmqHandoffState(
      runtime.pool,
      provider.store.pool,
      present(provider.scope.profile.providerBinding.providerId),
    );
    expect(report).toMatchObject({
      databaseIdle: true,
      unresolvedNativeOccupancy: 0,
      switchAuthorized: false,
    });
    evidence.push({ handoff: report });
  });
});
