import type { PoolClient } from "pg";
export interface TaskBusinessMigration {
  runtime: { sql: string; contract: TaskBusinessMigration["contract"] };
  sql: string;
  contract: { schema: string; family: string; migrationFile: string; installedSha256: string };
}
export function taskBusinessMigration(): TaskBusinessMigration;
export function installGowmTaskBusiness(
  client: PoolClient,
  migration: TaskBusinessMigration,
  apply: boolean,
): Promise<{
  installed: boolean;
  contract: TaskBusinessMigration["contract"];
  runtimeContract: TaskBusinessMigration["contract"];
}>;
