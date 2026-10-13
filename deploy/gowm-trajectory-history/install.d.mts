import type { PoolClient } from "pg";
export interface TrajectoryOwnerMigration {
  sql: string;
  contract: { schema: string; family: string; migrationFile: string; installedSha256: string };
}
export function trajectoryHistoryMigration(): TrajectoryOwnerMigration;
export function installGowmTrajectoryHistory(
  client: PoolClient,
  migration: TrajectoryOwnerMigration,
  apply: boolean,
): Promise<{ installed: boolean; contract: TrajectoryOwnerMigration["contract"] }>;
