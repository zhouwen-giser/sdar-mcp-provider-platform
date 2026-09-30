import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { AdapterBusinessEvent } from "../../adapter-protocol/src/index.js";
import type { Pool, PoolClient } from "pg";
import { inTransaction } from "../../gowm-shared-storage-adapter/src/connection.js";
import { storageScope } from "../../gowm-shared-storage-adapter/src/scope.js";
import type { GowmStorageConfig } from "../../gowm-shared-storage-adapter/src/config.js";
import { assertCurrentRoute } from "../../gowm-shared-storage-adapter/src/scope.js";
import { verifyGowmStorage } from "../../gowm-shared-storage-adapter/src/contract-check.js";
import { verifyGowmTaskBusinessStorage } from "../../gowm-shared-storage-adapter/src/task-business.js";
import {
  BusinessObjectRefSchema,
  TaskBusinessContextSchema,
  type BusinessObjectRef,
  type TaskBusinessContext,
} from "../../vehicle-provider-core/src/task-business-contract.js";
import {
  TaskArtifactSchema,
  prepareArtifactContentRead,
  type PreparedArtifactContentRead,
  type TaskArtifact,
} from "../../vehicle-provider-core/src/task-business-artifact.js";
import {
  BusinessActionSchema,
  RequiredInputSchema,
  RuntimeInterventionSchema,
  assertActionTransition,
  assertInterventionTransition,
  assertRequiredInputTransition,
} from "../../vehicle-provider-core/src/task-business-interaction.js";
import { assertPostgresJsonbSafe } from "./postgres-store.js";
import { appendTaskBusinessEventInTransaction } from "./postgres-store.js";
import { taskBusinessSourceCapability } from "./sources.js";
import {
  assertBoundExecutionScope,
  assertBusinessCommandEntryCurrent,
  assertBusinessCommandEntryOpenAt,
  assertBusinessContextTimeProgression,
  assertInterventionAppliedFacts,
  assertInterventionRejectedFacts,
  assertInterventionTerminalPublicEvents,
  assertReconAreaAdoptionFacts,
  assertRequiredInputReplyClaim,
  businessObjectRef,
  contextObjectRefs,
  parseBusinessCommandRecord,
  parseBusinessContext,
  parseBusinessObjectVersion,
  parseTaskBusinessEventDraft,
  prepareInterventionSubmission,
  validateBusinessContentWrites,
  loadTaskBusinessSnapshotPage,
  scopeBusinessIdentity,
  BusinessCommandRecordSchema,
  type BoundExecutionScope,
  type BusinessChangeSet,
  type BusinessCommandRecord,
  type BusinessCommandClaim,
  type BusinessObjectVersion,
  type CommittedBusinessChangeSet,
  type TaskBusinessEventDraft,
  type TaskBusinessStore,
  type TaskBusinessSnapshot,
  type TaskBusinessSnapshotPage,
  type StoredBusinessContent,
} from "./task-business-store.js";

interface ScopeKey {
  hash: string;
  text: string;
}

const verifiedGowmPools = new WeakSet<Pool>();

/** Native mode qualifies installed tables without running migrations at startup. */
export async function verifyNativeTaskBusinessSchema(pool: Pool): Promise<void> {
  for (const table of [
    "ugv_task_business_context",
    "ugv_task_business_object_version",
    "ugv_task_business_command",
    "ugv_task_business_content",
  ]) {
    const result = await pool.query<{ relation: string | null }>(
      "SELECT to_regclass($1)::text AS relation",
      [table],
    );
    if (!result.rows[0]?.relation) throw new Error(`TASK_BUSINESS_SCHEMA_NOT_INSTALLED: ${table}`);
  }
}

/** The only shared-mode constructor path; qualification never creates schema. */
export async function openGowmTaskBusinessStore(
  pool: Pool,
  config: GowmStorageConfig,
): Promise<PostgresTaskBusinessStore> {
  const registered = storageScope(pool);
  if (
    registered?.databaseUrl !== config.databaseUrl ||
    registered.bindingId !== config.bindingId ||
    registered.serviceKey !== config.serviceKey ||
    registered.sourceSessionKey !== config.sourceSessionKey ||
    registered.allowedDeviceIds[0] !== config.allowedDeviceIds[0]
  ) {
    throw new Error("GOWM_BUSINESS_POOL_MISMATCH");
  }
  await verifyGowmStorage(pool, config);
  await verifyGowmTaskBusinessStorage(pool, config);
  await assertCurrentRoute(pool, config);
  verifiedGowmPools.add(pool);
  return new PostgresTaskBusinessStore(pool, config);
}

export function assertGowmBusinessScope(scope: BoundExecutionScope, gowm: GowmStorageConfig): void {
  assertBoundExecutionScope(scope);
  const device = scope.deviceContext;
  if (
    !device ||
    device.deviceId !== gowm.allowedDeviceIds[0] ||
    device.bindingId !== gowm.bindingId ||
    device.smppServiceKey !== gowm.serviceKey ||
    device.sourceSessionKey !== gowm.sourceSessionKey
  ) {
    throw new Error("GOWM_BUSINESS_SCOPE_MISMATCH");
  }
}

