import { requireValue } from "./value.js";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { storageScope } from "./scope.js";

function stableUuid(text: string): string {
  const bytes = createHash("sha256").update(text).digest().subarray(0, 16);
  bytes[6] = (requireValue(bytes[6]) & 15) | 80;
  bytes[8] = (requireValue(bytes[8]) & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Only explicit source coordinates are interpreted; local frames stay native. */
export async function attachTaskTarget(
  client: PoolClient,
  taskId: string,
  args: Record<string, unknown>,
): Promise<void> {
  const config = storageScope(client);
  if (!config) return;
  const mission = object(args.mission),
    target = object(mission?.target);
  let geometry: Record<string, unknown> | undefined,
    crs = "UNRESOLVED_LOCAL_FRAME",
    path = "/mission/target";
  if (target && typeof target.latitude === "number" && typeof target.longitude === "number") {
    geometry = { type: "Point", coordinates: [target.longitude, target.latitude] };
    crs = "EPSG:4326";
  } else if (target && typeof target.x === "number" && typeof target.y === "number") {
    geometry = { type: "Point", coordinates: [target.x, target.y] };
  } else {
    const explicit = object(args.geometry);
    if (
      explicit &&
      ["Point", "LineString", "Polygon"].includes(String(explicit.type)) &&
      Array.isArray(explicit.coordinates)
    ) {
      geometry = explicit;
      path = "/geometry";
      if (typeof args.crs === "string" && args.crs.trim()) crs = args.crs;
    }
  }
  if (!geometry) return;
  const owner = { taskId };
  const existing = await client.query(
    `SELECT target_id FROM gowm_task.target_binding
    WHERE owner_domain='SMPP' AND owner_kind='MCP_TASK' AND owner_key=$1 AND usage_role='REQUESTED' AND argument_path=$2`,
    [owner, path],
  );
  if (existing.rowCount) return;
  const scope = (
    await client.query<{ data_scope_key: string }>(
      `SELECT b.data_scope_key FROM ugv_smpp.provider_task t
    JOIN gowm_device.device_service_binding b ON b.device_id=t.device_id AND b.binding_id=t.gowm_binding_id
    WHERE t.task_id=$1 AND t.device_id=$2 AND t.smpp_service_key=$3`,
      [taskId, config.allowedDeviceIds[0], config.serviceKey],
    )
  ).rows[0];
  if (!scope) throw Error("TARGET_OWNER_DEVICE_MISMATCH");
  const group = stableUuid(JSON.stringify([config.allowedDeviceIds[0], taskId, path]));
  const result = await client.query<{ target_id: string }>(
    `INSERT INTO gowm_task.target_geometry
    (target_group_id,revision,data_scope_key,source_domain,source_record_identity,geometry_kind,native_geometry,native_crs,geometry_wgs84,normalization_state)
    VALUES($1,1,$2,'SMPP',$3,upper($4),$5,$6,
      CASE WHEN $6='EPSG:4326' THEN public.ST_SetSRID(public.ST_GeomFromGeoJSON($5::jsonb::text),4326) ELSE NULL END,
      CASE WHEN $6='EPSG:4326' THEN 'NORMALIZED' ELSE 'NATIVE_ONLY' END) RETURNING target_id`,
    [group, scope.data_scope_key, { taskId, argumentPath: path }, geometry.type, geometry, crs],
  );
  await client.query(
    `INSERT INTO gowm_task.target_binding
    (target_id,device_id,data_scope_key,owner_domain,owner_kind,owner_key,usage_role,target_purpose,argument_path)
    VALUES($1,$2,$3,'SMPP','MCP_TASK',$4,'REQUESTED','NAVIGATION_DESTINATION',$5)`,
    [
      requireValue(result.rows[0]).target_id,
      config.allowedDeviceIds[0],
      scope.data_scope_key,
      owner,
      path,
    ],
  );
}
