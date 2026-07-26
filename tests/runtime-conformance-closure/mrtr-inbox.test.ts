import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AuthorizationContext } from "../../packages/domain/src/index.js";
import type { InputRequestRecord } from "../../packages/persistence-postgres/src/index.js";
import { TaskEngine } from "../../packages/task-engine/src/index.js";

const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "live",
  simulationId: null,
};

describe("MRTR durable response acceptance", () => {
  it.each(["PAUSE", "UPDATE"])(
    "R-001 R-002 persists an accepted response before %s command arbitration",
    async (blockingCommand) => {
      const acceptMcpInputResponses = vi.fn().mockResolvedValue({
        acceptedKeys: ["approval"],
        ignoredUnknownKeys: [],
        ignoredAnsweredKeys: [],
        ignoredSupersededKeys: [],
        duplicatePendingKeys: [],
      });
      const beginCommand = vi.fn().mockResolvedValue(command(blockingCommand));
      const engine = testEngine([openRequest("approval")], {
        acceptMcpInputResponses,
        beginCommand,
      });

      await engine.updateTaskInputResponses(
        "00000000-0000-4000-8000-000000000001",
        { approval: { action: "accept", content: true } },
        authorization,
      );

      expect(acceptMcpInputResponses).toHaveBeenCalledOnce();
      expect(acceptMcpInputResponses).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000001",
        authorization,
        { approval: { action: "accept", content: true } },
        expect.any(Function),
      );
    },
  );

  it("R-003 ignores a different response for an ANSWERED key", async () => {
    const answered = {
      ...openRequest("approval"),
      status: "ANSWERED",
      responseHash: createHash("sha256")
        .update(JSON.stringify({ action: "accept", content: true }))
        .digest("hex"),
      responseJson: { action: "accept", content: true },
    } as InputRequestRecord;
    const engine = testEngine([answered]);

    await expect(
      engine.updateTaskInputResponses(
        "00000000-0000-4000-8000-000000000001",
        { approval: { action: "decline" } },
        authorization,
      ),
    ).resolves.toBeUndefined();
  });

  it("R-004 ignores a SUPERSEDED key without creating a command", async () => {
    const beginCommand = vi.fn();
    const acceptMcpInputResponses = vi.fn().mockResolvedValue({
      acceptedKeys: [],
      ignoredUnknownKeys: [],
      ignoredAnsweredKeys: [],
      ignoredSupersededKeys: ["approval"],
      duplicatePendingKeys: [],
    });
    const superseded = { ...openRequest("approval"), status: "SUPERSEDED" } as never;
    const engine = testEngine([superseded], { beginCommand, acceptMcpInputResponses });

    await engine.updateTaskInputResponses(
      "00000000-0000-4000-8000-000000000001",
      { approval: { action: "decline" } },
      authorization,
    );

    expect(acceptMcpInputResponses).toHaveBeenCalledOnce();
    expect(beginCommand).not.toHaveBeenCalled();
  });
});

function testEngine(
  requests: InputRequestRecord[],
  overrides: Record<string, ReturnType<typeof vi.fn>> = {},
): TaskEngine {
  const repository = {
    pool: {},
    getAuthorized: vi.fn().mockResolvedValue({ operationSnapshotId: "snapshot-1" }),
    listInputRequests: vi.fn().mockResolvedValue(requests),
    acceptMcpInputResponses: vi.fn().mockResolvedValue({
      acceptedKeys: [],
      ignoredUnknownKeys: [],
      ignoredAnsweredKeys: [],
      ignoredSupersededKeys: [],
      duplicatePendingKeys: [],
    }),
    beginCommand: vi.fn().mockResolvedValue(command("UPDATE")),
    ...overrides,
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

function openRequest(key: string): InputRequestRecord {
  return {
    key,
    description: "Approve",
    schema: { type: "boolean" },
    required: true,
    status: "OPEN",
    answerHash: null,
    requestJson: { method: "elicitation/create", params: { message: "Approve" } },
    responseHash: null,
    responseJson: null,
  };
}

function command(commandType: string): Record<string, unknown> {
  return {
    sequence: 1,
    disposition: "existing",
    duplicate: true,
    commandType,
    state: "PENDING",
    adapterAck: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextAttemptAt: null,
    claimUntil: null,
    claimOwner: null,
  };
}
