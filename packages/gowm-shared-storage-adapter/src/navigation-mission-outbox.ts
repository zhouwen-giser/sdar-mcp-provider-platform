import { RUNTIME_VERSION } from "../../domain/src/index.js";
import { requireValue } from "./value.js";
import type { Pool, PoolClient } from "pg";
import {
  createProviderOpsEnvelope,
  type ProviderOpsEnvelope,
} from "../../observability/src/event-envelope.js";
import { sha256CanonicalJson } from "../../observability/src/hash.js";
import { inTransaction } from "./connection.js";
import { storageScope } from "./scope.js";

export interface NavigationReceipt {
  stepId: string;
  state: string;
  nativeMissionId: string | null;
  resultHash: string | null;
  completedAt: string;
  missionInstanceId: string | null;
}
export interface NavigationAuthorityInput {
  deviceId: string;
  serviceKey: string;
  bindingId: string;
  taskId: string;
  executionId: string;
  providerId: string;
  resourceId: string;
  argumentHash: string;
  authorizationHash: string;
  executionMode: string;
  observedAt: string;
  traceId?: string;
  correlationId?: string;
  receipts: NavigationReceipt[];
}

/** Only committed navigation receipts, never the vehicle's current Mission snapshot. */
export function navigationMissionEnvelopes(input: NavigationAuthorityInput): ProviderOpsEnvelope[] {
  const observedAt = new Date(input.observedAt).toISOString();
  const receipts = [...input.receipts].sort((a, b) => a.stepId.localeCompare(b.stepId));
  if (!receipts.length || new Set(receipts.map((r) => r.stepId)).size !== receipts.length)
    throw Error("NAVIGATION_RECEIPT_SET_INVALID");
  const scope = [
    input.deviceId,
    input.serviceKey,
    input.bindingId,
    input.taskId,
    input.executionId,
  ];
  if (scope.some((v) => !v)) throw Error("NAVIGATION_AUTHORITY_SCOPE_REQUIRED");
  const common = {
    providerId: input.providerId,
    runtimeVersion: RUNTIME_VERSION,
    instanceId: "smpp-runtime-postgres-authority",
    taskId: input.taskId,
    externalExecutionId: input.executionId,
    resourceId: input.resourceId,
    resourceType: "isr.vehicle.ugv",
    operationName: "vehicle_navigate",
    argumentHash: input.argumentHash,
    authorizationContextHash: input.authorizationHash,
    executionMode: input.executionMode,
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  };
  const sources = receipts.map((r, index) => {
    if (!Number.isFinite(Date.parse(r.completedAt))) throw Error("NAVIGATION_RECEIPT_TIME_INVALID");
    const exact =
      r.state === "ACCEPTED" &&
      typeof r.nativeMissionId === "string" &&
      /^[1-9][0-9]*$/.test(r.nativeMissionId) &&
      r.missionInstanceId !== null &&
      /^[a-f0-9]{64}$/.test(r.resultHash ?? "");
    const identity = sha256CanonicalJson([
      ...scope,
      r.stepId,
      r.state,
      r.resultHash,
      r.nativeMissionId,
      r.missionInstanceId,
      r.completedAt,
    ]);
    return createProviderOpsEnvelope({
      ...common,
      recordType: "provider.resource.state",
      eventCategory: "resource.state",
      deliveryClass: "audit",
      eventType: "resource.state",
      providerEventId: identity,
      providerEventSequence: index + 1,
      stableAggregateIdentity: JSON.stringify(scope),
      eventIdentity: identity,
      occurredAt: r.completedAt,
      emittedAt: r.completedAt,
      attributes: {
        "sdar.evidence.kind": "mission",
        "sdar.evidence.authority": "navigation_dispatch_receipt_v1",
        "sdar.evidence.receipt_hash": r.resultHash,
        "sdar.evidence.dispatch_step": r.stepId,
        "sdar.evidence.mission_instance_id": r.missionInstanceId,
        ...(exact ? { "sdar.device.mission_id": r.nativeMissionId } : {}),
      },
      payload: { state: r.state, reasonCode: "SMPP_NAVIGATION_RECEIPT_COMMITTED" },
    });
  });
  const ids = new Set(
    sources
      .map((s) => s.attributes["sdar.device.mission_id"])
      .filter((id): id is string => typeof id === "string"),
  );
  const incomplete = sources.some((s) => s.attributes["sdar.device.mission_id"] === undefined);
  const relationStatus =
    ids.size > 1 ? "conflict" : incomplete || ids.size !== 1 ? "unresolved" : "exact";
  const deviceMissionId = relationStatus === "exact" ? requireValue([...ids][0]) : null;
  const refs = sources.map((s) => s.recordId).sort();
  const sourceHashes = Object.fromEntries(sources.map((s) => [s.recordId, s.recordHash]));
  const relation = createProviderOpsEnvelope({
    ...common,
    recordType: "provider.execution.progress",
    eventCategory: "execution.progress",
    deliveryClass: "audit",
    eventType: "smpp.mission.relation",
    stableAggregateIdentity: JSON.stringify(scope),
    eventIdentity: "navigation-mission-authority-v1",
    occurredAt: observedAt,
    emittedAt: observedAt,
    attributes: {
      "sdar.fact.kind": "mission_relation",
      "sdar.mission.authority": "navigation_dispatch_receipt_v1",
      "sdar.mission.relation_status": relationStatus,
      "sdar.mission.source_record_refs": refs,
      "sdar.mission.source_record_hashes": sourceHashes,
      ...(deviceMissionId === null ? {} : { "sdar.device.mission_id": deviceMissionId }),
    },
    payload: {
      providerSubstate: `mission_relation_${relationStatus}`,
      reasonCode: `SMPP_MISSION_RELATION_${relationStatus.toUpperCase()}`,
      observedAt,
      relationStatus,
      deviceMissionId,
      sourceRecordRefs: refs,
    },
  });
  return [...sources, relation];
}

