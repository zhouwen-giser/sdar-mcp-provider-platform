import type { Pool, PoolClient } from "pg";
import { ZMQ_CONTROL_TOOLS } from "./catalog.js";
import { z } from "zod";
import { canonical, sha256 } from "../../vehicle-zmq-observer/src/config.js";
import {
  scopeColumns,
  scopeValues,
  scopePredicate,
  assertCurrentRoute,
  resolveDeviceContext,
} from "../../gowm-shared-storage-adapter/src/index.js";
import type { PostgresProviderStore } from "../../provider-adapter-kit/src/index.js";
import { SiteControlDeploymentProfile } from "../../vehicle-zmq-contract/src/site-profile.js";
export const RETIRE_REASON = "ZMQ_LEGACY_RETIRED_OUTCOME_UNKNOWN";
const writer = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    image: z.string().min(1),
    restartPolicy: z.string(),
    running: z.boolean(),
  })
  .strict();
export const SiteHandoffGrant = z
  .object({
    schemaVersion: z.literal("ugv.zmq-site-handoff-grant/1"),
    commandId: z.uuid(),
    planHash: z.string().regex(/^[a-f0-9]{64}$/),
    profileHash: z.string().regex(/^[a-f0-9]{64}$/),
    providerId: z.string().min(1),
    resourceId: z.string().min(1),
    actor: z.string().trim().min(1).max(128),
    reason: z.string().trim().min(1).max(1024),
    createdAt: z.iso.datetime(),
    oldWriters: z.array(writer).min(1).max(16),
    retiredTasks: z.array(z.string()),
    outcome: z.literal("legacy_outcome_unknown_writers_stopped"),
  })
  .strict();
