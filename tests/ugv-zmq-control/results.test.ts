import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { area, device, identity, request, rig, task, present, navigation } from "./helpers.js";
import { emptyReport, eoFrames } from "../ugv-zmq-observer/helpers.js";
import {
  Operation,
  ZmqControlEngine,
  resultIdentity,
  resultDraft,
  emptyInspection,
} from "../../packages/vehicle-zmq-control/src/index.js";
import type { Operation as Op } from "../../packages/vehicle-zmq-control/src/index.js";
const inspection = { ...area, name: "inspection.area" } as const;
async function inspecting() {
  const r = await rig(),
    accepted = await r.engine.start(request(r.clock, inspection));
  await r.pulse();
  let e = present(await r.repository.get(accepted.taskId));
  await r.eo(
    "device_status",
    device({ mode: "task", ready: false, active_task_id: e.zmqControl.nativeTaskId }),
  );
  await r.eo("task_status", task(present(e.zmqControl.nativeTaskId), "ready"));
  await r.pulse();
  e = present(await r.repository.get(accepted.taskId));
  await r.eo("task_status", task(present(e.zmqControl.nativeTaskId), "searching"));
  return { ...r, e, current: () => r.repository.get(e.taskId) };
}
const detection = (id: string) => ({
  target_id: id,
  category: "vehicle",
  confidence: 0.9,
  threat_level: null,
  pixel: { x_px: 10, y_px: 10 },
  bbox: null,
});
async function report(r: Awaited<ReturnType<typeof inspecting>>, extra = {}) {
  await r.eo(
    "targetlist",
    emptyReport({
      task_id: r.e.zmqControl.nativeTaskId,
      observed_at_utc_ms: r.clock.utc,
      image: { camera_id: "camera-1", frame_id: randomUUID(), width_px: 1920, height_px: 1080 },
      ...extra,
    }),
  );
}
async function finish(r: Awaited<ReturnType<typeof inspecting>>) {
  const complete = task(present(r.e.zmqControl.nativeTaskId), "completed");
  Object.assign(complete.task, { coverage_ratio: 1, coverage_complete: true });
  await r.eo("task_status", complete);
  await r.eo("device_status", device());
  await r.pulse();
  return present(await r.current());
}
async function effectReady(budget = 300000) {
  const r = await inspecting(),
    position = { longitude_deg: 106.001, latitude_deg: 29, ellipsoid_height_m: 10 };
  await r.eo("tracklist", {
    task_id: r.e.zmqControl.nativeTaskId,
    track_state: "tracking",
    track_id: "track-1",
    target_id: "object-1",
    observed_at_utc_ms: r.clock.utc,
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
  const source = present(await r.current()),
    page = await r.engine.results(resultIdentity(source), source.executionContext),
    record = present(page.records.find((v) => v.content.key === "tracklist"));
  await r.effect("device_status", {
    mode: "idle",
    ready: true,
    active_task_id: null,
    fault_code: null,
    fault_message: null,
  });
  const operation: Op = {
    name: "simulation.applyEffect",
    params: {
      targetId: "object-1",
      position,
      observation: {
        taskId: source.taskId,
        externalExecutionId: source.externalExecutionId,
        revision: record.revision,
      },
    },
  };
  const accepted = await r.engine.start(
    request(r.clock, operation, {
      timing: {
        startAt: new Date(r.clock.utc).toISOString(),
        startToleranceMs: 60000,
        maxElapsedMs: budget,
        parentDeadlineAt: null,
      },
    }),
  );
  await r.pulse();
  const e = present(await r.repository.get(accepted.taskId));
  const command = present(e.zmqControl.commands.find((c) => c.action === "effect"));
  const native = {
    task_id: e.zmqControl.nativeTaskId,
    request_id: command.requestId,
    target_id: "object-1",
    position,
    state: "executing",
    execution_finished: false,
    effect: "unknown",
    reason: null,
  };
  return {
    ...r,
    operation,
    effectTask: e,
    native,
    effectCurrent: () => r.repository.get(e.taskId),
  };
}
describe("SIMULATED inspection source and effect revisions", () => {
  it.each([
    [0, false],
    [1, false],
    [1, null],
    [1, true],
  ])("never converts coverage %s/%s into complete source evidence", async (ratio, complete) => {
    const r = await inspecting();
    try {
      await report(r);
      const state = task(present(r.e.zmqControl.nativeTaskId), "completed");
      Object.assign(state.task, { coverage_ratio: ratio, coverage_complete: complete });
      await r.eo("task_status", state);
      await r.eo("device_status", device());
      await r.pulse();
      const e = present(await r.current()),
        output = present(e.result);
      expect(output).toMatchObject({
        outcome: "partial",
        inspectionReport: {
          complete: false,
          absenceConclusion: "no_observations_in_received_frames",
        },
        coverageEvidence: { ratio, complete },
      });
      expect(output.missingEvidence).toContain("SOURCE_STREAM_COMPLETENESS_UNVERIFIED");
      if (complete !== true)
        expect(output.missingEvidence).toContain("COVERAGE_INSUFFICIENT_OR_UNVERIFIED");
    } finally {
      await r.engine.close();
    }
  });
  it("retains received reports, caps inline observations at 256 and never invents detection locations", async () => {
    const r = await inspecting();
    try {
      await report(r, {
        observed_at_utc_ms: null,
        truncated: true,
        targets: Array.from({ length: 300 }, (_, i) => detection(`item-${i}`)),
      });
      const e = await finish(r),
        page = await r.engine.results(resultIdentity(e), e.executionContext),
        full = present(page.records.find((v) => v.content.key === "targetlist"));
      expect(e.result).toMatchObject({
        truncated: true,
        sourceTruncated: true,
        observationCount: 300,
      });
      expect(e.zmqInspection?.anomalies).toHaveLength(256);
      expect(e.zmqInspection?.anomalies[0]).toMatchObject({
        longitude: null,
        latitude: null,
        observedAt: null,
      });
      expect((full.content.data as { targets: unknown[] }).targets).toHaveLength(300);
      expect(e.result?.missingEvidence).toEqual(
        expect.arrayContaining(["SOURCE_TRUNCATED_NOT_RECOVERABLE", "ACQUISITION_TIME_UNKNOWN"]),
      );
    } finally {
      await r.engine.close();
    }
  });
  it("rejects historical, cross-task, duplicate, conflicting and wrong-device reports", async () => {
    const r = await inspecting();
    try {
      await report(r, { task_id: "old-task", targets: [detection("a")] });
      await report(r, { observed_at_utc_ms: r.clock.utc - 10000, targets: [detection("a")] });
      const frames = eoFrames(
        "targetlist",
        emptyReport({ task_id: r.e.zmqControl.nativeTaskId, targets: [detection("a")] }),
        r.clock.utc + 1,
      );
      r.clock.advance(1);
      await r.receive("eo", frames);
      r.clock.advance(1);
      const repeated = r.normalizer.receive("eo", frames, {
        receivedAt: new Date(r.clock.utc).toISOString(),
        monotonicNs: String(r.clock.mono * 1000000),
        clockId: "SIMULATED-clock",
      });
      expect(repeated.projectable).toBe(false);
      r.engine.observe(repeated, {
        partitionHash: r.scope.settings.observerPartitionHash,
        sessionId: r.scope.settings.observerSessionId,
        ordinal: "999",
        entryHash: "f".repeat(64),
      });
      await r.engine.idle();
      const e = await finish(r);
      expect(e.zmqInspection?.observationCount).toBe(1);
      const mismatched = { ...resultIdentity(e), resourceId: "another-resource" };
      await expect(r.engine.results(mismatched, e.executionContext)).rejects.toThrow(
        "IDENTITY_MISMATCH",
      );
      await expect(
        r.engine.results(resultIdentity(e), {
          ...e.executionContext,
          authorizationContextHash: "e".repeat(64),
        }),
      ).rejects.toThrow("IDENTITY_MISMATCH");
    } finally {
      await r.engine.close();
    }
  });
  it("does not interpret missing target reports as no observations", async () => {
    const r = await inspecting();
    try {
      const e = await finish(r);
      expect(e.result).toMatchObject({
        inspectionReport: { completion: "unavailable", absenceConclusion: "unavailable" },
      });
    } finally {
      await r.engine.close();
    }
  });
  it.each(["hit", "miss", "destroyed", "unknown"])(
    "keeps execution success independent from referee effect %s",
    async (effect) => {
      const r = await effectReady();
      try {
        await r.effect("task_status", {
          task: { ...r.native, state: "succeeded", execution_finished: true, effect },
        });
        await r.effect("device_status", {
          mode: "idle",
          ready: true,
          active_task_id: null,
          fault_code: null,
          fault_message: null,
        });
        const e = present(await r.effectCurrent());
        expect(e).toMatchObject({
          state: "SUCCEEDED",
          result: { executionState: "succeeded", effect },
          zmqControl: { occupancy: "released" },
        });
        await expect(r.engine.control("cancel", identity(e))).rejects.toThrow(
          "CONTROL_UNSUPPORTED",
        );
        const wire = r.transport.commands.filter((c) => c.component === "simulationEffect");
        expect(wire).toHaveLength(1);
        expect(
          JSON.parse(Buffer.from(present(present(wire[0]).frames[0]), "base64").toString()),
        ).toMatchObject({ method: "AttackTarget", params: { target_id: "object-1" } });
      } finally {
        await r.engine.close();
      }
    },
  );
  it("retains timeout occupancy and original terminal result while versioning late completion", async () => {
    const r = await effectReady(100);
    try {
      await r.effect("task_status", { task: r.native });
      r.clock.advance(101);
      await r.seed();
      await r.effect("device_status", {
        mode: "busy",
        ready: false,
        active_task_id: r.native.task_id,
        fault_code: null,
        fault_message: null,
      });
      await r.pulse();
      const timed = present(await r.effectCurrent());
      expect(timed).toMatchObject({
        state: "TECHNICAL_FAILED",
        reasonCode: "DEADLINE_EXCEEDED",
        zmqControl: { occupancy: "held" },
      });
      await r.effect("task_status", {
        task: { ...r.native, state: "succeeded", execution_finished: true, effect: "miss" },
      });
      await r.effect("device_status", {
        mode: "idle",
        ready: true,
        active_task_id: null,
        fault_code: null,
        fault_message: null,
      });
      const late = present(await r.effectCurrent());
      expect(late.result).toEqual(timed.result);
      expect(late.state).toBe(timed.state);
      expect(late.terminalAt).toBe(timed.terminalAt);
      const query = await r.engine.effectResults(resultIdentity(late), late.executionContext);
      expect(query).toMatchObject({
        occupancy: "released",
        latest: { late: true, nativeTask: { effect: "miss" } },
      });
      expect(query.page.records.map((v) => v.revision)).toEqual([1, 2]);
      expect(query.missingEvidence).not.toContain("SIMULATION_EXECUTION_NOT_CONFIRMED_FINISHED");
      expect((query.originalTask.result as Record<string, unknown>).missingEvidence).toContain(
        "SIMULATION_EXECUTION_NOT_CONFIRMED_FINISHED",
      );
      expect(r.transport.commands.filter((c) => c.component === "simulationEffect")).toHaveLength(
        1,
      );
    } finally {
      await r.engine.close();
    }
  });
  it("keeps uncertain executions fenced after restart without replay", async () => {
    const r = await effectReady();
    try {
      await r.engine.close();
      const restarted = new ZmqControlEngine(r.scope, r.repository, r.transport, r.clock);
      await restarted.initialize();
      try {
        const e = present(await r.effectCurrent());
        expect(e).toMatchObject({ state: "TECHNICAL_FAILED", zmqControl: { occupancy: "held" } });
        expect(e.zmqControl.missingEvidence).toContain("SOURCE_RESTART_RECONCILIATION_UNAVAILABLE");
        restarted.pulse();
        await restarted.idle();
        expect(r.transport.commands.filter((c) => c.component === "simulationEffect")).toHaveLength(
          1,
        );
      } finally {
        await restarted.close();
      }
    } finally {
      await r.engine.close();
    }
  });
  it("keeps occupancy across a source interruption even after the same IDs reappear", async () => {
    const r = await effectReady();
    try {
      const stamp = {
        schemaVersion: "ugv.zmq-observation-event/2.0" as const,
        eventId: randomUUID(),
        receivedAt: new Date(r.clock.utc).toISOString(),
        monotonicNs: String(r.clock.mono * 1000000),
        clockId: "SIMULATED-clock",
      };
      const ref = {
        partitionHash: r.scope.settings.observerPartitionHash,
        sessionId: r.scope.settings.observerSessionId,
        ordinal: "999",
        entryHash: "f".repeat(64),
      };
      r.engine.observe(
        { ...stamp, type: "transport", component: "simulationEffect", state: "disconnected" },
        ref,
      );
      await r.pulse();
      r.engine.observe(
        {
          ...stamp,
          eventId: randomUUID(),
          type: "transport",
          component: "simulationEffect",
          state: "connected",
        },
        ref,
      );
      await r.effect("task_status", {
        task: { ...r.native, state: "succeeded", execution_finished: true, effect: "hit" },
      });
      await r.effect("device_status", {
        mode: "idle",
        ready: true,
        active_task_id: null,
        fault_code: null,
        fault_message: null,
      });
      expect(await r.effectCurrent()).toMatchObject({
        state: "TECHNICAL_FAILED",
        zmqControl: { occupancy: "held" },
      });
      expect(r.transport.commands.filter((c) => c.component === "simulationEffect")).toHaveLength(
        1,
      );
    } finally {
      await r.engine.close();
    }
  });
  it("quarantines a conflicting position for the same native request instead of releasing the channel", async () => {
    const r = await effectReady();
    try {
      await r.effect("task_status", {
        task: {
          ...r.native,
          position: { ...r.native.position, longitude_deg: 107 },
          state: "succeeded",
          execution_finished: true,
          effect: "hit",
        },
      });
      await r.effect("task_status", {
        task: { ...r.native, state: "succeeded", execution_finished: true, effect: "hit" },
      });
      await r.effect("device_status", {
        mode: "idle",
        ready: true,
        active_task_id: null,
        fault_code: null,
        fault_message: null,
      });
      expect(await r.effectCurrent()).toMatchObject({
        state: "TECHNICAL_FAILED",
        reasonCode: "ZMQ_EFFECT_IDENTITY_CONFLICT",
        zmqControl: { occupancy: "held" },
      });
    } finally {
      await r.engine.close();
    }
  });
  it("stores a later known effect after an independently finished unknown result without editing the original", async () => {
    const r = await effectReady();
    try {
      await r.effect("task_status", {
        task: {
          ...r.native,
          state: "unknown",
          execution_finished: true,
          effect: "unknown",
          reason: "SIMULATED_DELAY",
        },
      });
      await r.effect("device_status", {
        mode: "idle",
        ready: true,
        active_task_id: null,
        fault_code: null,
        fault_message: null,
      });
      const original = present(await r.effectCurrent());
      expect(original.zmqControl.occupancy).toBe("released");
      await r.effect("task_status", {
        task: { ...r.native, state: "succeeded", execution_finished: true, effect: "miss" },
      });
      const e = present(await r.effectCurrent()),
        query = await r.engine.effectResults(resultIdentity(e), e.executionContext);
      expect(e.result).toEqual(original.result);
      expect(e.state).toBe(original.state);
      expect(query).toMatchObject({
        latestRevision: 2,
        latest: { late: true, nativeTask: { effect: "miss" } },
      });
    } finally {
      await r.engine.close();
    }
  });
  it("rebuilds a stale summary head from durable result records without altering the terminal result", async () => {
    const r = await inspecting();
    try {
      await report(r, { targets: [detection("a")] });
      const e = await finish(r),
        original = structuredClone(e.result);
      e.zmqInspection = emptyInspection();
      await r.repository.save(e);
      const query = await r.engine.inspectionResults(resultIdentity(e), e.executionContext);
      expect(query).toMatchObject({ observationCount: 1 });
      expect((await r.current())?.result).toEqual(original);
    } finally {
      await r.engine.close();
    }
  });
  it("rejects an observation that expires before scheduled dispatch without faulting other components", async () => {
    const r = await effectReady();
    try {
      await r.effect("task_status", {
        task: { ...r.native, state: "succeeded", execution_finished: true, effect: "miss" },
      });
      await r.effect("device_status", {
        mode: "idle",
        ready: true,
        active_task_id: null,
        fault_code: null,
        fault_message: null,
      });
      const e = await r.engine.start(
        request(r.clock, r.operation, {
          timing: {
            startAt: new Date(r.clock.utc + 4000).toISOString(),
            startToleranceMs: 60000,
            maxElapsedMs: 10000,
            parentDeadlineAt: null,
          },
        }),
      );
      r.clock.advance(4001);
      await r.seed();
      await r.effect("device_status", {
        mode: "idle",
        ready: true,
        active_task_id: null,
        fault_code: null,
        fault_message: null,
      });
      await r.pulse();
      expect(await r.repository.get(e.taskId)).toMatchObject({
        state: "BUSINESS_FAILED",
        reasonCode: "ZMQ_EFFECT_SOURCE_EXPIRED_BEFORE_DISPATCH",
        zmqControl: { occupancy: "released" },
      });
      expect(r.engine.availability(navigation).available).toBe(true);
      expect(r.transport.commands.filter((c) => c.component === "simulationEffect")).toHaveLength(
        1,
      );
    } finally {
      await r.engine.close();
    }
  });
  it("requires genuine current geo evidence and rejects arbitrary positions", async () => {
    const r = await effectReady();
    try {
      const p = r.operation.params;
      await r.effect("task_status", {
        task: { ...r.native, state: "succeeded", execution_finished: true, effect: "miss" },
      });
      await r.effect("device_status", {
        mode: "idle",
        ready: true,
        active_task_id: null,
        fault_code: null,
        fault_message: null,
      });
      expect(
        await r.engine.checkAvailability(r.operation, r.effectTask.executionContext),
      ).toMatchObject({ available: true });
      expect(
        await r.engine.checkAvailability(
          { ...r.operation, params: { ...p, position: { ...p.position, longitude_deg: 107 } } },
          r.effectTask.executionContext,
        ),
      ).toMatchObject({
        available: false,
        reasonCode: "ZMQ_EFFECT_SOURCE_STALE_OR_POSITION_MISMATCH",
      });
      await expect(
        r.engine.start(
          request(r.clock, {
            ...r.operation,
            params: { ...p, position: { ...p.position, longitude_deg: 107 } },
          }),
        ),
      ).rejects.toThrow("SOURCE_STALE_OR_POSITION_MISMATCH");
      expect(r.transport.commands.filter((c) => c.component === "simulationEffect")).toHaveLength(
        1,
      );
      expect(() =>
        Operation.parse({
          ...inspection,
          params: { ...area.params, region_wgs84: area.params.region_wgs84.slice(0, 3) },
        }),
      ).toThrow();
      expect(() =>
        Operation.parse({ ...inspection, params: { ...area.params, excludedZones: [1] } }),
      ).toThrow();
    } finally {
      await r.engine.close();
    }
  });
  it("checks immutable result hashes, increasing revisions and bounded cursors", async () => {
    const r = await inspecting();
    try {
      await report(r);
      const e = present(await r.current()),
        id = resultIdentity(e),
        page = await r.engine.results(id, e.executionContext, 0, 1);
      expect(page.hasMore).toBe(true);
      const record = present(page.records[0]),
        draft = resultDraft(record);
      expect(await r.repository.appendResult(draft)).toEqual(record);
      await expect(async () =>
        r.repository.appendResult({ ...draft, content: { bad: true } }),
      ).rejects.toThrow("CONFLICT");
      await expect(r.engine.results(id, e.executionContext, -1)).rejects.toThrow("CURSOR");
      const retained = present(
        [...r.repository.results.values()].find((v) => v.revision === record.revision),
      );
      retained.contentHash = "0".repeat(64);
      await expect(r.engine.results(id, e.executionContext)).rejects.toThrow("INTEGRITY");
    } finally {
      await r.engine.close();
    }
  });
});
