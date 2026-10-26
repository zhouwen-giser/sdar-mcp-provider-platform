import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { Command, CommandRow, Json, TaskRow } from "../shared/model.js";
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v !== null && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;
export const fingerprint = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
interface DbCommand {
  command_id: string;
  status: string;
  request: Command;
  task_id: string | null;
  response: unknown;
  created_at: Date;
  updated_at: Date;
  request_hash: string;
}
interface DbTask {
  task_id: string;
  operation: string;
  snapshot: Json;
  created_at: Date;
  updated_at: Date;
}
const commandRow = (v: DbCommand): CommandRow => ({
  commandId: v.command_id,
  status: v.status,
  request: v.request,
  taskId: v.task_id,
  response: v.response,
  createdAt: v.created_at.toISOString(),
  updatedAt: v.updated_at.toISOString(),
});
const taskRow = (v: DbTask): TaskRow => ({
  taskId: v.task_id,
  operation: v.operation,
  snapshot: v.snapshot,
  createdAt: v.created_at.toISOString(),
  updatedAt: v.updated_at.toISOString(),
});
export class Store {
  constructor(
    readonly pool: Pool,
    readonly domain: string,
    readonly historyDomain?: string,
    readonly historyDomains: string[] = [],
  ) {}
  get readDomains() {
    return [
      ...new Set([
        this.domain,
        ...(this.historyDomain ? [this.historyDomain] : []),
        ...this.historyDomains,
      ]),
    ];
  }
  async migrate() {
    const schema = await this.pool.query<{ present: boolean }>(
      "SELECT to_regnamespace('ugv_control_console') IS NOT NULL AS present",
    );
    if (!schema.rows[0]?.present) await this.pool.query("CREATE SCHEMA ugv_control_console");
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ugv_control_console.command (
 domain text NOT NULL, command_id uuid NOT NULL, request_hash text NOT NULL, request jsonb NOT NULL,
 status text NOT NULL, task_id text, response jsonb, created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(domain,command_id));
 CREATE TABLE IF NOT EXISTS ugv_control_console.task (
 domain text NOT NULL,task_id text NOT NULL,operation text NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(domain,task_id));
 CREATE TABLE IF NOT EXISTS ugv_control_console.session (
 domain text NOT NULL, token_hash text NOT NULL, expires_at timestamptz NOT NULL, PRIMARY KEY(domain,token_hash));
 CREATE TABLE IF NOT EXISTS ugv_control_console.audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,domain text NOT NULL,actor text NOT NULL,action text NOT NULL,command_id uuid,reason text,occurred_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS console_command_recent ON ugv_control_console.command(domain,created_at DESC);
 CREATE INDEX IF NOT EXISTS console_task_recent ON ugv_control_console.task(domain,created_at DESC);`);
  }
  async recover() {
    await this.pool.query(
      "UPDATE ugv_control_console.command SET status='unknown',updated_at=now() WHERE domain=$1 AND status='dispatching'",
      [this.domain],
    );
  }
  async reserve(request: Command): Promise<{ fresh: boolean; row: CommandRow }> {
    const hash = fingerprint(request);
    const historical =
      this.readDomains.length > 1
        ? await this.pool.query<DbCommand>(
            "SELECT * FROM ugv_control_console.command WHERE domain=ANY($1::text[]) AND command_id=$2 ORDER BY (domain=$3) DESC LIMIT 1",
            [this.readDomains, request.commandId, this.domain],
          )
        : undefined;
    if (historical?.rows[0]) {
      if (historical.rows[0].request_hash !== hash) throw Error("COMMAND_ID_CONFLICT");
      return { fresh: false, row: commandRow(historical.rows[0]) };
    }
    const inserted = await this.pool.query<DbCommand>(
      `INSERT INTO ugv_control_console.command(domain,command_id,request_hash,request,status) VALUES($1,$2,$3,$4,'dispatching') ON CONFLICT DO NOTHING RETURNING *`,
      [this.domain, request.commandId, hash, request],
    );
    const value =
      inserted.rows.at(0) ??
      (
        await this.pool.query<DbCommand>(
          "SELECT * FROM ugv_control_console.command WHERE domain=$1 AND command_id=$2",
          [this.domain, request.commandId],
        )
      ).rows.at(0);
    if (value?.request_hash !== hash) throw Error("COMMAND_ID_CONFLICT");
    return { fresh: inserted.rowCount === 1, row: commandRow(value) };
  }
  async finish(id: string, status: string, response: unknown, taskId?: string) {
    await this.pool.query(
      "UPDATE ugv_control_console.command SET status=$3,response=$4,task_id=COALESCE($5,task_id),updated_at=now() WHERE domain=$1 AND command_id=$2",
      [this.domain, id, status, JSON.stringify(response), taskId ?? null],
    );
    return this.command(id);
  }
  async command(id: string) {
    const r = await this.pool.query<DbCommand>(
      "SELECT * FROM ugv_control_console.command WHERE domain=ANY($1::text[]) AND command_id=$2 ORDER BY (domain=$3) DESC LIMIT 1",
      [this.readDomains, id, this.domain],
    );
    return r.rows[0] ? commandRow(r.rows[0]) : undefined;
  }
  async commands() {
    return (
      await this.pool.query<DbCommand>(
        "SELECT * FROM (SELECT DISTINCT ON (command_id) * FROM ugv_control_console.command WHERE domain=ANY($1::text[]) ORDER BY command_id,(domain=$2) DESC) c ORDER BY created_at DESC LIMIT 200",
        [this.readDomains, this.domain],
      )
    ).rows.map(commandRow);
  }
  async saveTask(id: string, operation: string, snapshot: Json) {
    await this.pool.query(
      `INSERT INTO ugv_control_console.task(domain,task_id,operation,snapshot) VALUES($1,$2,$3,$4) ON CONFLICT(domain,task_id) DO UPDATE SET snapshot=$4,operation=CASE WHEN $3='' THEN ugv_control_console.task.operation ELSE $3 END,updated_at=now()`,
      [this.domain, id, operation, snapshot],
    );
  }
  async task(id: string) {
    const r = await this.pool.query<DbTask>(
      "SELECT * FROM ugv_control_console.task WHERE domain=ANY($1::text[]) AND task_id=$2 ORDER BY (domain=$3) DESC LIMIT 1",
      [this.readDomains, id, this.domain],
    );
    return r.rows[0] ? taskRow(r.rows[0]) : undefined;
  }
  async tasks() {
    return (
      await this.pool.query<DbTask>(
        "SELECT * FROM (SELECT DISTINCT ON (task_id) * FROM ugv_control_console.task WHERE domain=ANY($1::text[]) ORDER BY task_id,(domain=$2) DESC) t ORDER BY created_at DESC LIMIT 200",
        [this.readDomains, this.domain],
      )
    ).rows.map(taskRow);
  }
  async createSession(token: string) {
    await this.pool.query(
      "DELETE FROM ugv_control_console.session WHERE domain=$1 AND expires_at<=now()",
      [this.domain],
    );
    await this.pool.query(
      "INSERT INTO ugv_control_console.session(domain,token_hash,expires_at) VALUES($1,$2,now()+interval '8 hours')",
      [this.domain, fingerprint(token)],
    );
  }
  async sessionAllowed(token: string) {
    return (
      (
        await this.pool.query(
          "SELECT 1 FROM ugv_control_console.session WHERE domain=$1 AND token_hash=$2 AND expires_at>now()",
          [this.domain, fingerprint(token)],
        )
      ).rowCount === 1
    );
  }
  async revokeSession(token: string) {
    await this.pool.query(
      "DELETE FROM ugv_control_console.session WHERE domain=$1 AND token_hash=$2",
      [this.domain, fingerprint(token)],
    );
  }
  async audit(actor: string, action: string, id?: string, reason?: string) {
    await this.pool.query(
      "INSERT INTO ugv_control_console.audit(domain,actor,action,command_id,reason) VALUES($1,$2,$3,$4,$5)",
      [this.domain, actor, action, id ?? null, reason ?? null],
    );
  }
}
