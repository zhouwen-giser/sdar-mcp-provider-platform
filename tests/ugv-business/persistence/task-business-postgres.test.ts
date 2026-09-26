import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { runUgvProviderMigrations } from "../../../apps/ugv-provider-adapter/src/migrate.js";
import { UgvBusinessEventHub } from "../../../apps/ugv-provider-adapter/src/business-events.js";
import { ugvManifest } from "../../../apps/ugv-provider-adapter/src/manifest.js";
import { openUgvTaskBusinessStore } from "../../../apps/ugv-provider-adapter/src/task-business-bootstrap.js";
import { UgvProviderRuntime } from "../../../apps/ugv-provider-adapter/src/runtime.js";
import { UgvTaskBusinessContextService } from "../../../apps/ugv-provider-adapter/src/task-business-service.js";
import { NavigationTrajectoryProcessor } from "../../../apps/ugv-provider-adapter/src/navigation-trajectory-processor.js";
import { ReconBusinessProcessor } from "../../../apps/ugv-provider-adapter/src/recon-business-processor.js";
import { NativeLockBusinessProcessor } from "../../../apps/ugv-provider-adapter/src/native-lock-business-processor.js";
import { TargetBusinessProcessor } from "../../../apps/ugv-provider-adapter/src/target-business-processor.js";
import { UgvTelemetry } from "../../../apps/ugv-provider-adapter/src/telemetry.js";
import type {
  AdapterBusinessEvent,
  ProviderManifest,
} from "../../../packages/adapter-protocol/src/index.js";
import {
  jsonToProtoStruct,
  protoStructToJson,
} from "../../../packages/adapter-protocol/src/struct.js";
import {
  bootstrapTaskBusinessReducer,
  normalizeTaskBusinessSseNotification,
  reduceTaskBusinessFeedback,
  unresolvedTaskBusinessRefs,
} from "../../../packages/mcp-protocol/src/index.js";
import { OperationRegistry } from "../../../packages/operation-registry/src/index.js";
import {
  BoundExecutionScope,
  BusinessCommandRecordSchema,
  PostgresTaskBusinessStore,
  PostgresProviderStore,
  SMPP_DIAGNOSTIC_CONTRACT,
  SMPP_RESPONSE_LOSS_CAPABILITY,
  taskBusinessInputResponseHash,
  type BusinessObjectVersion,
  type ProviderExecution,
} from "../../../packages/provider-adapter-kit/src/index.js";
import { TaskArtifactSchema } from "../../../packages/vehicle-provider-core/src/task-business-artifact.js";
import {
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
} from "../../../packages/vehicle-provider-core/src/task-business-contract.js";
import { VehicleBusinessEventHub } from "../../../packages/vehicle-provider-core/src/business-events.js";
import {
  MockUgvDeviceMcpClient,
  mockUgvToolContracts,
} from "../../../packages/vehicle-device-mcp-client/src/index.js";
import { VehicleMqttIngress } from "../../../packages/vehicle-mqtt-ingress/src/index.js";
import { DISABLED_UGV_TASK_BUSINESS_SETTINGS } from "../../../packages/runtime-configuration-contract/src/providers/ugv-business.js";
import {
  BusinessActionSchema,
  RequiredInputSchema,
  RuntimeInterventionSchema,
} from "../../../packages/vehicle-provider-core/src/task-business-interaction.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error("TEST_DATABASE_URL is required for UGV business persistence tests");
const schema = `ugv_task_business_${randomUUID().replaceAll("-", "")}`;
const scopedUrl = new URL(databaseUrl);
scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
const admin = new Pool({ connectionString: databaseUrl, max: 1 });
const pool = new Pool({ connectionString: scopedUrl.toString(), max: 4 });
const catalog = z
  .object({
    context: TaskBusinessContextSchema,
    artifacts: z.array(TaskArtifactSchema),
    action: BusinessActionSchema,
    requiredInput: RequiredInputSchema,
    intervention: RuntimeInterventionSchema,
  })
  .parse(
    JSON.parse(
      readFileSync("protocol/task-business/v1/examples/positive-catalog.json", "utf8"),
    ) as unknown,
  );
const at = "2026-09-23T00:00:00Z";
const later = "2026-09-23T00:01:00Z";
const contentBytes = Buffer.from(
  JSON.stringify({
    type: "LineString",
    coordinates: [
      [116, 39],
      [116.1, 39.1],
    ],
  }),
);

function execution(): ProviderExecution {
  return {
    taskId: catalog.context.identity.taskId,
    externalExecutionId: catalog.context.identity.executionId,
    operationName: catalog.context.identity.operationName,
    argumentHash: "b".repeat(64),
    providerId: catalog.context.identity.providerId,
    resourceId: catalog.context.identity.resourceId,
    tracks: [],
    arguments: {},
    executionContext: {
      authorizationContextHash: "a".repeat(64),
      executionMode: "SIMULATION",
      simulationId: "scene-a",
      correlationId: "correlation-a",
    },
    downstreamMissionIds: [],
    state: "RUNNING",
    revision: 1,
    reasonCode: "PERSISTENCE_FIXTURE",
    createdAt: at,
    updatedAt: later,
    evidence: [],
  };
}

beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await runUgvProviderMigrations(pool, resolve(import.meta.dirname, "../../.."));
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
});

