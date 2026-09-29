import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { TaskEngine } from "../../packages/task-engine/src/index.js";
import type { ValidatedManifest } from "../../packages/operation-registry/src/index.js";
import {
  Sep2663ProtocolHandler,
  type TaskBusinessPublicEndpoint,
} from "../../packages/mcp-protocol/src/sep2663/handler.js";
import { createAuthorizationResolver } from "../../packages/mcp-protocol/src/security.js";
import { parseTaskInputResponses } from "../../packages/mcp-protocol/src/sep2663/tasks.js";
import { parsePublicInterventionApply } from "../../packages/mcp-protocol/src/sep2663/task-business.js";
import { RuntimeInterventionCommandSchema } from "../../packages/vehicle-provider-core/src/task-business-interaction.js";

interface Exchange {
  logicalInterface: string;
  precondition: string;
  request: {
    headers: Record<string, string>;
    body: { jsonrpc: string; id: string; method: string; params: Record<string, unknown> };
  };
  response: { httpStatus: number; body: Record<string, unknown> };
}

const examples = JSON.parse(
  readFileSync("protocol/task-business/v1/examples/conditional-write-wire.json", "utf8"),
) as {
  schema: string;
  qualification: string;
  exchanges: Exchange[];
};

describe("conditional five-interface handoff write examples", () => {
  it("routes the complete synthetic Input and Intervention envelopes through the frozen handler", async () => {
    expect(examples.schema).toBe("sdar.task-business-conditional-write-wire-examples/v1");
    expect(examples.qualification).toBe("synthetic_contract_only");
    expect(examples.exchanges.map((entry) => entry.logicalInterface)).toEqual([
      "RespondTaskInput",
      "ApplyTaskIntervention",
    ]);

    const manifest = {
      providerId: "synthetic-provider",
      providerType: "vehicle",
      providerVersion: "1.0.0",
      manifestHash: "a".repeat(64),
      operations: [],
    } as unknown as ValidatedManifest;
    const update = vi.fn(async () => undefined);
    const engine = { updateTaskInputResponses: update } as unknown as TaskEngine;
    const apply = vi.fn(async (request: ReturnType<typeof parsePublicInterventionApply>) => ({
      resultType: "complete",
      receipt: {
        commandId: request.command.commandId,
        commandSequence: "1",
        commandState: "PENDING",
        durablyAccepted: true,
        businessApplied: false,
        duplicate: false,
      },
      profileVersion: "1.0-rc2",
    }));
    const publicBusiness = {
      getContext: vi.fn(async () => ({})),
      getArtifact: vi.fn(async () => ({})),
      applyIntervention: apply,
    } satisfies TaskBusinessPublicEndpoint;
    const resolveAuthorization = createAuthorizationResolver({ mode: "trusted_headers" });
    const handler = new Sep2663ProtocolHandler(
      manifest,
      "synthetic-example-test",
      engine,
      resolveAuthorization,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      publicBusiness,
    );

    for (const example of examples.exchanges) {
      const { headers, body } = example.request;
      expect(example.precondition.length).toBeGreaterThan(0);
      expect(headers["mcp-method"]).toBe(body.method);
      expect(headers["mcp-name"]).toBe(body.params.taskId);
      const authorization = resolveAuthorization({ headers } as unknown as IncomingMessage);
      expect(authorization.verifiedResponder).toMatchObject({
        actorType: "user",
        actorId: "synthetic-user",
        source: "trusted_headers",
      });
      if (body.method === "tasks/update") {
        expect(parseTaskInputResponses(body.params)).toEqual({
          approval: { action: "accept", content: { decision: "continue_observation" } },
        });
      } else {
        const parsed = parsePublicInterventionApply(body.params);
        expect(RuntimeInterventionCommandSchema.parse(parsed.command)).toMatchObject({
          guard: {
            mode: "semantic",
            expectedInterventionRevision: 1,
            expectedEffectivePlanRevision: 2,
          },
        });
      }
      const actual = await handler.dispatchAsync(body, headers, authorization);
      expect(actual).toEqual(example.response);
    }
    expect(update).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
  });
});
