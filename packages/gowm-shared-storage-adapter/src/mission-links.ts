import type { PoolClient } from "pg";
import type { MutationJournalEntry } from "../../provider-adapter-kit/src/types.js";
import { NativeMissionStorage } from "./native-missions.js";
import { storageScope } from "./scope.js";

/** Called only within the transaction that persisted the dispatch receipt. */
export async function recordMissionReceipt(
  client: PoolClient,
  entry: MutationJournalEntry,
): Promise<void> {
  const config = storageScope(client);
  if (!config || !["ACCEPTED", "UNCERTAIN"].includes(entry.state)) return;
  const execution = (
    await client.query<{
      device_id: string;
      data_scope_key: string;
      gowm_binding_id: string;
      external_execution_id: string;
      mcp_task_id: string | null;
    }>(
      `SELECT e.device_id,b.data_scope_key,e.gowm_binding_id,e.external_execution_id,e.mcp_task_id
     FROM ugv_smpp.ugv_execution e JOIN gowm_device.device_service_binding b
       ON b.device_id=e.device_id AND b.binding_id=e.gowm_binding_id
     WHERE e.device_id=$1 AND e.smpp_service_key=$2 AND e.task_id=$3 FOR UPDATE OF e`,
      [config.allowedDeviceIds[0], config.serviceKey, entry.taskId],
    )
  ).rows[0];
  if (!execution) throw new Error("EXECUTION_ROUTE_UNAVAILABLE");
  const native = new NativeMissionStorage();
  const evidence = {
    taskId: entry.taskId,
    stepId: entry.stepId,
    resultHash: entry.resultHash ?? null,
    state: entry.state,
    completedAt: entry.completedAt ?? null,
    nativeMissionId: entry.externalMissionId ?? null,
  };
  let missionId: string | undefined;
  const creating = entry.phase === "PRIMARY" || entry.phase === "FOLLOWUP";
  if (entry.state === "ACCEPTED" && entry.externalMissionId) {
    if (creating) {
      const identity = await native.registerMissionIdentity(client, {
        deviceId: execution.device_id,
        scope: execution.data_scope_key,
        channel: "provider-execution",
        authority: config.serviceKey,
        // The receipt carries no trustworthy device boot/session epoch.
        kind: "EXECUTION_SCOPED_ID",
        session: execution.external_execution_id,
        nativeId: entry.externalMissionId,
        evidence,
      });
      missionId = identity.mission_instance_id;
    } else {
      const identity = await client.query<{ mission_instance_id: string }>(
        `SELECT mission_instance_id FROM gowm_execution.mission_identity
         WHERE device_id=$1 AND authority_key=$2 AND native_session_key=$3
           AND native_mission_id=$4 AND mission_channel='provider-execution'`,
        [
          execution.device_id,
          config.serviceKey,
          execution.external_execution_id,
          entry.externalMissionId,
        ],
      );
      missionId = identity.rows[0]?.mission_instance_id;
    }
  }
  await native.linkExecutionToMission(client, {
    deviceId: execution.device_id,
    scope: execution.data_scope_key,
    bindingId: execution.gowm_binding_id,
    ...(execution.mcp_task_id ? { mcpTaskId: execution.mcp_task_id } : {}),
    executionId: execution.external_execution_id,
    providerTaskId: entry.taskId,
    stepId: entry.stepId,
    ...(missionId ? { missionId } : {}),
    relation: creating ? "CREATED" : "CONTROLLED",
    state: missionId ? "LINKED" : entry.state === "UNCERTAIN" ? "UNCERTAIN" : "PENDING",
    source: config.serviceKey,
    idempotencyKey: JSON.stringify([entry.taskId, entry.stepId, entry.state, "receipt"]),
    evidence,
    ...(!missionId ? { unresolved: { reason: "MISSION_IDENTITY_UNRESOLVED" } } : {}),
  });
}

/** Publication/recovery reconciliation uses admission and accepted execution evidence. */
export async function reconcileMcpExecutionLinks(client: PoolClient): Promise<void> {
  const config = storageScope(client);
  if (!config) return;
  const executions = await client.query<{ task_id: string; mcp_task_id: string }>(
    `SELECT e.task_id,t.task_id mcp_task_id
     FROM ugv_smpp.provider_task t JOIN ugv_smpp.admission_intent a
       ON a.task_id=t.task_id AND a.device_id=t.device_id AND a.gowm_binding_id=t.gowm_binding_id
     JOIN ugv_smpp.ugv_execution e ON e.device_id=t.device_id
       AND e.smpp_service_key=t.smpp_service_key AND e.gowm_binding_id=t.gowm_binding_id
       AND e.external_execution_id=t.external_execution_id AND e.argument_hash=t.argument_hash
       AND e.operation_name=t.operation_name
     WHERE t.device_id=$1 AND t.smpp_service_key=$2 AND e.mcp_task_id IS NULL
       AND a.state IN ('ACCEPTED','PUBLISHED') FOR UPDATE OF e`,
    [config.allowedDeviceIds[0], config.serviceKey],
  );
  for (const row of executions.rows) {
    await client.query(
      `UPDATE ugv_smpp.ugv_execution SET mcp_task_id=$3
      WHERE device_id=$1 AND task_id=$2 AND mcp_task_id IS NULL`,
      [config.allowedDeviceIds[0], row.task_id, row.mcp_task_id],
    );
    // Explicit NULL -> known-parent CAS preserves the immutable receipt payload/key.
    await client.query(
      `UPDATE gowm_execution.execution_mission_link SET mcp_task_id=$3
      WHERE device_id=$1 AND provider_task_record_id=$2 AND mcp_task_id IS NULL`,
      [config.allowedDeviceIds[0], row.task_id, row.mcp_task_id],
    );
  }
}
