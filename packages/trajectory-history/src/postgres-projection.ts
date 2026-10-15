import type { PoolClient } from "pg";
import type { BoundExecutionScope } from "../../provider-adapter-kit/src/task-business-store.js";
import type { TaskArtifact } from "../../vehicle-provider-core/src/task-business-artifact.js";
import {
  ProjectionEvidenceSchema,
  ReceptionEntrySchema,
  ReceptionScopeSchema,
  type TrajectoryProjectionWrite,
} from "./contract.js";
import { buildProjectionEvidence } from "./projection.js";

/** Runs inside the same transaction/fence as the exact Artifact, Context and public event. */
export async function insertTrajectoryProjection(
  client: PoolClient,
  scope: BoundExecutionScope,
  key: { hash: string; text: string },
  artifact: TaskArtifact,
  write: TrajectoryProjectionWrite,
): Promise<void> {
  const prior = await client.query<{ payload: unknown }>(
    `SELECT payload FROM ugv_trajectory_projection_evidence
     WHERE scope_hash=$1 AND scope_key=$2 AND artifact_id=$3 AND revision=$4`,
    [key.hash, key.text, artifact.artifactId, artifact.revision - 1],
  );
  let linked;
  if (write.receptionId) {
    if (!write.sourceStreamId) throw Error("TRAJECTORY_EVIDENCE_SOURCE_STREAM_REQUIRED");
    const receipt = await client.query<Record<string, unknown>>(
      `SELECT s.scope_payload, r.sequence::text,r.previous_hash,r.hash,r.receipt,
        to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') recorded_at
       FROM ugv_trajectory_history_reception r JOIN ugv_trajectory_history_stream s USING(stream_id)
       WHERE r.reception_id=$1 AND s.scope_payload->>'providerId'=$2 AND s.scope_payload->>'resourceId'=$3 AND r.stream_id=$4`,
      [write.receptionId, scope.providerId, scope.resourceId, write.sourceStreamId],
    );
    if (receipt.rows.length !== 1) throw Error("TRAJECTORY_EVIDENCE_RECEIPT_NOT_FOUND");
    const row = receipt.rows[0];
    if (!row) throw Error("TRAJECTORY_EVIDENCE_RECEIPT_NOT_FOUND");
    const receptionScope = ReceptionScopeSchema.parse(row.scope_payload);
    if (
      scope.deviceContext &&
      (receptionScope.deviceId !== scope.deviceContext.deviceId ||
        receptionScope.sourceSessionKey !== scope.deviceContext.sourceSessionKey ||
        receptionScope.bindingId !== scope.deviceContext.bindingId ||
        receptionScope.smppServiceKey !== scope.deviceContext.smppServiceKey)
    )
      throw Error("TRAJECTORY_EVIDENCE_DEVICE_SCOPE_MISMATCH");
    linked = {
      scope: receptionScope,
      entry: ReceptionEntrySchema.parse({
        sequence: row.sequence,
        previousHash: row.previous_hash,
        hash: row.hash,
        receipt: row.receipt,
        recordedAt: row.recorded_at,
        recordingClockOwner: "POSTGRESQL_RECORD_INSERTION_CLOCK",
        recordingResolution: "MICROSECOND",
        exactTransactionCommittedAt: null,
      }),
    };
  }
  const evidence = buildProjectionEvidence(
    artifact,
    write,
    prior.rows[0] ? ProjectionEvidenceSchema.parse(prior.rows[0].payload) : undefined,
    linked,
  );
  await client.query(
    `INSERT INTO ugv_trajectory_projection_evidence
    (scope_hash,scope_key,task_id,artifact_id,revision,payload) VALUES($1,$2,$3,$4,$5,$6)`,
    [key.hash, key.text, scope.taskId, artifact.artifactId, artifact.revision, evidence],
  );
}