/** The committed execution + dispatch journal are the durable publication intent.
 * Only new opted-in terminal navigations are eligible; no historical backfill.
 * All evidence and the derived authority enter the existing outbox atomically.
 */
export async function capturePendingNavigationMissions(pool: Pool): Promise<void> {
  const scope = storageScope(pool);
  if (!scope) return;
  await inTransaction(pool, async (client) => {
    const candidates = await client.query<{
      task_id: string;
      external_execution_id: string;
      resource_id: string;
      provider_id: string;
      argument_hash: string;
      authorization_context_hash: string;
      execution_mode: string;
      terminal_at: Date;
      trace_id: string | null;
      correlation_id: string | null;
    }>(
      `SELECT e.mcp_task_id task_id,e.external_execution_id,e.resource_id,t.provider_id,
      e.argument_hash,t.authorization_context_hash,t.execution_mode,e.terminal_at,t.trace_id,t.correlation_id
      FROM ugv_smpp.ugv_execution e JOIN ugv_smpp.provider_task t
      ON t.task_id=e.mcp_task_id AND t.device_id=e.device_id AND t.smpp_service_key=e.smpp_service_key
      AND t.gowm_binding_id=e.gowm_binding_id AND t.external_execution_id=e.external_execution_id
      AND t.argument_hash=e.argument_hash AND t.operation_name=e.operation_name
      WHERE e.device_id=$1 AND e.smpp_service_key=$2 AND e.gowm_binding_id=$3
      AND e.operation_name='vehicle_navigate' AND e.payload->>'missionAuthorityVersion'='1'
      AND e.terminal_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM ugv_smpp.ugv_mutation_journal j WHERE j.device_id=e.device_id AND j.task_id=e.task_id AND j.phase='PRIMARY')
      AND NOT EXISTS (SELECT 1 FROM ugv_smpp.provider_ops_delivery o WHERE o.device_id=e.device_id AND o.event_key=$2||':navigation-mission-v1:'||e.external_execution_id)
      ORDER BY e.terminal_at,e.task_id FOR UPDATE OF e SKIP LOCKED LIMIT 50`,
      [scope.allowedDeviceIds[0], scope.serviceKey, scope.bindingId],
    );
    for (const row of candidates.rows) {
      const receipts = await client.query<NavigationReceipt>(
        `SELECT j.step_id "stepId",j.state,
        j.external_mission_id "nativeMissionId",j.result_hash "resultHash",
        to_char(COALESCE(j.completed_at,j.dispatched_at,j.intent_persisted_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') "completedAt",
        (SELECT CASE WHEN count(DISTINCT l.mission_instance_id)=1 THEN min(l.mission_instance_id::text) ELSE NULL END FROM gowm_execution.execution_mission_link l
          WHERE l.device_id=j.device_id AND l.provider_task_record_id=j.task_id
          AND l.provider_dispatch_step_id=j.step_id AND l.source_system_key=$2
          AND l.binding_id=$3 AND l.provider_execution_id=$4 AND l.link_state='LINKED'
          AND l.source_evidence_ref->>'resultHash'=j.result_hash
          AND l.source_evidence_ref->>'nativeMissionId'=j.external_mission_id) "missionInstanceId"
        FROM ugv_smpp.ugv_mutation_journal j JOIN ugv_smpp.ugv_execution e ON e.task_id=j.task_id AND e.device_id=j.device_id
        WHERE e.device_id=$1 AND e.smpp_service_key=$2 AND e.gowm_binding_id=$3 AND e.external_execution_id=$4
        AND j.phase IN ('PRIMARY','FOLLOWUP') ORDER BY j.step_id`,
        [scope.allowedDeviceIds[0], scope.serviceKey, scope.bindingId, row.external_execution_id],
      );
      const envelopes = navigationMissionEnvelopes({
        deviceId: requireValue(scope.allowedDeviceIds[0]),
        serviceKey: scope.serviceKey,
        bindingId: scope.bindingId,
        taskId: row.task_id,
        executionId: row.external_execution_id,
        providerId: row.provider_id,
        resourceId: row.resource_id,
        argumentHash: row.argument_hash,
        authorizationHash: row.authorization_context_hash,
        executionMode: row.execution_mode,
        observedAt: row.terminal_at.toISOString(),
        ...(row.trace_id ? { traceId: row.trace_id } : {}),
        ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
        receipts: receipts.rows,
      });
      for (const envelope of envelopes)
        await insertFact(
          client,
          requireValue(scope.allowedDeviceIds[0]),
          envelope.eventType === "smpp.mission.relation"
            ? `${scope.serviceKey}:navigation-mission-v1:${row.external_execution_id}`
            : `${scope.serviceKey}:navigation-receipt-v1:${envelope.recordId}`,
          envelope,
        );
    }
  });
}
async function insertFact(
  client: PoolClient,
  deviceId: string,
  key: string,
  envelope: ProviderOpsEnvelope,
) {
  await client.query(
    `INSERT INTO ugv_smpp.provider_ops_delivery(device_id,record_id,event_key,record_type,event_category,delivery_class,aggregate_type,aggregate_id,occurred_at,record_body)
    VALUES($1,$2,$3,$4,$5,'audit','task',$6,$7,$8) ON CONFLICT(device_id,event_key) DO NOTHING`,
    [
      deviceId,
      envelope.recordId,
      key,
      envelope.recordType,
      envelope.eventCategory,
      envelope.taskId,
      envelope.occurredAt,
      envelope,
    ],
  );
  const existing = await client.query<{ hash: string }>(
    `SELECT record_body->>'recordHash' hash FROM ugv_smpp.provider_ops_delivery WHERE device_id=$1 AND event_key=$2`,
    [deviceId, key],
  );
  if (existing.rows[0]?.hash !== envelope.recordHash)
    throw Error("NAVIGATION_AUTHORITY_EVENT_CONFLICT");
}
