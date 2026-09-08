// Adapted from GOWM BusinessStorage (source.json); upstream license retained in the consumer contract.
import { requireValue } from "./value.js";
import type { PoolClient } from "pg";
type Json = Record<string, unknown>;
interface MissionRow {
  mission_instance_id: string;
  identity_kind: string;
  same?: boolean;
}
function required(v: string) {
  if (!v.trim()) throw Error("DEVICE_SCOPE_REQUIRED");
}
export class NativeMissionStorage {
  async registerMissionIdentity(
    c: PoolClient,
    i: {
      deviceId: string;
      scope: string;
      channel: string;
      authority: string;
      kind: string;
      session: string;
      nativeId: string;
      evidence: Json;
      missionId?: string;
    },
  ) {
    required(i.deviceId);
    const device = await c.query<MissionRow>(
      "SELECT 1 FROM gowm_device.device WHERE device_id=$1 AND data_scope_key=$2",
      [i.deviceId, i.scope],
    );
    if (!device.rowCount) throw Error("MISSION_DEVICE_SCOPE_MISMATCH");
    await c.query<MissionRow>("SELECT pg_advisory_xact_lock(hashtextextended($1,718081))", [
      JSON.stringify([i.deviceId, i.channel, i.authority, i.session, i.nativeId]),
    ]);
    const old = (
      await c.query<MissionRow>(
        `SELECT * FROM gowm_execution.mission_identity WHERE device_id=$1 AND mission_channel=$2 AND authority_key=$3 AND native_session_key=$4 AND native_mission_id=$5`,
        [i.deviceId, i.channel, i.authority, i.session, i.nativeId],
      )
    ).rows[0];
    if (old) {
      if (i.missionId && i.missionId !== old.mission_instance_id)
        throw Error("MISSION_IDENTITY_CONFLICT");
      if (old.identity_kind !== i.kind) throw Error("MISSION_IDENTITY_CONFLICT");
      return old;
    }
    const id =
      i.missionId ??
      (
        await c.query<MissionRow>(
          `INSERT INTO gowm_execution.device_mission(device_id,data_scope_key,mission_channel,created_by) VALUES($1,$2,$3,$4) RETURNING mission_instance_id`,
          [i.deviceId, i.scope, i.channel, i.authority],
        )
      ).rows[0]?.mission_instance_id;
    if (!id) throw new Error("MISSION_IDENTITY_UNRESOLVED");
    return requireValue(
      (
        await c.query<MissionRow>(
          `INSERT INTO gowm_execution.mission_identity(mission_instance_id,device_id,mission_channel,authority_key,identity_kind,native_session_key,native_mission_id,evidence_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [id, i.deviceId, i.channel, i.authority, i.kind, i.session, i.nativeId, i.evidence],
        )
      ).rows[0],
    );
  }
  async linkExecutionToMission(
    c: PoolClient,
    i: {
      deviceId: string;
      scope: string;
      bindingId: string;
      mcpTaskId?: string;
      executionId: string;
      providerTaskId: string;
      stepId: string;
      missionId?: string;
      relation: string;
      state: string;
      source: string;
      idempotencyKey: string;
      evidence: Json;
      unresolved?: Json;
    },
  ) {
    required(i.deviceId);
    const values = [
      i.deviceId,
      i.scope,
      i.bindingId,
      i.mcpTaskId ?? null,
      i.executionId,
      i.providerTaskId,
      i.stepId,
      i.missionId ?? null,
      i.relation,
      i.state,
      i.source,
      i.idempotencyKey,
      i.evidence,
      i.unresolved ?? null,
    ];
    const r = await c.query<MissionRow>(
      `INSERT INTO gowm_execution.execution_mission_link(device_id,data_scope_key,binding_id,mcp_task_id,provider_execution_id,provider_task_record_id,provider_dispatch_step_id,mission_instance_id,relation_kind,link_state,source_system_key,idempotency_key,source_evidence_ref,unresolved_native_identity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(device_id,source_system_key,idempotency_key) DO NOTHING RETURNING *`,
      values,
    );
    if (r.rowCount) return requireValue(r.rows[0]);
    const old = await c.query<MissionRow>(
      `SELECT *, ROW(data_scope_key,binding_id,mcp_task_id,provider_execution_id,provider_task_record_id,provider_dispatch_step_id,mission_instance_id,relation_kind,link_state,source_evidence_ref,unresolved_native_identity) IS NOT DISTINCT FROM ROW($2::text,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::uuid,$9::text,$10::text,$13::jsonb,$14::jsonb) AS same FROM gowm_execution.execution_mission_link WHERE device_id=$1 AND source_system_key=$11 AND idempotency_key=$12`,
      values,
    );
    if (!old.rows[0]?.same) throw Error("MISSION_RECEIPT_CONFLICT");
    return requireValue(old.rows[0]);
  }
}
