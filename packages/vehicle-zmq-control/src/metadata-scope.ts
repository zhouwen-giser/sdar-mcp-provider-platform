import { scopePredicate, scoped } from "../../gowm-shared-storage-adapter/src/index.js";

/** Control metadata shares GOWM's snapshot table without entering its device-state channels. */
export function metadataPredicate(pool: object): string {
  const device = scopePredicate(pool, "ugv_state_snapshot", "ugv_state_snapshot");
  return scoped(pool)
    ? `${device} AND source_session_key=current_setting('smpp.source_session_key') AND channel='zmq_control'`
    : device;
}
export const metadataColumns = (pool: object): string =>
  scoped(pool) ? "device_id,source_session_key,channel," : "";
export const metadataValues = (pool: object): string =>
  scoped(pool)
    ? "current_setting('smpp.device_id'),current_setting('smpp.source_session_key'),'zmq_control',"
    : "";
