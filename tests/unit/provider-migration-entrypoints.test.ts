import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runNpcTankProviderMigrations } from "../../apps/npc-tank-provider-adapter/src/migrate.js";
import { runUgvProviderMigrations } from "../../apps/ugv-provider-adapter/src/migrate.js";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

class RecordingExecutor {
  readonly statements: string[] = [];

  query(sql: string): Promise<void> {
    this.statements.push(sql);
    return Promise.resolve();
  }
}

describe("Provider Migration entrypoints", () => {
  it("binds the UGV entrypoint exclusively to provider:ugv", async () => {
    const executor = new RecordingExecutor();

    await runUgvProviderMigrations(executor, workspaceRoot);

    expect(executor.statements).toHaveLength(2);
    const statements = executor.statements.join("\n");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS ugv_execution");
    expect(statements).not.toContain("npc_tank_");
    expect(statements).not.toContain("runtime_schema_migration");
  });

  it("binds the NPC Tank entrypoint exclusively to provider:npc-tank", async () => {
    const executor = new RecordingExecutor();

    await runNpcTankProviderMigrations(executor, workspaceRoot);

    expect(executor.statements).toHaveLength(2);
    const statements = executor.statements.join("\n");
    expect(statements).toContain("CREATE TABLE IF NOT EXISTS npc_tank_execution");
    expect(statements).toContain("tool_name = 'get_status'");
    expect(statements).not.toContain("ugv_");
    expect(statements).not.toContain("runtime_schema_migration");
  });
});