function scopeKey(scope: BoundExecutionScope, gowm?: GowmStorageConfig): ScopeKey {
  assertBoundExecutionScope(scope);
  if (gowm) assertGowmBusinessScope(scope, gowm);
  const text = scope.key();
  return { text, hash: createHash("sha256").update(text).digest("hex") };
}

function decodeVersion(
  scope: BoundExecutionScope,
  kind: string,
  payload: unknown,
): BusinessObjectVersion {
  switch (kind) {
    case "artifact":
      return parseBusinessObjectVersion(scope, { kind, value: TaskArtifactSchema.parse(payload) });
    case "action":
      return parseBusinessObjectVersion(scope, {
        kind,
        value: BusinessActionSchema.parse(payload),
      });
    case "input_request":
      return parseBusinessObjectVersion(scope, { kind, value: RequiredInputSchema.parse(payload) });
    case "intervention":
      return parseBusinessObjectVersion(scope, {
        kind,
        value: RuntimeInterventionSchema.parse(payload),
      });
    default:
      throw new Error("BUSINESS_OBJECT_KIND_INVALID");
  }
}

function assertScopeRow(actual: string, expected: string): void {
  if (actual !== expected) throw new Error("BUSINESS_SCOPE_HASH_COLLISION");
}

/** Native PostgreSQL adapter. The migration is applied separately, never at startup. */
export class PostgresTaskBusinessStore implements TaskBusinessStore {
  constructor(
    readonly pool: Pool,
    private readonly gowm?: GowmStorageConfig,
  ) {
    const poolScope = storageScope(pool);
    if (gowm) {
      if (
        !verifiedGowmPools.has(pool) ||
        poolScope?.databaseUrl !== gowm.databaseUrl ||
        poolScope.bindingId !== gowm.bindingId ||
        poolScope.serviceKey !== gowm.serviceKey ||
        poolScope.sourceSessionKey !== gowm.sourceSessionKey ||
        poolScope.allowedDeviceIds[0] !== gowm.allowedDeviceIds[0]
      )
        throw new Error("GOWM_BUSINESS_POOL_MISMATCH");
    } else if (poolScope) {
      throw new Error("GOWM_BUSINESS_STORE_VERIFICATION_REQUIRED");
    }
  }

  async getContext(scope: BoundExecutionScope): Promise<TaskBusinessContext | undefined> {
    const key = scopeKey(scope, this.gowm);
    const result = await this.pool.query<{ payload: unknown }>(
      `SELECT payload FROM ugv_task_business_context WHERE scope_hash=$1 AND scope_key=$2`,
      [key.hash, key.text],
    );
    const payload = result.rows[0]?.payload;
    return payload === undefined
      ? undefined
      : parseBusinessContext(scope, TaskBusinessContextSchema.parse(payload));
  }

