import { describe, expect, it, vi } from "vitest";
import type { AuthorizationContext } from "../../packages/domain/src/index.js";
import type {
  LockedInputResponseRequest,
  McpInputResponse,
  ValidateLockedInputResponse,
} from "../../packages/persistence-postgres/src/index.js";
import { TaskEngine } from "../../packages/task-engine/src/index.js";

const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "live",
  simulationId: null,
};

describe("MRTR atomic locked-schema validation", () => {
  it("maps invalid client content to invalid_params using the locked schema", async () => {
    const engine = testEngine(locked({ type: "boolean" }), "OPEN");
    await expect(
      engine.updateTaskInputResponses(
        "00000000-0000-4000-8000-000000000001",
        { approval: { action: "accept", content: "not-boolean" } },
        authorization,
      ),
    ).rejects.toMatchObject({ kind: "invalid_params", reasonCode: "INVALID_INPUT_RESPONSE" });
  });

  it("maps an invalid Provider schema to adapter_contract", async () => {
    const engine = testEngine(locked({ type: "not-a-json-schema-type" }), "OPEN");
    await expect(
      engine.updateTaskInputResponses(
        "00000000-0000-4000-8000-000000000001",
        { approval: { action: "accept", content: true } },
        authorization,
      ),
    ).rejects.toMatchObject({ kind: "adapter_contract", reasonCode: "INVALID_INPUT_SCHEMA" });
  });

  it.each(["ANSWERED", "SUPERSEDED"] as const)(
    "does not invoke the validator for %s requests",
    async (status) => {
      const validator = vi.fn();
      const engine = testEngine(locked({ type: "boolean" }), status, validator);
      await expect(
        engine.updateTaskInputResponses(
          "00000000-0000-4000-8000-000000000001",
          { approval: { action: "accept", content: "invalid" } },
          authorization,
        ),
      ).resolves.toBeUndefined();
      expect(validator).not.toHaveBeenCalled();
    },
  );
});

function locked(schema: Record<string, unknown>): LockedInputResponseRequest {
  return {
    key: "approval",
    status: "OPEN",
    schema,
    requestJson: { method: "elicitation/create", params: {} },
  };
}

function testEngine(
  request: LockedInputResponseRequest,
  status: LockedInputResponseRequest["status"],
  observer?: () => void,
): TaskEngine {
  const repository = {
    pool: {},
    getAuthorized: vi.fn().mockResolvedValue({ operationSnapshotId: "snapshot-1" }),
    acceptMcpInputResponses: vi.fn(
      (
        _taskId: string,
        _authorization: AuthorizationContext,
        responses: Record<string, McpInputResponse>,
        validate: ValidateLockedInputResponse,
      ) => {
        const response = responses.approval;
        if (response === undefined) throw new Error("EXPECTED_APPROVAL_RESPONSE");
        if (status === "OPEN") {
          observer?.();
          validate({ ...request, status }, response);
        }
        return {
          acceptedKeys: status === "OPEN" ? ["approval"] : [],
          ignoredUnknownKeys: [],
          ignoredAnsweredKeys: status === "ANSWERED" ? ["approval"] : [],
          ignoredSupersededKeys: status === "SUPERSEDED" ? ["approval"] : [],
          duplicatePendingKeys: [],
        };
      },
    ),
  };
  const operationSnapshots = {
    loadOperationSnapshot: vi.fn().mockResolvedValue({
      operation: { capabilities: { inputRequired: true } },
    }),
  };
  return new TaskEngine(
    {} as never,
    new Map(),
    {} as never,
    repository as never,
    undefined,
    undefined,
    undefined,
    undefined,
    operationSnapshots as never,
  );
}
