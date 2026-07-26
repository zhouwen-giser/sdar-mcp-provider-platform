import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runMigrations } from "../../packages/persistence-postgres/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined)
  throw new Error("TEST_DATABASE_URL is required for Business Events tests");

export class BusinessEventsPostgresHarness {
  readonly schema = `business_events_${process.pid.toString()}_${randomUUID().replaceAll("-", "")}`;
  readonly admin = new Pool({ connectionString: databaseUrl, max: 2 });
  readonly pool = new Pool({
    connectionString: databaseUrl,
    max: 12,
    options: `-c search_path=${this.schema}`,
  });

  async start(): Promise<void> {
    await this.admin.query(`CREATE SCHEMA ${this.schema}`);
    await runMigrations(this.pool);
  }

  async stop(): Promise<void> {
    await this.pool.end();
    await this.admin.query(`DROP SCHEMA IF EXISTS ${this.schema} CASCADE`);
    await this.admin.end();
  }
}
