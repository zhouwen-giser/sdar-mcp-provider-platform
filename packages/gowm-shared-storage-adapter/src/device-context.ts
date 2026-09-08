import { requireValue } from "./value.js";
import type { Pool, PoolClient } from "pg";
import type { GowmStorageConfig } from "./config.js";

export interface DeviceExecutionContext {
  readonly deviceId: string;
  readonly dataScopeKey: string;
  readonly bindingId: string;
  readonly smppServiceKey: string;
  readonly providerId: string;
  readonly resourceId: string;
  readonly sourceSessionKey: string;
}

export async function resolveDeviceContext(
  client: Pick<Pool | PoolClient, "query">,
  config: GowmStorageConfig,
  identity: { providerId: string; resourceId?: string },
  forAdmission = true,
): Promise<DeviceExecutionContext> {
  const rows = await client.query<{
    device_id: string;
    data_scope_key: string;
    binding_id: string;
    smpp_service_key: string;
    provider_id: string;
    resource_id: string;
  }>(
    `SELECT b.device_id,b.data_scope_key,b.binding_id,b.smpp_service_key,b.provider_id,b.resource_id
      FROM gowm_device.device_service_binding b JOIN gowm_device.device d USING(device_id)
      WHERE b.device_id=$1 AND b.binding_id=$2 AND b.smpp_service_key=$3
        AND b.provider_id=$4 AND ($5::text IS NULL OR b.resource_id=$5)
        AND d.enabled AND (NOT $6::boolean OR
          (b.valid_from<=clock_timestamp() AND (b.valid_to IS NULL OR b.valid_to>clock_timestamp())))`,
    [
      config.allowedDeviceIds[0],
      config.bindingId,
      config.serviceKey,
      identity.providerId,
      identity.resourceId ?? null,
      forAdmission,
    ],
  );
  if (rows.rows.length !== 1)
    throw new Error(forAdmission ? "DEVICE_BINDING_MISMATCH" : "EXECUTION_ROUTE_UNAVAILABLE");
  const row = requireValue(rows.rows[0]);
  return Object.freeze({
    deviceId: row.device_id,
    dataScopeKey: row.data_scope_key,
    bindingId: row.binding_id,
    smppServiceKey: row.smpp_service_key,
    providerId: row.provider_id,
    resourceId: row.resource_id,
    sourceSessionKey: config.sourceSessionKey,
  });
}