export type SiteHandoffGrant = z.infer<typeof SiteHandoffGrant>;
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export async function handoffSnapshot(pool: Pool, profileInput: unknown, client?: PoolClient) {
  const p = SiteControlDeploymentProfile.parse(profileInput),
    db = client ?? pool;
  const runtime = await db.query<Record<string, unknown>>(
    `SELECT p.* FROM provider_task p WHERE (${scopePredicate(pool, "p", "provider_task")}) AND p.provider_id=$1 AND p.internal_state NOT LIKE 'TERMINAL_%' ORDER BY p.task_id${client ? " FOR UPDATE" : ""}`,
    [p.providerBinding.providerId],
  );
  const provider = await db.query<Record<string, unknown>>(
    `SELECT e.* FROM ugv_execution e WHERE (${scopePredicate(pool, "e", "ugv_execution")}) AND e.payload->>'providerId'=$1 AND (e.state NOT IN ('SUCCEEDED','BUSINESS_FAILED','CANCELLED','TECHNICAL_FAILED') OR e.payload->'zmqControl'->>'occupancy'='held') ORDER BY e.task_id${client ? " FOR UPDATE" : ""}`,
    [p.providerBinding.providerId],
  );
  const commands = await db.query<Record<string, unknown>>(
    `SELECT c.* FROM task_command c JOIN provider_task p ON p.task_id=c.task_id WHERE (${scopePredicate(pool, "p", "provider_task")}) AND p.provider_id=$1 AND (${scopePredicate(pool, "c", "task_command")}) AND c.state NOT IN ('ACKNOWLEDGED','REJECTED') ORDER BY c.task_id,c.command_sequence${client ? " FOR UPDATE OF c" : ""}`,
    [p.providerBinding.providerId],
  );
  const admissions = await db.query<Record<string, unknown>>(
    `SELECT a.task_id,a.state FROM admission_intent a WHERE (${scopePredicate(pool, "a", "admission_intent")}) AND a.provider_id=$1 AND a.state IN ('PENDING','ACCEPTED','UNCERTAIN') ORDER BY a.task_id`,
    [p.providerBinding.providerId],
  );
  return json({
    runtime: runtime.rows,
    provider: provider.rows,
    commands: commands.rows,
    admissions: admissions.rows,
  });
}
export async function planHandoff(
  store: PostgresProviderStore,
  profile: unknown,
  writers: z.infer<typeof writer>[],
) {
  const p = SiteControlDeploymentProfile.parse(profile),
    snapshot = await handoffSnapshot(store.pool, p);
  if (store.gowm) {
    const b = await resolveDeviceContext(
      store.pool,
      store.gowm,
      {
        providerId: p.providerBinding.providerId ?? "",
        resourceId: p.providerBinding.resourceId ?? "",
      },
      false,
    );
    if (b.sourceSessionKey !== p.providerBinding.sourceSessionKey)
      throw Error("ZMQ_HANDOFF_BINDING_MISMATCH");
  }
  const oldWriters = z.array(writer).min(1).max(16).parse(writers);
  const binding = store.gowm
    ? {
        deviceId: store.gowm.allowedDeviceIds[0],
        bindingId: store.gowm.bindingId,
        serviceKey: store.gowm.serviceKey,
        sourceSessionKey: store.gowm.sourceSessionKey,
      }
    : null;
  const data = {
    schemaVersion: "ugv.zmq-site-handoff-plan/1",
    profileHash: sha256(canonical(p)),
    binding,
    snapshot,
    oldWriters: oldWriters.map(({ id, image }) => ({ id, image })),
  };
  return { ...data, planHash: sha256(canonical(data)) };
}
async function assertProfileBinding(
  store: PostgresProviderStore,
  p: z.infer<typeof SiteControlDeploymentProfile>,
) {
  if (!store.gowm) return;
  const binding = await resolveDeviceContext(
    store.pool,
    store.gowm,
    {
      providerId: p.providerBinding.providerId ?? "",
      resourceId: p.providerBinding.resourceId ?? "",
    },
    false,
  );
  if (binding.sourceSessionKey !== p.providerBinding.sourceSessionKey)
    throw Error("ZMQ_HANDOFF_BINDING_MISMATCH");
}
export async function verifySiteGrant(
  store: PostgresProviderStore,
  profile: unknown,
  value: unknown,
) {
  const p = SiteControlDeploymentProfile.parse(profile),
    grant = SiteHandoffGrant.parse(value);
  await assertProfileBinding(store, p);
  if (
    grant.profileHash !== sha256(canonical(p)) ||
    grant.providerId !== p.providerBinding.providerId ||
    grant.resourceId !== p.providerBinding.resourceId ||
    grant.oldWriters.some((w) => w.running || w.restartPolicy !== "no")
  )
    throw Error("ZMQ_SITE_HANDOFF_GRANT_MISMATCH");
  const found = await store.pool.query<{ snapshot: unknown }>(
    `SELECT snapshot FROM ugv_state_snapshot WHERE (${scopePredicate(store.pool, "ugv_state_snapshot", "ugv_state_snapshot")}) AND revision=$1`,
    ["site-handoff:" + grant.commandId],
  );
  if (canonical(found.rows[0]?.snapshot ?? null) !== canonical(grant))
    throw Error("ZMQ_SITE_HANDOFF_GRANT_NOT_COMMITTED");
  return grant;
}
export async function applyHandoff(
  store: PostgresProviderStore,
  profile: unknown,
  plan: Awaited<ReturnType<typeof planHandoff>>,
  input: { commandId: string; actor: string; reason: string; writers: z.infer<typeof writer>[] },
) {
  const p = SiteControlDeploymentProfile.parse(profile),
    id = z.uuid().parse(input.commandId),
    key = "site-handoff:" + id;
  await assertProfileBinding(store, p);
  const { planHash, ...planData } = plan;
  if (sha256(canonical(planData)) !== planHash) throw Error("ZMQ_HANDOFF_PLAN_HASH_INVALID");
  const c = await store.pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,790029))", [
      p.providerBinding.providerId,
    ]);
    if (store.gowm) await assertCurrentRoute(c, store.gowm);
    const previous = await c.query<{ snapshot: SiteHandoffGrant }>(
      `SELECT snapshot FROM ugv_state_snapshot WHERE (${scopePredicate(store.pool, "ugv_state_snapshot", "ugv_state_snapshot")}) AND revision=$1`,
      [key],
    );
    if (previous.rows[0]) {
      const g = SiteHandoffGrant.parse(previous.rows[0].snapshot);
      if (
        g.planHash !== plan.planHash ||
        g.actor !== input.actor ||
        g.reason !== input.reason ||
        g.profileHash !== sha256(canonical(p))
      )
        throw Error("COMMAND_ID_CONFLICT");
      await c.query("COMMIT");
      return g;
    }
    const snapshot = await handoffSnapshot(store.pool, p, c);
    if (
      canonical(snapshot) !== canonical(plan.snapshot) ||
      plan.profileHash !== sha256(canonical(p))
    )
      throw Error("ZMQ_HANDOFF_SNAPSHOT_CONFLICT");
    if (
      snapshot.admissions.length ||
      snapshot.runtime.some((t) => ZMQ_CONTROL_TOOLS.has(String(t.operation_name))) ||
      snapshot.provider.some((e) => !!(e.payload as Record<string, unknown>).zmqControl)
    )
      throw Error("ZMQ_HANDOFF_UNRESOLVED_NATIVE_OR_ADMISSION");
    if (
      input.writers.some((w) => w.running || w.restartPolicy !== "no") ||
      canonical(input.writers.map(({ id, image }) => ({ id, image }))) !==
        canonical(plan.oldWriters)
    )
      throw Error("ZMQ_OLD_WRITER_NOT_FENCED");
    const grant = SiteHandoffGrant.parse({
      schemaVersion: "ugv.zmq-site-handoff-grant/1",
      commandId: id,
      planHash: plan.planHash,
      profileHash: plan.profileHash,
      providerId: p.providerBinding.providerId,
      resourceId: p.providerBinding.resourceId,
      actor: input.actor,
      reason: input.reason,
      createdAt: new Date().toISOString(),
      oldWriters: input.writers,
      retiredTasks: snapshot.runtime.map((t) => t.task_id),
      outcome: "legacy_outcome_unknown_writers_stopped",
    });
    const error = {
      reasonCode: RETIRE_REASON,
      message: "管理退役；设备结果未知，未声明停止或取消成功",
      handoffCommandId: id,
    };
    for (const task of snapshot.runtime) {
      await c.query(
        `UPDATE provider_task p SET internal_state='TERMINAL_FAILED',mcp_status='failed',substate=NULL,status_message=$2,error=$3,stop_reason=$2,terminal_at=clock_timestamp(),handle_expires_at=COALESCE(handle_expires_at,clock_timestamp()+(COALESCE(ttl_ms,86400000)||' milliseconds')::interval),runtime_revision=runtime_revision+1,runtime_updated_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE (${scopePredicate(store.pool, "p", "provider_task")}) AND task_id=$1`,
        [task.task_id, RETIRE_REASON, error],
      );
    }
    for (const e of snapshot.provider) {
      const at = grant.createdAt,
        payload = {
          ...(e.payload as Record<string, unknown>),
          state: "TECHNICAL_FAILED",
          reasonCode: RETIRE_REASON,
          terminalAt: at,
          updatedAt: at,
          revision: Number(e.revision) + 1,
          administrativeRetirement: {
            commandId: id,
            actor: input.actor,
            reason: input.reason,
            physicalOutcome: "unknown",
          },
        };
      await c.query(
        `UPDATE ugv_execution e SET state='TECHNICAL_FAILED',reason_code=$2,terminal_at=$3,updated_at=$3,revision=revision+1,payload=$4 WHERE (${scopePredicate(store.pool, "e", "ugv_execution")}) AND task_id=$1`,
        [e.task_id, RETIRE_REASON, at, payload],
      );
    }
    for (const command of snapshot.commands) {
      await c.query(
        `UPDATE task_command c SET state='REJECTED',adapter_ack=$3,last_error_code=$4,last_error_message=$4,claim_owner=NULL,claim_until=NULL,updated_at=clock_timestamp() WHERE (${scopePredicate(store.pool, "c", "task_command")}) AND task_id=$1 AND command_sequence=$2 AND EXISTS (SELECT 1 FROM provider_task p WHERE p.task_id=c.task_id AND (${scopePredicate(store.pool, "p", "provider_task")}))`,
        [
          command.task_id,
          command.command_sequence,
          { accepted: false, reasonCode: RETIRE_REASON, handoffCommandId: id },
          RETIRE_REASON,
        ],
      );
    }
    await c.query(
      `INSERT INTO ugv_state_snapshot(${scopeColumns(store.pool, "ugv_state_snapshot")}revision,observed_at,snapshot) VALUES(${scopeValues(store.pool, "ugv_state_snapshot")}$1,$2,$3)`,
      [key, grant.createdAt, grant],
    );
    await c.query("COMMIT");
    return grant;
  } catch (error) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    c.release();
  }
}
