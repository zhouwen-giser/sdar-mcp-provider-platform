ALTER TABLE registry_snapshot
  DROP CONSTRAINT IF EXISTS registry_snapshot_environment_checksum_key;

ALTER TABLE active_registry_snapshot
  DROP CONSTRAINT IF EXISTS active_registry_snapshot_environment_checksum_key;
