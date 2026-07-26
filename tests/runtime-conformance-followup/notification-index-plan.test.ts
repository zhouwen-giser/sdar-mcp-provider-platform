import { writeFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TaskRepository } from "../../packages/persistence-postgres/src/index.js";
import { authorization, PostgresHarness } from "./postgres-harness.js";

const harness = new PostgresHarness("followup-index-provider");

beforeAll(() => harness.start());
beforeEach(() => harness.reset());
afterAll(() => harness.stop());

describe("notification UUID batch plans", () => {
  it("uses indexes for 256 UUIDs without disabling sequential scans", async () => {
    await harness.pool.query(
      `INSERT INTO provider_task
        (task_id, provider_id, operation_name, operation_snapshot_id,
         authorization_context_hash, execution_mode, simulation_id, arguments, argument_hash,
         external_execution_id, internal_state, mcp_status, substate, status_message,
         accepted_at, actual_started_at, latest_start_at)
       SELECT ('00000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
              $1, 'durable_task', (SELECT snapshot_id FROM operation_snapshot LIMIT 1),
              $2, 'live', NULL, '{}'::jsonb, repeat('b',64), 'index-' || series::text,
              'RUNNING', 'working', 'running', 'Working.', clock_timestamp(),
              clock_timestamp(), clock_timestamp()
       FROM generate_series(1,5000) AS series`,
      [harness.providerId, authorization.hash],
    );
    await harness.pool.query(
      `INSERT INTO task_input_request
        (task_id, request_key, description, schema, required, status, request_json)
       SELECT task_id, 'approval', 'Approve?', '{"type":"boolean"}'::jsonb, true, 'OPEN',
              '{"method":"elicitation/create","params":{}}'::jsonb
       FROM provider_task`,
    );
    await harness.pool.query("ANALYZE provider_task");
    await harness.pool.query("ANALYZE task_input_request");
    const taskIds = (
      await harness.pool.query<{ task_id: string }>(
        "SELECT task_id FROM provider_task ORDER BY task_id LIMIT 256",
      )
    ).rows.map((row) => row.task_id);

    const repository = new TaskRepository(harness.pool);
    expect(await repository.getAuthorizedTasksByIds(taskIds, authorization)).toHaveLength(256);
    expect((await repository.listInputRequestsByTaskIds(taskIds)).size).toBe(256);

    const taskPlan = await explain(
      `SELECT * FROM provider_task
       WHERE task_id=ANY($1::uuid[]) AND authorization_context_hash=$2
         AND execution_mode=$3 AND simulation_id IS NOT DISTINCT FROM $4
       ORDER BY task_id`,
      [taskIds, authorization.hash, authorization.executionMode, authorization.simulationId],
    );
    const requestPlan = await explain(
      `SELECT task_id, request_key FROM task_input_request
       WHERE task_id=ANY($1::uuid[]) ORDER BY task_id, created_at, request_key`,
      [taskIds],
    );
    const taskEvidence = summarizePlan(taskPlan, "provider_task");
    const requestEvidence = summarizePlan(requestPlan, "task_input_request");
    expect(taskEvidence.planNode).not.toBe("Seq Scan");
    expect(requestEvidence.planNode).not.toBe("Seq Scan");
    expect(taskEvidence.indexName).toBeTruthy();
    expect(requestEvidence.indexName).toBeTruthy();

    await writeFile(
      "reports/runtime-conformance-followup/uuid-index-plan.json",
      `${JSON.stringify(
        {
          databaseMode: "real-postgresql",
          tableRowCount: { provider_task: 5000, task_input_request: 5000 },
          requestedTaskCount: 256,
          providerTask: taskEvidence,
          taskInputRequest: requestEvidence,
        },
        null,
        2,
      )}\n`,
    );
  });
});

async function explain(sql: string, values: unknown[]): Promise<Plan> {
  const result = await harness.pool.query<{ "QUERY PLAN": Plan[] }>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    values,
  );
  const plan = result.rows[0]?.["QUERY PLAN"][0];
  if (plan === undefined) throw new Error("POSTGRES_EXPLAIN_PLAN_MISSING");
  return plan;
}

interface PlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  Plans?: PlanNode[];
}

interface Plan {
  Plan: PlanNode;
  "Execution Time": number;
}

function summarizePlan(plan: Plan, relation: string) {
  const relationNode = findNode(plan.Plan, (node) => node["Relation Name"] === relation);
  if (relationNode === undefined) throw new Error(`PLAN_RELATION_MISSING:${relation}`);
  const indexNode = findNode(relationNode, (node) => node["Index Name"] !== undefined);
  return {
    planNode: relationNode["Node Type"],
    indexName: indexNode?.["Index Name"] ?? null,
    executionTimeMs: plan["Execution Time"],
    sharedHitBlocks: relationNode["Shared Hit Blocks"] ?? 0,
    sharedReadBlocks: relationNode["Shared Read Blocks"] ?? 0,
  };
}

function findNode(
  node: PlanNode,
  predicate: (candidate: PlanNode) => boolean,
): PlanNode | undefined {
  if (predicate(node)) return node;
  for (const child of node.Plans ?? []) {
    const found = findNode(child, predicate);
    if (found !== undefined) return found;
  }
  return undefined;
}