  async getContextSnapshot(scope: BoundExecutionScope): Promise<TaskBusinessSnapshot | undefined> {
    const key = scopeKey(scope, this.gowm);
    const snapshot = await inTransaction(this.pool, async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await client.query<{ payload: unknown }>(
        `SELECT payload FROM ugv_task_business_context WHERE scope_hash=$1 AND scope_key=$2`,
        [key.hash, key.text],
      );
      const payload = result.rows[0]?.payload;
      if (payload === undefined) return undefined;
      const context = parseBusinessContext(scope, TaskBusinessContextSchema.parse(payload));
      const refs = contextObjectRefs(context);
      // Read all exact versions in one round trip. Recon target histories grow
      // while scanning; one query per version can starve control/recovery RPCs.
      const versions = refs.length
        ? await client.query<{ payload: unknown }>(
            `SELECT stored.payload
             FROM unnest($3::text[], $4::text[], $5::bigint[]) WITH ORDINALITY
               AS wanted(kind,id,revision,position)
             LEFT JOIN ugv_task_business_object_version stored
               ON stored.scope_hash=$1 AND stored.scope_key=$2
               AND stored.object_kind=wanted.kind AND stored.object_id=wanted.id
               AND stored.revision=wanted.revision
             ORDER BY wanted.position`,
            [
              key.hash,
              key.text,
              refs.map((r) => r.kind),
              refs.map((r) => r.id),
              refs.map((r) => r.revision),
            ],
          )
        : { rows: [] };
      const objects = refs.map((ref, index) => {
        const record = versions.rows[index]?.payload;
        if (record === undefined || record === null)
          throw new Error("BUSINESS_CONTEXT_REF_NOT_FOUND");
        return decodeVersion(scope, ref.kind, record);
      });
      return { context, objects };
    });
    if (snapshot && Buffer.byteLength(JSON.stringify(snapshot)) > 1_048_576) {
      throw new Error("BUSINESS_SNAPSHOT_TOO_LARGE");
    }
    return snapshot;
  }

  getContextSnapshotPage(
    scope: BoundExecutionScope,
    maxBytes: number,
    cursor?: string,
  ): Promise<TaskBusinessSnapshotPage | undefined> {
    const key = scopeKey(scope, this.gowm);
    // A high-rate producer may advance Context during even a single page read.
    // Pin this page to one database snapshot; a later page still checks its
    // cursor against that page's current Context and rejects revision changes.
    return inTransaction(this.pool, async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      return loadTaskBusinessSnapshotPage(
        {
          getContext: async () => {
            const result = await client.query<{ payload: unknown }>(
              `SELECT payload FROM ugv_task_business_context WHERE scope_hash=$1 AND scope_key=$2`,
              [key.hash, key.text],
            );
            const payload = result.rows[0]?.payload;
            return payload === undefined
              ? undefined
              : parseBusinessContext(scope, TaskBusinessContextSchema.parse(payload));
          },
          getObjectVersion: async (_scope, candidate) => {
            const ref = BusinessObjectRefSchema.parse(candidate);
            const result = await client.query<{ payload: unknown }>(
              `SELECT payload FROM ugv_task_business_object_version
               WHERE scope_hash=$1 AND scope_key=$2 AND object_kind=$3 AND object_id=$4 AND revision=$5`,
              [key.hash, key.text, ref.kind, ref.id, ref.revision],
            );
            const payload = result.rows[0]?.payload;
            return payload === undefined ? undefined : decodeVersion(scope, ref.kind, payload);
          },
        },
        scope,
        maxBytes,
        cursor,
      );
    });
  }

  async getArtifactVersion(
    scope: BoundExecutionScope,
    artifactId: string,
    revision: number,
  ): Promise<TaskArtifact | undefined> {
    const found = await this.getObjectVersion(scope, {
      kind: "artifact",
      id: artifactId,
      revision,
    });
    return found?.kind === "artifact" ? found.value : undefined;
  }

  async getArtifactLatest(
    scope: BoundExecutionScope,
    artifactId: string,
  ): Promise<TaskArtifact | undefined> {
    const key = scopeKey(scope, this.gowm);
    const result = await this.pool.query<{ payload: unknown }>(
      `SELECT payload FROM ugv_task_business_object_version
       WHERE scope_hash=$1 AND scope_key=$2 AND object_kind='artifact' AND object_id=$3
       ORDER BY revision DESC LIMIT 1`,
      [key.hash, key.text, artifactId],
    );
    const payload = result.rows[0]?.payload;
    if (payload === undefined) return undefined;
    const parsed = parseBusinessObjectVersion(scope, {
      kind: "artifact",
      value: TaskArtifactSchema.parse(payload),
    });
    if (parsed.kind !== "artifact") throw new Error("BUSINESS_OBJECT_KIND_INVALID");
    return parsed.value;
  }

  async readArtifactContent(
    scope: BoundExecutionScope,
    artifactId: string,
    revision: number,
    now: Date,
    representationName?: string,
  ): Promise<PreparedArtifactContentRead> {
    const artifact = await this.getArtifactVersion(scope, artifactId, revision);
    if (!artifact) throw new Error("ARTIFACT_REVISION_NOT_FOUND");
    return prepareArtifactContentRead(
      artifact,
      { identity: scopeBusinessIdentity(scope), artifactId, revision },
      now,
      representationName,
    );
  }

  async readArtifactContentBytes(
    scope: BoundExecutionScope,
    artifactId: string,
    revision: number,
    now: Date,
    representationName?: string,
  ): Promise<StoredBusinessContent> {
    const prepared = await this.readArtifactContent(
      scope,
      artifactId,
      revision,
      now,
      representationName,
    );
    if (prepared.kind !== "stored") throw new Error("ARTIFACT_CONTENT_INLINE");
    const key = scopeKey(scope, this.gowm);
    const result = await this.pool.query<{
      media_type: string;
      size_bytes: string;
      sha256: string;
      expires_at: Date | null;
      bytes: Buffer;
    }>(
      `SELECT media_type,size_bytes,sha256,expires_at,bytes
       FROM ugv_task_business_content
       WHERE scope_hash=$1 AND scope_key=$2 AND artifact_id=$3 AND revision=$4 AND handle=$5`,
      [key.hash, key.text, artifactId, revision, prepared.handle],
    );
    const row = result.rows[0];
    if (!row) throw new Error("ARTIFACT_CONTENT_NOT_FOUND");
    if (row.expires_at && now.getTime() >= row.expires_at.getTime()) {
      throw new Error("ARTIFACT_CONTENT_EXPIRED");
    }
    const bytes = Uint8Array.from(row.bytes);
    if (
      row.media_type !== prepared.mediaType ||
      Number(row.size_bytes) !== prepared.sizeBytes ||
      row.sha256 !== prepared.sha256 ||
      bytes.length !== prepared.sizeBytes ||
      createHash("sha256").update(bytes).digest("hex") !== prepared.sha256
    ) {
      throw new Error("ARTIFACT_CONTENT_HASH_MISMATCH");
    }
    return {
      artifactId,
      revision,
      handle: prepared.handle,
      mediaType: prepared.mediaType,
      sizeBytes: prepared.sizeBytes,
      sha256: prepared.sha256,
      ...(row.expires_at === null ? {} : { expiresAt: row.expires_at.toISOString() }),
      bytes,
    };
  }

  async getObjectVersion(
    scope: BoundExecutionScope,
    candidate: BusinessObjectRef,
  ): Promise<BusinessObjectVersion | undefined> {
    const key = scopeKey(scope, this.gowm);
    const ref = BusinessObjectRefSchema.parse(candidate);
    const result = await this.pool.query<{ payload: unknown }>(
      `SELECT payload FROM ugv_task_business_object_version
       WHERE scope_hash=$1 AND scope_key=$2 AND object_kind=$3 AND object_id=$4 AND revision=$5`,
      [key.hash, key.text, ref.kind, ref.id, ref.revision],
    );
    const payload = result.rows[0]?.payload;
    return payload === undefined ? undefined : decodeVersion(scope, ref.kind, payload);
  }

  async getCommand(
    scope: BoundExecutionScope,
    commandId: string,
  ): Promise<BusinessCommandRecord | undefined> {
    const key = scopeKey(scope, this.gowm);
    const result = await this.pool.query<{ payload: unknown }>(
      `SELECT payload FROM ugv_task_business_command
       WHERE scope_hash=$1 AND scope_key=$2 AND command_id=$3`,
      [key.hash, key.text, commandId],
    );
    const payload = result.rows[0]?.payload;
    return payload === undefined
      ? undefined
      : parseBusinessCommandRecord(scope, BusinessCommandRecordSchema.parse(payload));
  }

  async getAcceptedInputCommand(
    scope: BoundExecutionScope,
    requestKey: string,
  ): Promise<BusinessCommandRecord | undefined> {
    if (!requestKey || requestKey.length > 256)
      throw new Error("BUSINESS_INPUT_REQUEST_KEY_INVALID");
    const key = scopeKey(scope, this.gowm);
    const result = await this.pool.query<{ payload: unknown }>(
      `SELECT payload FROM ugv_task_business_command
       WHERE scope_hash=$1 AND scope_key=$2 AND command_type='input_response'
         AND state='accepted' AND payload->>'entryKey'=$3 LIMIT 2`,
      [key.hash, key.text, `input:${requestKey}`],
    );
    if (result.rows.length > 1) throw new Error("BUSINESS_ENTRY_CLAIM_CONFLICT");
    const payload = result.rows[0]?.payload;
    return payload === undefined
      ? undefined
      : parseBusinessCommandRecord(scope, BusinessCommandRecordSchema.parse(payload));
  }

  async claimCommand(
    scope: BoundExecutionScope,
    candidate: BusinessCommandRecord,
    expectedEntryRef?: BusinessObjectRef,
    _now?: Date,
    expectedContextRevision?: number,
    options?: { publishInterventionSubmission: true },
  ): Promise<BusinessCommandClaim> {
    const key = scopeKey(scope, this.gowm);
    const command = parseBusinessCommandRecord(scope, candidate);
    if (command.state !== "accepted") throw new Error("BUSINESS_COMMAND_CLAIM_STATE_INVALID");
    assertPostgresJsonbSafe(command, "taskBusinessCommand");
    return inTransaction(this.pool, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [key.hash]);
      const existing = await client.query<{ scope_key: string; payload: unknown }>(
        `SELECT scope_key,payload FROM ugv_task_business_command WHERE scope_hash=$1 AND command_id=$2`,
        [key.hash, command.commandId],
      );
      const row = existing.rows[0];
      if (row) {
        assertScopeRow(row.scope_key, key.text);
        const record = parseBusinessCommandRecord(
          scope,
          BusinessCommandRecordSchema.parse(row.payload),
        );
        if (
          record.commandType !== command.commandType ||
          record.requestHash !== command.requestHash ||
          record.responseHash !== command.responseHash ||
          record.entryKey !== command.entryKey ||
          record.runtimeCommandSequence !== command.runtimeCommandSequence
        ) {
          throw new Error("COMMAND_ID_CONFLICT");
        }
        return { claimed: false, record };
      }
      let current: TaskBusinessContext | undefined;
      let entryVersion: BusinessObjectVersion | undefined;
      let acceptedAt: Date | undefined;
      if (
        expectedEntryRef ||
        expectedContextRevision !== undefined ||
        options?.publishInterventionSubmission
      ) {
        const currentResult = await client.query<{ scope_key: string; payload: unknown }>(
          `SELECT scope_key,payload FROM ugv_task_business_context WHERE scope_hash=$1`,
          [key.hash],
        );
        const currentRow = currentResult.rows[0];
        if (currentRow) assertScopeRow(currentRow.scope_key, key.text);
        current = currentRow
          ? parseBusinessContext(scope, TaskBusinessContextSchema.parse(currentRow.payload))
          : undefined;
        if (
          expectedContextRevision !== undefined &&
          current?.contextRevision !== expectedContextRevision
        ) {
          throw new Error("CONTEXT_REVISION_CONFLICT");
        }
        if (expectedEntryRef) {
          assertBusinessCommandEntryCurrent(current, expectedEntryRef, command.commandType);
          const entry = await client.query<{ scope_key: string; payload: unknown }>(
            `SELECT scope_key,payload FROM ugv_task_business_object_version
           WHERE scope_hash=$1 AND object_kind=$2 AND object_id=$3 AND revision=$4`,
            [key.hash, expectedEntryRef.kind, expectedEntryRef.id, expectedEntryRef.revision],
          );
          const entryRow = entry.rows[0];
          if (entryRow) assertScopeRow(entryRow.scope_key, key.text);
          const claimTime = await client.query<{ at: Date }>("SELECT clock_timestamp() AS at");
          acceptedAt = claimTime.rows[0]?.at;
          if (!acceptedAt) throw new Error("BUSINESS_COMMAND_TIME_INVALID");
          entryVersion = entryRow
            ? decodeVersion(scope, expectedEntryRef.kind, entryRow.payload)
            : undefined;
          assertBusinessCommandEntryOpenAt(
            entryVersion,
            command.commandType,
            acceptedAt,
            current?.effectivePlanRevision,
          );
        }
      }
      if (command.entryKey) {
        const occupied = await client.query(
          `SELECT 1 FROM ugv_task_business_command
           WHERE scope_hash=$1 AND scope_key=$2 AND payload->>'entryKey'=$3
             AND state IN ('accepted','applied') LIMIT 1`,
          [key.hash, key.text, command.entryKey],
        );
        if (occupied.rowCount) throw new Error("BUSINESS_ENTRY_ALREADY_CLAIMED");
      }
      if (command.commandType === "intervention") {
        const applying = await client.query(
          `SELECT 1 FROM ugv_task_business_command
           WHERE scope_hash=$1 AND scope_key=$2 AND command_type='intervention'
             AND state='accepted' LIMIT 1`,
          [key.hash, key.text],
        );
        if (applying.rowCount) throw new Error("BUSINESS_CHANGE_IN_PROGRESS");
      }
      if (command.runtimeCommandSequence) {
        const mapped = await client.query(
          `SELECT 1 FROM ugv_task_business_command
           WHERE scope_hash=$1 AND scope_key=$2 AND command_type=$3
             AND payload->>'runtimeCommandSequence'=$4 LIMIT 1`,
          [key.hash, key.text, command.commandType, command.runtimeCommandSequence],
        );
        if (mapped.rowCount) throw new Error("RUNTIME_COMMAND_SEQUENCE_CONFLICT");
      }
      await client.query(
        `INSERT INTO ugv_task_business_command
         (scope_hash,scope_key,command_id,command_type,request_hash,state,payload,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          key.hash,
          key.text,
          command.commandId,
          command.commandType,
          command.requestHash,
          command.state,
          command,
          command.createdAt,
          command.updatedAt,
        ],
      );
      if (!options?.publishInterventionSubmission) return { claimed: true, record: command };
      if (!expectedEntryRef || !current || !entryVersion || !acceptedAt) {
        throw new Error("BUSINESS_INTERVENTION_SUBMISSION_INVALID");
      }
      const submission = prepareInterventionSubmission(
        scope,
        current,
        entryVersion,
        command,
        acceptedAt,
      );
      const ref = businessObjectRef(submission.version);
      assertPostgresJsonbSafe(submission.version.value, "taskBusinessObject");
      assertPostgresJsonbSafe(submission.context, "taskBusinessContext");
      await client.query(
        `INSERT INTO ugv_task_business_object_version
         (scope_hash,scope_key,object_kind,object_id,revision,payload)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [key.hash, key.text, ref.kind, ref.id, ref.revision, submission.version.value],
      );
      const updated = await client.query(
        `UPDATE ugv_task_business_context
         SET context_revision=$3,effective_plan_revision=$4,payload=$5,updated_at=$6
         WHERE scope_hash=$1 AND scope_key=$2 AND context_revision=$7`,
        [
          key.hash,
          key.text,
          submission.context.contextRevision,
          submission.context.effectivePlanRevision,
          submission.context,
          submission.context.updatedAt,
          current.contextRevision,
        ],
      );
      if (updated.rowCount !== 1) throw new Error("BUSINESS_CONTEXT_REVISION_CONFLICT");
      const source = taskBusinessSourceCapability(this.gowm);
      const events: AdapterBusinessEvent[] = [];
      for (const draft of submission.events) {
        const occurredAt = draft.body.providerRecordedAt;
        events.push(
          await appendTaskBusinessEventInTransaction(
            client,
            source.sourceStreamId,
            {
              sourceId: "vehicle.business",
              scope: "task",
              occurredAt,
              eventType: "vehicle.business.changed",
              description: draft.description,
              reasonCode: draft.reasonCode,
              externalExecutionId: scope.executionId,
              resourceRef: scope.resourceId,
              severityHint: draft.severityHint,
              rawPayload: draft.body,
              retainUntil: new Date(Date.parse(occurredAt) + 604_800_000).toISOString(),
            },
            this.gowm,
          ),
        );
      }
      return { claimed: true, record: command, events };
    });
  }

  async commitChangeSet(changeSet: BusinessChangeSet): Promise<TaskBusinessContext> {
    return (await this.commitBusinessChangeSet(changeSet, [])).context;
  }

  async commitBusinessChangeSet(
    changeSet: BusinessChangeSet,
    events: readonly TaskBusinessEventDraft[],
  ): Promise<CommittedBusinessChangeSet> {
    const { scope } = changeSet;
    const key = scopeKey(scope, this.gowm);
    const context = parseBusinessContext(scope, changeSet.context);
    const contents = validateBusinessContentWrites(changeSet);
    const drafts = events.map((event) => parseTaskBusinessEventDraft(context, event));
    assertPostgresJsonbSafe(context, "taskBusinessContext");
    for (const draft of drafts) assertPostgresJsonbSafe(draft.body, "taskBusinessFeedback");
    return inTransaction(this.pool, async (client) => {
      // Serializes first Context creation and later CAS writes for this scope.
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [key.hash]);
      const contextResult = await client.query<{ scope_key: string; payload: unknown }>(
        `SELECT scope_key,payload FROM ugv_task_business_context WHERE scope_hash=$1 FOR UPDATE`,
        [key.hash],
      );
      const row = contextResult.rows[0];
      if (row) assertScopeRow(row.scope_key, key.text);
      const current = row
        ? parseBusinessContext(scope, TaskBusinessContextSchema.parse(row.payload))
        : undefined;
      if (
        (current === undefined && changeSet.expectedContextRevision !== null) ||
        (current !== undefined && changeSet.expectedContextRevision !== current.contextRevision)
      )
        throw new Error("BUSINESS_CONTEXT_REVISION_CONFLICT");
      if (
        (current === undefined && ![0, 1].includes(context.contextRevision)) ||
        (current !== undefined && context.contextRevision !== current.contextRevision + 1)
      )
        throw new Error("BUSINESS_CONTEXT_REVISION_INVALID");
      if (current && context.effectivePlanRevision < current.effectivePlanRevision) {
        throw new Error("BUSINESS_PLAN_REVISION_REGRESSION");
      }
      assertBusinessContextTimeProgression(current, context);
      if (current?.summary.status === "finalized") throw new Error("BUSINESS_CONTEXT_FINALIZED");

      const pending = new Map<string, BusinessObjectVersion>();
      for (const candidate of changeSet.objects) {
        const version = parseBusinessObjectVersion(scope, candidate);
        const ref = businessObjectRef(version);
        const objectId = JSON.stringify([ref.kind, ref.id]);
        if (pending.has(objectId)) throw new Error("BUSINESS_OBJECT_DUPLICATE_IN_CHANGESET");
        pending.set(objectId, version);
        const last = await client.query<{ revision: string; payload: unknown }>(
          `SELECT revision,payload FROM ugv_task_business_object_version
           WHERE scope_hash=$1 AND scope_key=$2 AND object_kind=$3 AND object_id=$4
           ORDER BY revision DESC LIMIT 1`,
          [key.hash, key.text, ref.kind, ref.id],
        );
        const priorRow = last.rows[0];
        const latestRevision = priorRow ? Number(priorRow.revision) : 0;
        if (ref.revision !== latestRevision + 1)
          throw new Error("BUSINESS_OBJECT_REVISION_CONFLICT");
        if (priorRow) {
          const prior = decodeVersion(scope, ref.kind, priorRow.payload);
          assertObjectTransition(prior, version);
        }
        assertPostgresJsonbSafe(version.value, "taskBusinessObject");
      }

      const listed = [
        ...context.artifactRefs,
        ...context.actionRefs,
        ...context.requiredInputRefs,
        ...context.interventionRefs,
      ];
      const listedSet = new Set(listed.map(refKey));
      for (const ref of Object.values(context.activeRefs)) {
        if (!listedSet.has(refKey(ref))) throw new Error("BUSINESS_ACTIVE_REF_NOT_LISTED");
      }
      const persistedRefs = contextObjectRefs(context).filter((ref) => {
        const version = pending.get(JSON.stringify([ref.kind, ref.id]));
        return !version || businessObjectRef(version).revision !== ref.revision;
      });
      if (persistedRefs.length) {
        const missing = await client.query(
          `SELECT 1 FROM unnest($3::text[], $4::text[], $5::bigint[])
             AS wanted(kind,id,revision)
           WHERE NOT EXISTS (
             SELECT 1 FROM ugv_task_business_object_version stored
             WHERE stored.scope_hash=$1 AND stored.scope_key=$2
               AND stored.object_kind=wanted.kind AND stored.object_id=wanted.id
               AND stored.revision=wanted.revision
           ) LIMIT 1`,
          [
            key.hash,
            key.text,
            persistedRefs.map((ref) => ref.kind),
            persistedRefs.map((ref) => ref.id),
            persistedRefs.map((ref) => ref.revision),
          ],
        );
        if (missing.rowCount) throw new Error("BUSINESS_CONTEXT_REF_NOT_FOUND");
      }

      let command: BusinessCommandRecord | undefined;
      if (changeSet.command) {
        command = parseBusinessCommandRecord(scope, changeSet.command);
        const claimedResult = await client.query<{ scope_key: string; payload: unknown }>(
          `SELECT scope_key,payload FROM ugv_task_business_command
           WHERE scope_hash=$1 AND command_id=$2 FOR UPDATE`,
          [key.hash, command.commandId],
        );
        const claimedRow = claimedResult.rows[0];
        if (!claimedRow) throw new Error("BUSINESS_COMMAND_CLAIM_REQUIRED");
        assertScopeRow(claimedRow.scope_key, key.text);
        const claimed = parseBusinessCommandRecord(
          scope,
          BusinessCommandRecordSchema.parse(claimedRow.payload),
        );
        if (
          claimed.commandType !== command.commandType ||
          claimed.requestHash !== command.requestHash ||
          claimed.responseHash !== command.responseHash ||
          claimed.createdAt !== command.createdAt ||
          claimed.entryKey !== command.entryKey ||
          claimed.runtimeCommandSequence !== command.runtimeCommandSequence ||
          !isDeepStrictEqual(claimed.interventionRequest, command.interventionRequest)
        )
          throw new Error("COMMAND_ID_CONFLICT");
        if (Date.parse(command.updatedAt) < Date.parse(claimed.updatedAt)) {
          throw new Error("BUSINESS_COMMAND_TIME_REGRESSION");
        }
        if (claimed.state !== "accepted" || command.state === "accepted") {
          throw new Error("BUSINESS_COMMAND_TRANSITION_INVALID");
        }
        for (const ref of command.resultRefs ?? []) {
          await assertRefExists(client, key, pending, ref, "BUSINESS_COMMAND_RESULT_REF_NOT_FOUND");
        }
        assertPostgresJsonbSafe(command, "taskBusinessCommand");
      }

      for (const version of pending.values()) {
        if (
          version.kind !== "input_request" ||
          (version.value.state !== "answered" &&
            version.value.state !== "declined" &&
            !(version.value.state === "cancelled" && version.value.response?.action === "cancel"))
        )
          continue;
        if (!version.value.responseCommandId)
          throw new Error("BUSINESS_INPUT_RESPONSE_CLAIM_REQUIRED");
        const claim = await client.query<{ payload: unknown }>(
          `SELECT payload FROM ugv_task_business_command
           WHERE scope_hash=$1 AND scope_key=$2 AND command_id=$3`,
          [key.hash, key.text, version.value.responseCommandId],
        );
        const payload = claim.rows[0]?.payload;
        const claimed = payload
          ? parseBusinessCommandRecord(scope, BusinessCommandRecordSchema.parse(payload))
          : undefined;
        assertRequiredInputReplyClaim(current, context, version.value, claimed);
      }

      assertInterventionAppliedFacts(current, context, [...pending.values()], command);
      assertInterventionRejectedFacts(current, context, [...pending.values()], command);
      assertInterventionTerminalPublicEvents(context, [...pending.values()], command, drafts);
      let priorArea: BusinessObjectVersion | undefined;
      const nextAreaRef = context.activeRefs.reconEffectiveArea;
      const currentAreaRef = current?.activeRefs.reconEffectiveArea;
      if (
        nextAreaRef &&
        (currentAreaRef === undefined || refKey(nextAreaRef) !== refKey(currentAreaRef))
      ) {
        const priorAreaRef = currentAreaRef ?? {
          kind: "artifact" as const,
          id: "recon-requested-area",
          revision: 1,
        };
        const priorAreaRow = await client.query<{ scope_key: string; payload: unknown }>(
          `SELECT scope_key,payload FROM ugv_task_business_object_version
           WHERE scope_hash=$1 AND scope_key=$2 AND object_kind=$3 AND object_id=$4 AND revision=$5`,
          [key.hash, key.text, priorAreaRef.kind, priorAreaRef.id, priorAreaRef.revision],
        );
        if (priorAreaRow.rows[0]) {
          assertScopeRow(priorAreaRow.rows[0].scope_key, key.text);
          priorArea = decodeVersion(scope, priorAreaRef.kind, priorAreaRow.rows[0].payload);
        }
      }
      assertReconAreaAdoptionFacts(current, context, [...pending.values()], drafts, priorArea);

      for (const version of pending.values()) {
        const ref = businessObjectRef(version);
        await client.query(
          `INSERT INTO ugv_task_business_object_version
           (scope_hash,scope_key,object_kind,object_id,revision,payload)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [key.hash, key.text, ref.kind, ref.id, ref.revision, version.value],
        );
      }
      for (const content of contents) {
        await client.query(
          `INSERT INTO ugv_task_business_content
           (scope_hash,scope_key,artifact_id,revision,handle,media_type,size_bytes,sha256,expires_at,bytes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            key.hash,
            key.text,
            content.artifactId,
            content.revision,
            content.handle,
            content.mediaType,
            content.sizeBytes,
            content.sha256,
            content.expiresAt ?? null,
            Buffer.from(content.bytes),
          ],
        );
      }
      if (current) {
        const updated = await client.query(
          `UPDATE ugv_task_business_context
           SET context_revision=$3,effective_plan_revision=$4,payload=$5,updated_at=$6
           WHERE scope_hash=$1 AND scope_key=$2 AND context_revision=$7`,
          [
            key.hash,
            key.text,
            context.contextRevision,
            context.effectivePlanRevision,
            context,
            context.updatedAt,
            current.contextRevision,
          ],
        );
        if (updated.rowCount !== 1) throw new Error("BUSINESS_CONTEXT_REVISION_CONFLICT");
      } else {
        await client.query(
          `INSERT INTO ugv_task_business_context
           (scope_hash,scope_key,task_id,external_execution_id,context_revision,
            effective_plan_revision,payload,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            key.hash,
            key.text,
            context.identity.taskId,
            context.identity.executionId,
            context.contextRevision,
            context.effectivePlanRevision,
            context,
            context.updatedAt,
          ],
        );
      }
      if (command) {
        const completed = await client.query(
          `UPDATE ugv_task_business_command
           SET state=$3,payload=$4,updated_at=$5
           WHERE scope_hash=$1 AND scope_key=$2 AND command_id=$6 AND state='accepted'`,
          [key.hash, key.text, command.state, command, command.updatedAt, command.commandId],
        );
        if (completed.rowCount !== 1) throw new Error("BUSINESS_COMMAND_TRANSITION_INVALID");
      }
      const committedEvents: AdapterBusinessEvent[] = [];
      const source = taskBusinessSourceCapability(this.gowm);
      for (const draft of drafts) {
        const occurredAt = draft.body.providerRecordedAt;
        committedEvents.push(
          await appendTaskBusinessEventInTransaction(
            client,
            source.sourceStreamId,
            {
              sourceId: "vehicle.business",
              scope: "task",
              occurredAt,
              eventType: "vehicle.business.changed",
              description: draft.description,
              reasonCode: draft.reasonCode,
              externalExecutionId: scope.executionId,
              resourceRef: scope.resourceId,
              severityHint: draft.severityHint,
              rawPayload: draft.body,
              retainUntil: new Date(Date.parse(occurredAt) + 604_800_000).toISOString(),
            },
            this.gowm,
          ),
        );
      }
      return { context, events: committedEvents };
    });
  }
}

async function assertRefExists(
  client: PoolClient,
  key: ScopeKey,
  pending: ReadonlyMap<string, BusinessObjectVersion>,
  ref: BusinessObjectRef,
  reason: string,
): Promise<void> {
  const pendingVersion = pending.get(JSON.stringify([ref.kind, ref.id]));
  if (pendingVersion && businessObjectRef(pendingVersion).revision === ref.revision) return;
  const result = await client.query(
    `SELECT 1 FROM ugv_task_business_object_version
     WHERE scope_hash=$1 AND scope_key=$2 AND object_kind=$3 AND object_id=$4 AND revision=$5`,
    [key.hash, key.text, ref.kind, ref.id, ref.revision],
  );
  if (result.rowCount !== 1) throw new Error(reason);
}

function refKey(ref: BusinessObjectRef): string {
  return JSON.stringify([ref.kind, ref.id, ref.revision]);
}

function assertObjectTransition(prior: BusinessObjectVersion, next: BusinessObjectVersion): void {
  if (prior.kind === "artifact" && next.kind === "artifact") {
    if (prior.value.artifactType !== next.value.artifactType) {
      throw new Error("BUSINESS_ARTIFACT_TYPE_CHANGED");
    }
  } else if (prior.kind === "action" && next.kind === "action") {
    assertActionTransition(prior.value, next.value);
  } else if (prior.kind === "input_request" && next.kind === "input_request") {
    assertRequiredInputTransition(prior.value, next.value);
  } else if (prior.kind === "intervention" && next.kind === "intervention") {
    assertInterventionTransition(prior.value, next.value);
  }
}
