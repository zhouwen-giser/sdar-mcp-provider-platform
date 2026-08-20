import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runUgvProviderMigrations } from "../../apps/ugv-provider-adapter/src/migrate.js";
import {
  PostgresProviderStore,
  type CommandAckRecord,
  type MutationJournalEntry,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required");

describe("UGV Postgres execution recovery", () => {
  const admin = new Pool({ connectionString: databaseUrl });
  const schema = `ugv_pre_sim_${randomUUID().replaceAll("-", "")}`;
  const scopedUrl = withSearchPath(databaseUrl, schema);

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const migrationPool = new Pool({ connectionString: scopedUrl, max: 1 });
    try {
      await runUgvProviderMigrations(migrationPool, resolve(import.meta.dirname, "../.."));
    } finally {
      await migrationPool.end();
    }
  });

  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it("retains public identity and physical evidence fences across a store restart", async () => {
    const observedAt = new Date().toISOString();
    const execution: ProviderExecution = {
      taskId: "restart-navigation",
      externalExecutionId: "vehicle:ugv1:chassis:restart-navigation",
      operationName: "vehicle_navigate",
      argumentHash: "a".repeat(64),
      providerId: "isr.vehicle.ugv.production",
      resourceId: "vehicle:ugv1",
      tracks: ["chassis"],
      arguments: {
        resourceId: "vehicle:ugv1",
        mission: { type: "point", target: { latitude: 29.72, longitude: 106.814 } },
      },
      executionContext: {
        authorizationContextHash: "b".repeat(64),
        executionMode: "LIVE",
        simulationId: "not-applicable-live",
        correlationId: "restart-navigation",
      },
      downstreamMissionIds: ["42"],
      observationCursors: { chassis: "source:41" },
      dispatchBaseline: {
        capturedAt: observedAt,
        snapshotRevision: "baseline-41",
        observationAuthorities: [
          {
            topic: "/ugv/nav_state",
            observedAt,
            timeAuthority: "source",
            sourceSequence: "41",
            cursor: "source:41",
          },
        ],
        mission: { id: "41", state: "RUNNING", observedAt },
      },
      controlConfirmation: {
        command: "pause",
        requestedAt: observedAt,
        baseline: {
          capturedAt: observedAt,
          snapshotRevision: "pause-41",
          observationAuthorities: [],
          mission: { id: "42", state: "RUNNING", observedAt },
        },
      },
      selectedDeviceTool: "ugv_mission_control",
      state: "RUNNING",
      revision: 4,
      reasonCode: "UGV_TASK_RUNNING",
      progress: 25,
      createdAt: observedAt,
      updatedAt: observedAt,
      evidence: [],
    };

    const first = new PostgresProviderStore(scopedUrl, 1, "ugv");
    await first.initialize();
    await first.putExecution(execution);
    const commandAck: CommandAckRecord = {
      taskId: execution.taskId,
      command: "pause",
      commandSequence: "1",
      response: {
        accepted: true,
        state: "RUNNING",
        reasonCode: "UGV_CONTROL_CONFIRMATION_PENDING",
      },
      createdAt: observedAt,
    };
    await first.putCommandAck(commandAck);
    const intent: MutationJournalEntry = {
      taskId: execution.taskId,
      stepId: "primary:1",
      phase: "PRIMARY",
      toolName: "ugv_path_follow_mission",
      argumentHash: "c".repeat(64),
      state: "INTENT_PERSISTED",
      intentPersistedAt: observedAt,
    };
    expect(await first.claimMutationJournal(intent)).toMatchObject({ claimed: true });
    const dispatching: MutationJournalEntry = {
      ...intent,
      state: "DISPATCHING",
      dispatchedAt: new Date(Date.parse(observedAt) + 1).toISOString(),
    };
    expect(await first.advanceMutationJournal(dispatching, "INTENT_PERSISTED")).toBe(true);
    const accepted: MutationJournalEntry = {
      ...dispatching,
      state: "ACCEPTED",
      externalMissionId: "42",
      resultHash: "d".repeat(64),
      completedAt: new Date(Date.parse(observedAt) + 2).toISOString(),
    };
    expect(await first.advanceMutationJournal(accepted, "DISPATCHING")).toBe(true);
    await first.close();

    const restarted = new PostgresProviderStore(scopedUrl, 1, "ugv");
    await restarted.initialize();
    expect(await restarted.listActiveExecutions()).toEqual([execution]);
    expect(await restarted.getExecution(execution.taskId)).toMatchObject({
      providerId: execution.providerId,
      dispatchBaseline: execution.dispatchBaseline,
      controlConfirmation: execution.controlConfirmation,
      downstreamMissionIds: ["42"],
      state: "RUNNING",
    });
    expect(await restarted.getCommandAck(execution.taskId, "pause", "1")).toEqual(commandAck);
    expect(await restarted.listMutationJournal(execution.taskId)).toEqual([accepted]);
    await restarted.close();
  });
});

function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}
