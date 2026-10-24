import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { beforeAll, afterAll, afterEach, describe, it, expect } from "vitest";
import { installObservationArchive } from "../../packages/vehicle-zmq-observer/src/index.js";
import {
  resultIdentity,
  resultDraft,
  PostgresControlRepository,
  operationFromConsoleCandidate,
  type Operation,
  type ZmqExecution,
} from "../../packages/vehicle-zmq-control/src/index.js";
import { area, request, TestClock, present } from "../ugv-zmq-control/helpers.js";
import { emptyReport } from "../ugv-zmq-observer/helpers.js";
import { SimulatedZmqDevices, releaseSimulatorEndpoints } from "./simulator.js";
import { boot, until, providerStore } from "./harness.js";

const configFile = process.env.SMPP_ZMQ_TEST_CONFIG_FILE;
const schema = "zmq_results_test_" + randomUUID().replaceAll("-", "");
let databaseUrl: string, pool: Pool;
const evidence: Record<string, unknown>[] = [];
const fixtures: { device: SimulatedZmqDevices; runtime: Awaited<ReturnType<typeof boot>> }[] = [];
function input(operation: Operation, budget = 10000) {
  const clock = new TestClock();
  clock.utc = Date.now();
  return request(clock, operation, {
    timing: {
      startAt: new Date().toISOString(),
      startToleranceMs: 60000,
      maxElapsedMs: budget,
      parentDeadlineAt: null,
    },
  });
}
async function inspecting() {
  const device = new SimulatedZmqDevices(),
    profile = await device.start(),
    runtime = await boot(databaseUrl, schema, profile);
  fixtures.push({ device, runtime });
  await runtime.ready();
  const args = {
    resourceId: present(profile.providerBinding.resourceId),
    area: {
      crs: "OGC:CRS84",
      searchStrategy: "track",
      vertices: area.params.region_wgs84.map((p) => ({
        longitude: p.longitude_deg,
        latitude: p.latitude_deg,
        ellipsoidHeightM: p.ellipsoid_height_m,
      })),
    },
  };
  const operation = operationFromConsoleCandidate("vehicle_zmq_inspect_area", args).operation;
  const e = await runtime.engine.start(input(operation));
  await until(async () => (await runtime.repository.get(e.taskId))?.state === "RUNNING");
  return { device, profile, ...runtime, e };
}
async function source(r: Awaited<ReturnType<typeof inspecting>>) {
  const current = present(await r.repository.get(r.e.taskId)),
    position = { longitude_deg: 106.001, latitude_deg: 29, ellipsoid_height_m: 10 };
  await r.device.publishReport("tracklist", {
    task_id: current.zmqControl.nativeTaskId,
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
    async () => (await r.repository.get(r.e.taskId))?.zmqInspection?.observationCount === 1,
  );
  const records = (await r.engine.results(resultIdentity(current), current.executionContext))
    .records;
  const record = present(records.find((v) => v.content.key === "tracklist"));
  const args = {
    resourceId: r.e.resourceId,
    targetId: "object-1",
    position,
    observation: {
      taskId: current.taskId,
      externalExecutionId: current.externalExecutionId,
      revision: record.revision,
    },
  };
  return operationFromConsoleCandidate("simulation_apply_effect", args).operation;
}
async function saveCase(name: string, r: Awaited<ReturnType<typeof inspecting>>, e: ZmqExecution) {
  const resultPages = [];
  let after = 0;
  do {
    const page = await r.engine.results(resultIdentity(e), e.executionContext, after);
    resultPages.push(page);
    if (!page.hasMore) break;
    after = page.nextRevision;
  } while (resultPages.length < 128);
  evidence.push({
    case: name,
    final: await r.repository.get(e.taskId),
    resultPages,
    journal: await r.store.listMutationJournal(e.taskId),
    commands: r.device.commands,
    simulatedWorld: [...r.device.simulatedWorld.entries()],
  });
}
describe.skipIf(!configFile)("SIMULATED native result pipeline + PostgreSQL", () => {
  beforeAll(async () => {
    databaseUrl = (JSON.parse(readFileSync(present(configFile), "utf8")) as { databaseUrl: string })
      .databaseUrl;
    pool = new Pool({
      connectionString: databaseUrl,
      query_timeout: 3000,
      statement_timeout: 3000,
    });
    await installObservationArchive(pool, schema);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SET LOCAL search_path = "${schema}"`);
      for (const path of [
        "migrations/providers/ugv/024_ugv_provider.sql",
        "migrations/providers/ugv/027_mutation_journal.sql",
      ])
        await c.query(readFileSync(path, "utf8"));
      await c.query("COMMIT");
    } finally {
      c.release();
    }
    if (process.env.SMPP_ZMQ_RESULTS_RAW_FILE)
      writeFileSync(process.env.SMPP_ZMQ_RESULTS_RAW_FILE, "");
  });
  afterEach(async () => {
    for (const { device, runtime: r } of fixtures.splice(0)) {
      try {
        await r.engine.close();
        await r.driver.stop();
        await r.observer.stop();
        if (process.env.SMPP_ZMQ_RESULTS_RAW_FILE)
          for (const session of await r.archive.sessions()) {
            appendFileSync(
              process.env.SMPP_ZMQ_RESULTS_RAW_FILE,
              JSON.stringify({
                kind: "session",
                partitionHash: r.scope.settings.observerPartitionHash,
                session,
              }) + "\n",
            );
            let cursor = "0";
            for (let n = 0; n < 100; n++) {
              const page = await r.archive.page(session.sessionId, cursor, 200);
              for (const entry of page.entries)
                appendFileSync(
                  process.env.SMPP_ZMQ_RESULTS_RAW_FILE,
                  JSON.stringify({
                    kind: "entry",
                    partitionHash: r.scope.settings.observerPartitionHash,
                    sessionId: session.sessionId,
                    entry,
                  }) + "\n",
                );
              if (!page.nextCursor) break;
              cursor = page.nextCursor;
              if (n === 99) throw Error("EVIDENCE_EXPORT_BOUND");
            }
          }
      } finally {
        await r.close();
        await device.close();
      }
    }
  });
  afterAll(async () => {
    releaseSimulatorEndpoints();
    if (process.env.SMPP_ZMQ_RESULTS_EVIDENCE_FILE)
      writeFileSync(
        process.env.SMPP_ZMQ_RESULTS_EVIDENCE_FILE,
        JSON.stringify({ classification: "SIMULATED_ONLY", evidence }, null, 2) + "\n",
      );
    if (pool) {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    }
  });
  it("converts the console quad without losing axes/height and retains all 300 received detections", async () => {
    const r = await inspecting();
    const native = present(await r.repository.get(r.e.taskId)).zmqControl.nativeTaskId;
    await r.device.publishReport(
      "targetlist",
      emptyReport({
        task_id: native,
        observed_at_utc_ms: null,
        truncated: true,
        targets: Array.from({ length: 300 }, (_, i) => ({
          target_id: `item-${i}`,
          category: "vehicle",
          confidence: 0.9,
          threat_level: null,
          pixel: { x_px: 2, y_px: 2 },
          bbox: null,
        })),
      }),
    );
    await until(
      async () => (await r.repository.get(r.e.taskId))?.zmqInspection?.observationCount === 300,
    );
    r.device.completeRecon();
    await until(async () => !!(await r.repository.get(r.e.taskId))?.terminalAt);
    const e = present(await r.repository.get(r.e.taskId)),
      query = await r.engine.inspectionResults(resultIdentity(e), e.executionContext);
    expect(e.result).toMatchObject({
      outcome: "partial",
      truncated: true,
      sourceTruncated: true,
      inspectionReport: { complete: false },
    });
    const record = present(query.page.records.find((v) => v.kind === "inspection_frame"));
    expect((record.content.data as { targets: unknown[] }).targets).toHaveLength(300);
    expect(
      r.device.commands.find((v) => v.request.method === "AreaSearch")?.request.params,
    ).toMatchObject({ region_wgs84: area.params.region_wgs84 });
    const draft = resultDraft(record);
    expect(await r.repository.appendResult(draft)).toEqual(record);
    await expect(
      r.repository.appendResult({ ...draft, content: { conflict: true } }),
    ).rejects.toThrow("CONFLICT");
    await expect(
      r.engine.results({ ...resultIdentity(e), simulationId: "other" }, e.executionContext),
    ).rejects.toThrow("IDENTITY");
    expect(r.device.errors).toEqual([]);
    await saveCase("inspection-300-source-truncated", r, e);
  });
  it.each(["hit", "miss", "destroyed", "failed", "unknown"])(
    "uses the simulated world's geometry/health or explicit failure for %s",
    async (outcome) => {
      const r = await inspecting(),
        operation = await source(r),
        entity = present(r.device.simulatedWorld.get("object-1"));
      if (outcome === "miss") entity.longitude += 1;
      if (outcome === "destroyed") entity.health = 0.5;
      if (outcome === "failed") r.device.effectPolicy = "fail";
      if (outcome === "unknown") r.device.effectPolicy = "unknown";
      await until(() => r.engine.availability(operation).available);
      const e = await r.engine.start(input(operation, outcome === "unknown" ? 350 : 10000));
      await until(async () => !!(await r.repository.get(e.taskId))?.terminalAt);
      const final = present(await r.repository.get(e.taskId)),
        query = await r.engine.effectResults(resultIdentity(final), final.executionContext);
      expect(query.latest?.nativeTask).toMatchObject(
        outcome === "failed" ? { state: "failed", execution_finished: true } : { effect: outcome },
      );
      expect(final.zmqControl.occupancy).toBe(outcome === "unknown" ? "held" : "released");
      expect(r.device.commands.filter((c) => c.component === "simulationEffect")).toHaveLength(1);
      if (outcome === "hit") expect(entity.health).toBe(0.4);
      if (outcome === "miss") expect(entity.health).toBe(1);
      if (outcome === "destroyed") expect(entity.health).toBeLessThanOrEqual(0);
      expect(r.device.errors).toEqual([]);
      await saveCase(`effect-${outcome}`, r, final);
    },
  );
  it("preserves the deadline terminal result, releases late confirmed occupancy and queries after storage reconnect", async () => {
    const r = await inspecting(),
      operation = await source(r);
    r.device.effectDelayMs = 700;
    const e = await r.engine.start(input(operation, 350));
    await until(async () => !!(await r.repository.get(e.taskId))?.terminalAt);
    const original = present(await r.repository.get(e.taskId));
    expect(original).toMatchObject({
      state: "TECHNICAL_FAILED",
      zmqControl: { occupancy: "held" },
    });
    await until(
      async () => (await r.repository.get(e.taskId))?.zmqControl.occupancy === "released",
    );
    const late = present(await r.repository.get(e.taskId));
    expect(late.result).toEqual(original.result);
    expect(late.terminalAt).toBe(original.terminalAt);
    const query = await r.engine.effectResults(resultIdentity(late), late.executionContext);
    expect(query).toMatchObject({
      occupancy: "released",
      latest: { late: true, nativeTask: { effect: "hit" } },
    });
    expect(query.page.records.length).toBeGreaterThanOrEqual(2);
    const reopened = providerStore(databaseUrl, schema),
      reader = new PostgresControlRepository(reopened, reopened.pool, r.scope);
    try {
      await reopened.initialize();
      expect((await reader.resultPage(resultIdentity(late))).records).toEqual(query.page.records);
    } finally {
      await reader.close();
      await reopened.close();
    }
    expect(r.device.commands.filter((c) => c.component === "simulationEffect")).toHaveLength(1);
    await saveCase("effect-deadline-late-version", r, late);
  });
  it("does not replay an effect when its REQ receipt is lost", async () => {
    const r = await inspecting(),
      operation = await source(r);
    r.device.effectReplyDelayMs = 700;
    const e = await r.engine.start(input(operation));
    await until(
      async () => (await r.repository.get(e.taskId))?.zmqControl.occupancy === "released",
    );
    const final = present(await r.repository.get(e.taskId));
    expect(r.device.commands.filter((c) => c.component === "simulationEffect")).toHaveLength(1);
    expect(
      (await r.store.listMutationJournal(e.taskId)).filter((j) => j.phase === "PRIMARY"),
    ).toMatchObject([{ state: "UNCERTAIN" }]);
    expect(
      (await r.engine.effectResults(resultIdentity(final), final.executionContext)).latest,
    ).toMatchObject({ nativeTask: { effect: "hit", execution_finished: true } });
    await saveCase("effect-lost-ack-no-replay", r, final);
  });
});
