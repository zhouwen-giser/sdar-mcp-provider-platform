import * as grpc from "@grpc/grpc-js";
import { describe, expect, it, vi } from "vitest";
import {
  TaskBusinessGateway,
  taskBusinessProtocolError,
} from "../../apps/runtime/src/task-business-gateway.js";
import { assertTaskBusinessEventReadiness } from "../../apps/runtime/src/runtime.js";
import { UGV_READ_ONLY_BUSINESS_PROFILE } from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import type { AuthorizationContext, TaskRecord } from "../../packages/domain/src/index.js";
import { TaskNotFoundOrUnauthorizedError } from "../../packages/domain/src/index.js";
import type {
  ValidatedManifest,
  ValidatedOperation,
} from "../../packages/operation-registry/src/index.js";

const authorization: AuthorizationContext = {
  hash: "a".repeat(64),
  executionMode: "simulation",
  simulationId: "scene-a",
  correlationId: "correlation-current",
};
const taskId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1004";
const otherTaskId = "018f0d4e-7b3a-7cc1-8d57-2f4d9e2a1005";

function fixture() {
  const task = {
    taskId: taskId,
    providerId: "isr.vehicle.ugv.ugv1",
    operationName: "vehicle_navigate",
    operationSnapshotId: "snapshot-1",
    authorizationContextHash: authorization.hash,
    executionMode: authorization.executionMode,
    simulationId: authorization.simulationId,
    externalExecutionId: "execution-stored",
    arguments: { resourceId: "vehicle:ugv1" },
    argumentHash: "b".repeat(64),
    rootTraceparent: null,
    rootTracestate: null,
  } as unknown as TaskRecord;
  const operation = {
    name: task.operationName,
    resourceBinding: { mode: "ARGUMENT_REFERENCE", resourceIdJsonPointer: "/resourceId" },
    businessFeedbackProfile: UGV_READ_ONLY_BUSINESS_PROFILE,
  } as ValidatedOperation;
  const source = {
    sourceId: "vehicle.business",
    deliverySemantics: "durable_at_least_once" as const,
    replaySupported: true,
  };
  const manifest = {
    providerId: task.providerId,
    operations: [operation],
    businessEventSources: [source],
  } as ValidatedManifest;
  const tasks = { getAuthorized: vi.fn(async () => task) };
  const snapshots = {
    loadOperationSnapshot: vi.fn(async () => ({
      snapshotId: task.operationSnapshotId,
      providerId: task.providerId,
      providerVersion: "1.0.0",
      manifestHash: "manifest-1",
      operation,
    })),
  };
  const adapter = {
    getBusinessContext: vi.fn(async () => ({ contextRevision: 1 })),
    getBusinessSnapshotPart: vi.fn(async () => ({
      jsonBytes: Uint8Array.from([123, 125]),
      totalBytes: "2",
      sha256: "f".repeat(64),
    })),
    getBusinessArtifact: vi.fn(async () => ({
      artifact: { artifactId: "route-1", revision: 2 },
      mediaType: "application/geo+json",
      sha256: "f".repeat(64),
      contentTotalBytes: "0",
    })),
  };
  const gateway = new TaskBusinessGateway(manifest, tasks, snapshots, adapter);
  return { task, operation, manifest, tasks, snapshots, adapter, gateway };
}

