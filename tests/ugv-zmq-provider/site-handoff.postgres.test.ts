import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import {
  planHandoff,
  applyHandoff,
  verifySiteGrant,
  RETIRE_REASON,
} from "../../packages/vehicle-zmq-control/src/site-handoff.js";
import { controlSiteFixture } from "./site-control-fixture.js";
const file = process.env.SMPP_ZMQ_TEST_CONFIG_FILE;
let f: Awaited<ReturnType<typeof controlSiteFixture>>, store: PostgresProviderStore;
const taskId = randomUUID(),
  writers = [
    { id: "d".repeat(64), image: "SIMULATED-image-sha", running: false, restartPolicy: "no" },
  ];
describe.skipIf(!file)("audited legacy retirement using real PostgreSQL", () => {
  beforeAll(async () => {
    const cfg = JSON.parse(readFileSync(file ?? "", "utf8")) as { databaseUrl: string };
    f = await controlSiteFixture(cfg.databaseUrl);
    const url = new URL(cfg.databaseUrl);
    url.searchParams.set("options", "-c search_path=" + f.schemas.slice(0, 2).join(","));
    store = new PostgresProviderStore(url.toString(), 4);
    const snapshot = await f.runtime.pool.query<{ snapshot_id: string }>(
      "SELECT snapshot_id FROM operation_snapshot LIMIT 1",
    );
    const original = snapshot.rows[0]?.snapshot_id;
    if (!original) throw Error("FIXTURE_SNAPSHOT_REQUIRED");
    const oldId = randomUUID();
    await f.runtime.pool.query(
      "INSERT INTO operation_snapshot SELECT (jsonb_populate_record(NULL::operation_snapshot,to_jsonb(s)||jsonb_build_object('snapshot_id',$2::text,'manifest_hash',$3::text))).* FROM operation_snapshot s WHERE snapshot_id=$1",
      [original, oldId, "e".repeat(64)],
    );
    await f.runtime.pool.query(
      `INSERT INTO provider_task(task_id,provider_id,operation_name,operation_snapshot_id,authorization_context_hash,execution_mode,simulation_id,arguments,argument_hash,external_execution_id,internal_state,mcp_status,substate,accepted_at,result) VALUES($1,$2,'vehicle_area_recon',$3,$4,'live',NULL,$5,$6,$7,'STOPPING','working','stopping',clock_timestamp(),$8)`,
      [
        taskId,
        f.profile.providerBinding.providerId,
        oldId,
        "a".repeat(64),
        { resourceId: f.resourceId },
        "b".repeat(64),
        randomUUID(),
        { original: "immutable business report" },
      ],
    );
    await f.runtime.pool.query(
      "INSERT INTO task_command(task_id,command_sequence,command_type,request_hash,state,payload) VALUES($1,1,'CANCEL',$2,'PENDING',$3)",
      [taskId, "c".repeat(64), { original: true }],
    );
    await f.runtime.pool.query(
      "INSERT INTO task_observation(task_id,revision,type,source,occurred_at,payload) VALUES($1,1,'legacy','runtime',clock_timestamp(),$2)",
      [taskId, { original: true }],
    );
    const now = new Date().toISOString();
    await f.provider.store.putExecution({
      taskId,
      externalExecutionId: randomUUID(),
      providerId: f.profile.providerBinding.providerId ?? "",
      operationName: "vehicle_area_recon",
      resourceId: f.resourceId,
      argumentHash: "b".repeat(64),
      arguments: { resourceId: f.resourceId },
      executionContext: {
        authorizationContextHash: "a".repeat(64),
        executionMode: "live",
        simulationId: "",
        correlationId: taskId,
      },
      downstreamMissionIds: ["old-unknown"],
      tracks: [],
      state: "STOPPING",
      revision: 2,
      reasonCode: "OLD_STOP_UNCONFIRMED",
      createdAt: now,
      updatedAt: now,
      evidence: [],
      result: { original: "immutable provider report" },
    });
  }, 30000);
  afterAll(async () => {
    await store?.close();
    await f?.close();
  });
  it("rejects changed snapshots and an active or restartable old writer", async () => {
    const plan = await planHandoff(store, f.profile, writers),
      input = {
        commandId: randomUUID(),
        actor: "fixture-operator",
        reason: "legacy link retired",
        writers,
      };
    await f.runtime.pool.query("UPDATE provider_task SET version=version+1 WHERE task_id=$1", [
      taskId,
    ]);
    await expect(applyHandoff(store, f.profile, plan, input)).rejects.toThrow(
      "ZMQ_HANDOFF_SNAPSHOT_CONFLICT",
    );
    const fresh = await planHandoff(store, f.profile, writers);
    await expect(
      applyHandoff(store, f.profile, fresh, {
        ...input,
        writers: [{ ...writers[0], running: true }] as typeof writers,
      }),
    ).rejects.toThrow("ZMQ_OLD_WRITER_NOT_FENCED");
  });
  it("preserves old reports/events, rejects pending commands and supports exact replay", async () => {
    const plan = await planHandoff(store, f.profile, writers),
      input = {
        commandId: randomUUID(),
        actor: "fixture-operator",
        reason: "legacy link retired",
        writers,
      };
    const grant = await applyHandoff(store, f.profile, plan, input);
    expect(grant.retiredTasks).toContain(taskId);
    const task = (
      await f.runtime.pool.query(
        "SELECT internal_state,error,result FROM provider_task WHERE task_id=$1",
        [taskId],
      )
    ).rows[0] as { internal_state: string; error: { reasonCode: string }; result: unknown };
    expect(task).toMatchObject({
      internal_state: "TERMINAL_FAILED",
      error: { reasonCode: RETIRE_REASON },
      result: { original: "immutable business report" },
    });
    const provider = await f.provider.store.getExecution(taskId);
    expect(provider).toMatchObject({
      state: "TECHNICAL_FAILED",
      reasonCode: RETIRE_REASON,
      result: { original: "immutable provider report" },
    });
    expect(
      (await f.runtime.pool.query("SELECT state FROM task_command WHERE task_id=$1", [taskId]))
        .rows[0],
    ).toMatchObject({ state: "REJECTED" });
    expect(
      (
        await f.runtime.pool.query("SELECT payload FROM task_observation WHERE task_id=$1", [
          taskId,
        ])
      ).rows,
    ).toEqual([{ payload: { original: true } }]);
    expect(await applyHandoff(store, f.profile, plan, input)).toEqual(grant);
    expect(await verifySiteGrant(store, f.profile, grant)).toEqual(grant);
    await expect(
      applyHandoff(store, f.profile, plan, { ...input, reason: "different" }),
    ).rejects.toThrow("COMMAND_ID_CONFLICT");
    expect(f.devices.commands).toHaveLength(0);
    const after = await planHandoff(store, f.profile, writers);
    expect(after.snapshot.runtime).toEqual([]);
    expect(after.snapshot.provider).toEqual([]);
    expect(after.snapshot.commands).toEqual([]);
  });
});
