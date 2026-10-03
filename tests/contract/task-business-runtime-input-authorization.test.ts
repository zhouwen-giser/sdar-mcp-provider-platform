import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import type { AuthorizationContext, TaskRecord } from "../../packages/domain/src/index.js";
import {
  TaskBusinessOperationProfileSchema,
  TASK_BUSINESS_OPERATION_PROFILE_SCHEMA_VERSION,
} from "../../packages/adapter-protocol/src/index.js";
import { createAuthorizationResolver } from "../../packages/mcp-protocol/src/security.js";
import type { ValidatedManifest } from "../../packages/operation-registry/src/index.js";
import type {
  LockedInputResponseRequest,
  McpInputResponse,
  OperationSnapshotRepository,
  TaskRepository,
  ValidateLockedInputResponse,
} from "../../packages/persistence-postgres/src/index.js";
import { TaskEngine } from "../../packages/task-engine/src/engine.js";
import type { TaskAdapterGateway } from "../../packages/task-engine/src/diagnostic-gateway.js";

const response = { action: "accept" as const, content: { choice: "continue" } };
const requestMetadata = {
  schemaVersion: "sdar.required-input/1.0-rc2",
  requestKey: "decision-a",
  inputType: "target.observation_decision",
  requiredResponder: "user",
  deadlineAt: "2100-01-01T00:00:00Z",
};
const syntheticBusinessProfile = TaskBusinessOperationProfileSchema.parse({
  schemaVersion: TASK_BUSINESS_OPERATION_PROFILE_SCHEMA_VERSION,
  profileVersion: "1.0-rc2",
  availability: "available",
  source: {
    sourceId: "vehicle.business",
    deliverySemantics: "durable_at_least_once",
    replaySupported: true,
  },
  artifactTypes: [],
  actionTypes: [],
  requiredInputTypes: ["target.observation_decision"],
  interventionTypes: [],
  methods: {
    contextGet: "io.sdar/taskBusiness/context/get",
    artifactGet: "io.sdar/taskBusiness/artifacts/get",
    eventsListen: "io.sdar/businessEvents/listen",
    contentGet: false,
    inputUpdate: true,
    interventionApply: false,
  },
  semantics: {
    artifact: ["requested"],
    coordinateFrames: [],
    observationClockDomains: ["utc"],
  },
  limits: { maxInlineArtifactBytes: 65_536, maxWaitMs: 300_000, trajectoryMinSamples: 2 },
  policy: {
    visualLockOwner: "disabled",
    decisionMode: "user_required",
    onExpire: "release_and_resume_scan",
    onDismiss: "release_and_resume_scan",
    footprintMode: "disabled",
    coverageMode: "disabled",
  },
  qualification: {
    routeAdoption: "not_supported",
    footprint: "not_supported",
    automaticVisualLock: "not_supported",
    runtimeReplan: "not_supported",
  },
});

function fixture(metadata: unknown = requestMetadata) {
  const accepted: string[] = [];
  const request: LockedInputResponseRequest = {
    key: "decision-a",
    status: "OPEN",
    schema: {
      type: "object",
      properties: { choice: { type: "string", const: "continue" } },
      required: ["choice"],
      additionalProperties: false,
    },
    requestJson: {
      method: "elicitation/create",
      params: {
        message: "Choose the bounded observation branch",
        requestedSchema: {},
        ...(metadata === null ? {} : { _meta: { "io.sdar/taskBusiness": metadata } }),
      },
    },
  };
  const repository = {
    getAuthorized: async () => ({ operationSnapshotId: "snapshot-a" }) as TaskRecord,
    acceptMcpInputResponses: async (
      _taskId: string,
      _authorization: AuthorizationContext,
      responses: Record<string, McpInputResponse>,
      validate: ValidateLockedInputResponse,
    ) => {
      const inputResponse = responses["decision-a"];
      if (inputResponse === undefined) throw new Error("TEST_RESPONSE_MISSING");
      validate(request, inputResponse);
      accepted.push("decision-a");
      return {
        acceptedKeys: ["decision-a"],
        ignoredUnknownKeys: [],
        ignoredAnsweredKeys: [],
        ignoredSupersededKeys: [],
        duplicatePendingKeys: [],
      };
    },
  } as unknown as TaskRepository;
  const snapshots = {
    loadOperationSnapshot: async () => ({
      operation: {
        capabilities: { inputRequired: true },
        businessFeedbackProfile: syntheticBusinessProfile,
      },
    }),
  } as unknown as OperationSnapshotRepository;
  const engine = new TaskEngine(
    {} as ValidatedManifest,
    new Map(),
    {} as TaskAdapterGateway,
    repository,
    undefined,
    undefined,
    undefined,
    undefined,
    snapshots,
  );
  return { engine, accepted };
}

function headerRequest(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

const trusted = createAuthorizationResolver({ mode: "trusted_headers" });
const scoped = (actorType: string) =>
  trusted(
    headerRequest({
      "x-sdar-subject": "test-user-proxy",
      "x-sdar-tenant": "test-tenant",
      "x-sdar-actor-type": actorType,
      "x-sdar-execution-mode": "simulation",
      "x-sdar-simulation-id": "isolated-test-scene",
    }),
  );

describe("Runtime business input responder boundary", () => {
  it("accepts a declared user request only from a verified user context", async () => {
    const { engine, accepted } = fixture();
    await engine.updateTaskInputResponses("task-a", { "decision-a": response }, scoped("user"));
    expect(accepted).toEqual(["decision-a"]);
  });

  it("rejects agent and anonymous claimed-user responses before durable acceptance", async () => {
    const { engine, accepted } = fixture();
    await expect(
      engine.updateTaskInputResponses("task-a", { "decision-a": response }, scoped("agent")),
    ).rejects.toMatchObject({ reasonCode: "RESPONDER_NOT_AUTHORIZED" });
    const anonymous = createAuthorizationResolver({ mode: "anonymous" });
    const claimedUser = anonymous(
      headerRequest({
        "x-sdar-subject": "test-user-proxy",
        "x-sdar-actor-type": "user",
        "x-sdar-execution-mode": "simulation",
        "x-sdar-simulation-id": "isolated-test-scene",
      }),
    );
    await expect(
      engine.updateTaskInputResponses("task-a", { "decision-a": response }, claimedUser),
    ).rejects.toMatchObject({ reasonCode: "RESPONDER_NOT_AUTHORIZED" });
    expect(accepted).toEqual([]);
  });

  it("accepts anonymous development policy without trusting supplied actor headers", async () => {
    const development = createAuthorizationResolver({ mode: "development" });
    for (const headers of [{}, { "x-sdar-actor-type": "operator" }]) {
      const { engine, accepted } = fixture();
      const authorization = development(headerRequest(headers));
      await engine.updateTaskInputResponses("task-a", { "decision-a": response }, authorization);
      expect(accepted).toEqual(["decision-a"]);
      expect(authorization.verifiedResponder).toEqual({
        actorType: "development_anonymous",
        actorId: "development-anonymous",
        source: "development",
      });
    }
  });

  it("rejects missing or mismatched Provider request metadata", async () => {
    for (const metadata of [
      null,
      { ...requestMetadata, requestKey: "other-key" },
      { ...requestMetadata, requiredResponder: "agent" },
      { ...requestMetadata, deadlineAt: "bad-date" },
    ]) {
      const { engine, accepted } = fixture(metadata);
      await expect(
        engine.updateTaskInputResponses("task-a", { "decision-a": response }, scoped("user")),
      ).rejects.toThrow(/BUSINESS_INPUT_METADATA_/);
      expect(accepted).toEqual([]);
    }
  });
});