describe("Runtime TaskBusinessGateway", () => {
  it("requires public Business Events when the Manifest advertises a business profile", () => {
    const { manifest, operation } = fixture();
    expect(() => assertTaskBusinessEventReadiness(manifest, false)).toThrow(
      "TASK_BUSINESS_EVENTS_REQUIRED",
    );
    expect(() => assertTaskBusinessEventReadiness(manifest, true)).not.toThrow();
    operation.businessFeedbackProfile = undefined;
    expect(() => assertTaskBusinessEventReadiness(manifest, false)).not.toThrow();
  });

  it("binds reads to the authorized Task and stored operation snapshot", async () => {
    const { gateway, tasks, snapshots, adapter } = fixture();
    expect(
      await gateway.getContext(taskId, authorization, 8_192, "cursor-1", {
        externalExecutionId: "execution-stored",
        resourceId: "vehicle:ugv1",
        executionMode: "simulation",
        simulationId: "scene-a",
      }),
    ).toEqual({ contextRevision: 1 });
    expect(tasks.getAuthorized).toHaveBeenCalledWith(taskId, authorization);
    expect(snapshots.loadOperationSnapshot).toHaveBeenCalledWith("snapshot-1");
    expect(adapter.getBusinessContext).toHaveBeenCalledWith(
      taskId,
      "execution-stored",
      8_192,
      "cursor-1",
      expect.objectContaining({
        authorizationContextHash: authorization.hash,
        executionMode: "simulation",
        simulationId: "scene-a",
        externalExecutionId: "execution-stored",
        argumentHash: "b".repeat(64),
      }),
    );
    await gateway.getArtifact(
      taskId,
      authorization,
      "route-1",
      2,
      "geojson",
      true,
      {},
      {
        contentOffset: 10,
        maxContentBytes: 100,
      },
    );
    expect(adapter.getBusinessArtifact).toHaveBeenCalledWith(
      taskId,
      "execution-stored",
      "route-1",
      2,
      "geojson",
      true,
      expect.objectContaining({ contentOffset: 10, maxContentBytes: 100 }),
    );
  });

  it("rejects unknown, cross-task, cross-provider and client-supplied binding changes", async () => {
    const { gateway, task, tasks } = fixture();
    await expect(gateway.resolve("not-a-uuid", authorization, "context")).rejects.toThrow(
      "TASK_ID_INVALID",
    );
    tasks.getAuthorized.mockRejectedValueOnce(new TaskNotFoundOrUnauthorizedError());
    await expect(gateway.resolve(otherTaskId, authorization, "context")).rejects.toThrow(
      "TASK_NOT_FOUND",
    );
    await expect(
      gateway.resolve(taskId, authorization, "context", {
        externalExecutionId: "client-selected",
      }),
    ).rejects.toThrow("BUSINESS_EXECUTION_ID_MISMATCH");
    await expect(
      gateway.resolve(taskId, authorization, "context", { resourceId: "vehicle:other" }),
    ).rejects.toThrow("BUSINESS_RESOURCE_ID_MISMATCH");
    await expect(
      gateway.resolve(taskId, authorization, "context", { simulationId: "scene-b" }),
    ).rejects.toThrow("BUSINESS_SIMULATION_ID_MISMATCH");
    await expect(
      gateway.resolve(taskId, authorization, "context", { executionMode: "live" }),
    ).rejects.toThrow("BUSINESS_EXECUTION_MODE_MISMATCH");
    tasks.getAuthorized.mockResolvedValueOnce({ ...task, taskId: otherTaskId });
    await expect(gateway.resolve(taskId, authorization, "context")).rejects.toThrow(
      "TASK_NOT_FOUND",
    );
    tasks.getAuthorized.mockResolvedValueOnce({ ...task, providerId: "other-provider" });
    await expect(gateway.resolve(taskId, authorization, "context")).rejects.toThrow(
      "TASK_NOT_FOUND",
    );
    tasks.getAuthorized.mockResolvedValueOnce({
      ...task,
      authorizationContextHash: "c".repeat(64),
    });
    await expect(gateway.resolve(taskId, authorization, "context")).rejects.toThrow(
      "TASK_NOT_FOUND",
    );
  });

  it("rejects unsupported extension, unbound execution and unavailable write capabilities", async () => {
    const { gateway, task, operation, manifest, tasks } = fixture();
    await expect(gateway.resolve(taskId, authorization, "input")).rejects.toThrow(
      "BUSINESS_INPUT_NOT_SUPPORTED",
    );
    await expect(gateway.resolve(taskId, authorization, "intervention")).rejects.toThrow(
      "BUSINESS_INTERVENTION_NOT_SUPPORTED",
    );
    manifest.businessEventSources = [];
    await expect(gateway.resolve(taskId, authorization, "context")).rejects.toThrow(
      "TASK_BUSINESS_NOT_SUPPORTED",
    );
    manifest.businessEventSources = [
      {
        sourceId: "vehicle.business",
        deliverySemantics: "durable_at_least_once",
        replaySupported: true,
      } as ValidatedManifest["businessEventSources"][number],
    ];
    operation.businessFeedbackProfile = undefined;
    await expect(gateway.resolve(taskId, authorization, "context")).rejects.toThrow(
      "TASK_BUSINESS_NOT_SUPPORTED",
    );
    operation.businessFeedbackProfile = UGV_READ_ONLY_BUSINESS_PROFILE;
    tasks.getAuthorized.mockResolvedValueOnce({ ...task, externalExecutionId: null });
    await expect(gateway.resolve(taskId, authorization, "context")).rejects.toThrow(
      "BUSINESS_EXECUTION_NOT_BOUND",
    );
  });

  it("maps semantic and Adapter errors to JSON-RPC reasonCode and profile version", () => {
    expect(taskBusinessProtocolError(new TaskNotFoundOrUnauthorizedError()).data).toMatchObject({
      reasonCode: "TASK_NOT_FOUND",
      profileVersion: "1.0-rc2",
    });
    const metadata = new grpc.Metadata();
    metadata.set("io.sdar.task-business.reason-code", "BUSINESS_READ_SCOPE_MISMATCH");
    const missing = taskBusinessProtocolError(
      Object.assign(new Error("missing"), {
        code: grpc.status.NOT_FOUND,
        details: "BUSINESS_READ_SCOPE_MISMATCH",
        metadata,
      }),
    );
    expect(missing.code).toBe(-32602);
    expect(missing.data).toMatchObject({
      reasonCode: "BUSINESS_READ_SCOPE_MISMATCH",
      profileVersion: "1.0-rc2",
    });
    const unavailable = taskBusinessProtocolError(
      Object.assign(new Error("unavailable"), {
        code: grpc.status.UNIMPLEMENTED,
        details: "BUSINESS_METHOD_NOT_ENABLED",
        metadata: new grpc.Metadata(),
      }),
    );
    expect(unavailable.code).toBe(-32601);
    expect(unavailable.data).toMatchObject({ reasonCode: "TASK_BUSINESS_NOT_SUPPORTED" });
  });
});
