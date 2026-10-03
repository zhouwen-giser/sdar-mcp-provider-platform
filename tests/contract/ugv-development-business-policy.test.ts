import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { TaskBusinessContextSchema } from "../../packages/vehicle-provider-core/src/task-business-contract.js";
import { isRuntimeBusinessResponder } from "../../packages/domain/src/index.js";
import {
  RequiredInputSchema,
  RequiredInputResponseCommandSchema,
  TrustedResponderSchema,
  taskBusinessResponder,
  assessRequiredInputResponse,
} from "../../packages/vehicle-provider-core/src/task-business-interaction.js";

const catalog = z
  .object({
    context: TaskBusinessContextSchema,
    requiredInput: RequiredInputSchema,
    inputCommand: RequiredInputResponseCommandSchema,
  })
  .parse(
    JSON.parse(readFileSync("protocol/task-business/v1/examples/positive-catalog.json", "utf8")),
  );
const request = RequiredInputSchema.parse(catalog.requiredInput);
const command = RequiredInputResponseCommandSchema.parse(catalog.inputCommand);
const responder = taskBusinessResponder({
  source: "development",
  actorType: "development_anonymous",
  actorId: "development-anonymous",
});
const now = new Date(request.requestedAt);
const assess = (value = command, binding = request.subjectBinding) =>
  assessRequiredInputResponse(
    request,
    value,
    responder,
    catalog.context.contextRevision,
    binding,
    now,
  );

describe("development business policy without invented human identity", () => {
  it.each(["accept", "decline", "cancel"] as const)(
    "allows %s with unchanged public business guards",
    (action) => {
      const value = { ...command, result: action === "accept" ? command.result : { action } };
      expect(assess(value).outcome).toBe(action);
      expect(responder).toEqual({
        source: "runtime_development_policy",
        actorType: "development_anonymous",
        verified: false,
      });
    },
  );
  it("retains task, request, revision and subject binding checks", () => {
    expect(() => assess({ ...command, taskId: "foreign" })).toThrow("INPUT_BINDING_INVALID");
    expect(() => assess({ ...command, requestKey: "foreign" })).toThrow("INPUT_BINDING_INVALID");
    expect(() =>
      assess({
        ...command,
        guard: { mode: "semantic", expectedRequestRevision: request.revision + 1 },
      }),
    ).toThrow("REQUEST_REVISION_CONFLICT");
    expect(() => assess(command, { ...request.subjectBinding, kind: "none" } as never)).toThrow(
      "SUBJECT_NO_LONGER_VALID",
    );
  });
  it("rejects forged identities and cross-policy combinations", () => {
    expect(
      isRuntimeBusinessResponder({ source: "development", actorType: "user", actorId: "alice" }),
    ).toBe(false);
    expect(
      isRuntimeBusinessResponder({
        source: "trusted_headers",
        actorType: "development_anonymous",
        actorId: "development-anonymous",
      }),
    ).toBe(false);
    expect(TrustedResponderSchema.safeParse({ ...responder, verified: true }).success).toBe(false);
    expect(
      TrustedResponderSchema.safeParse({ ...responder, source: "runtime_authorization_context" })
        .success,
    ).toBe(false);
  });
});
