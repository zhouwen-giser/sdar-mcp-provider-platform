import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { installObservationArchive } from "../../packages/vehicle-zmq-observer/src/index.js";
import {
  PostgresControlRepository,
  controlScope,
  type Operation,
} from "../../packages/vehicle-zmq-control/src/index.js";
import {
  camera,
  area,
  identity,
  navigation,
  request,
  TestClock,
} from "../ugv-zmq-control/helpers.js";
import { SimulatedZmqDevices, releaseSimulatorEndpoints } from "./simulator.js";
import { boot, until, providerStore } from "./harness.js";

const configFile = process.env.SMPP_ZMQ_TEST_CONFIG_FILE;
const schema = "zmq_control_test_" + randomUUID().replaceAll("-", "");
let pool: Pool, databaseUrl: string;
const cleanup: (() => Promise<void>)[] = [];
const evidence: Record<string, unknown>[] = [];
const captures: Awaited<ReturnType<typeof boot>>[] = [];
function input(operation: Operation = camera) {
  const clock = new TestClock();
  clock.utc = Date.now();
  return request(clock, operation, {
    timing: {
      startAt: new Date().toISOString(),
      startToleranceMs: 60000,
      maxElapsedMs: 10000,
      parentDeadlineAt: null,
    },
  });
}
const fixture = async () => {
  const device = new SimulatedZmqDevices(),
    profile = await device.start();
  cleanup.push(() => device.close());
  const runtime = await boot(databaseUrl, schema, profile);
  captures.push(runtime);
  cleanup.push(() => runtime.close());
  await runtime.ready();
  return { device, profile, ...runtime };
};
describe.skipIf(!configFile)("SIMULATED native control + real PostgreSQL", () => {
  beforeAll(async () => {
    if (process.env.SMPP_ZMQ_CONTROL_RAW_EVIDENCE_FILE)
      writeFileSync(process.env.SMPP_ZMQ_CONTROL_RAW_EVIDENCE_FILE, "");
    databaseUrl = z
      .object({ databaseUrl: z.string() })
      .parse(JSON.parse(readFileSync(configFile ?? "", "utf8")) as unknown).databaseUrl;
    pool = new Pool({
      connectionString: databaseUrl,
      query_timeout: 3000,
      statement_timeout: 3000,
    });
    await installObservationArchive(pool, schema);
    const owner = await pool.connect();
    try {
      await owner.query("BEGIN");
      await owner.query(`SET LOCAL search_path = "${schema}"`);
      for (const path of [
        "migrations/providers/ugv/024_ugv_provider.sql",
        "migrations/providers/ugv/027_mutation_journal.sql",
      ])
        await owner.query(readFileSync(path, "utf8"));
      await owner.query("COMMIT");
    } finally {
      owner.release();
    }
  });
  afterEach(async () => {
    try {
      for (const runtime of captures.splice(0)) {
        if (!process.env.SMPP_ZMQ_CONTROL_RAW_EVIDENCE_FILE) continue;
        await runtime.engine.close();
        await runtime.driver.stop();
        await runtime.observer.stop();
        const sessions = await runtime.archive.sessions();
        for (const session of sessions) {
          appendFileSync(
            process.env.SMPP_ZMQ_CONTROL_RAW_EVIDENCE_FILE,
            JSON.stringify({
              kind: "session",
              partitionHash: runtime.scope.settings.observerPartitionHash,
              session,
            }) + "\n",
          );
          let cursor = "0";
          for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
            const page = await runtime.archive.page(session.sessionId, cursor, 200);
            for (const entry of page.entries)
              appendFileSync(
                process.env.SMPP_ZMQ_CONTROL_RAW_EVIDENCE_FILE,
                JSON.stringify({
                  kind: "entry",
                  partitionHash: runtime.scope.settings.observerPartitionHash,
                  sessionId: session.sessionId,
                  entry,
                }) + "\n",
              );
            if (!page.nextCursor) break;
            cursor = page.nextCursor;
            if (pageNumber === 99) throw Error("SIMULATED_EVIDENCE_EXPORT_BOUND_EXCEEDED");
          }
        }
      }
    } finally {
      while (cleanup.length) await cleanup.pop()?.();
    }
  });
  afterAll(async () => {
    releaseSimulatorEndpoints();
    if (pool) {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    }
    if (process.env.SMPP_ZMQ_CONTROL_EVIDENCE_FILE)
      writeFileSync(
        process.env.SMPP_ZMQ_CONTROL_EVIDENCE_FILE,
        JSON.stringify({ classification: "SIMULATED_ONLY", evidence }, null, 2) + "\n",
      );
  });
  it("completes correlated camera work without treating the REP ACK as completion", async () => {
    const r = await fixture(),
      e = await r.engine.start(input());
    await until(async () => (await r.repository.get(e.taskId))?.state === "SUCCEEDED");
    const final = await r.repository.get(e.taskId),
      journal = await r.store.listMutationJournal(e.taskId);
    expect(journal.filter((j) => j.phase === "PRIMARY")).toHaveLength(1);
    expect(journal.find((j) => j.phase === "PRIMARY")?.state).toBe("ACCEPTED");
    expect(final?.zmqControl.latestEvidence.length).toBeGreaterThan(0);
    expect(r.device.commands.filter((c) => c.component === "eo")).toHaveLength(1);
    expect(r.device.errors).toEqual([]);
    evidence.push({
      case: "camera",
      taskId: e.taskId,
      final,
      journal,
      committed: r.observer.health.committedEvents,
    });
  });
  it("executes native navigation through mode, planning, START, pause/resume, and physical terminal evidence", async () => {
    const r = await fixture(),
      e = await r.engine.start(input(navigation));
    await until(async () => (await r.repository.get(e.taskId))?.state === "RUNNING");
    await r.engine.control("pause", identity(e));
    await until(async () => (await r.repository.get(e.taskId))?.state === "PAUSED");
    const deadline = (await r.repository.get(e.taskId))?.zmqControl.deadlineAt;
    await r.engine.control("resume", identity(e));
    await until(async () => (await r.repository.get(e.taskId))?.state === "RUNNING");
    expect((await r.repository.get(e.taskId))?.zmqControl.deadlineAt).toBe(deadline);
    r.device.completeNavigation();
    await until(async () => (await r.repository.get(e.taskId))?.state === "SUCCEEDED");
    const final = await r.repository.get(e.taskId);
    expect(final?.zmqControl.stopConfirmed).toBe(true);
    expect(r.device.commands.filter((c) => c.request.type === "targetPoint")).toHaveLength(1);
    expect(
      r.device.commands.filter((c) => c.request.type === "motionControl" && c.request.value === 1),
    ).toHaveLength(1);
    expect(r.device.errors).toEqual([]);
    evidence.push({
      case: "navigation",
      final,
      commands: r.device.commands,
      archive: r.observer.health,
    });
  });
  it("runs optical preparation and pause/resume/cancel through actual REQ/PUB strings", async () => {
    const r = await fixture(),
      e = await r.engine.start(input(area));
    await until(async () => (await r.repository.get(e.taskId))?.state === "RUNNING");
    await r.engine.control("pause", identity(e));
    await until(async () => (await r.repository.get(e.taskId))?.state === "PAUSED");
    await r.engine.control("resume", identity(e));
    await until(async () => (await r.repository.get(e.taskId))?.state === "RUNNING");
    await r.engine.control("cancel", identity(e));
    await until(async () => (await r.repository.get(e.taskId))?.state === "CANCELLED");
    expect(r.device.commands.filter((c) => c.request.method === "AreaSearch")).toHaveLength(1);
    expect(r.device.errors).toEqual([]);
    evidence.push({
      case: "optical_lifecycle",
      final: await r.repository.get(e.taskId),
      commands: r.device.commands,
    });
  });
  it("prioritizes stop during another component's mode wait and 100Hz localization ingress", async () => {
    const r = await fixture();
    r.device.emitMode = false;
    r.device.completeCamera = false;
    const nav = await r.engine.start(input(navigation));
    await until(() => r.device.commands.some((c) => c.request.type === "mode"));
    const cam = await r.engine.start(input());
    await until(() => r.device.commands.some((c) => c.request.method === "TeleControl"));
    const requestedAt = Date.now();
    await r.engine.control("cancel", identity(cam));
    await until(async () => (await r.repository.get(cam.taskId))?.state === "CANCELLED");
    const stop = r.device.commands.find(
      (c) => (c.request.params as Record<string, unknown> | undefined)?.action === "stop",
    );
    const delay = (stop?.at ?? Infinity) - requestedAt;
    expect(delay).toBeLessThan(1500);
    await r.engine.control("cancel", identity(nav));
    expect(r.device.commands.some((c) => c.request.type === "targetPoint")).toBe(false);
    expect(r.observer.health.locallyDiscardedMessages).toBe(0);
    expect(r.device.errors).toEqual([]);
    evidence.push({
      case: "stop_during_mode_and_100hz",
      requestToSimulatorReceiptMs: delay,
      archive: r.observer.health,
    });
  });
  it("enforces endpoint writer ownership, command conflict and identity isolation in PostgreSQL", async () => {
    const r = await fixture();
    r.device.completeCamera = false;
    const other = new PostgresControlRepository(r.store, r.store.pool, r.scope);
    await expect(other.start()).rejects.toThrow("WRITER_ALREADY_ACTIVE");
    const initial = input(),
      [a, b] = await Promise.all([r.engine.start(initial), r.engine.start(initial)]);
    expect(a.externalExecutionId).toBe(b.externalExecutionId);
    await expect(r.engine.start({ ...initial, resourceId: "vehicle:other" })).rejects.toThrow(
      "CONFLICT",
    );
    await expect(
      r.engine.get(a.taskId, { ...a.executionContext, authorizationContextHash: "e".repeat(64) }),
    ).rejects.toThrow("IDENTITY_MISMATCH");
    await until(async () => (await r.repository.get(a.taskId))?.state === "RUNNING");
    await r.engine.control("cancel", identity(a));
    await until(async () => (await r.repository.get(a.taskId))?.state === "CANCELLED");
    expect(
      r.device.commands.filter(
        (c) => (c.request.params as Record<string, unknown> | undefined)?.action === "position",
      ),
    ).toHaveLength(1);
  });
  it("keeps timed-out REQ work uncertain, rebuilds the socket for stop and does not replay the movement", async () => {
    const r = await fixture();
    r.device.completeCamera = false;
    r.device.replyDelayMs = 700;
    const e = await r.engine.start(input());
    await until(async () =>
      (await r.store.listMutationJournal(e.taskId)).some((j) => j.state === "UNCERTAIN"),
    );
    const requestedAt = Date.now();
    await r.engine.control("cancel", identity(e));
    await until(async () => (await r.repository.get(e.taskId))?.zmqControl.stopConfirmed === true);
    const movements = r.device.commands.filter(
        (c) => (c.request.params as Record<string, unknown> | undefined)?.action === "position",
      ),
      stops = r.device.commands.filter(
        (c) => (c.request.params as Record<string, unknown> | undefined)?.action === "stop",
      );
    expect(movements).toHaveLength(1);
    expect(stops).toHaveLength(1);
    expect((stops[0]?.at ?? Infinity) - requestedAt).toBeLessThan(1500);
    evidence.push({
      case: "lost_req_receipt",
      final: await r.repository.get(e.taskId),
      commandCount: r.device.commands.length,
      requestToSimulatorReceiptMs: (stops[0]?.at ?? 0) - requestedAt,
      limitation:
        "REP can delay receiving stop; client dispatch bound does not qualify device stopping",
    });
  });
  it("uses a prearmed stop when execution-table writes block, without waiting for the ordinary write backlog", async () => {
    const r = await fixture();
    r.device.completeCamera = false;
    const e = await r.engine.start(input());
    await until(async () => (await r.repository.get(e.taskId))?.state === "RUNNING");
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(`LOCK TABLE "${schema}".ugv_execution IN ACCESS EXCLUSIVE MODE`);
      const requestedAt = Date.now();
      await expect(r.engine.control("cancel", identity(e))).rejects.toThrow();
      await until(() =>
        r.device.commands.some(
          (c) => (c.request.params as Record<string, unknown> | undefined)?.action === "stop",
        ),
      );
      const stop = r.device.commands.find(
        (c) => (c.request.params as Record<string, unknown> | undefined)?.action === "stop",
      );
      expect((stop?.at ?? Infinity) - requestedAt).toBeLessThan(1500);
      evidence.push({
        case: "execution_write_lock_stop",
        requestToSimulatorReceiptMs: (stop?.at ?? 0) - requestedAt,
        durablePrearmedIntent: true,
      });
      await blocker.query("ROLLBACK");
      await until(
        async () => (await r.repository.get(e.taskId))?.zmqControl.occupancy === "released",
      );
      expect(
        r.device.commands.filter(
          (c) => (c.request.params as Record<string, unknown> | undefined)?.action === "stop",
        ),
      ).toHaveLength(1);
      expect(r.engine.availability(camera).available).toBe(false);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });
  it.each([
    "before_intent",
    "after_intent",
    "before_dispatch",
    "after_send",
    "before_identity",
    "before_terminal",
  ])(
    "SIGKILL at %s preserves dispatch identity and never replays a possibly sent action",
    async (checkpoint) => {
      const device = new SimulatedZmqDevices(),
        profile = await device.start();
      cleanup.push(() => device.close());
      const partition = "SIMULATED-crash:" + randomUUID(),
        initial = input(checkpoint === "before_identity" ? area : camera);
      const child = fork(new URL("./crash-child.ts", import.meta.url), [configFile ?? ""], {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      const kill = async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
        child.kill("SIGKILL");
        await exited;
      };
      cleanup.push(kill);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("SIMULATED_CHECKPOINT_TIMEOUT")), 8000);
        child.once("error", reject);
        child.on("message", (message: { type: string; code?: string }) => {
          if (message.type === "checkpoint") {
            clearTimeout(timer);
            resolve();
          } else if (message.type === "failure") {
            clearTimeout(timer);
            reject(Error(message.code));
          }
        });
        child.send({ schema, profile, partition, checkpoint, request: initial });
      });
      await kill();
      const countAtCrash = device.commands.filter((c) => c.component === "eo").length;
      const resumed = await boot(databaseUrl, schema, profile, partition);
      captures.push(resumed);
      cleanup.push(() => resumed.close());
      if (checkpoint === "before_intent" || checkpoint === "after_intent") {
        await until(
          async () => (await resumed.repository.get(initial.taskId))?.state === "SUCCEEDED",
        );
        expect(device.commands.filter((c) => c.component === "eo")).toHaveLength(1);
      } else {
        await delay(350);
        const e = await resumed.repository.get(initial.taskId);
        expect(e).toMatchObject({
          state: "TECHNICAL_FAILED",
          reasonCode: "ZMQ_RESTART_OUTCOME_UNKNOWN",
          zmqControl: { stage: "uncertain", occupancy: "held" },
        });
        expect(device.commands.filter((c) => c.component === "eo")).toHaveLength(countAtCrash);
        if (checkpoint === "before_identity")
          expect(e?.zmqControl.nativeTaskId).toBe(device.taskId);
      }
      evidence.push({
        case: "SIGKILL",
        checkpoint,
        taskId: initial.taskId,
        countAtCrash,
        final: await resumed.repository.get(initial.taskId),
        finalCommandCount: device.commands.filter((c) => c.component === "eo").length,
      });
    },
  );
  it.each([
    { name: "camera.zoom", params: { zoom_ratio: 2, zoom_timeout_ms: 1000 } },
    { name: "camera.velocity", params: { yaw_rate_rad_s: 0.1, pitch_rate_rad_s: 0, hold_ms: 300 } },
  ] satisfies Operation[])(
    "completes native $name with actual feedback and a finite device budget",
    async (operation) => {
      const r = await fixture(),
        e = await r.engine.start(input(operation));
      await until(async () => (await r.repository.get(e.taskId))?.state === "SUCCEEDED");
      expect(r.device.commands.filter((c) => c.request.method === "TeleControl")).toHaveLength(1);
      expect((await r.repository.get(e.taskId))?.zmqControl.stopConfirmed).toBe(true);
      evidence.push({ case: operation.name, final: await r.repository.get(e.taskId) });
    },
  );
  it.each([
    {
      name: "navigation.route",
      params: {
        waypoints: [{ longitude: 106.81, latitude: 29.72 }],
        speedLimitMps: 1,
        obstacleAvoidance: true,
      },
    },
    {
      name: "navigation.returnHome",
      params: { returnType: 0, waypoints: [], speedLimitMps: 1, obstacleAvoidance: true },
    },
  ] satisfies Operation[])(
    "executes native $name through a single task and START",
    async (operation) => {
      const r = await fixture(),
        e = await r.engine.start(input(operation));
      await until(async () => (await r.repository.get(e.taskId))?.state === "RUNNING");
      r.device.completeNavigation();
      await until(async () => (await r.repository.get(e.taskId))?.state === "SUCCEEDED");
      expect(
        r.device.commands.filter(
          (c) => c.request.type === "motionControl" && c.request.value === 1,
        ),
      ).toHaveLength(1);
      evidence.push({
        case: operation.name,
        final: await r.repository.get(e.taskId),
        commands: r.device.commands,
      });
    },
  );
  it("locks each shared endpoint and prevents a scene reset from clearing unresolved ownership", async () => {
    const r = await fixture();
    r.device.completeCamera = false;
    const e = await r.engine.start(input());
    await until(async () => (await r.repository.get(e.taskId))?.state === "RUNNING");
    const profile = structuredClone(r.profile);
    profile.components.chassis.commandEndpoint = "tcp://127.0.0.1:49991";
    const otherStore = providerStore(databaseUrl, schema);
    cleanup.push(() => otherStore.close());
    const overlapping = new PostgresControlRepository(
      otherStore,
      otherStore.pool,
      controlScope(profile, r.scope.settings),
    );
    await expect(overlapping.start()).rejects.toThrow("WRITER_ALREADY_ACTIVE");
    await r.engine.close();
    const reset = structuredClone(r.profile);
    reset.executionDomain.simulationId = "SIMULATED-new-scene";
    const resetStore = providerStore(databaseUrl, schema);
    cleanup.push(() => resetStore.close());
    const resetRepository = new PostgresControlRepository(
      resetStore,
      resetStore.pool,
      controlScope(reset, r.scope.settings),
    );
    await expect(resetRepository.start()).rejects.toThrow("UNRESOLVED_PREDECESSOR_SCOPE");
    expect((await r.store.getExecution(e.taskId))?.state).toBe("RUNNING");
  });
  it("prepares, starts and cancels a native sector scan without resetting its platform deadline", async () => {
    const r = await fixture(),
      e = await r.engine.start(
        input({
          name: "recon.circular",
          params: {
            scan_mode: "sector",
            yaw_center_rad: 0,
            yaw_span_rad: 1,
            pitch_rad: 0,
            yaw_speed_rad_s: 0.5,
            cycle_count: 1,
            task_timeout_ms: 5000,
            search_strategy: "recognize",
          },
        }),
      );
    await until(async () => (await r.repository.get(e.taskId))?.state === "RUNNING");
    const deadline = (await r.repository.get(e.taskId))?.zmqControl.deadlineAt;
    await r.engine.control("cancel", identity(e));
    await until(async () => (await r.repository.get(e.taskId))?.state === "CANCELLED");
    expect((await r.repository.get(e.taskId))?.zmqControl.deadlineAt).toBe(deadline);
    expect(r.device.commands.filter((c) => c.request.method === "CircularSearch")).toHaveLength(1);
    evidence.push({
      case: "sector_lifecycle",
      final: await r.repository.get(e.taskId),
      commands: r.device.commands,
    });
  });
  it("enforces a real platform deadline, retains unconfirmed stop ownership and preserves the original late result", async () => {
    const r = await fixture();
    r.device.completeCamera = false;
    r.device.stopConfirmed = false;
    const initial = input();
    initial.timing.maxElapsedMs = 400;
    const e = await r.engine.start(initial);
    await until(
      async () => (await r.repository.get(e.taskId))?.reasonCode === "ZMQ_STOP_UNCONFIRMED",
    );
    const uncertain = await r.repository.get(e.taskId);
    expect(uncertain?.zmqControl).toMatchObject({
      occupancy: "held",
      stopReason: "DEADLINE_EXCEEDED",
      stopConfirmed: false,
    });
    const original = structuredClone(uncertain?.result);
    const telecontrol = r.device.eoDevice.telecontrol as Record<string, unknown>;
    r.device.stopConfirmed = true;
    r.device.eoDevice = {
      ...r.device.eoDevice,
      ready: true,
      mode: "idle",
      telecontrol: { ...telecontrol, state: "succeeded", remaining_ms: 0 },
    };
    await r.device.publish();
    await until(
      async () => (await r.repository.get(e.taskId))?.zmqControl.occupancy === "released",
    );
    const late = await r.repository.get(e.taskId);
    expect(late?.reasonCode).toBe("ZMQ_STOP_UNCONFIRMED");
    expect(late?.result).toEqual(original);
    expect(
      r.device.commands.filter(
        (c) => (c.request.params as Record<string, unknown> | undefined)?.action === "stop",
      ),
    ).toHaveLength(1);
    evidence.push({
      case: "deadline_stop_unconfirmed_then_late",
      originalResult: original,
      final: late,
      commands: r.device.commands,
    });
  });
  it("keeps interrupted source ownership unknown even if a replacement reports the same native task ID complete", async () => {
    const r = await fixture(),
      e = await r.engine.start(input(area));
    await until(async () => (await r.repository.get(e.taskId))?.state === "RUNNING");
    const count = r.device.commands.length,
      endpoint = r.profile.components.eo.publicationEndpoint;
    await r.device.eoPub.unbind(endpoint);
    await until(
      async () =>
        (await r.repository.get(e.taskId))?.reasonCode === "ZMQ_SOURCE_RESTART_UNVERIFIABLE",
    );
    r.device.completeRecon();
    await r.device.eoPub.bind(endpoint);
    await delay(200);
    const final = await r.repository.get(e.taskId);
    expect(final).toMatchObject({
      state: "TECHNICAL_FAILED",
      reasonCode: "ZMQ_SOURCE_RESTART_UNVERIFIABLE",
      zmqControl: { stage: "uncertain", occupancy: "held", nativeTaskId: r.device.taskId },
    });
    expect(r.device.commands).toHaveLength(count);
    await expect(r.engine.control("cancel", identity(e))).rejects.toThrow(
      "RESTART_RECONCILIATION_REQUIRED",
    );
    evidence.push({ case: "source_interruption_and_native_id_reuse", final, commandCount: count });
  });
});