describe("native PostgreSQL task business Store", () => {
  it("rejects an answered Input without a claimed reply and then commits the claimed answer", async () => {
    const run = {
      ...execution(),
      executionContext: {
        ...execution().executionContext,
        simulationId: `scene-input-claim-${randomUUID()}`,
      },
    };
    const scope = BoundExecutionScope.fromExecution(run);
    const store = new PostgresTaskBusinessStore(pool);
    const route = catalog.artifacts.find((item) => item.artifactId === "route-line");
    if (!route) throw new Error("CATALOG_ROUTE_MISSING");
    const pending = RequiredInputSchema.parse({
      ...catalog.requiredInput,
      deadlineAt: "2100-01-01T00:00:00Z",
    });
    const context = TaskBusinessContextSchema.parse({ ...catalog.context, contextRevision: 1 });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: null,
      context,
      objects: [
        { kind: "artifact", value: route },
        { kind: "action", value: catalog.action },
        { kind: "input_request", value: pending },
        { kind: "intervention", value: catalog.intervention },
      ],
    });
    const responseCommandId = `input-answer-${randomUUID()}`;
    const response = { action: "accept" as const, value: { decision: "continue" } };
    const answered = RequiredInputSchema.parse({
      ...pending,
      revision: 2,
      state: "answered",
      resolvedAt: later,
      responseCommandId,
      response,
    });
    const ref = { kind: "input_request" as const, id: answered.requestId, revision: 2 };
    const next = TaskBusinessContextSchema.parse({
      ...context,
      contextRevision: 2,
      requiredInputRefs: [ref],
      activeRefs: { ...context.activeRefs, input: ref },
    });
    const changeSet = {
      scope,
      expectedContextRevision: 1,
      context: next,
      objects: [{ kind: "input_request" as const, value: answered }],
    };
    await expect(store.commitChangeSet(changeSet)).rejects.toThrow(
      "BUSINESS_INPUT_RESPONSE_CLAIM_REQUIRED",
    );
    expect(await store.getContext(scope)).toEqual(context);
    expect(await store.getObjectVersion(scope, ref)).toBeUndefined();

    const command = BusinessCommandRecordSchema.parse({
      commandId: responseCommandId,
      commandType: "input_response",
      entryKey: `input:${pending.requestKey}`,
      runtimeCommandSequence: "91",
      identity: context.identity,
      requestHash: "a".repeat(64),
      responseHash: taskBusinessInputResponseHash(response),
      state: "accepted",
      createdAt: at,
      updatedAt: at,
    });
    expect((await store.claimCommand(scope, command, context.requiredInputRefs[0])).claimed).toBe(
      true,
    );
    await expect(
      store.commitChangeSet({
        ...changeSet,
        objects: [
          {
            kind: "input_request",
            value: { ...answered, responseCommandId: "different-command" },
          },
        ],
      }),
    ).rejects.toThrow("BUSINESS_INPUT_RESPONSE_CLAIM_REQUIRED");
    await expect(
      store.commitChangeSet({
        ...changeSet,
        objects: [
          {
            kind: "input_request",
            value: { ...answered, response: { action: "accept", value: { decision: "divert" } } },
          },
        ],
      }),
    ).rejects.toThrow("BUSINESS_INPUT_RESPONSE_MISMATCH");
    await expect(
      store.commitChangeSet({
        ...changeSet,
        command: {
          ...command,
          responseHash: "f".repeat(64),
          state: "rejected",
          resultCode: "LOCAL_ACTION_FAILED",
          updatedAt: later,
        },
      }),
    ).rejects.toThrow("COMMAND_ID_CONFLICT");
    await store.commitChangeSet({
      ...changeSet,
      command: {
        ...command,
        state: "rejected",
        resultCode: "LOCAL_ACTION_FAILED",
        updatedAt: later,
      },
    });
    expect(await store.getContext(scope)).toEqual(next);
    expect(await store.getObjectVersion(scope, ref)).toEqual({
      kind: "input_request",
      value: answered,
    });
    expect((await store.getCommand(scope, command.commandId))?.state).toBe("rejected");
  });

  it("rolls back a Context revision whose recorded time moves backward", async () => {
    const store = new PostgresTaskBusinessStore(pool);
    const run = {
      ...execution(),
      taskId: `task-context-time-${randomUUID()}`,
      externalExecutionId: `execution-context-time-${randomUUID()}`,
    };
    const scope = BoundExecutionScope.fromExecution(run);
    const context = TaskBusinessContextSchema.parse({
      ...catalog.context,
      identity: {
        ...catalog.context.identity,
        taskId: run.taskId,
        executionId: run.externalExecutionId,
      },
      contextRevision: 1,
      activeRefs: {},
      artifactRefs: [],
      actionRefs: [],
      requiredInputRefs: [],
      interventionRefs: [],
    });
    await store.commitChangeSet({ scope, expectedContextRevision: null, context, objects: [] });
    const earlier = TaskBusinessContextSchema.parse({
      ...context,
      contextRevision: 2,
      updatedAt: at,
    });
    await expect(
      store.commitChangeSet({ scope, expectedContextRevision: 1, context: earlier, objects: [] }),
    ).rejects.toThrow("BUSINESS_CONTEXT_TIME_REGRESSION");
    expect(await store.getContext(scope)).toEqual(context);
    const sameTime = TaskBusinessContextSchema.parse({ ...context, contextRevision: 2 });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: sameTime,
      objects: [],
    });
    expect((await store.getContext(scope))?.contextRevision).toBe(2);
  });

  it("rolls back an Input or Intervention with a malformed published JSON Schema", async () => {
    const store = new PostgresTaskBusinessStore(pool);
    for (const kind of ["input_request", "intervention"] as const) {
      const run = {
        ...execution(),
        taskId: `task-invalid-schema-${kind}-${randomUUID()}`,
        externalExecutionId: `execution-invalid-schema-${kind}-${randomUUID()}`,
      };
      const scope = BoundExecutionScope.fromExecution(run);
      const identity = {
        ...catalog.context.identity,
        taskId: run.taskId,
        executionId: run.externalExecutionId,
      };
      const valid: BusinessObjectVersion =
        kind === "input_request"
          ? { kind, value: RequiredInputSchema.parse({ ...catalog.requiredInput, identity }) }
          : { kind, value: RuntimeInterventionSchema.parse({ ...catalog.intervention, identity }) };
      const ref = {
        kind,
        id: valid.kind === "input_request" ? valid.value.requestId : valid.value.interventionId,
        revision: 1,
      } as const;
      const context = TaskBusinessContextSchema.parse({
        ...catalog.context,
        identity,
        contextRevision: 1,
        activeRefs: { entry: ref },
        artifactRefs: [],
        actionRefs: [],
        requiredInputRefs: kind === "input_request" ? [ref] : [],
        interventionRefs: kind === "intervention" ? [ref] : [],
      });
      const invalid: BusinessObjectVersion =
        valid.kind === "input_request"
          ? {
              kind: "input_request",
              value: { ...valid.value, inputSchema: { type: "not-a-json-schema-type" } },
            }
          : {
              kind: "intervention",
              value: { ...valid.value, inputSchema: { type: "not-a-json-schema-type" } },
            };
      await expect(
        store.commitChangeSet({
          scope,
          expectedContextRevision: null,
          context,
          objects: [invalid],
        }),
      ).rejects.toThrow(
        kind === "input_request" ? "INVALID_INPUT_SCHEMA" : "INVALID_INTERVENTION_SCHEMA",
      );
      expect(await store.getContext(scope)).toBeUndefined();
      expect(await store.getObjectVersion(scope, ref)).toBeUndefined();
      await store.commitChangeSet({
        scope,
        expectedContextRevision: null,
        context,
        objects: [valid],
      });
      expect(await store.getObjectVersion(scope, ref)).toEqual(valid);
    }
  });

  it("qualifies the installed native schema before exposing the durable business source", async () => {
    const provider = new PostgresProviderStore(scopedUrl.toString(), 2, "ugv");
    try {
      expect(
        provider.businessEventSources().some((item) => item.sourceId === "vehicle.business"),
      ).toBe(false);
      const business = await openUgvTaskBusinessStore(provider, {
        ...DISABLED_UGV_TASK_BUSINESS_SETTINGS,
        enabled: true,
        coverage: { mode: "device_reported" },
      });
      expect(business).toBeInstanceOf(PostgresTaskBusinessStore);
      expect(
        provider.businessEventSources().some((item) => item.sourceId === "vehicle.business"),
      ).toBe(true);
      if (!business) throw new Error("BUSINESS_STORE_MISSING");
      const service = new UgvTaskBusinessContextService(
        provider,
        business,
        "isr.vehicle.ugv.ugv1",
        "vehicle:ugv1",
        () => undefined,
      );
      const runtime = new UgvProviderRuntime(
        {
          providerId: "isr.vehicle.ugv.ugv1",
          resourceId: "vehicle:ugv1",
          freshness: {
            chassis: 3_000,
            mission: 3_000,
            health: 5_000,
            target: 3_000,
            payload: 3_000,
          },
          allowNavigationWithRecon: true,
          fireRequiresChassisStopped: true,
          pollIntervalMs: 60_000,
        },
        provider,
        new VehicleMqttIngress("direct_domain_json", {
          maxPayloadBytes: 65_536,
          maxDepth: 16,
          maxNodes: 4_096,
          maxStringBytes: 16_384,
        }),
        new MockUgvDeviceMcpClient(),
        new UgvBusinessEventHub(provider),
        new UgvTelemetry({
          providerId: "isr.vehicle.ugv.ugv1",
          enabled: false,
          endpoint: "127.0.0.1:7002",
          tlsMode: "disabled",
        }),
        service,
      );
      const profiles = runtime.businessFeedbackProfiles();
      expect(profiles?.vehicle_navigate).toMatchObject({
        artifactTypes: ["navigation.destination", "navigation.waypoints", "navigation.trajectory"],
        interventionTypes: [],
        methods: { contextGet: "io.sdar/taskBusiness/context/get", interventionApply: false },
      });
      expect(profiles?.vehicle_area_recon).toMatchObject({
        artifactTypes: [
          "recon.area",
          "recon.coverage_plan",
          "recon.covered_area",
          "target.object",
          "target.track",
        ],
        policy: { coverageMode: "device_reported" },
      });
      const manifest = ugvManifest(
        "isr.vehicle.ugv.ugv1",
        "1.0.0",
        provider,
        "vehicle:ugv1",
        { contracts: mockUgvToolContracts(), executionMode: "simulation" },
        profiles,
      ) as unknown as ProviderManifest;
      expect(
        new OperationRegistry()
          .validate(manifest)
          .operations.find((item) => item.definition.name === "vehicle_navigate")?.tool._meta[
          "io.sdar/taskBusiness"
        ],
      ).toEqual(profiles?.vehicle_navigate);

      const run: ProviderExecution = {
        ...execution(),
        taskId: `task-update-ack-${randomUUID()}`,
        externalExecutionId: `nav-update-ack-${randomUUID()}`,
        operationName: "vehicle_navigate",
        arguments: { resourceId: "vehicle:ugv1" },
        downstreamMissionIds: ["1"],
        state: "RUNNING",
      };
      await provider.putExecution(run);
      const identity = {
        taskId: run.taskId,
        externalExecutionId: run.externalExecutionId,
        operationName: run.operationName,
        argumentHash: run.argumentHash,
        executionContext: run.executionContext,
        commandSequence: "1",
      };
      const ambiguous = {
        inputs: [{ inputRequestKey: "decision" }],
        inputResponses: [{ key: "decision" }],
      };
      expect(await runtime.updateInput(identity, ambiguous)).toMatchObject({
        accepted: false,
        reasonCode: "INPUT_RESPONSE_WIRE_AMBIGUOUS",
      });
      expect(await provider.getCommandAck(run.taskId, "update", "1")).toBeUndefined();
      expect(
        await runtime.updateInput(identity, {
          inputs: [],
          inputResponses: [{ key: "decision" }],
        }),
      ).toMatchObject({ accepted: false, reasonCode: "INPUT_RESPONSE_WIRE_INVALID" });
      expect(await provider.getCommandAck(run.taskId, "update", "1")).toBeUndefined();
      const denied = await runtime.updateInput(identity, {
        inputs: [],
        inputResponses: [{ key: "decision", result: jsonToProtoStruct({ action: "accept" }) }],
      });
      expect(denied).toMatchObject({
        accepted: false,
        reasonCode: "UGV_INPUT_HANDLER_NOT_AVAILABLE",
      });
      expect(await provider.getCommandAck(run.taskId, "update", "1")).toMatchObject({
        response: { reasonCode: "UGV_INPUT_HANDLER_NOT_AVAILABLE" },
      });
      expect(await runtime.updateInput(identity, ambiguous)).toEqual(denied);
    } finally {
      await provider.close();
    }
  });
  it("returns the lease-current diagnostic receipt when bound and consumed timestamps tie", async () => {
    const provider = new PostgresProviderStore(scopedUrl.toString(), 2, "ugv");
    try {
      const leaseId = randomUUID();
      const requestHash = "f".repeat(64);
      const argumentHash = "d".repeat(64);
      await provider.armDiagnosticLease(
        {
          contract: SMPP_DIAGNOSTIC_CONTRACT,
          leaseId,
          capabilityId: SMPP_RESPONSE_LOSS_CAPABILITY,
          faultType: "drop-response-after-durable-side-effect",
          boundary: "provider-after-durable-mission",
          injectionCount: 1,
          operationName: "vehicle_navigate",
          stableOperationKey: "e".repeat(64),
          canonicalRequestHash: requestHash,
          idempotencyKey: "same-timestamp-postgres",
          state: "ARMED",
          scope: {
            runId: "run-same-timestamp",
            caseId: "UGV-MCP-003",
            caseExecutionId: "case-same-timestamp",
            repetitionId: "repetition-1",
            selector: { operationName: "vehicle_navigate", argumentHash },
          },
          armedAt: at,
          expiresAt: later,
        },
        {
          contract: SMPP_DIAGNOSTIC_CONTRACT,
          receiptId: randomUUID(),
          leaseId,
          action: "armed",
          requestHash,
          occurredAt: at,
          reasonCode: "SMPP_DIAGNOSTIC_ARMED",
        },
      );
      const bound = await provider.bindDiagnosticLease({
        capabilityId: SMPP_RESPONSE_LOSS_CAPABILITY,
        operationName: "vehicle_navigate",
        argumentHash,
        logicalInvocationId: "same-timestamp-invocation",
        taskId: "same-timestamp-task",
        externalExecutionId: "same-timestamp-execution",
        deviceMissionId: "1",
        observedAt: at,
      });
      expect(bound?.receipt.action).toBe("bound");
      await provider.consumeDiagnosticLease(leaseId, requestHash, randomUUID(), at);
      expect(await provider.getDiagnosticStatus(leaseId)).toMatchObject({
        lease: { state: "CONSUMED" },
        receipt: { action: "consumed", state: "CONSUMED" },
      });
    } finally {
      await provider.close();
    }
  });

  it("creates Context without a Runtime Task row and retains exact immutable versions across Store instances", async () => {
    const scope = BoundExecutionScope.fromExecution(execution());
    const store = new PostgresTaskBusinessStore(pool);
    const route = catalog.artifacts.find((item) => item.artifactId === "route-line");
    if (!route) throw new Error("CATALOG_ROUTE_MISSING");
    const context = TaskBusinessContextSchema.parse({ ...catalog.context, contextRevision: 1 });
    const objects: BusinessObjectVersion[] = [
      { kind: "artifact", value: route },
      { kind: "action", value: catalog.action },
      { kind: "input_request", value: catalog.requiredInput },
      { kind: "intervention", value: catalog.intervention },
    ];
    expect(await store.getContext(scope)).toBeUndefined();
    await store.commitChangeSet({ scope, expectedContextRevision: null, context, objects });
    const restarted = new PostgresTaskBusinessStore(pool);
    expect(await restarted.getContext(scope)).toEqual(context);
    expect((await restarted.getContextSnapshot(scope))?.objects).toHaveLength(4);
    expect(await restarted.getArtifactVersion(scope, route.artifactId, 1)).toEqual(route);
    expect(await restarted.getArtifactLatest(scope, route.artifactId)).toEqual(route);
    expect(
      await restarted.readArtifactContent(scope, route.artifactId, 1, new Date(at)),
    ).toMatchObject({ kind: "inline" });
    expect(await restarted.getArtifactVersion(scope, route.artifactId, 2)).toBeUndefined();
    const other = BoundExecutionScope.fromExecution({
      ...execution(),
      executionContext: { ...execution().executionContext, simulationId: "scene-b" },
    });
    expect(await restarted.getContext(other)).toBeUndefined();
    expect(await restarted.getArtifactVersion(other, route.artifactId, 1)).toBeUndefined();

    const route2 = TaskArtifactSchema.parse({ ...route, revision: 2 });
    const ref2 = { kind: "artifact" as const, id: route.artifactId, revision: 2 };
    const next = TaskBusinessContextSchema.parse({
      ...context,
      contextRevision: 2,
      activeRefs: { ...context.activeRefs, route: ref2 },
      artifactRefs: [ref2],
    });
    await expect(
      restarted.commitChangeSet({
        scope,
        expectedContextRevision: 1,
        context: next,
        objects: [
          { kind: "artifact", value: route2 },
          { kind: "artifact", value: route2 },
        ],
      }),
    ).rejects.toThrow("BUSINESS_OBJECT_DUPLICATE_IN_CHANGESET");
    expect(await restarted.getArtifactVersion(scope, route.artifactId, 2)).toBeUndefined();
    await restarted.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: next,
      objects: [{ kind: "artifact", value: route2 }],
    });
    expect(await store.getArtifactVersion(scope, route.artifactId, 1)).toEqual(route);
    expect(await store.getArtifactVersion(scope, route.artifactId, 2)).toEqual(route2);
    const referenceFixture = catalog.artifacts.find((item) => item.artifactId === "route-ref");
    const unavailable = catalog.artifacts.find((item) => item.artifactId === "route-unavailable");
    if (
      referenceFixture?.availability !== "available" ||
      referenceFixture.content.kind !== "content_ref" ||
      !unavailable
    )
      throw new Error("CATALOG_ARTIFACT_MISSING");
    const reference = TaskArtifactSchema.parse({
      ...referenceFixture,
      content: {
        ...referenceFixture.content,
        sizeBytes: contentBytes.length,
        sha256: createHash("sha256").update(contentBytes).digest("hex"),
      },
    });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 2,
      context: { ...next, contextRevision: 3 },
      objects: [
        { kind: "artifact", value: reference },
        { kind: "artifact", value: unavailable },
      ],
      contents: [
        {
          artifactId: reference.artifactId,
          revision: 1,
          handle: "route-ref_1",
          bytes: contentBytes,
        },
      ],
    });
    expect(
      await store.readArtifactContent(scope, reference.artifactId, 1, new Date(at)),
    ).toMatchObject({ kind: "stored", handle: "route-ref_1" });
    expect(
      (await store.readArtifactContentBytes(scope, reference.artifactId, 1, new Date(at))).bytes,
    ).toEqual(Uint8Array.from(contentBytes));
    expect(await store.getArtifactLatest(scope, route.artifactId)).toEqual(route2);
    await expect(
      store.readArtifactContent(scope, reference.artifactId, 1, new Date("2026-09-24T00:00:00Z")),
    ).rejects.toThrow("ARTIFACT_CONTENT_EXPIRED");
    await expect(
      store.readArtifactContentBytes(
        scope,
        reference.artifactId,
        1,
        new Date("2026-09-24T00:00:00Z"),
      ),
    ).rejects.toThrow("ARTIFACT_CONTENT_EXPIRED");
    await expect(
      store.readArtifactContent(scope, unavailable.artifactId, 1, new Date(at)),
    ).rejects.toThrow("ARTIFACT_NOT_AVAILABLE");
    await expect(
      store.readArtifactContent(scope, reference.artifactId, 2, new Date(at)),
    ).rejects.toThrow("ARTIFACT_REVISION_NOT_FOUND");
    const fourth = TaskBusinessContextSchema.parse({ ...next, contextRevision: 4 });
    const writers = await Promise.allSettled([
      store.commitChangeSet({ scope, expectedContextRevision: 3, context: fourth, objects: [] }),
      restarted.commitChangeSet({
        scope,
        expectedContextRevision: 3,
        context: fourth,
        objects: [],
      }),
    ]);
    expect(writers.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(writers.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect((await store.getContext(scope))?.contextRevision).toBe(4);
  });

  it("reapplying the append-only business migration keeps existing Context and versions", async () => {
    const migration = readFileSync(
      resolve(
        import.meta.dirname,
        "../../../migrations/providers/ugv/030_task_business_versions.sql",
      ),
      "utf8",
    );
    await pool.query(migration);
    await pool.query(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../../migrations/providers/ugv/031_task_business_command_fences.sql",
        ),
        "utf8",
      ),
    );
    await pool.query(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../../migrations/providers/ugv/032_task_business_content.sql",
        ),
        "utf8",
      ),
    );
    const scope = BoundExecutionScope.fromExecution(execution());
    const store = new PostgresTaskBusinessStore(pool);
    expect((await store.getContext(scope))?.contextRevision).toBe(4);
    expect(await store.getArtifactVersion(scope, "route-line", 1)).toBeDefined();
  });

  it("stores immutable content bytes with Artifact versions and rolls back a duplicate handle", async () => {
    const run = {
      ...execution(),
      taskId: "task-content-atomic",
      externalExecutionId: "execution-content-atomic",
    };
    const scope = BoundExecutionScope.fromExecution(run);
    const store = new PostgresTaskBusinessStore(pool);
    const fixture = catalog.artifacts.find((item) => item.artifactId === "route-ref");
    if (fixture?.availability !== "available" || fixture.content.kind !== "content_ref") {
      throw new Error("CATALOG_REFERENCE_MISSING");
    }
    const reference = TaskArtifactSchema.parse({
      ...fixture,
      identity: { ...fixture.identity, taskId: run.taskId, executionId: run.externalExecutionId },
      content: {
        ...fixture.content,
        sizeBytes: contentBytes.length,
        sha256: createHash("sha256").update(contentBytes).digest("hex"),
      },
    });
    if (reference.availability !== "available" || reference.content.kind !== "content_ref") {
      throw new Error("REFERENCE_INVALID");
    }
    const context = TaskBusinessContextSchema.parse({
      ...catalog.context,
      identity: reference.identity,
      contextRevision: 1,
      activeRefs: {},
      artifactRefs: [{ kind: "artifact", id: reference.artifactId, revision: 1 }],
      actionRefs: [],
      requiredInputRefs: [],
      interventionRefs: [],
    });
    const write = {
      artifactId: reference.artifactId,
      revision: 1,
      handle: reference.content.handle,
      bytes: contentBytes,
    };
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: null,
        context,
        objects: [{ kind: "artifact", value: reference }],
        contents: [
          {
            ...write,
            bytes: Buffer.from(contentBytes.map((byte, index) => (index === 0 ? byte ^ 1 : byte))),
          },
        ],
      }),
    ).rejects.toThrow("ARTIFACT_CONTENT_HASH_MISMATCH");
    expect(await store.getContext(scope)).toBeUndefined();
    await store.commitChangeSet({
      scope,
      expectedContextRevision: null,
      context,
      objects: [{ kind: "artifact", value: reference }],
      contents: [write],
    });
    expect(
      (
        await new PostgresTaskBusinessStore(pool).readArtifactContentBytes(
          scope,
          reference.artifactId,
          1,
          new Date(at),
        )
      ).bytes,
    ).toEqual(Uint8Array.from(contentBytes));
    await expect(
      pool.query("UPDATE ugv_task_business_content SET bytes=$1 WHERE handle=$2", [
        Buffer.from("tamper"),
        reference.content.handle,
      ]),
    ).rejects.toThrow("ARTIFACT_CONTENT_IMMUTABLE");
    const next = TaskArtifactSchema.parse({
      ...reference,
      revision: 2,
      content: { ...reference.content, revision: 2 },
    });
    const context2 = TaskBusinessContextSchema.parse({
      ...context,
      contextRevision: 2,
      artifactRefs: [{ kind: "artifact", id: reference.artifactId, revision: 2 }],
    });
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 1,
        context: context2,
        objects: [{ kind: "artifact", value: next }],
        contents: [{ ...write, revision: 2 }],
      }),
    ).rejects.toThrow();
    expect((await store.getContext(scope))?.contextRevision).toBe(1);
    expect(await store.getArtifactVersion(scope, reference.artifactId, 2)).toBeUndefined();
    const other = BoundExecutionScope.fromExecution({
      ...run,
      executionContext: { ...run.executionContext, simulationId: "scene-other" },
    });
    await expect(
      store.readArtifactContentBytes(other, reference.artifactId, 1, new Date(at)),
    ).rejects.toThrow("ARTIFACT_REVISION_NOT_FOUND");
  });

  it("keeps a command claim and terminal result scoped and durable", async () => {
    const execution2 = {
      ...execution(),
      taskId: "task-command",
      externalExecutionId: "execution-command",
    };
    const scope = BoundExecutionScope.fromExecution(execution2);
    const store = new PostgresTaskBusinessStore(pool);
    const identity = {
      ...catalog.context.identity,
      taskId: execution2.taskId,
      executionId: execution2.externalExecutionId,
    };
    const routeCatalog = catalog.artifacts.find((item) => item.artifactId === "route-line");
    if (!routeCatalog) throw new Error("CATALOG_ROUTE_MISSING");
    const route = TaskArtifactSchema.parse({ ...routeCatalog, identity });
    const routeRef = { kind: "artifact" as const, id: route.artifactId, revision: 1 };
    const intervention = RuntimeInterventionSchema.parse({ ...catalog.intervention, identity });
    const interventionRef = {
      kind: "intervention" as const,
      id: intervention.interventionId,
      revision: 1,
    };
    const context = TaskBusinessContextSchema.parse({
      ...catalog.context,
      identity,
      contextRevision: 1,
      activeRefs: { route: routeRef, intervention: interventionRef },
      artifactRefs: [routeRef],
      actionRefs: [],
      requiredInputRefs: [],
      interventionRefs: [interventionRef],
    });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: null,
      context,
      objects: [
        { kind: "artifact", value: route },
        { kind: "intervention", value: intervention },
      ],
    });
    const accepted = BusinessCommandRecordSchema.parse({
      commandId: "command-1",
      commandType: "intervention",
      entryKey: `intervention:${intervention.interventionId}`,
      identity,
      requestHash: "d".repeat(64),
      state: "accepted",
      createdAt: at,
      updatedAt: at,
    });
    expect(await store.claimCommand(scope, accepted, interventionRef, new Date(at))).toEqual({
      claimed: true,
      record: accepted,
    });
    expect(await store.claimCommand(scope, accepted)).toEqual({ claimed: false, record: accepted });
    await expect(
      store.claimCommand(scope, { ...accepted, requestHash: "e".repeat(64) }),
    ).rejects.toThrow("COMMAND_ID_CONFLICT");
    const falseApplied = BusinessCommandRecordSchema.parse({
      ...accepted,
      state: "applied",
      resultCode: "APPLIED",
      updatedAt: later,
    });
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 1,
        context: TaskBusinessContextSchema.parse({ ...context, contextRevision: 2 }),
        objects: [],
        command: falseApplied,
      }),
    ).rejects.toThrow("BUSINESS_INTERVENTION_APPLIED_FACTS_INCOMPLETE");
    expect((await store.getContext(scope))?.contextRevision).toBe(1);
    expect((await store.getCommand(scope, accepted.commandId))?.state).toBe("accepted");

    let current = context;
    for (const [revision, state] of [
      [2, "submitted"],
      [3, "applying"],
    ] as const) {
      const version = RuntimeInterventionSchema.parse({
        ...intervention,
        revision,
        state,
        acceptedCommandId: accepted.commandId,
      });
      const ref = { kind: "intervention" as const, id: version.interventionId, revision };
      const next = TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: revision,
        interventionRefs: [ref],
        activeRefs: { ...current.activeRefs, intervention: ref },
      });
      await store.commitChangeSet({
        scope,
        expectedContextRevision: current.contextRevision,
        context: next,
        objects: [{ kind: "intervention", value: version }],
      });
      current = next;
    }
    const beforeSnapshot = await store.getContextSnapshot(scope);
    if (!beforeSnapshot) throw new Error("BUSINESS_BEFORE_SNAPSHOT_MISSING");
    const publicStreamId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1007";
    let readModel = bootstrapTaskBusinessReducer(
      [
        {
          contextRevision: beforeSnapshot.context.contextRevision,
          context: beforeSnapshot.context,
          objects: beforeSnapshot.objects,
          objectDescriptors: [],
        },
      ],
      { streamId: publicStreamId, afterSequence: "10" },
    );
    const adoptedRoute = TaskArtifactSchema.parse({ ...route, revision: 2 });
    const adoptedRef = { kind: "artifact" as const, id: route.artifactId, revision: 2 };
    const appliedIntervention = RuntimeInterventionSchema.parse({
      ...intervention,
      revision: 4,
      state: "applied",
      acceptedCommandId: accepted.commandId,
      resultRefs: [adoptedRef],
    });
    const appliedRef = {
      kind: "intervention" as const,
      id: appliedIntervention.interventionId,
      revision: 4,
    };
    const applied = BusinessCommandRecordSchema.parse({
      ...accepted,
      state: "applied",
      resultCode: "ROUTE_ADOPTED",
      resultRefs: [adoptedRef],
      updatedAt: later,
    });
    const finalContext = TaskBusinessContextSchema.parse({
      ...current,
      contextRevision: 4,
      effectivePlanRevision: context.effectivePlanRevision + 1,
      activeRefs: { route: adoptedRef },
      artifactRefs: [adoptedRef],
      interventionRefs: [appliedRef],
    });
    const resultObjects = [
      { kind: "artifact" as const, value: adoptedRoute },
      { kind: "intervention" as const, value: appliedIntervention },
    ];
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 3,
        context: finalContext,
        objects: resultObjects,
      }),
    ).rejects.toThrow("BUSINESS_INTERVENTION_APPLIED_FACTS_INCOMPLETE");
    expect((await store.getContext(scope))?.contextRevision).toBe(3);
    const finalChange = {
      scope,
      expectedContextRevision: 3 as const,
      context: finalContext,
      objects: resultObjects,
      command: applied,
    };
    const candidateRoute = TaskArtifactSchema.parse({
      ...adoptedRoute,
      properties: { ...adoptedRoute.properties, adoption: "candidate" },
    });
    await expect(
      store.commitChangeSet({
        ...finalChange,
        objects: [
          { kind: "artifact", value: candidateRoute },
          { kind: "intervention", value: appliedIntervention },
        ],
      }),
    ).rejects.toThrow("BUSINESS_INTERVENTION_APPLIED_FACTS_INCOMPLETE");
    await expect(
      store.commitChangeSet({
        ...finalChange,
        context: TaskBusinessContextSchema.parse({
          ...finalContext,
          activeRefs: { route: routeRef },
          artifactRefs: [routeRef, adoptedRef],
        }),
      }),
    ).rejects.toThrow("BUSINESS_INTERVENTION_APPLIED_FACTS_INCOMPLETE");
    expect((await store.getContext(scope))?.contextRevision).toBe(3);
    await expect(store.commitChangeSet(finalChange)).rejects.toThrow(
      "BUSINESS_INTERVENTION_PUBLIC_EVENT_REQUIRED",
    );
    const event = (kind: string, payload: unknown) => ({
      body: TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind,
        contextRevision: finalContext.contextRevision,
        providerRecordedAt: later,
        payload,
      }),
      description: "Synthetic plan applied",
      reasonCode: "TEST",
      severityHint: "info" as const,
    });
    const metadata = event("BUSINESS_EVENT", {
      eventType: "business.plan_applied",
      severity: "info",
      reasonCode: "TEST",
      description: "Synthetic plan applied",
      contextDelta: {
        activeRefs: finalContext.activeRefs,
        effectivePlanRevision: finalContext.effectivePlanRevision,
      },
    });
    const artifact = event("ARTIFACT_CHANGED", {
      change: "update",
      artifactRef: adoptedRef,
      previousRevision: 1,
      reasonCode: "TEST",
    });
    const interventionEvent = event("INTERVENTION_CHANGED", {
      change: "update",
      interventionRef: appliedRef,
      previousRevision: 3,
      reasonCode: "TEST",
    });
    await expect(store.commitBusinessChangeSet(finalChange, [metadata, artifact])).rejects.toThrow(
      "BUSINESS_INTERVENTION_PUBLIC_EVENT_REQUIRED",
    );
    expect((await store.getContext(scope))?.contextRevision).toBe(3);
    const committed = await store.commitBusinessChangeSet(finalChange, [
      metadata,
      artifact,
      interventionEvent,
    ]);
    expect(committed.events).toHaveLength(3);
    const persisted = await pool.query<{ source_event_id: string }>(
      `SELECT source_event_id FROM ugv_business_event_source_log
       WHERE source_id='vehicle.business' AND source_event_id = ANY($1::text[])`,
      [committed.events.map((item) => item.sourceEventId)],
    );
    expect(persisted.rows.map((row) => row.source_event_id).sort()).toEqual(
      committed.events.map((item) => item.sourceEventId).sort(),
    );
    for (const [index, sourceEvent] of committed.events.entries()) {
      const notification = {
        method: "notifications/io.sdar/businessEvents",
        params: {
          streamId: publicStreamId,
          sequence: String(11 + index),
          eventId: `public-applied-${index}`,
          sourceId: "vehicle.business",
          sourceStreamId: sourceEvent.sourceStreamId,
          sourceSequence: sourceEvent.sourceSequence,
          sourceEventId: sourceEvent.sourceEventId,
          eventType: sourceEvent.eventType,
          scope: "task",
          taskId: scope.taskId,
          occurredAt: later,
          rawPayload: protoStructToJson(sourceEvent.rawPayload),
        },
      };
      readModel = reduceTaskBusinessFeedback(
        readModel,
        normalizeTaskBusinessSseNotification(notification, beforeSnapshot.context.identity),
      );
    }
    expect(readModel.context.contextRevision).toBe(4);
    expect(readModel.context.effectivePlanRevision).toBe(3);
    expect(readModel.context.activeRefs).toEqual(finalContext.activeRefs);
    expect(readModel.context.artifactRefs).toEqual(finalContext.artifactRefs);
    expect(readModel.context.interventionRefs).toEqual(finalContext.interventionRefs);
    expect(unresolvedTaskBusinessRefs(readModel)).toEqual([adoptedRef, appliedRef]);
    const afterSnapshot = await store.getContextSnapshot(scope);
    if (!afterSnapshot) throw new Error("BUSINESS_AFTER_SNAPSHOT_MISSING");
    const refreshed = bootstrapTaskBusinessReducer(
      [
        {
          contextRevision: afterSnapshot.context.contextRevision,
          context: afterSnapshot.context,
          objects: afterSnapshot.objects,
          objectDescriptors: [],
        },
      ],
      { streamId: publicStreamId, afterSequence: "13" },
    );
    expect(unresolvedTaskBusinessRefs(refreshed)).toEqual([]);
    expect(refreshed.objectVersions.size).toBe(2);
    expect(await new PostgresTaskBusinessStore(pool).getCommand(scope, accepted.commandId)).toEqual(
      applied,
    );
    expect((await store.getContext(scope))?.effectivePlanRevision).toBe(3);
  });

  it("commits a failed Intervention and public source without changing the adopted route", async () => {
    const run = {
      ...execution(),
      taskId: "task-replan-failed",
      externalExecutionId: "execution-replan-failed",
    };
    const scope = BoundExecutionScope.fromExecution(run);
    const store = new PostgresTaskBusinessStore(pool);
    const identity = {
      ...catalog.context.identity,
      taskId: run.taskId,
      executionId: run.externalExecutionId,
    };
    const routeCatalog = catalog.artifacts.find((item) => item.artifactId === "route-line");
    if (!routeCatalog) throw new Error("CATALOG_ROUTE_MISSING");
    const route = TaskArtifactSchema.parse({ ...routeCatalog, identity });
    const routeRef = { kind: "artifact" as const, id: route.artifactId, revision: 1 };
    const intervention = RuntimeInterventionSchema.parse({ ...catalog.intervention, identity });
    const offeredRef = {
      kind: "intervention" as const,
      id: intervention.interventionId,
      revision: 1,
    };
    const context = TaskBusinessContextSchema.parse({
      ...catalog.context,
      identity,
      contextRevision: 1,
      activeRefs: { route: routeRef, intervention: offeredRef },
      artifactRefs: [routeRef],
      actionRefs: [],
      requiredInputRefs: [],
      interventionRefs: [offeredRef],
    });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: null,
      context,
      objects: [
        { kind: "artifact", value: route },
        { kind: "intervention", value: intervention },
      ],
    });
    const accepted = BusinessCommandRecordSchema.parse({
      commandId: "failed-plan-command",
      commandType: "intervention",
      entryKey: `intervention:${intervention.interventionId}`,
      identity,
      requestHash: "f".repeat(64),
      state: "accepted",
      createdAt: at,
      updatedAt: at,
    });
    expect((await store.claimCommand(scope, accepted, offeredRef, new Date(at))).claimed).toBe(
      true,
    );
    let current = context;
    for (const [revision, state] of [
      [2, "submitted"],
      [3, "applying"],
    ] as const) {
      const version = RuntimeInterventionSchema.parse({
        ...intervention,
        revision,
        state,
        acceptedCommandId: accepted.commandId,
      });
      const ref = { kind: "intervention" as const, id: version.interventionId, revision };
      const next = TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: revision,
        activeRefs: { route: routeRef, intervention: ref },
        interventionRefs: [ref],
      });
      await store.commitChangeSet({
        scope,
        expectedContextRevision: current.contextRevision,
        context: next,
        objects: [{ kind: "intervention", value: version }],
      });
      current = next;
    }
    const before = await store.getContextSnapshot(scope);
    if (!before) throw new Error("FAILED_PLAN_BEFORE_SNAPSHOT_MISSING");
    const failed = RuntimeInterventionSchema.parse({
      ...intervention,
      revision: 4,
      state: "failed",
      reasonCode: "REPLAN_FAILED",
      acceptedCommandId: accepted.commandId,
    });
    const failedRef = { kind: "intervention" as const, id: failed.interventionId, revision: 4 };
    const finalContext = TaskBusinessContextSchema.parse({
      ...current,
      contextRevision: 4,
      activeRefs: { route: routeRef },
      interventionRefs: [failedRef],
    });
    const rejected = BusinessCommandRecordSchema.parse({
      ...accepted,
      state: "rejected",
      resultCode: "REPLAN_FAILED",
      updatedAt: later,
    });
    const finalChange = {
      scope,
      expectedContextRevision: 3 as const,
      context: finalContext,
      objects: [{ kind: "intervention" as const, value: failed }],
      command: rejected,
    };
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 3,
        context: finalContext,
        objects: [{ kind: "intervention", value: failed }],
      }),
    ).rejects.toThrow("BUSINESS_INTERVENTION_REJECTED_FACTS_INCOMPLETE");
    await expect(
      store.commitChangeSet({
        ...finalChange,
        context: TaskBusinessContextSchema.parse({
          ...finalContext,
          effectivePlanRevision: current.effectivePlanRevision + 1,
        }),
      }),
    ).rejects.toThrow("BUSINESS_INTERVENTION_REJECTED_FACTS_INCOMPLETE");
    const otherRoute = TaskArtifactSchema.parse({ ...route, revision: 2 });
    const otherRouteRef = { kind: "artifact" as const, id: route.artifactId, revision: 2 };
    await expect(
      store.commitChangeSet({
        ...finalChange,
        context: TaskBusinessContextSchema.parse({
          ...finalContext,
          activeRefs: { route: otherRouteRef },
          artifactRefs: [routeRef, otherRouteRef],
        }),
        objects: [...finalChange.objects, { kind: "artifact", value: otherRoute }],
      }),
    ).rejects.toThrow("BUSINESS_INTERVENTION_REJECTED_FACTS_INCOMPLETE");
    await expect(store.commitChangeSet(finalChange)).rejects.toThrow(
      "BUSINESS_INTERVENTION_PUBLIC_EVENT_REQUIRED",
    );
    const event = (kind: string, payload: unknown) => ({
      body: TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind,
        contextRevision: finalContext.contextRevision,
        providerRecordedAt: later,
        payload,
      }),
      description: "Synthetic replan failure",
      reasonCode: "REPLAN_FAILED",
      severityHint: "warning" as const,
    });
    const metadata = event("BUSINESS_EVENT", {
      eventType: "business.plan_failed",
      severity: "warning",
      reasonCode: "REPLAN_FAILED",
      description: "Synthetic replan failure",
      contextDelta: {
        activeRefs: finalContext.activeRefs,
        effectivePlanRevision: finalContext.effectivePlanRevision,
      },
    });
    const changed = event("INTERVENTION_CHANGED", {
      change: "update",
      interventionRef: failedRef,
      previousRevision: 3,
      reasonCode: "REPLAN_FAILED",
    });
    await expect(store.commitBusinessChangeSet(finalChange, [metadata])).rejects.toThrow(
      "BUSINESS_INTERVENTION_PUBLIC_EVENT_REQUIRED",
    );
    await expect(
      store.commitBusinessChangeSet(finalChange, [
        metadata,
        event("INTERVENTION_CHANGED", {
          change: "create",
          interventionRef: failedRef,
          reasonCode: "REPLAN_FAILED",
        }),
      ]),
    ).rejects.toThrow("BUSINESS_INTERVENTION_PUBLIC_EVENT_REQUIRED");
    await expect(
      store.commitBusinessChangeSet(finalChange, [
        metadata,
        event("INTERVENTION_CHANGED", {
          change: "update",
          interventionRef: failedRef,
          previousRevision: 2,
          reasonCode: "REPLAN_FAILED",
        }),
      ]),
    ).rejects.toThrow("BUSINESS_INTERVENTION_PUBLIC_EVENT_REQUIRED");
    const committed = await store.commitBusinessChangeSet(finalChange, [metadata, changed]);
    expect(committed.events).toHaveLength(2);
    const sourceRows = await pool.query<{ source_event_id: string }>(
      `SELECT source_event_id FROM ugv_business_event_source_log
       WHERE source_id='vehicle.business' AND source_event_id = ANY($1::text[])`,
      [committed.events.map((item) => item.sourceEventId)],
    );
    expect(sourceRows.rows.map((row) => row.source_event_id).sort()).toEqual(
      committed.events.map((item) => item.sourceEventId).sort(),
    );
    let readModel = bootstrapTaskBusinessReducer(
      [
        {
          contextRevision: before.context.contextRevision,
          context: before.context,
          objects: before.objects,
          objectDescriptors: [],
        },
      ],
      { streamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1111", afterSequence: "20" },
    );
    for (const [index, sourceEvent] of committed.events.entries()) {
      readModel = reduceTaskBusinessFeedback(
        readModel,
        normalizeTaskBusinessSseNotification(
          {
            method: "notifications/io.sdar/businessEvents",
            params: {
              streamId: "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1111",
              sequence: String(21 + index),
              eventId: `public-failed-${index}`,
              sourceId: "vehicle.business",
              sourceStreamId: sourceEvent.sourceStreamId,
              sourceSequence: sourceEvent.sourceSequence,
              sourceEventId: sourceEvent.sourceEventId,
              eventType: sourceEvent.eventType,
              scope: "task",
              taskId: scope.taskId,
              occurredAt: later,
              rawPayload: protoStructToJson(sourceEvent.rawPayload),
            },
          },
          identity,
        ),
      );
    }
    expect(readModel.context.effectivePlanRevision).toBe(context.effectivePlanRevision);
    expect(readModel.context.activeRefs).toEqual({ route: routeRef });
    expect(readModel.context.interventionRefs).toEqual([failedRef]);
    expect(unresolvedTaskBusinessRefs(readModel)).toEqual([failedRef]);
    expect(await store.getCommand(scope, accepted.commandId)).toEqual(rejected);
    expect(await store.claimCommand(scope, accepted)).toEqual({ claimed: false, record: rejected });
  });

  it("serializes two different accepted plan adjustments across PostgreSQL Store instances", async () => {
    const scope = BoundExecutionScope.fromExecution({
      ...execution(),
      taskId: "task-adjustment-single-flight",
      externalExecutionId: "execution-adjustment-single-flight",
    });
    const identity = {
      ...catalog.context.identity,
      taskId: scope.taskId,
      executionId: scope.executionId,
    };
    const command = BusinessCommandRecordSchema.parse({
      commandId: "adjustment-a",
      commandType: "intervention",
      entryKey: "intervention:one",
      runtimeCommandSequence: "71",
      identity,
      requestHash: "d".repeat(64),
      state: "accepted",
      createdAt: at,
      updatedAt: at,
    });
    const second = BusinessCommandRecordSchema.parse({
      ...command,
      commandId: "adjustment-b",
      entryKey: "intervention:two",
      runtimeCommandSequence: "72",
    });
    const firstStore = new PostgresTaskBusinessStore(pool);
    const secondStore = new PostgresTaskBusinessStore(pool);
    const routeCatalog = catalog.artifacts.find((item) => item.artifactId === "route-line");
    if (!routeCatalog) throw new Error("CATALOG_ROUTE_MISSING");
    const route = TaskArtifactSchema.parse({ ...routeCatalog, identity });
    const routeRef = { kind: "artifact" as const, id: route.artifactId, revision: 1 };
    const firstEntry = RuntimeInterventionSchema.parse({
      ...catalog.intervention,
      identity,
      interventionId: "one",
    });
    const secondEntry = RuntimeInterventionSchema.parse({
      ...catalog.intervention,
      identity,
      interventionId: "two",
    });
    const firstRef = { kind: "intervention" as const, id: "one", revision: 1 };
    const secondRef = { kind: "intervention" as const, id: "two", revision: 1 };
    const context = TaskBusinessContextSchema.parse({
      ...catalog.context,
      identity,
      contextRevision: 1,
      activeRefs: { route: routeRef, intervention: firstRef, alternateIntervention: secondRef },
      artifactRefs: [routeRef],
      actionRefs: [],
      requiredInputRefs: [],
      interventionRefs: [firstRef, secondRef],
    });
    await firstStore.commitChangeSet({
      scope,
      expectedContextRevision: null,
      context,
      objects: [
        { kind: "artifact", value: route },
        { kind: "intervention", value: firstEntry },
        { kind: "intervention", value: secondEntry },
      ],
    });
    const outcomes = await Promise.allSettled([
      firstStore.claimCommand(scope, command),
      secondStore.claimCommand(scope, second),
    ]);
    const winners = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const losers = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]?.status === "rejected" && losers[0].reason).toMatchObject({
      message: "BUSINESS_CHANGE_IN_PROGRESS",
    });
    const winner = winners[0];
    if (winner?.status !== "fulfilled") throw new Error("ADJUSTMENT_WINNER_MISSING");
    const retry = winner.value.record;
    expect((await secondStore.claimCommand(scope, retry)).claimed).toBe(false);
    const winnerId = retry.entryKey?.slice("intervention:".length);
    if (winnerId !== "one" && winnerId !== "two") throw new Error("ADJUSTMENT_ENTRY_MISSING");
    const withdrawn = RuntimeInterventionSchema.parse({
      ...(winnerId === "one" ? firstEntry : secondEntry),
      revision: 2,
      state: "withdrawn",
      reasonCode: "ADMISSION_REJECTED",
      acceptedCommandId: retry.commandId,
    });
    const withdrawnRef = { kind: "intervention" as const, id: winnerId, revision: 2 };
    const activeRefs = Object.fromEntries(
      Object.entries(context.activeRefs).filter(
        ([, ref]) => ref.kind !== "intervention" || ref.id !== winnerId,
      ),
    );
    const terminalContext = TaskBusinessContextSchema.parse({
      ...context,
      contextRevision: 2,
      activeRefs,
      interventionRefs: context.interventionRefs.map((ref) =>
        ref.id === winnerId ? withdrawnRef : ref,
      ),
    });
    const event = (kind: string, payload: unknown) => ({
      body: TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind,
        contextRevision: terminalContext.contextRevision,
        providerRecordedAt: later,
        payload,
      }),
      description: "Synthetic admission rejection",
      reasonCode: "ADMISSION_REJECTED",
      severityHint: "warning" as const,
    });
    await firstStore.commitBusinessChangeSet(
      {
        scope,
        expectedContextRevision: 1,
        context: terminalContext,
        objects: [{ kind: "intervention", value: withdrawn }],
        command: BusinessCommandRecordSchema.parse({
          ...retry,
          state: "rejected",
          resultCode: "ADMISSION_REJECTED",
          updatedAt: later,
        }),
      },
      [
        event("BUSINESS_EVENT", {
          eventType: "business.plan_rejected",
          severity: "warning",
          reasonCode: "ADMISSION_REJECTED",
          description: "Synthetic admission rejection",
          contextDelta: {
            activeRefs: terminalContext.activeRefs,
            effectivePlanRevision: terminalContext.effectivePlanRevision,
          },
        }),
        event("INTERVENTION_CHANGED", {
          change: "update",
          interventionRef: withdrawnRef,
          previousRevision: 1,
          reasonCode: "ADMISSION_REJECTED",
        }),
      ],
    );
    const loser = retry.commandId === command.commandId ? second : command;
    expect((await secondStore.claimCommand(scope, loser)).claimed).toBe(true);
  });

  it("rechecks effective plan revision in the PostgreSQL intervention claim transaction", async () => {
    const scope = BoundExecutionScope.fromExecution({
      ...execution(),
      taskId: "task-adjustment-plan-revision",
      externalExecutionId: "execution-adjustment-plan-revision",
    });
    const identity = {
      ...catalog.context.identity,
      taskId: scope.taskId,
      executionId: scope.executionId,
    };
    const route = catalog.artifacts.find((item) => item.artifactId === "route-line");
    if (!route) throw new Error("CATALOG_ROUTE_MISSING");
    const routeRef = { kind: "artifact" as const, id: route.artifactId, revision: 1 };
    const intervention = RuntimeInterventionSchema.parse({ ...catalog.intervention, identity });
    const interventionRef = {
      kind: "intervention" as const,
      id: intervention.interventionId,
      revision: 1,
    };
    const context = TaskBusinessContextSchema.parse({
      ...catalog.context,
      identity,
      contextRevision: 1,
      activeRefs: { route: routeRef, intervention: interventionRef },
      artifactRefs: [routeRef],
      actionRefs: [],
      requiredInputRefs: [],
      interventionRefs: [interventionRef],
    });
    const store = new PostgresTaskBusinessStore(pool);
    await store.commitChangeSet({
      scope,
      expectedContextRevision: null,
      context,
      objects: [
        { kind: "artifact", value: TaskArtifactSchema.parse({ ...route, identity }) },
        { kind: "intervention", value: intervention },
      ],
    });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: TaskBusinessContextSchema.parse({
        ...context,
        contextRevision: 2,
      }),
      objects: [],
    });
    const command = BusinessCommandRecordSchema.parse({
      commandId: "stale-plan-adjustment",
      commandType: "intervention",
      entryKey: `intervention:${intervention.interventionId}`,
      runtimeCommandSequence: "73",
      identity,
      requestHash: "d".repeat(64),
      state: "accepted",
      createdAt: at,
      updatedAt: at,
    });
    await expect(store.claimCommand(scope, command, interventionRef, undefined, 1)).rejects.toThrow(
      "CONTEXT_REVISION_CONFLICT",
    );
    expect(await store.getCommand(scope, command.commandId)).toBeUndefined();
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 2,
      context: TaskBusinessContextSchema.parse({
        ...context,
        contextRevision: 3,
        effectivePlanRevision: context.effectivePlanRevision + 1,
      }),
      objects: [],
    });
    await expect(store.claimCommand(scope, command, interventionRef)).rejects.toThrow(
      "PLAN_REVISION_CONFLICT",
    );
    expect(await store.getCommand(scope, command.commandId)).toBeUndefined();
  });

  it("fences competing semantic entries and Runtime command sequences across Store instances", async () => {
    const scope = BoundExecutionScope.fromExecution({
      ...execution(),
      taskId: "task-command-fence",
      externalExecutionId: "execution-command-fence",
    });
    const identity = {
      ...catalog.context.identity,
      taskId: scope.taskId,
      executionId: scope.executionId,
    };
    const command = BusinessCommandRecordSchema.parse({
      commandId: "fence-command-a",
      commandType: "input_response",
      entryKey: "input:request-key-a",
      runtimeCommandSequence: "42",
      identity,
      requestHash: "d".repeat(64),
      responseHash: taskBusinessInputResponseHash({ action: "decline" }),
      state: "accepted",
      createdAt: at,
      updatedAt: at,
    });
    const first = new PostgresTaskBusinessStore(pool);
    const second = new PostgresTaskBusinessStore(pool);
    const results = await Promise.allSettled([
      first.claimCommand(scope, command),
      second.claimCommand(scope, {
        ...command,
        commandId: "fence-command-b",
        runtimeCommandSequence: "43",
      }),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
    const winner = results.find((item) => item.status === "fulfilled");
    if (winner?.status !== "fulfilled") throw new Error("COMMAND_WINNER_MISSING");
    expect((await first.claimCommand(scope, winner.value.record)).claimed).toBe(false);
    await expect(
      first.claimCommand(scope, {
        ...winner.value.record,
        commandId: "fence-command-c",
        entryKey: "input:request-key-c",
      }),
    ).rejects.toThrow("RUNTIME_COMMAND_SEQUENCE_CONFLICT");
    const otherScope = BoundExecutionScope.fromExecution({
      ...execution(),
      taskId: scope.taskId,
      externalExecutionId: scope.executionId,
      executionContext: { ...execution().executionContext, simulationId: "scene-b" },
    });
    expect((await second.claimCommand(otherScope, command)).claimed).toBe(true);
  });

  it("rechecks the active Input revision inside the PostgreSQL command claim transaction", async () => {
    const run = {
      ...execution(),
      executionContext: { ...execution().executionContext, simulationId: "scene-claim-guard" },
    };
    const scope = BoundExecutionScope.fromExecution(run);
    const store = new PostgresTaskBusinessStore(pool);
    const route = catalog.artifacts.find((item) => item.artifactId === "route-line");
    if (!route) throw new Error("CATALOG_ROUTE_MISSING");
    const pending = RequiredInputSchema.parse({
      ...catalog.requiredInput,
      deadlineAt: "2100-01-01T00:00:00Z",
    });
    const context = TaskBusinessContextSchema.parse({ ...catalog.context, contextRevision: 1 });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: null,
      context,
      objects: [
        { kind: "artifact", value: route },
        { kind: "action", value: catalog.action },
        { kind: "input_request", value: pending },
        { kind: "intervention", value: catalog.intervention },
      ],
    });
    const inputRef = context.requiredInputRefs[0];
    if (!inputRef) throw new Error("INPUT_REF_MISSING");
    const unrelated = TaskBusinessContextSchema.parse({ ...context, contextRevision: 2 });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: unrelated,
      objects: [],
    });
    const command = BusinessCommandRecordSchema.parse({
      commandId: "pg-claim-before-invalidation",
      commandType: "input_response",
      entryKey: `input:${catalog.requiredInput.requestKey}`,
      runtimeCommandSequence: "81",
      identity: context.identity,
      requestHash: "a".repeat(64),
      responseHash: taskBusinessInputResponseHash({ action: "decline" }),
      state: "accepted",
      createdAt: at,
      updatedAt: at,
    });
    expect((await store.claimCommand(scope, command, inputRef)).claimed).toBe(true);
    const cancelled = RequiredInputSchema.parse({
      ...pending,
      revision: 2,
      state: "cancelled",
      resolvedAt: later,
    });
    const cancelledRef = { kind: "input_request" as const, id: cancelled.requestId, revision: 2 };
    await store.commitChangeSet({
      scope,
      expectedContextRevision: 2,
      context: TaskBusinessContextSchema.parse({
        ...unrelated,
        contextRevision: 3,
        requiredInputRefs: [...unrelated.requiredInputRefs, cancelledRef],
        activeRefs: { ...unrelated.activeRefs, input: cancelledRef },
      }),
      objects: [{ kind: "input_request", value: cancelled }],
    });
    const stale = {
      ...command,
      commandId: "pg-claim-after-invalidation",
      runtimeCommandSequence: "82",
    };
    await expect(store.claimCommand(scope, stale, inputRef)).rejects.toThrow(
      "BUSINESS_ENTRY_NOT_CURRENT",
    );
    expect(await store.getCommand(scope, stale.commandId)).toBeUndefined();
  });

  it("uses database time to reject expired Input and Intervention claims atomically", async () => {
    const run = {
      ...execution(),
      executionContext: { ...execution().executionContext, simulationId: "scene-expired-entry" },
    };
    const scope = BoundExecutionScope.fromExecution(run);
    const store = new PostgresTaskBusinessStore(pool);
    const route = catalog.artifacts.find((item) => item.artifactId === "route-line");
    if (!route) throw new Error("CATALOG_ROUTE_MISSING");
    const intervention = RuntimeInterventionSchema.parse({
      ...catalog.intervention,
      validUntil: "2026-09-24T00:00:00Z",
    });
    const context = TaskBusinessContextSchema.parse({ ...catalog.context, contextRevision: 1 });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: null,
      context,
      objects: [
        { kind: "artifact", value: route },
        { kind: "action", value: catalog.action },
        { kind: "input_request", value: catalog.requiredInput },
        { kind: "intervention", value: intervention },
      ],
    });
    const inputRef = context.requiredInputRefs[0];
    const interventionRef = context.interventionRefs[0];
    if (!inputRef || !interventionRef) throw new Error("ENTRY_REF_MISSING");
    const command = BusinessCommandRecordSchema.parse({
      commandId: "pg-expired-input",
      commandType: "input_response",
      entryKey: `input:${catalog.requiredInput.requestKey}`,
      runtimeCommandSequence: "83",
      identity: context.identity,
      requestHash: "a".repeat(64),
      responseHash: taskBusinessInputResponseHash({ action: "decline" }),
      state: "accepted",
      createdAt: at,
      updatedAt: at,
    });
    await expect(store.claimCommand(scope, command, inputRef)).rejects.toThrow(
      "INPUT_DEADLINE_EXPIRED",
    );
    expect(await store.getCommand(scope, command.commandId)).toBeUndefined();
    const adjustment = BusinessCommandRecordSchema.parse({
      commandId: "pg-expired-intervention",
      commandType: "intervention",
      entryKey: `intervention:${intervention.interventionId}`,
      runtimeCommandSequence: "84",
      identity: context.identity,
      requestHash: "a".repeat(64),
      state: "accepted",
      createdAt: at,
      updatedAt: at,
    });
    await expect(store.claimCommand(scope, adjustment, interventionRef)).rejects.toThrow(
      "INTERVENTION_EXPIRED",
    );
    expect(await store.getCommand(scope, adjustment.commandId)).toBeUndefined();
  });

  it("commits two business source events with one Context revision and rolls back failed source writes", async () => {
    const sourceStore = new PostgresProviderStore(scopedUrl.toString(), 4, "ugv");
    try {
      const store = new PostgresTaskBusinessStore(sourceStore.pool);
      const scope = BoundExecutionScope.fromExecution({
        ...execution(),
        taskId: "task-atomic-business",
        externalExecutionId: "execution-atomic-business",
      });
      const context = TaskBusinessContextSchema.parse({
        ...catalog.context,
        identity: {
          ...catalog.context.identity,
          taskId: scope.taskId,
          executionId: scope.executionId,
        },
        contextRevision: 1,
        activeRefs: {},
        artifactRefs: [],
        actionRefs: [],
        requiredInputRefs: [],
        interventionRefs: [],
      });
      const feedback = (eventType: string, contextRevision: number) => ({
        body: TaskBusinessFeedbackBodySchema.parse({
          schemaVersion: "sdar.task-business-feedback/1.0-rc2",
          kind: "BUSINESS_EVENT",
          contextRevision,
          providerRecordedAt: later,
          payload: { eventType, severity: "info", reasonCode: "TEST", description: eventType },
        }),
        description: eventType,
        reasonCode: "TEST",
        severityHint: "info" as const,
      });
      expect(
        sourceStore.businessEventSources().some((source) => source.sourceId === "vehicle.business"),
      ).toBe(false);
      sourceStore.enableTaskBusinessSource(store);
      const source = sourceStore
        .businessEventSources()
        .find((item) => item.sourceId === "vehicle.business");
      if (!source) throw new Error("BUSINESS_SOURCE_MISSING");
      const before = await sourceStore.replayBusinessEvents(
        "vehicle.business",
        source.sourceStreamId,
        0n,
      );
      const beforeSequence = BigInt(before.at(-1)?.sourceSequence ?? "0");
      const hub = new VehicleBusinessEventHub(sourceStore, {
        reasonPrefix: "UGV",
        resourceId: scope.resourceId,
      });
      const notified: string[] = [];
      const unsubscribe = hub.subscribe("vehicle.business", (event) =>
        notified.push(event.sourceEventId),
      );
      const committed = await store.commitBusinessChangeSet(
        { scope, expectedContextRevision: null, context, objects: [] },
        [feedback("test.first", 1), feedback("test.second", 1)],
      );
      expect(committed.events.map((event) => event.sourceSequence)).toEqual([
        String(beforeSequence + 1n),
        String(beforeSequence + 2n),
      ]);
      expect(new Set(committed.events.map((event) => event.sourceEventId)).size).toBe(2);
      expect((await store.getContext(scope))?.contextRevision).toBe(1);
      expect(
        await sourceStore.replayBusinessEvents("vehicle.business", source.sourceStreamId, 0n),
      ).toHaveLength(before.length + 2);

      const finalized = TaskBusinessContextSchema.parse({
        ...context,
        contextRevision: 2,
        summary: { status: "finalized", resultCode: "COMPLETED" },
        activeRefs: {},
        updatedAt: later,
        finalizedAt: later,
      });
      await expect(
        store.commitBusinessChangeSet(
          { scope, expectedContextRevision: 1, context: finalized, objects: [] },
          [
            {
              body: TaskBusinessFeedbackBodySchema.parse({
                schemaVersion: "sdar.task-business-feedback/1.0-rc2",
                kind: "CONTEXT_FINALIZED",
                contextRevision: 2,
                providerRecordedAt: later,
                payload: {
                  reasonCode: "COMPLETED",
                  finalContextRevision: 2,
                  summary: finalized.summary,
                  artifactRefs: finalized.artifactRefs,
                  actionRefs: finalized.actionRefs,
                  finalizedAt: at,
                },
              }),
              description: "Context finalized",
              reasonCode: "COMPLETED",
              severityHint: "info",
            },
          ],
        ),
      ).rejects.toThrow("BUSINESS_EVENT_FINALIZATION_MISMATCH");
      expect((await store.getContext(scope))?.contextRevision).toBe(1);
      expect(
        await sourceStore.replayBusinessEvents("vehicle.business", source.sourceStreamId, 0n),
      ).toHaveLength(before.length + 2);
      for (const event of committed.events) hub.notifyCommittedTaskBusinessEvent(event);
      expect(notified).toEqual(committed.events.map((event) => event.sourceEventId));
      expect(
        await sourceStore.replayBusinessEvents("vehicle.business", source.sourceStreamId, 0n),
      ).toHaveLength(before.length + 2);

      await sourceStore.pool.query(`CREATE FUNCTION reject_business_source_test() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SOURCE_INSERT_REJECTED'; END $$`);
      await sourceStore.pool.query(`CREATE TRIGGER reject_business_source_test
        BEFORE INSERT ON ugv_business_event_source_log
        FOR EACH ROW EXECUTE FUNCTION reject_business_source_test()`);
      const next = TaskBusinessContextSchema.parse({ ...context, contextRevision: 2 });
      await expect(
        store.commitBusinessChangeSet(
          { scope, expectedContextRevision: 1, context: next, objects: [] },
          [feedback("test.rejected", 2)],
        ),
      ).rejects.toThrow("SOURCE_INSERT_REJECTED");
      expect((await store.getContext(scope))?.contextRevision).toBe(1);
      expect(
        await sourceStore.replayBusinessEvents("vehicle.business", source.sourceStreamId, 0n),
      ).toHaveLength(before.length + 2);
      await sourceStore.pool.query(
        "DROP TRIGGER reject_business_source_test ON ugv_business_event_source_log",
      );
      await sourceStore.pool.query("DROP FUNCTION reject_business_source_test()");
      const resumed = await store.commitBusinessChangeSet(
        { scope, expectedContextRevision: 1, context: next, objects: [] },
        [feedback("test.resumed", 2)],
      );
      expect(resumed.events[0]?.sourceSequence).toBe(String(beforeSequence + 3n));
      unsubscribe();
    } finally {
      await sourceStore.close();
    }
  });
  it("persists a same-phase recon status clock without inventing a public event", async () => {
    const run: ProviderExecution = {
      ...execution(),
      taskId: `task-recon-clock-${randomUUID()}`,
      externalExecutionId: `execution-recon-clock-${randomUUID()}`,
      operationName: "vehicle_area_recon",
      arguments: {
        resourceId: "vehicle:ugv1",
        scanMode: "area",
        area: {
          polygon: [
            { longitude: 116, latitude: 39 },
            { longitude: 117, latitude: 39 },
            { longitude: 117, latitude: 40 },
          ],
        },
      },
      taskBusinessContextExpected: true,
      downstreamMissionIds: ["1"],
      createdAt: at,
      updatedAt: at,
    };
    const store = new PostgresTaskBusinessStore(pool);
    const notified: AdapterBusinessEvent[] = [];
    const service = new UgvTaskBusinessContextService(
      { getExecution: async () => run },
      store,
      run.providerId ?? "isr.vehicle.ugv.ugv1",
      run.resourceId,
      (event) => notified.push(event),
    );
    await service.ensureForCreatedExecution(run.taskId);
    const recon = new ReconBusinessProcessor(store, (event) => notified.push(event));
    const status = (cursor: string, second: number, motionStatus: 5 | 6) => ({
      schemaVersion: "ugv.recon-status-fact/1",
      missionId: "1",
      sourceCursor: cursor,
      observedAt: `2026-09-23T00:00:0${second}Z`,
      motionStatus,
    });
    expect(await recon.applyStatus(run, status("status-1", 1, 5))).toBe("committed");
    const firstEventCount = notified.length;
    expect(await recon.applyStatus(run, status("status-3", 3, 5))).toBe("committed");
    expect(notified).toHaveLength(firstEventCount);
    expect(await recon.applyStatus(run, status("status-2", 2, 6))).toBe("duplicate");
    expect(await recon.applyStatus(run, status("status-3-tie", 3, 6))).toBe("duplicate");
    const reopened = new PostgresTaskBusinessStore(pool);
    expect(await reopened.getContext(BoundExecutionScope.fromExecution(run))).toMatchObject({
      contextRevision: 3,
      phase: { code: "recon.motion.5", since: "2026-09-23T00:00:01Z" },
      summary: { properties: { reconStatusObservedAt: "2026-09-23T00:00:03Z" } },
    });
    const coverage = (cursor: string, second: number, coveragePercent: number) => ({
      schemaVersion: "ugv.recon-coverage-fact/1",
      missionId: "1",
      sourceCursor: cursor,
      observedAt: `2026-09-23T00:00:0${second}Z`,
      coverage: { coveragePercent },
    });
    expect(await recon.applyCoverage(run, coverage("coverage-5", 5, 20))).toBe("committed");
    const scope = BoundExecutionScope.fromExecution(run);
    const firstCoverage = await reopened.getContext(scope);
    const firstArtifact = await reopened.getArtifactLatest(scope, "recon-covered-area");
    const coverageEventCount = notified.length;
    expect(await recon.applyCoverage(run, coverage("coverage-5-tie", 5, 30))).toBe("duplicate");
    expect(await reopened.getContext(scope)).toEqual(firstCoverage);
    expect(await reopened.getArtifactLatest(scope, "recon-covered-area")).toEqual(firstArtifact);
    expect(notified).toHaveLength(coverageEventCount);
    expect(await recon.applyCoverage(run, coverage("coverage-6", 6, 30))).toBe("committed");
    expect(await reopened.getContext(scope)).toMatchObject({
      summary: { properties: { reconCoverage: { coveragePercent: 30 } } },
    });
  });

  it("persists the native lock source clock through silent phase updates and release", async () => {
    const run: ProviderExecution = {
      ...execution(),
      taskId: `task-native-lock-clock-${randomUUID()}`,
      externalExecutionId: `execution-native-lock-clock-${randomUUID()}`,
      operationName: "vehicle_area_recon",
      arguments: { resourceId: "vehicle:ugv1", scanMode: "circular" },
      taskBusinessContextExpected: true,
      downstreamMissionIds: ["1"],
      createdAt: at,
      updatedAt: at,
    };
    const store = new PostgresTaskBusinessStore(pool);
    const notified: AdapterBusinessEvent[] = [];
    await new UgvTaskBusinessContextService(
      { getExecution: async () => run },
      store,
      run.providerId ?? "isr.vehicle.ugv.ugv1",
      run.resourceId,
      (event) => notified.push(event),
    ).ensureForCreatedExecution(run.taskId);
    const lock = new NativeLockBusinessProcessor(store, (event) => notified.push(event));
    const fact = (cursor: string, second: number, stage: 1 | 2 | 3) => ({
      schemaVersion: "ugv.recon-native-lock-fact/1",
      missionId: "1",
      sourceCursor: cursor,
      observedAt: `2026-09-23T00:00:0${second}Z`,
      stage,
      ...(stage === 1 ? {} : { targetId: "7" }),
      motionStatus: 5,
    });
    expect(await lock.apply(run, fact("lock-1", 1, 2))).toBe("committed");
    const firstEventCount = notified.length;
    expect(await lock.apply(run, fact("lock-3", 3, 2))).toBe("committed");
    expect(notified).toHaveLength(firstEventCount);
    expect(await lock.apply(run, fact("lock-2", 2, 3))).toBe("duplicate");
    expect(await lock.apply(run, fact("release-4", 4, 1))).toBe("committed");
    const scope = BoundExecutionScope.fromExecution(run);
    const reopened = new PostgresTaskBusinessStore(pool);
    expect(await reopened.getContext(scope)).toMatchObject({
      summary: { properties: { nativeLockObservedAt: "2026-09-23T00:00:04Z" } },
    });
    const afterRelease = await reopened.getContext(scope);
    expect(afterRelease?.activeRefs["visualLock:1"]).toBeUndefined();
    expect(
      await lock.apply(run, {
        ...fact("lock-3.5", 3, 3),
        observedAt: "2026-09-23T00:00:03.500Z",
      }),
    ).toBe("duplicate");
    expect(await reopened.getContext(scope)).toEqual(afterRelease);
  });

  it("persists an initial scanning lock clock before any Action", async () => {
    const run: ProviderExecution = {
      ...execution(),
      taskId: `task-native-initial-scan-${randomUUID()}`,
      externalExecutionId: `execution-native-initial-scan-${randomUUID()}`,
      operationName: "vehicle_area_recon",
      arguments: { resourceId: "vehicle:ugv1", scanMode: "circular" },
      taskBusinessContextExpected: true,
      downstreamMissionIds: ["1"],
      createdAt: at,
      updatedAt: at,
    };
    const store = new PostgresTaskBusinessStore(pool);
    const notified: AdapterBusinessEvent[] = [];
    await new UgvTaskBusinessContextService(
      { getExecution: async () => run },
      store,
      run.providerId ?? "isr.vehicle.ugv.ugv1",
      run.resourceId,
      (event) => notified.push(event),
    ).ensureForCreatedExecution(run.taskId);
    const scope = BoundExecutionScope.fromExecution(run);
    const initialEventCount = notified.length;
    const stage = (cursor: string, second: number, stage: 1 | 2 | 3 | 4) => ({
      schemaVersion: "ugv.recon-native-lock-fact/1",
      missionId: "1",
      sourceCursor: cursor,
      observedAt: `2026-09-23T00:00:0${second}Z`,
      stage,
      ...(stage === 3 ? { targetId: "7" } : {}),
      motionStatus: 5,
    });
    expect(
      await new NativeLockBusinessProcessor(store, (event) => notified.push(event)).apply(
        run,
        stage("scan-4", 4, 1),
      ),
    ).toBe("committed");
    expect(notified).toHaveLength(initialEventCount);
    const reopened = new PostgresTaskBusinessStore(pool);
    const projector = new NativeLockBusinessProcessor(reopened, (event) => notified.push(event));
    const scanned = await reopened.getContext(scope);
    expect(scanned?.summary.properties).toMatchObject({
      nativeLockObservedAt: "2026-09-23T00:00:04Z",
    });
    expect(scanned?.actionRefs).toHaveLength(0);
    expect(await projector.apply(run, stage("lock-2", 2, 3))).toBe("duplicate");
    expect(await reopened.getContext(scope)).toEqual(scanned);
    expect(await projector.apply(run, stage("lock-5", 5, 3))).toBe("committed");
    expect((await reopened.getContext(scope))?.actionRefs).toHaveLength(1);
    expect(notified).toHaveLength(initialEventCount + 1);
    expect(await projector.apply(run, stage("unqualified-7", 7, 4))).toBe("committed");
    const afterUnqualified = await new PostgresTaskBusinessStore(pool).getContext(scope);
    expect(afterUnqualified?.summary.properties).toMatchObject({
      nativeLockObservedAt: "2026-09-23T00:00:07Z",
    });
    expect(afterUnqualified?.activeRefs["visualLock:1"]).toBeDefined();
    expect(notified).toHaveLength(initialEventCount + 1);
    expect(await projector.apply(run, stage("lock-6", 6, 3))).toBe("duplicate");
    expect(await projector.apply(run, stage("lock-7-tie", 7, 3))).toBe("duplicate");
    expect(await reopened.getContext(scope)).toEqual(afterUnqualified);
    expect(await projector.apply(run, stage("targetless-8", 8, 2))).toBe("committed");
    const afterTargetless = await new PostgresTaskBusinessStore(pool).getContext(scope);
    expect(afterTargetless?.summary.properties).toMatchObject({
      nativeLockObservedAt: "2026-09-23T00:00:08Z",
    });
    expect(afterTargetless?.activeRefs["visualLock:1"]).toEqual(
      afterUnqualified?.activeRefs["visualLock:1"],
    );
    expect(notified).toHaveLength(initialEventCount + 1);
    expect(await projector.apply(run, stage("lock-7.5", 7, 3))).toBe("duplicate");
    expect(await projector.apply(run, stage("scan-8-tie", 8, 1))).toBe("duplicate");
    expect(await reopened.getContext(scope)).toEqual(afterTargetless);
  });

  it("retains the newest microsecond target capture across Store instances", async () => {
    const run: ProviderExecution = {
      ...execution(),
      taskId: `task-target-capture-${randomUUID()}`,
      externalExecutionId: `execution-target-capture-${randomUUID()}`,
      operationName: "vehicle_area_recon",
      arguments: { resourceId: "vehicle:ugv1", scanMode: "circular" },
      taskBusinessContextExpected: true,
      downstreamMissionIds: ["1"],
      createdAt: at,
      updatedAt: at,
    };
    const store = new PostgresTaskBusinessStore(pool);
    const notified: AdapterBusinessEvent[] = [];
    await new UgvTaskBusinessContextService(
      { getExecution: async () => run },
      store,
      run.providerId ?? "isr.vehicle.ugv.ugv1",
      run.resourceId,
      (event) => notified.push(event),
    ).ensureForCreatedExecution(run.taskId);
    const captureUs = Date.parse("2026-09-23T00:00:02Z") * 1000;
    const fact = (offsetUs: number) => ({
      schemaVersion: "ugv.recon-target-fact/1",
      missionId: "1",
      observationSessionId: "1",
      sensorId: "ugv.area_recon.targets",
      sourceTargetId: "7",
      sourceRevision: String(captureUs + offsetUs),
      observedAt: "2026-09-23T00:00:02Z",
      visibility: "visible" as const,
      trackingState: "unknown" as const,
      location: { longitude: 116, latitude: 39 },
    });
    expect(
      await new TargetBusinessProcessor(store, (event) => notified.push(event)).apply(
        run,
        fact(900),
      ),
    ).toBe("committed");
    const reopened = new PostgresTaskBusinessStore(pool);
    const projector = new TargetBusinessProcessor(reopened, (event) => notified.push(event));
    const scope = BoundExecutionScope.fromExecution(run);
    const prior = await reopened.getContext(scope);
    const targetRef = prior?.artifactRefs.find((ref) => ref.id.startsWith("target-"));
    const firstArtifact = await reopened.getArtifactLatest(scope, targetRef?.id ?? "");
    const eventCount = notified.length;
    expect(
      await projector.apply(run, {
        ...fact(100),
        visibility: "lost",
        location: undefined,
      }),
    ).toBe("duplicate");
    expect(await reopened.getContext(scope)).toEqual(prior);
    expect(await reopened.getArtifactLatest(scope, targetRef?.id ?? "")).toEqual(firstArtifact);
    expect(notified).toHaveLength(eventCount);
    expect(await projector.apply(run, { ...fact(950), confidence: 0.8 })).toBe("committed");
    expect(await reopened.getArtifactLatest(scope, targetRef?.id ?? "")).toMatchObject({
      revision: 2,
      properties: { visibility: "visible", confidence: 0.8 },
    });
  });

  it("retains observed trajectory versions and terminal summary across Store instances", async () => {
    const run: ProviderExecution = {
      ...execution(),
      taskId: `task-trajectory-${randomUUID()}`,
      externalExecutionId: `execution-trajectory-${randomUUID()}`,
      operationName: "vehicle_navigate",
      arguments: {
        resourceId: "vehicle:ugv1",
        mission: { type: "point", target: { longitude: 116.2, latitude: 39.2 } },
      },
      taskBusinessContextExpected: true,
      downstreamMissionIds: ["1"],
      createdAt: at,
      updatedAt: at,
    };
    const store = new PostgresTaskBusinessStore(pool);
    const notified: AdapterBusinessEvent[] = [];
    const service = new UgvTaskBusinessContextService(
      { getExecution: async () => run },
      store,
      run.providerId ?? "isr.vehicle.ugv.ugv1",
      run.resourceId,
      (event) => notified.push(event),
    );
    await service.ensureForCreatedExecution(run.taskId);
    const trajectory = new NavigationTrajectoryProcessor(store, () => undefined, 3_000);
    for (const [fraction, longitude] of [
      ["000100", 116],
      ["000900", 116.1],
    ] as const)
      await trajectory.apply(run, {
        schemaVersion: "ugv.navigation-position-fact/1",
        missionId: "1",
        sourceCursor: `pg-position-${fraction}`,
        sourceTopic: "/ugv/gnss",
        observedAt: `2026-09-23T00:00:01.${fraction}Z`,
        position: { longitude, latitude: 39 },
      });
    expect(
      await trajectory.apply(run, {
        schemaVersion: "ugv.navigation-position-fact/1",
        missionId: "1",
        sourceCursor: "pg-position-000800",
        sourceTopic: "/ugv/gnss",
        observedAt: "2026-09-23T00:00:01.000800Z",
        position: { longitude: 115, latitude: 39 },
      }),
    ).toBe("duplicate");
    const scope = BoundExecutionScope.fromExecution(run);
    const active = (await store.getContext(scope))?.activeRefs.trajectory;
    if (!active) throw new Error("PERSISTED_TRAJECTORY_MISSING");
    const reopened = new PostgresTaskBusinessStore(pool);
    expect((await reopened.getContext(scope))?.updatedAt).toBe("2026-09-23T00:00:01.000900Z");
    expect(await reopened.getArtifactVersion(scope, active.id, 1)).toMatchObject({
      content: { geometry: { type: "Point" } },
    });
    expect(await reopened.getArtifactVersion(scope, active.id, 2)).toMatchObject({
      content: {
        geometry: {
          type: "LineString",
          coordinates: [
            [116, 39],
            [116.1, 39],
          ],
        },
      },
    });
    const beforeFinalizationEvents = notified.length;
    await service.finalizeForTerminalExecution({
      ...run,
      state: "BUSINESS_FAILED",
      reasonCode: "UGV_MISSION_FAILED",
      terminalAt: "2026-09-23T00:00:03Z",
      updatedAt: "2026-09-23T00:00:03Z",
    });
    const finalizationEvents = notified.slice(beforeFinalizationEvents);
    const finalizationBodies = finalizationEvents.map((event) =>
      TaskBusinessFeedbackBodySchema.parse(protoStructToJson(event.rawPayload)),
    );
    expect(finalizationBodies.map((body) => body.kind)).toEqual([
      "BUSINESS_EVENT",
      "CONTEXT_FINALIZED",
    ]);
    expect(finalizationBodies[0]?.contextRevision).toBe(finalizationBodies[1]?.contextRevision);
    expect(BigInt(finalizationEvents[1]?.sourceSequence ?? "0")).toBe(
      BigInt(finalizationEvents[0]?.sourceSequence ?? "0") + 1n,
    );
    expect(await reopened.getContext(scope)).toMatchObject({
      summary: { status: "finalized", resultCode: "UGV_MISSION_FAILED" },
      activeRefs: {},
      finalizedAt: "2026-09-23T00:00:03Z",
    });
    expect(await reopened.getArtifactVersion(scope, active.id, 2)).toBeDefined();
  });
});
