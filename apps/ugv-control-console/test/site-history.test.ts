import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { siteFixture } from "../../../tests/ugv-zmq-provider/site-fixture.js";
import { emptyReport } from "../../../tests/ugv-zmq-observer/helpers.js";
import { emptyInspection } from "../../../packages/vehicle-zmq-control/src/inspection.js";
import {
  ResultIdentity,
  resultKey,
  resultHash,
  type ResultDraft,
} from "../../../packages/vehicle-zmq-control/src/results.js";
import { canonical, sha256 } from "../../../packages/vehicle-zmq-observer/src/index.js";
import { protoStructToJson } from "../../../packages/adapter-protocol/src/index.js";
import type { ProviderExecution } from "../../../packages/provider-adapter-kit/src/index.js";
const file = process.env.SMPP_ZMQ_TEST_CONFIG_FILE;
let f: Awaited<ReturnType<typeof siteFixture>>;
describe.skipIf(!file)("retained native reports through site read-only storage", () => {
  beforeAll(async () => {
    const c = JSON.parse(readFileSync(file ?? "", "utf8")) as { databaseUrl: string };
    f = await siteFixture(c.databaseUrl);
  }, 30000);
  afterAll(async () => {
    if (f) await f.close();
  });
  const context = {
    authorizationContextHash: "d".repeat(64),
    executionMode: "simulation",
    simulationId: "SIMULATED-historical-domain",
    correlationId: "historical-query",
  };
  async function seeded(kind: "inspection" | "effect") {
    const at = new Date().toISOString(),
      taskId = randomUUID(),
      executionId = randomUUID(),
      operationName =
        kind === "inspection" ? "vehicle_zmq_inspect_area" : "simulation_apply_effect";
    const e: ProviderExecution = {
      taskId,
      externalExecutionId: executionId,
      providerId: f.profile.providerBinding.providerId ?? "",
      resourceId: f.resourceId,
      operationName,
      argumentHash: "e".repeat(64),
      arguments: {},
      executionContext: context,
      downstreamMissionIds: [],
      tracks: [],
      state: "SUCCEEDED",
      revision: 2,
      reasonCode: "SIMULATED_RETAINED_HISTORY",
      createdAt: at,
      updatedAt: at,
      terminalAt: at,
      evidence: [],
      result: { schemaVersion: "SIMULATED-original-immutable-result" },
    };
    Object.assign(e, {
      zmqControl: {
        scopeHash: "c".repeat(64),
        stage: "terminal",
        occupancy: kind === "effect" ? "held" : "released",
        missingEvidence: [],
      },
      ...(kind === "inspection"
        ? { zmqInspection: emptyInspection() }
        : {
            zmqEffect: {
              lastRevision: 0,
              taskSignature: null,
              executionFinished: null,
              latest: null,
            },
          }),
    });
    await f.provider.store.putExecution(e);
    const identity = ResultIdentity.parse({
      scopeHash: "c".repeat(64),
      providerId: e.providerId,
      resourceId: f.resourceId,
      taskId,
      externalExecutionId: executionId,
      operationName,
      authorizationContextHash: context.authorizationContextHash,
      executionMode: context.executionMode,
      simulationId: context.simulationId,
    });
    const draft: ResultDraft = {
      identity,
      kind: kind === "inspection" ? "inspection_frame" : "effect",
      receivedAt: at,
      sourceRef: {
        partitionHash: "a".repeat(64),
        sessionId: randomUUID(),
        ordinal: "1",
        entryHash: "b".repeat(64),
      },
      content:
        kind === "inspection"
          ? { key: "targetlist", data: emptyReport({ task_id: "SIMULATED-native-history" }) }
          : {
              nativeTask: {
                task_id: "SIMULATED-effect-history",
                request_id: "SIMULATED-request",
                state: "succeeded",
                execution_finished: true,
                effect: "miss",
                reason: null,
              },
            },
    };
    await f.provider.store.pool.query(
      "INSERT INTO ugv_state_snapshot(revision,observed_at,snapshot) VALUES($1,$2,$3)",
      [
        resultKey(draft),
        at,
        {
          ...draft,
          schemaVersion: "ugv.zmq-result-record/1",
          revision: 1,
          contentHash: resultHash(draft),
        },
      ],
    );
    const args = { resourceId: f.resourceId, taskId, executionId, afterRevision: 0, limit: 8 };
    const query = async (c = context) => {
      const r = await f.provider.runtime.start({
        taskId: randomUUID(),
        operationName:
          kind === "inspection" ? "vehicle_get_inspection_result" : "simulation_get_effect_result",
        arguments: args,
        argumentHash: sha256(canonical(args)),
        executionContext: c,
      });
      return protoStructToJson(r.initialSnapshot.result);
    };
    return { e, query, before: JSON.stringify(await f.provider.store.getExecution(taskId)) };
  }
  it("rebuilds a valid empty-frame summary in the original domain without rewriting history", async () => {
    const { e, query, before } = await seeded("inspection"),
      result = await query();
    expect(result).toMatchObject({
      schemaVersion: "ugv.zmq-inspection-result/1",
      inspectionReport: {
        complete: false,
        targetReportCount: 1,
        validEmptyFrameCount: 1,
        absenceConclusion: "no_observations_in_received_frames",
      },
      identity: { simulationId: context.simulationId, scopeHash: "c".repeat(64) },
      page: { nextRevision: 1, hasMore: false },
    });
    await expect(query({ ...context, authorizationContextHash: "f".repeat(64) })).rejects.toThrow(
      "ZMQ_EXECUTION_IDENTITY_MISMATCH",
    );
    expect(JSON.stringify(await f.provider.store.getExecution(e.taskId))).toBe(before);
    expect(f.devices.commands).toHaveLength(0);
  });
  it("reads supplemental effects while retaining the original result and unresolved occupancy", async () => {
    const { e, query, before } = await seeded("effect"),
      result = await query();
    expect(result).toMatchObject({
      schemaVersion: "ugv.zmq-effect-query/1",
      executionFinished: true,
      occupancy: "held",
      latestRevision: 1,
      originalTask: { result: e.result },
      latest: { nativeTask: { effect: "miss" } },
    });
    expect(result.missingEvidence).toContain("SIMULATION_IDLE_STATE_UNCONFIRMED");
    expect(JSON.stringify(await f.provider.store.getExecution(e.taskId))).toBe(before);
    expect(f.devices.commands).toHaveLength(0);
  });
});
