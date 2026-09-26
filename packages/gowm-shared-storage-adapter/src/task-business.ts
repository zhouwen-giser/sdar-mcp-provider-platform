import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { z } from "zod";
import type { GowmStorageConfig } from "./config.js";

const tables = [
  "ugv_task_business_context",
  "ugv_task_business_object_version",
  "ugv_task_business_command",
  "ugv_task_business_content",
] as const;
const commonColumns = [
  "scope_hash",
  "scope_key",
  "device_id",
  "gowm_binding_id",
  "smpp_service_key",
  "source_session_key",
] as const;
const columns: Record<(typeof tables)[number], readonly string[]> = {
  ugv_task_business_context: [
    ...commonColumns,
    "task_id",
    "external_execution_id",
    "context_revision",
    "effective_plan_revision",
    "payload",
    "updated_at",
  ],
  ugv_task_business_object_version: [
    ...commonColumns,
    "object_kind",
    "object_id",
    "revision",
    "payload",
  ],
  ugv_task_business_command: [
    ...commonColumns,
    "command_id",
    "command_type",
    "request_hash",
    "state",
    "payload",
    "created_at",
    "updated_at",
  ],
  ugv_task_business_content: [
    ...commonColumns,
    "artifact_id",
    "revision",
    "handle",
    "media_type",
    "size_bytes",
    "sha256",
    "expires_at",
    "bytes",
    "created_at",
  ],
};
const columnTypes: Record<string, string> = {
  scope_hash: "text",
  scope_key: "text",
  device_id: "text",
  gowm_binding_id: "uuid",
  smpp_service_key: "text",
  source_session_key: "text",
  task_id: "text",
  external_execution_id: "text",
  context_revision: "bigint",
  effective_plan_revision: "bigint",
  payload: "jsonb",
  updated_at: "timestamp with time zone",
  object_kind: "text",
  object_id: "text",
  revision: "bigint",
  command_id: "text",
  command_type: "text",
  request_hash: "text",
  state: "text",
  created_at: "timestamp with time zone",
  artifact_id: "text",
  handle: "text",
  media_type: "text",
  size_bytes: "bigint",
  sha256: "text",
  expires_at: "timestamp with time zone",
  bytes: "bytea",
};
const scopeDefaults: Record<string, string> = {
  device_id: "smpp.device_id",
  gowm_binding_id: "smpp.binding_id",
  smpp_service_key: "smpp.service_key",
  source_session_key: "smpp.source_session_key",
};
const primaryKeyColumns: Record<(typeof tables)[number], readonly string[]> = {
  ugv_task_business_context: ["scope_hash"],
  ugv_task_business_object_version: ["scope_hash", "object_kind", "object_id", "revision"],
  ugv_task_business_command: ["scope_hash", "command_id"],
  ugv_task_business_content: ["scope_hash", "handle"],
};
const requiredIndexes = [
  "ugv_task_business_context_task_idx",
  "ugv_task_business_object_scope_idx",
  "ugv_task_business_command_created_idx",
  "ugv_task_business_command_entry_fence_idx",
  "ugv_task_business_command_runtime_sequence_idx",
  "ugv_task_business_content_version_idx",
] as const;
const ownerContract = z
  .object({
    schema: z.literal("gowm.task-business-storage/v1"),
    family: z.literal("SMPP_PROVIDER_UGV"),
    migrationFile: z.literal("030_task_business_versions.sql"),
    installedSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

/** Read-only qualification; the GOWM owner installs and versions the schema. */
export async function verifyGowmTaskBusinessStorage(
  pool: Pool,
  config: Pick<GowmStorageConfig, "contractDir">,
): Promise<void> {
  const role = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
  );
  if (!role.rows[0] || role.rows[0].rolsuper || role.rows[0].rolbypassrls) {
    throw new Error("GOWM_BUSINESS_RLS_ROLE_INVALID");
  }
  const schemaUsage = await pool.query<{ usable: boolean }>(
    "SELECT has_schema_privilege(current_user,oid,'USAGE') AS usable FROM pg_namespace WHERE nspname='ugv_smpp'",
  );
  if (schemaUsage.rows.length === 0) throw new Error("GOWM_BUSINESS_SCHEMA_NOT_INSTALLED");
  if (!schemaUsage.rows[0]?.usable) throw new Error("GOWM_BUSINESS_SCHEMA_USAGE_MISSING");
  for (const table of tables) {
    const result = await pool.query<{ relation: string | null }>(
      "SELECT to_regclass($1)::text AS relation",
      [`ugv_smpp.${table}`],
    );
    if (!result.rows[0]?.relation) throw new Error(`GOWM_BUSINESS_SCHEMA_NOT_INSTALLED: ${table}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(
      await readFile(join(config.contractDir, "task-business.json"), "utf8"),
    ) as unknown;
  } catch {
    throw new Error("GOWM_BUSINESS_CONTRACT_MISSING");
  }
  const parsed = ownerContract.safeParse(raw);
  if (!parsed.success) throw new Error("GOWM_BUSINESS_CONTRACT_INVALID");
  const contract = parsed.data;
  const history = await pool.query<{ checksum: string }>(
    `SELECT checksum FROM ugv_smpp.gowm_install_history WHERE family=$1 AND file=$2`,
    [contract.family, contract.migrationFile],
  );
  if (history.rows[0]?.checksum !== contract.installedSha256) {
    throw new Error("GOWM_BUSINESS_INSTALL_HISTORY_MISMATCH");
  }

  const actualColumns = await pool.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    `SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns
     WHERE table_schema='ugv_smpp' AND table_name=ANY($1::text[])`,
    [tables],
  );
  const found = new Map(
    actualColumns.rows.map((row) => [`${row.table_name}.${row.column_name}`, row]),
  );
  for (const table of tables) {
    for (const column of columns[table]) {
      const actual = found.get(`${table}.${column}`);
      if (!actual) {
        throw new Error(`GOWM_BUSINESS_COLUMN_MISSING: ${table}.${column}`);
      }
      if (
        actual.data_type !== columnTypes[column] ||
        actual.is_nullable !== (column === "expires_at" ? "YES" : "NO")
      ) {
        throw new Error(`GOWM_BUSINESS_COLUMN_INVALID: ${table}.${column}`);
      }
      const setting = scopeDefaults[column];
      if (setting && !actual.column_default?.includes(setting)) {
        throw new Error(`GOWM_BUSINESS_SCOPE_DEFAULT_MISSING: ${table}.${column}`);
      }
    }
  }

  const grants = await pool.query<{ table_name: string; usable: boolean }>(
    `SELECT table_name,
      has_table_privilege('ugv_smpp.'||table_name,'SELECT')
      AND has_table_privilege('ugv_smpp.'||table_name,'INSERT')
      AND (table_name IN ('ugv_task_business_object_version','ugv_task_business_content')
        OR has_table_privilege('ugv_smpp.'||table_name,'UPDATE')) AS usable
     FROM unnest($1::text[]) table_name`,
    [tables],
  );
  if (grants.rows.length !== tables.length || grants.rows.some((row) => !row.usable)) {
    throw new Error("GOWM_BUSINESS_PRIVILEGE_MISSING");
  }

  const isolation = await pool.query<{
    table_name: string;
    rls_enabled: boolean;
    rls_forced: boolean;
    policy_count: string;
  }>(
    `SELECT c.relname AS table_name,c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       (SELECT count(*)::text FROM pg_policy p WHERE p.polrelid=c.oid) AS policy_count
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='ugv_smpp' AND c.relname=ANY($1::text[])`,
    [tables],
  );
  if (
    isolation.rows.length !== tables.length ||
    isolation.rows.some(
      (row) => !row.rls_enabled || !row.rls_forced || Number(row.policy_count) < 1,
    )
  ) {
    throw new Error("GOWM_BUSINESS_SCOPE_POLICY_MISSING");
  }
  const policies = await pool.query<{ tablename: string; qual: string; with_check: string }>(
    `SELECT tablename,qual,with_check FROM pg_policies
     WHERE schemaname='ugv_smpp' AND policyname='smpp_task_business_scope'
       AND tablename=ANY($1::text[])`,
    [tables],
  );
  const settings = [
    "smpp.device_id",
    "smpp.binding_id",
    "smpp.service_key",
    "smpp.source_session_key",
  ];
  if (
    policies.rows.length !== tables.length ||
    policies.rows.some((row) =>
      settings.some((setting) => !row.qual.includes(setting) || !row.with_check.includes(setting)),
    )
  ) {
    throw new Error("GOWM_BUSINESS_SCOPE_POLICY_INVALID");
  }
  const primaryKeys = await pool.query<{ table_name: string; column_names: string[] }>(
    `SELECT c.relname AS table_name,
       array_agg(a.attname ORDER BY key_position.ordinality)::text[] AS column_names
     FROM pg_constraint k
     JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     JOIN unnest(k.conkey) WITH ORDINALITY AS key_position(attnum,ordinality) ON true
     JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=key_position.attnum
     WHERE n.nspname='ugv_smpp' AND c.relname=ANY($1::text[]) AND k.contype='p'
     GROUP BY c.relname`,
    [tables],
  );
  if (
    primaryKeys.rows.length !== tables.length ||
    primaryKeys.rows.some(
      (row) =>
        JSON.stringify(row.column_names) !==
        JSON.stringify(primaryKeyColumns[row.table_name as (typeof tables)[number]]),
    )
  ) {
    throw new Error("GOWM_BUSINESS_KEY_MISSING");
  }
  const indexes = await pool.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname='ugv_smpp' AND indexname=ANY($1::text[])`,
    [requiredIndexes],
  );
  if (indexes.rows.length !== requiredIndexes.length) {
    throw new Error("GOWM_BUSINESS_INDEX_MISSING");
  }
  const triggers = await pool.query<{ table_name: string }>(
    `SELECT c.relname AS table_name FROM pg_trigger t
     JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='ugv_smpp' AND c.relname=ANY($1::text[])
       AND t.tgname='gowm_task_business_scope_immutable' AND NOT t.tgisinternal`,
    [tables],
  );
  if (
    !triggers.rows.some((row) => row.table_name === "ugv_task_business_context") ||
    !triggers.rows.some((row) => row.table_name === "ugv_task_business_command")
  ) {
    throw new Error("GOWM_BUSINESS_SCOPE_TRIGGER_MISSING");
  }
  const contentTrigger = await pool.query<{ trigger_count: string }>(
    `SELECT count(*)::text AS trigger_count FROM pg_trigger t
     JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='ugv_smpp' AND c.relname='ugv_task_business_content'
       AND t.tgname='ugv_task_business_content_immutable' AND NOT t.tgisinternal`,
  );
  if (Number(contentTrigger.rows[0]?.trigger_count) !== 1) {
    throw new Error("GOWM_BUSINESS_CONTENT_IMMUTABILITY_MISSING");
  }
}
