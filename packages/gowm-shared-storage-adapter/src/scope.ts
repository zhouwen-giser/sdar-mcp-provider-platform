import type { Pool, PoolClient } from "pg";
import type { GowmStorageConfig } from "./config.js";

// Immutable per-pool deployment scope. No request changes connection identity.
const scopes = new WeakMap<object, GowmStorageConfig>();
export function registerScope(pool: Pool, config: GowmStorageConfig): void {
  scopes.set(pool, config);
  pool.on("connect", (client) => scopes.set(client, config));
}
export function storageScope(queryable: object): GowmStorageConfig | undefined {
  return scopes.get(queryable);
}
export function scoped(queryable: object): boolean {
  return scopes.has(queryable);
}
/** GOWM retains the native outbox's global event_key unique constraint. */
export function storedEventKey(queryable: object, key: string): string {
  const config = storageScope(queryable);
  return config ? JSON.stringify([config.allowedDeviceIds[0], config.serviceKey, key]) : key;
}
const roots = new Set(["provider_task", "admission_intent", "ugv_execution"]);
const serviceTables = new Set([...roots, "idempotency_record"]);
const eventTable = (table: string) =>
  /^(provider_business_event|adapter_business_event)/.test(table);
const identifier = (name: string) => {
  if (!/^[a-z_][a-z_0-9]*$/.test(name)) throw new Error("INVALID_STORAGE_IDENTIFIER");
  return name;
};

export function scopePredicate(queryable: object, alias: string, table: string): string {
  if (!scoped(queryable)) return "TRUE";
  const prefix = `${identifier(alias)}.`;
  if (table === "runtime_lease")
    return `${prefix}scope_key='DEVICE:'||current_setting('smpp.device_id')`;
  let sql = `${prefix}device_id=current_setting('smpp.device_id')`;
  if (serviceTables.has(table))
    sql += ` AND ${prefix}smpp_service_key=current_setting('smpp.service_key')`;
  if (roots.has(table))
    sql += ` AND ${prefix}gowm_binding_id=current_setting('smpp.binding_id')::uuid`;
  return sql;
}
export function scopeColumns(queryable: object, table: string): string {
  if (!scoped(queryable)) return "";
  if (table === "ugv_execution")
    return "device_id,gowm_binding_id,smpp_service_key,source_session_key,";
  if (roots.has(table)) return "device_id,gowm_binding_id,smpp_service_key,";
  if (table === "idempotency_record") return "device_id,smpp_service_key,";
  return "device_id,";
}
export function scopeValues(queryable: object, table: string): string {
  if (!scoped(queryable)) return "";
  const device = "current_setting('smpp.device_id'),";
  if (roots.has(table))
    return (
      device +
      "current_setting('smpp.binding_id')::uuid,current_setting('smpp.service_key')," +
      (table === "ugv_execution" ? "current_setting('smpp.source_session_key')," : "")
    );
  if (table === "idempotency_record") return device + "current_setting('smpp.service_key'),";
  return device;
}
export function scopeConflict(queryable: object, table: string): string {
  if (!scoped(queryable)) return "";
  if (eventTable(table) || table === "provider_ops_delivery") return "device_id,";
  if (table === "idempotency_record") return "device_id,smpp_service_key,";
  if (table === "runtime_lease") return "scope_key,";
  return "";
}

export async function assertCurrentRoute(
  client: Pick<Pool | PoolClient, "query">,
  config: GowmStorageConfig,
): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM gowm_device.device_service_binding
    WHERE binding_id=$1 AND device_id=$2 AND smpp_service_key=$3 AND valid_to IS NULL`,
    [config.bindingId, config.allowedDeviceIds[0], config.serviceKey],
  );
  if (result.rowCount !== 1) throw new Error("EXECUTION_ROUTE_UNAVAILABLE");
}
