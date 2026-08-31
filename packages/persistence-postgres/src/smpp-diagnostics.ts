import type { Pool } from "pg";
import type { CanonicalJsonValue } from "../../observability/src/index.js";
import { sha256CanonicalJson } from "../../observability/src/index.js";

export type SmppTaskExecutionBindingStatus =
  "unbound" | "bound" | "unresolved" | "conflict" | "terminal";

export type SmppDispatchUncertaintyClass =
  | "response_lost_after_adapter_success"
  | "adapter_transport_ambiguous"
  | "runtime_crash_window"
  | "unknown";

export interface SmppDispatchUncertaintyV1 {
  schemaVersion: "sdar.smpp-dispatch-uncertainty/v1";
  taskId: string;
  operationName: string;
  argumentHash: string;
  uncertaintyClass: SmppDispatchUncertaintyClass;
  redispatchAllowed: false;
  occurredAt: string;
  causalRefs: string[];
}

export type SmppReconciliationStatus =
  "found" | "not_found" | "conflict" | "transient_unavailable" | "deferred";

export interface SmppReconciliationResultV1 {
  schemaVersion: "sdar.smpp-reconciliation-result/v1";
  taskId: string;
  attempt: number;
  status: SmppReconciliationStatus;
  externalExecutionId: string | null;
  occurredAt: string;
  identityValidated: boolean;
}

export interface SmppTaskExecutionBindingV1 {
  schemaVersion: "sdar.smpp-task-execution-binding/v1";
  taskId: string;
  providerId: string;
  operationName: string;
  argumentHash: string;
  executionMode: string;
  simulationId: string | null;
  externalExecutionId: string | null;
  resourceRef: string | null;
  adapterRevision: number | null;
  bindingStatus: SmppTaskExecutionBindingStatus;
  contentHash: string;
}

interface BindingRow {
  task_id: string;
  provider_id: string;
  operation_name: string;
  argument_hash: string;
  execution_mode: string;
  simulation_id: string | null;
  arguments: Record<string, unknown>;
  admission_state: string;
  external_execution_id: string | null;
  adapter_revision: string | null;
  internal_state: string | null;
  operation_definition: Record<string, unknown>;
  identity_conflict: boolean;
}

/** Read-only projection over the existing Runtime task/admission authority. */
export class SmppDiagnosticRepository {
  constructor(readonly pool: Pool) {}

  async getTaskExecutionBinding(taskId: string): Promise<SmppTaskExecutionBindingV1 | null> {
    const result = await this.pool.query<BindingRow>(
      `SELECT admission.task_id,
              admission.provider_id,
              admission.operation_name,
              admission.argument_hash,
              admission.execution_mode,
              admission.simulation_id,
              admission.arguments,
              admission.state AS admission_state,
              task.external_execution_id,
              task.adapter_revision,
              task.internal_state,
              snapshot.definition AS operation_definition,
              EXISTS (
                SELECT 1 FROM outbox_event event
                WHERE event.aggregate_id=admission.task_id
                  AND event.event_type='task.identity_conflict'
              ) AS identity_conflict
       FROM admission_intent admission
       JOIN operation_snapshot snapshot
         ON snapshot.snapshot_id=admission.operation_snapshot_id
       LEFT JOIN provider_task task ON task.task_id=admission.task_id
       WHERE admission.task_id=$1`,
      [taskId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;

    const projectionWithoutHash = {
      schemaVersion: "sdar.smpp-task-execution-binding/v1" as const,
      taskId: row.task_id,
      providerId: row.provider_id,
      operationName: row.operation_name,
      argumentHash: row.argument_hash,
      executionMode: row.execution_mode,
      simulationId: row.simulation_id,
      externalExecutionId: row.external_execution_id,
      resourceRef: resourceReference(row.operation_definition, row.arguments),
      adapterRevision: row.adapter_revision === null ? null : Number(row.adapter_revision),
      bindingStatus: bindingStatus(row),
    };
    return {
      ...projectionWithoutHash,
      contentHash: `sha256:${sha256CanonicalJson(projectionWithoutHash as CanonicalJsonValue)}`,
    };
  }

  async getDispatchUncertainty(taskId: string): Promise<SmppDispatchUncertaintyV1 | null> {
    const result = await this.pool.query<{
      task_id: string;
      operation_name: string;
      argument_hash: string;
      uncertainty_class: SmppDispatchUncertaintyClass;
      occurred_at: Date;
      causal_refs: string[];
    }>("SELECT * FROM smpp_dispatch_uncertainty WHERE task_id=$1", [taskId]);
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      schemaVersion: "sdar.smpp-dispatch-uncertainty/v1",
      taskId: row.task_id,
      operationName: row.operation_name,
      argumentHash: row.argument_hash,
      uncertaintyClass: row.uncertainty_class,
      redispatchAllowed: false,
      occurredAt: row.occurred_at.toISOString(),
      causalRefs: row.causal_refs,
    };
  }

  async listReconciliationResults(taskId: string): Promise<SmppReconciliationResultV1[]> {
    const result = await this.pool.query<{
      task_id: string;
      attempt: number;
      status: SmppReconciliationStatus;
      external_execution_id: string | null;
      occurred_at: Date;
      identity_validated: boolean;
    }>("SELECT * FROM smpp_reconciliation_audit WHERE task_id=$1 ORDER BY attempt", [taskId]);
    return result.rows.map((row) => ({
      schemaVersion: "sdar.smpp-reconciliation-result/v1",
      taskId: row.task_id,
      attempt: row.attempt,
      status: row.status,
      externalExecutionId: row.external_execution_id,
      occurredAt: row.occurred_at.toISOString(),
      identityValidated: row.identity_validated,
    }));
  }
}

function bindingStatus(row: BindingRow): SmppTaskExecutionBindingStatus {
  if (row.identity_conflict) return "conflict";
  if (row.internal_state?.startsWith("TERMINAL_")) return "terminal";
  if (row.external_execution_id !== null) return "bound";
  if (row.admission_state === "UNCERTAIN") return "unresolved";
  return "unbound";
}

function resourceReference(
  definition: Record<string, unknown>,
  argumentsValue: Record<string, unknown>,
): string | null {
  const resourceBinding = definition.resourceBinding;
  if (
    typeof resourceBinding !== "object" ||
    resourceBinding === null ||
    Array.isArray(resourceBinding)
  ) {
    return null;
  }
  const binding = resourceBinding as Record<string, unknown>;
  const pointer = binding.resourceIdJsonPointer;
  if (binding.mode !== "ARGUMENT_REFERENCE" || typeof pointer !== "string") return null;
  if (!pointer.startsWith("/")) return null;
  let current: unknown = argumentsValue;
  for (const encoded of pointer.slice(1).split("/")) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return null;
    const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" || typeof current === "number" ? String(current) : null;
}
