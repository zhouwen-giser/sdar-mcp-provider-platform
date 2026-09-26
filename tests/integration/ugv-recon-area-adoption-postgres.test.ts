import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runUgvProviderMigrations } from "../../apps/ugv-provider-adapter/src/migrate.js";
import {
  BoundExecutionScope,
  PostgresTaskBusinessStore,
  scopeBusinessIdentity,
  type ProviderExecution,
} from "../../packages/provider-adapter-kit/src/index.js";
import { TaskArtifactSchema } from "../../packages/vehicle-provider-core/src/task-business-artifact.js";
import {
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
} from "../../packages/vehicle-provider-core/src/task-business-contract.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for recon area adoption test");
const schema = `ugvb_recon_area_${randomUUID().replaceAll("-", "")}`;
let admin: Pool;
let pool: Pool;
let store: PostgresTaskBusinessStore;

beforeAll(async () => {
  admin = new Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  pool = new Pool({ connectionString: url.toString(), max: 3 });
  await runUgvProviderMigrations(pool, resolve(import.meta.dirname, "../.."));
  store = new PostgresTaskBusinessStore(pool);
});

afterAll(async () => {
  await pool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});

describe("native PostgreSQL recon area adoption facts (synthetic source)", () => {
  it("rolls back an incomplete switch and commits area, reset and public events together", async () => {
    const execution: ProviderExecution = {
      taskId: "task-recon-area-pg",
      externalExecutionId: "execution-recon-area-pg",
      operationName: "vehicle_area_recon",
      argumentHash: "a".repeat(64),
      providerId: "provider-recon-area-pg",
      resourceId: "vehicle:ugv1",
      tracks: [],
      arguments: {},
      executionContext: {
        authorizationContextHash: "b".repeat(64),
        executionMode: "simulation",
        simulationId: "synthetic-recon-area-pg",
        correlationId: "recon-area-pg",
      },
      downstreamMissionIds: ["mission-pg"],
      state: "RUNNING",
      revision: 1,
      reasonCode: "TEST",
      createdAt: "2026-09-24T00:00:00Z",
      updatedAt: "2026-09-24T00:00:00Z",
      evidence: [],
    };
    const scope = BoundExecutionScope.fromExecution(execution);
    const identity = scopeBusinessIdentity(scope);
    const area = TaskArtifactSchema.parse({
      schemaVersion: "sdar.task-artifact/1.0-rc2",
      artifactId: "recon-requested-area",
      artifactType: "recon.area",
      revision: 1,
      semantics: "requested",
      lifecycle: "active",
      identity,
      source: { producer: "provider", method: "test_double" },
      createdAt: execution.createdAt,
      updatedAt: execution.createdAt,
      availability: "available",
      properties: { areaRevision: 1 },
      content: {
        kind: "geojson",
        crs: "OGC:CRS84",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [116, 39],
              [117, 39],
              [117, 40],
              [116, 39],
            ],
          ],
        },
      },
    });
    if (area.availability !== "available") throw new Error("SYNTHETIC_AREA_UNAVAILABLE");
    const oldCoverage = TaskArtifactSchema.parse({
      schemaVersion: "sdar.task-artifact/1.0-rc2",
      artifactId: "recon-covered-area",
      artifactType: "recon.covered_area",
      revision: 1,
      semantics: "derived",
      lifecycle: "active",
      identity,
      source: { producer: "device", method: "test_double" },
      createdAt: execution.createdAt,
      updatedAt: execution.createdAt,
      availability: "not_produced_yet",
      reasonCode: "COVERAGE_NOT_OBSERVED",
    });
    const oldFootprint = TaskArtifactSchema.parse({
      schemaVersion: "sdar.task-artifact/1.0-rc2",
      artifactId: "recon-current-footprint",
      artifactType: "recon.current_footprint",
      revision: 1,
      semantics: "observed",
      lifecycle: "active",
      identity,
      source: { producer: "device", method: "test_double" },
      createdAt: execution.createdAt,
      updatedAt: execution.createdAt,
      availability: "available",
      properties: { areaRevision: 1, quality: "observed" },
      content: area.content,
    });
    const footprintRef = { kind: "artifact" as const, id: oldFootprint.artifactId, revision: 1 };
    const initial = TaskBusinessContextSchema.parse({
      schemaVersion: "sdar.task-business-context/1.0-rc2",
      identity,
      contextRevision: 1,
      effectivePlanRevision: 0,
      phase: null,
      summary: {
        status: "in_progress",
        properties: { reconCoverage: { areaRevision: 1, totalCount: 10 } },
      },
      activeRefs: { currentFootprint: footprintRef },
      artifactRefs: [
        { kind: "artifact", id: area.artifactId, revision: 1 },
        { kind: "artifact", id: oldCoverage.artifactId, revision: 1 },
        footprintRef,
      ],
      actionRefs: [],
      requiredInputRefs: [],
      interventionRefs: [],
      updatedAt: execution.createdAt,
    });
    await store.commitChangeSet({
      scope,
      expectedContextRevision: null,
      context: initial,
      objects: [
        { kind: "artifact", value: area },
        { kind: "artifact", value: oldCoverage },
        { kind: "artifact", value: oldFootprint },
      ],
    });
    const adoptedArea = TaskArtifactSchema.parse({
      ...area,
      revision: 2,
      semantics: "planned",
      source: { producer: "device_planner", method: "test_double" },
      properties: { areaRevision: 2 },
      updatedAt: "2026-09-24T00:00:01Z",
    });
    const resetCoverage = TaskArtifactSchema.parse({
      ...oldCoverage,
      revision: 2,
      source: { producer: "provider", method: "test_double" },
      updatedAt: adoptedArea.updatedAt,
      reasonCode: "COVERAGE_RESET_FOR_NEW_AREA",
    });
    const areaRef = { kind: "artifact" as const, id: area.artifactId, revision: 2 };
    const resetRef = { kind: "artifact" as const, id: oldCoverage.artifactId, revision: 2 };
    const next = TaskBusinessContextSchema.parse({
      ...initial,
      contextRevision: 2,
      effectivePlanRevision: 1,
      activeRefs: { reconEffectiveArea: areaRef },
      artifactRefs: [...initial.artifactRefs, areaRef, resetRef],
      summary: { status: "in_progress", properties: {} },
      updatedAt: adoptedArea.updatedAt,
    });
    const objects = [
      { kind: "artifact" as const, value: adoptedArea },
      { kind: "artifact" as const, value: resetCoverage },
    ];
    await expect(
      store.commitChangeSet({
        scope,
        expectedContextRevision: 1,
        context: { ...next, summary: initial.summary },
        objects,
      }),
    ).rejects.toThrow("RECON_AREA_ADOPTION_FACTS_INCOMPLETE");
    expect(await store.getContext(scope)).toEqual(initial);
    expect(await store.getArtifactLatest(scope, area.artifactId)).toEqual(area);
    const reasonCode = "RECON_AREA_ADOPTED";
    const changed = (ref: typeof areaRef) => ({
      body: TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind: "ARTIFACT_CHANGED",
        contextRevision: 2,
        providerRecordedAt: next.updatedAt,
        payload: { change: "update", artifactRef: ref, previousRevision: 1, reasonCode },
      }),
      description: reasonCode,
      reasonCode,
      severityHint: "info" as const,
    });
    const draftsFor = (activeRefs: typeof next.activeRefs) => [
      changed(areaRef),
      changed(resetRef),
      {
        body: TaskBusinessFeedbackBodySchema.parse({
          schemaVersion: "sdar.task-business-feedback/1.0-rc2",
          kind: "BUSINESS_EVENT",
          contextRevision: 2,
          providerRecordedAt: next.updatedAt,
          payload: {
            eventType: "recon.area_adopted",
            severity: "info",
            reasonCode,
            description: "Synthetic verified area adoption",
            subjects: [areaRef, resetRef],
            contextDelta: {
              activeRefs,
              effectivePlanRevision: next.effectivePlanRevision,
              summary: next.summary,
            },
          },
        }),
        description: reasonCode,
        reasonCode,
        severityHint: "info" as const,
      },
    ];
    const drafts = draftsFor(next.activeRefs);
    const staleFootprintContext = TaskBusinessContextSchema.parse({
      ...next,
      activeRefs: { ...next.activeRefs, currentFootprint: footprintRef },
    });
    await expect(
      store.commitBusinessChangeSet(
        { scope, expectedContextRevision: 1, context: staleFootprintContext, objects },
        draftsFor(staleFootprintContext.activeRefs),
      ),
    ).rejects.toThrow("RECON_AREA_ADOPTION_FOOTPRINT_STALE");
    expect(await store.getContext(scope)).toEqual(initial);
    expect(await store.getArtifactLatest(scope, oldFootprint.artifactId)).toEqual(oldFootprint);
    expect((await pool.query("SELECT 1 FROM ugv_business_event_source_log")).rowCount).toBe(0);
    await expect(
      store.commitBusinessChangeSet(
        {
          scope,
          expectedContextRevision: 1,
          context: next,
          objects: [
            {
              kind: "artifact",
              value: TaskArtifactSchema.parse({
                ...adoptedArea,
                properties: { areaRevision: 1 },
              }),
            },
            { kind: "artifact", value: resetCoverage },
          ],
        },
        drafts,
      ),
    ).rejects.toThrow("RECON_AREA_REVISION_NOT_ADVANCED");
    expect(await store.getContext(scope)).toEqual(initial);
    expect(await store.getArtifactLatest(scope, area.artifactId)).toEqual(area);
    expect((await pool.query("SELECT 1 FROM ugv_business_event_source_log")).rowCount).toBe(0);
    const committed = await store.commitBusinessChangeSet(
      { scope, expectedContextRevision: 1, context: next, objects },
      drafts,
    );
    expect(committed.events).toHaveLength(3);
    expect(await store.getContext(scope)).toEqual(next);
    expect(await store.getArtifactVersion(scope, oldCoverage.artifactId, 1)).toEqual(oldCoverage);
    expect(await store.getArtifactLatest(scope, oldCoverage.artifactId)).toEqual(resetCoverage);
    expect((await pool.query("SELECT 1 FROM ugv_business_event_source_log")).rowCount).toBe(3);
    const secondArea = TaskArtifactSchema.parse({
      ...adoptedArea,
      revision: 3,
      properties: { areaRevision: 3 },
      content: {
        kind: "geojson",
        crs: "OGC:CRS84",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [116.1, 39],
              [117.1, 39],
              [117.1, 40],
              [116.1, 39],
            ],
          ],
        },
      },
      updatedAt: "2026-09-24T00:00:02Z",
    });
    const secondReset = TaskArtifactSchema.parse({
      ...resetCoverage,
      revision: 3,
      updatedAt: secondArea.updatedAt,
    });
    const secondAreaRef = { kind: "artifact" as const, id: area.artifactId, revision: 3 };
    const secondResetRef = { kind: "artifact" as const, id: oldCoverage.artifactId, revision: 3 };
    const second = TaskBusinessContextSchema.parse({
      ...next,
      contextRevision: 3,
      effectivePlanRevision: 2,
      activeRefs: { reconEffectiveArea: secondAreaRef },
      artifactRefs: [...next.artifactRefs, secondAreaRef, secondResetRef],
      updatedAt: secondArea.updatedAt,
    });
    const secondChanged = (ref: typeof secondAreaRef) => ({
      body: TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind: "ARTIFACT_CHANGED",
        contextRevision: 3,
        providerRecordedAt: second.updatedAt,
        payload: { change: "update", artifactRef: ref, previousRevision: 2, reasonCode },
      }),
      description: reasonCode,
      reasonCode,
      severityHint: "info" as const,
    });
    const secondEvents = [
      secondChanged(secondAreaRef),
      secondChanged(secondResetRef),
      {
        body: TaskBusinessFeedbackBodySchema.parse({
          schemaVersion: "sdar.task-business-feedback/1.0-rc2",
          kind: "BUSINESS_EVENT",
          contextRevision: 3,
          providerRecordedAt: second.updatedAt,
          payload: {
            eventType: "recon.area_adopted",
            severity: "info",
            reasonCode,
            description: "Second synthetic verified area adoption",
            subjects: [secondAreaRef, secondResetRef],
            contextDelta: {
              activeRefs: second.activeRefs,
              effectivePlanRevision: second.effectivePlanRevision,
              summary: second.summary,
            },
          },
        }),
        description: reasonCode,
        reasonCode,
        severityHint: "info" as const,
      },
    ];
    const secondObjects = [
      { kind: "artifact" as const, value: secondArea },
      { kind: "artifact" as const, value: secondReset },
    ];
    await expect(
      store.commitBusinessChangeSet(
        {
          scope,
          expectedContextRevision: 2,
          context: second,
          objects: [
            {
              kind: "artifact",
              value: TaskArtifactSchema.parse({ ...secondArea, properties: { areaRevision: 2 } }),
            },
            { kind: "artifact", value: secondReset },
          ],
        },
        secondEvents,
      ),
    ).rejects.toThrow("RECON_AREA_REVISION_NOT_ADVANCED");
    expect(await store.getContext(scope)).toEqual(next);
    expect(await store.getArtifactLatest(scope, area.artifactId)).toEqual(adoptedArea);
    expect((await pool.query("SELECT 1 FROM ugv_business_event_source_log")).rowCount).toBe(3);
    await store.commitBusinessChangeSet(
      { scope, expectedContextRevision: 2, context: second, objects: secondObjects },
      secondEvents,
    );
    expect(await store.getContext(scope)).toEqual(second);
    expect(await store.getArtifactVersion(scope, area.artifactId, 2)).toEqual(adoptedArea);
    expect(await store.getArtifactLatest(scope, area.artifactId)).toEqual(secondArea);
    expect((await pool.query("SELECT 1 FROM ugv_business_event_source_log")).rowCount).toBe(6);
  });
});
