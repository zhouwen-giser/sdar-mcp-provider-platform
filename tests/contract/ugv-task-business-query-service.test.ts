import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { protoStructToJson } from "../../packages/adapter-protocol/src/index.js";
import { executionSnapshot } from "../../apps/ugv-provider-adapter/src/runtime.js";
import {
  UgvTaskBusinessContextService,
  UGV_NAVIGATION_BUSINESS_PROFILE,
  UGV_RECON_BUSINESS_PROFILE,
} from "../../apps/ugv-provider-adapter/src/task-business-service.js";
import {
  BoundExecutionScope,
  MemoryProviderStore,
  MemoryTaskBusinessStore,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";
import { TaskArtifactSchema } from "../../packages/vehicle-provider-core/src/task-business-artifact.js";
import { TaskBusinessContextSchema } from "../../packages/vehicle-provider-core/src/task-business-contract.js";
import {
  BusinessActionSchema,
  RequiredInputSchema,
} from "../../packages/vehicle-provider-core/src/task-business-interaction.js";

const catalog = JSON.parse(
  readFileSync("protocol/task-business/v1/examples/positive-catalog.json", "utf8"),
) as {
  artifacts: unknown[];
  requiredInput: unknown;
};
const at = "2026-09-24T00:00:00Z";
const bytes = Buffer.from(
  JSON.stringify({
    type: "LineString",
    coordinates: [
      [116, 39],
      [117, 40],
    ],
  }),
);

function execution(taskId = "task-query", expected = true): ProviderExecution {
  return {
    taskId,
    externalExecutionId: `execution-${taskId}`,
    operationName: "vehicle_navigate",
    argumentHash: "b".repeat(64),
    providerId: "provider-a",
    resourceId: "vehicle:ugv1",
    tracks: [],
    arguments: {},
    executionContext: {
      authorizationContextHash: "a".repeat(64),
      executionMode: "SIMULATION",
      simulationId: "scene-a",
      correlationId: "correlation-a",
    },
    ...(expected ? { taskBusinessContextExpected: true } : {}),
    downstreamMissionIds: [],
    state: "ACCEPTED",
    revision: 1,
    reasonCode: "UGV_OPERATION_ACCEPTED",
    createdAt: at,
    updatedAt: at,
    evidence: [],
  };
}

function readIdentity(run: ProviderExecution) {
  return {
    taskId: run.taskId,
    externalExecutionId: run.externalExecutionId,
    executionContext: run.executionContext,
  };
}

describe("UGV TaskBusiness Context query service", () => {
  it("reads large Context and exact Action JSON in bounded chunks with scope and revision fences", async () => {
    const runs = new MemoryProviderStore();
    const business = new MemoryTaskBusinessStore();
    const service = new UgvTaskBusinessContextService(
      runs,
      business,
      "provider-a",
      "vehicle:ugv1",
      () => undefined,
    );
    const run = execution("task-large-version");
    await runs.putExecution(run);
    await service.ensureForCreatedExecution(run.taskId);
    const scope = BoundExecutionScope.fromExecution(run);
    const current = await business.getContext(scope);
    if (!current) throw new Error("CONTEXT_MISSING");
    const action = BusinessActionSchema.parse({
      schemaVersion: "sdar.business-action/1.0-rc2",
      actionId: "large-action",
      actionType: "sensor.visual_lock",
      identity: current.identity,
      revision: 1,
      state: "requested",
      actor: { type: "device" },
      triggerOrigin: "device_automatic",
      reasonCode: "DEVICE_REQUESTED",
      requestedAt: at,
      properties: { detail: "a".repeat(1_100_000) },
    });
    const ref = { kind: "action" as const, id: action.actionId, revision: action.revision };
    const next = TaskBusinessContextSchema.parse({
      ...current,
      contextRevision: 2,
      summary: { status: "in_progress", properties: { detail: "c".repeat(1_100_000) } },
      actionRefs: [ref],
    });
    await business.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: next,
      objects: [{ kind: "action", value: action }],
    });
    const page = await service.getBusinessContext(readIdentity(run), 1_048_576, "");
    expect(page).toMatchObject({
      contextRevision: 2,
      contextDescriptor: { revision: 2, readMethod: "getContext" },
      objectDescriptors: [{ ref, readMethod: "getObjectVersion" }],
    });

    const read = async (objectRef?: typeof ref) => {
      const chunks: Uint8Array[] = [];
      let offset = 0;
      while (true) {
        const part = await service.getBusinessSnapshotPart(readIdentity(run), {
          contextRevision: 2,
          ...(objectRef === undefined ? {} : { objectRef }),
          offset,
          maxBytes: 65_536,
        });
        chunks.push(part.jsonBytes);
        if (part.nextOffset === undefined) {
          const bytes = Buffer.concat(chunks);
          expect(bytes.length).toBe(part.totalBytes);
          expect(createHash("sha256").update(bytes).digest("hex")).toBe(part.sha256);
          return JSON.parse(bytes.toString("utf8")) as unknown;
        }
        offset = part.nextOffset;
      }
    };
    expect(await read()).toEqual(next);
    expect(await read(ref)).toEqual({ kind: "action", value: action });
    await expect(
      service.getBusinessSnapshotPart(readIdentity(run), {
        contextRevision: 1,
        offset: 0,
        maxBytes: 1024,
      }),
    ).rejects.toThrow("BUSINESS_SNAPSHOT_REVISION_CHANGED");
    await expect(
      service.getBusinessSnapshotPart(readIdentity(run), {
        contextRevision: 2,
        objectRef: { ...ref, id: "unlisted" },
        offset: 0,
        maxBytes: 1024,
      }),
    ).rejects.toThrow("BUSINESS_SNAPSHOT_REF_NOT_ACTIVE");
    await expect(
      service.getBusinessSnapshotPart(readIdentity(run), {
        contextRevision: 2,
        offset: 2_000_000,
        maxBytes: 1024,
      }),
    ).rejects.toThrow("BUSINESS_SNAPSHOT_OFFSET_AHEAD");
    await expect(
      service.getBusinessSnapshotPart(
        { ...readIdentity(run), externalExecutionId: "other" },
        { contextRevision: 2, offset: 0, maxBytes: 1024 },
      ),
    ).rejects.toThrow("BUSINESS_READ_SCOPE_MISMATCH");
  });

  it("projects only a durable active recon input and never substitutes fire confirmation", async () => {
    const runs = new MemoryProviderStore();
    const business = new MemoryTaskBusinessStore();
    const service = new UgvTaskBusinessContextService(
      runs,
      business,
      "provider-a",
      "vehicle:ugv1",
      () => undefined,
    );
    const run: ProviderExecution = {
      ...execution("recon-decision"),
      operationName: "vehicle_area_recon",
      arguments: { resourceId: "vehicle:ugv1", scanMode: "circular" },
    };
    await runs.putExecution(run);
    await service.ensureForCreatedExecution(run.taskId);
    const waiting: ProviderExecution = { ...run, state: "WAITING_INPUT" };
    expect(await service.activeRequiredInput(waiting)).toBeUndefined();
    expect(() => executionSnapshot(waiting)).toThrow("UGV_REQUIRED_INPUT_NOT_BOUND");

    const scope = BoundExecutionScope.fromExecution(run);
    const current = await business.getContext(scope);
    if (!current) throw new Error("BUSINESS_CONTEXT_MISSING");
    const request = RequiredInputSchema.parse({
      ...RequiredInputSchema.parse(catalog.requiredInput),
      requestId: "decision-recon-decision",
      requestKey: "decision-key-recon-decision",
      identity: current.identity,
      requestedAt: at,
      deadlineAt: "2026-09-24T00:05:00Z",
    });
    const ref = { kind: "input_request" as const, id: request.requestId, revision: 1 };
    await business.commitChangeSet({
      scope,
      expectedContextRevision: current.contextRevision,
      context: TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: current.contextRevision + 1,
        activeRefs: { ...current.activeRefs, requiredDecision: ref },
        requiredInputRefs: [...current.requiredInputRefs, ref],
      }),
      objects: [{ kind: "input_request", value: request }],
    });
    const persisted = await service.activeRequiredInput(waiting);
    expect(persisted).toEqual(request);
    const snapshot = executionSnapshot(waiting, persisted);
    const requests = snapshot.mcpInputRequests as {
      key: string;
      params: unknown;
    }[];
    expect(requests).toHaveLength(1);
    expect(requests[0]?.key).toBe(request.requestKey);
    expect(protoStructToJson(requests[0]?.params)).toMatchObject({
      requestedSchema: request.inputSchema,
      _meta: {
        "io.sdar/taskBusiness": {
          requestId: request.requestId,
          requestKey: request.requestKey,
          inputType: request.inputType,
          requiredResponder: "user",
          revision: 1,
          deadlineAt: request.deadlineAt,
        },
      },
    });
    expect(requests[0]?.key).not.toBe("fire_confirmation");

    const latest = await business.getContext(scope);
    if (!latest) throw new Error("BUSINESS_CONTEXT_MISSING");
    const cancelled = RequiredInputSchema.parse({
      ...request,
      revision: 2,
      state: "cancelled",
      resolvedAt: "2026-09-24T00:00:01Z",
    });
    await business.commitChangeSet({
      scope,
      expectedContextRevision: latest.contextRevision,
      context: TaskBusinessContextSchema.parse({
        ...latest,
        contextRevision: latest.contextRevision + 1,
        activeRefs: {},
        requiredInputRefs: [...latest.requiredInputRefs, { ...ref, revision: 2 }],
      }),
      objects: [{ kind: "input_request", value: cancelled }],
    });
    expect(await service.activeRequiredInput(waiting)).toBeUndefined();
    expect(() => executionSnapshot(waiting)).toThrow("UGV_REQUIRED_INPUT_NOT_BOUND");
    expect(
      (
        executionSnapshot({ ...waiting, operationName: "vehicle_fire_weapon" })
          .mcpInputRequests as { key: string }[]
      )[0]?.key,
    ).toBe("fire_confirmation");
  });
  it("stores requested recon area separately from absent scan and covered-area artifacts", async () => {
    const runs = new MemoryProviderStore();
    const business = new MemoryTaskBusinessStore();
    const notify = vi.fn();
    const service = new UgvTaskBusinessContextService(
      runs,
      business,
      "provider-a",
      "vehicle:ugv1",
      notify,
    );
    const areaRun: ProviderExecution = {
      ...execution("recon-area"),
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
    };
    await runs.putExecution(areaRun);
    await service.ensureForCreatedExecution(areaRun.taskId);
    const snapshot = await business.getContextSnapshot(BoundExecutionScope.fromExecution(areaRun));
    expect(snapshot?.context.artifactRefs).toHaveLength(3);
    expect(snapshot?.context.activeRefs).toEqual({});
    expect(snapshot?.objects).toMatchObject([
      {
        kind: "artifact",
        value: {
          artifactType: "recon.area",
          semantics: "requested",
          availability: "available",
          properties: { areaRevision: 1 },
          content: { geometry: { type: "Polygon" } },
        },
      },
      {
        kind: "artifact",
        value: {
          artifactType: "recon.coverage_plan",
          availability: "not_produced_yet",
        },
      },
      {
        kind: "artifact",
        value: {
          artifactType: "recon.covered_area",
          availability: "not_produced_yet",
        },
      },
    ]);
    expect(notify).toHaveBeenCalledTimes(4);
    const circularRun: ProviderExecution = {
      ...execution("recon-circular"),
      operationName: "vehicle_area_recon",
      arguments: { resourceId: "vehicle:ugv1", scanMode: "circular" },
    };
    await runs.putExecution(circularRun);
    await service.ensureForCreatedExecution(circularRun.taskId);
    expect(
      (await business.getContextSnapshot(BoundExecutionScope.fromExecution(circularRun)))?.objects,
    ).toHaveLength(2);
    expect(UGV_RECON_BUSINESS_PROFILE.artifactTypes).toEqual([
      "recon.area",
      "recon.coverage_plan",
      "recon.covered_area",
      "target.object",
      "target.track",
    ]);
    expect(UGV_RECON_BUSINESS_PROFILE.policy.coverageMode).toBe("device_reported");
  });

  it("records admitted point/waypoint intent as requested Artifacts without inventing a planner route", async () => {
    const runs = new MemoryProviderStore();
    const business = new MemoryTaskBusinessStore();
    const notify = vi.fn();
    const service = new UgvTaskBusinessContextService(
      runs,
      business,
      "provider-a",
      "vehicle:ugv1",
      notify,
    );
    const cases = [
      {
        taskId: "intent-point",
        mission: { type: "point", target: { longitude: 116, latitude: 39 } },
        artifactType: "navigation.destination",
        geometryType: "Point",
      },
      {
        taskId: "intent-waypoints",
        mission: {
          type: "route",
          waypoints: [
            { longitude: 116, latitude: 39 },
            { longitude: 116.2, latitude: 39.2 },
          ],
        },
        artifactType: "navigation.waypoints",
        geometryType: "MultiPoint",
      },
    ] as const;
    for (const item of cases) {
      const run = {
        ...execution(item.taskId),
        arguments: {
          resourceId: "vehicle:ugv1",
          mission: item.mission,
        },
      };
      await runs.putExecution(run);
      await service.ensureForCreatedExecution(run.taskId);
      const page = await service.getBusinessContext(readIdentity(run), 16_384, "");
      const objects = page.objects as { kind: string; value: Record<string, unknown> }[];
      expect(objects).toHaveLength(1);
      expect(objects[0]).toMatchObject({
        kind: "artifact",
        value: {
          artifactType: item.artifactType,
          semantics: "requested",
          source: { producer: "provider", method: "admitted_task_arguments" },
          content: { kind: "geojson", geometry: { type: item.geometryType } },
        },
      });
      expect((page.context as { artifactRefs: unknown[] }).artifactRefs).toHaveLength(1);
      expect((page.context as { activeRefs: Record<string, unknown> }).activeRefs).toEqual({});
      expect(
        (objects[0]?.value.content as { geometry: Record<string, unknown> }).geometry.type,
      ).not.toBe("LineString");
    }
    expect(notify).toHaveBeenCalledTimes(4);
    expect(UGV_NAVIGATION_BUSINESS_PROFILE.artifactTypes).toEqual([
      "navigation.destination",
      "navigation.waypoints",
      "navigation.trajectory",
    ]);
    expect(UGV_NAVIGATION_BUSINESS_PROFILE.qualification.routeAdoption).toBe("not_supported");
  });
  it("initializes a new admitted execution once and rejects old history or a changed scope", async () => {
    const runs = new MemoryProviderStore();
    const business = new MemoryTaskBusinessStore();
    const notify = vi.fn();
    const service = new UgvTaskBusinessContextService(
      runs,
      business,
      "provider-a",
      "vehicle:ugv1",
      notify,
    );
    const run = execution();
    await runs.putExecution(run);
    await service.ensureForCreatedExecution(run.taskId);
    await service.ensureForCreatedExecution(run.taskId);
    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0]?.[0]).toMatchObject({
      eventType: "vehicle.business.changed",
      reasonCode: "BUSINESS_CONTEXT_INITIALIZED",
    });
    expect(await service.getBusinessContext(readIdentity(run), 8_192, "")).toMatchObject({
      contextRevision: 1,
      context: { identity: { taskId: run.taskId }, activeRefs: {} },
      objects: [],
    });
    await expect(
      service.getBusinessContext({ ...readIdentity(run), externalExecutionId: "other" }, 8_192, ""),
    ).rejects.toThrow("BUSINESS_READ_SCOPE_MISMATCH");
    await expect(
      service.getBusinessContext(
        {
          ...readIdentity(run),
          executionContext: { ...run.executionContext, simulationId: "other-scene" },
        },
        8_192,
        "",
      ),
    ).rejects.toThrow("BUSINESS_READ_SCOPE_MISMATCH");
    await expect(
      service.getBusinessContext(
        {
          ...readIdentity(run),
          executionContext: { ...run.executionContext, authorizationContextHash: "c".repeat(64) },
        },
        8_192,
        "",
      ),
    ).rejects.toThrow("BUSINESS_READ_SCOPE_MISMATCH");
    const historical = execution("task-historical", false);
    await runs.putExecution(historical);
    await expect(service.getBusinessContext(readIdentity(historical), 8_192, "")).rejects.toThrow(
      "BUSINESS_CONTEXT_NOT_AVAILABLE",
    );
    await expect(service.ensureForCreatedExecution(historical.taskId)).rejects.toThrow(
      "BUSINESS_EXECUTION_NOT_ELIGIBLE",
    );
  });

  it("reads only versions from the persisted execution's bound business scope", async () => {
    const runs = new MemoryProviderStore();
    const business = new MemoryTaskBusinessStore();
    const service = new UgvTaskBusinessContextService(
      runs,
      business,
      "provider-a",
      "vehicle:ugv1",
      () => undefined,
    );
    const run = execution("task-artifact");
    await runs.putExecution(run);
    await service.ensureForCreatedExecution(run.taskId);
    const fixture = catalog.artifacts
      .map((value) => TaskArtifactSchema.parse(value))
      .find((item) => item.artifactId === "route-ref");
    if (fixture?.availability !== "available" || fixture.content.kind !== "content_ref")
      throw new Error("REFERENCE_FIXTURE_MISSING");
    const artifact = TaskArtifactSchema.parse({
      ...fixture,
      identity: {
        ...fixture.identity,
        taskId: run.taskId,
        executionId: run.externalExecutionId,
        providerId: run.providerId,
        resourceId: run.resourceId,
        operationName: run.operationName,
      },
      content: {
        ...fixture.content,
        sizeBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        expiresAt: "2030-01-01T00:00:00Z",
      },
    });
    if (artifact.availability !== "available" || artifact.content.kind !== "content_ref")
      throw new Error("ARTIFACT_INVALID");
    const scope = BoundExecutionScope.fromExecution(run);
    const current = await business.getContext(scope);
    if (!current) throw new Error("CONTEXT_MISSING");
    const next = TaskBusinessContextSchema.parse({
      ...current,
      contextRevision: 2,
      artifactRefs: [{ kind: "artifact", id: artifact.artifactId, revision: 1 }],
      activeRefs: { route: { kind: "artifact", id: artifact.artifactId, revision: 1 } },
    });
    await business.commitChangeSet({
      scope,
      expectedContextRevision: 1,
      context: next,
      objects: [{ kind: "artifact", value: artifact }],
      contents: [
        { artifactId: artifact.artifactId, revision: 1, handle: artifact.content.handle, bytes },
      ],
    });
    const read = await service.getBusinessArtifact(
      readIdentity(run),
      artifact.artifactId,
      undefined,
      "",
      true,
    );
    expect(read.artifact).toMatchObject({ artifactId: artifact.artifactId, revision: 1 });
    expect(read.contentBytes).toEqual(Uint8Array.from(bytes));
    expect(read.sha256).toBe(artifact.content.sha256);
    expect(
      (await service.getBusinessArtifact(readIdentity(run), artifact.artifactId, 1, "", false))
        .contentBytes,
    ).toBeUndefined();
    await expect(
      service.getBusinessArtifact(readIdentity(run), artifact.artifactId, 2, "", true),
    ).rejects.toThrow("ARTIFACT_REVISION_NOT_FOUND");
    await expect(
      service.getBusinessArtifact(readIdentity(run), artifact.artifactId, 1, "missing", true),
    ).rejects.toThrow("ARTIFACT_REPRESENTATION_NOT_FOUND");
  });
});
