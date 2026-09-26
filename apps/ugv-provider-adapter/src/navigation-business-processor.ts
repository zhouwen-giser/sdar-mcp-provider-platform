import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { AdapterBusinessEvent } from "../../../packages/adapter-protocol/src/index.js";
import {
  BoundExecutionScope,
  scopeBusinessIdentity,
  type ProviderExecution,
  type TaskBusinessStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import {
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
} from "../../../packages/vehicle-provider-core/src/task-business-contract.js";
import {
  ArtifactContentSchema,
  TaskArtifactSchema,
} from "../../../packages/vehicle-provider-core/src/task-business-artifact.js";
import { compareIsoTimestamps } from "../../../packages/vehicle-provider-core/src/time.js";

const planFactSchema = z
  .object({
    schemaVersion: z.literal("ugv.navigation-plan-fact/1"),
    routeId: z.string().min(1).max(256),
    routePlanId: z.string().min(1).max(256),
    routeRevision: z.number().int().positive(),
    missionId: z.string().min(1).max(256),
    sourceRecordId: z.string().min(1).max(256),
    routeSource: z.string().min(1).max(256),
    adoption: z.enum(["candidate", "adopted"]),
    observedAt: z.iso.datetime({ offset: true }),
    content: ArtifactContentSchema.refine(
      (content) =>
        (content.kind === "geojson" || content.kind === "local_geometry") &&
        (content.geometry.type === "LineString" || content.geometry.type === "MultiLineString"),
      "NAVIGATION_PLANNER_ROUTE_GEOMETRY_REQUIRED",
    ),
  })
  .strict();
export type NavigationPlanFact = z.infer<typeof planFactSchema>;

const terminal = new Set(["SUCCEEDED", "BUSINESS_FAILED", "CANCELLED", "TECHNICAL_FAILED"]);

/** Receives a verified planner fact from a future southbound source; never derives a route. */
export class NavigationBusinessProcessor {
  constructor(
    readonly business: Pick<
      TaskBusinessStore,
      "getContext" | "getArtifactLatest" | "getObjectVersion" | "commitBusinessChangeSet"
    >,
    readonly notifyCommitted: (event: AdapterBusinessEvent) => void,
  ) {}

  async apply(execution: ProviderExecution, input: unknown): Promise<"committed" | "duplicate"> {
    const fact = planFactSchema.parse(input);
    if (
      execution.operationName !== "vehicle_navigate" ||
      execution.taskBusinessContextExpected !== true ||
      execution.downstreamMissionIds.at(-1) !== fact.missionId ||
      compareIsoTimestamps(fact.observedAt, execution.createdAt) < 0
    ) {
      throw new Error("NAVIGATION_PLAN_EXECUTION_BINDING_INVALID");
    }
    if (terminal.has(execution.state)) throw new Error("NAVIGATION_PLAN_TASK_TERMINAL");
    const scope = BoundExecutionScope.fromExecution(execution);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.business.getContext(scope);
      if (!current || current.summary.status === "finalized") {
        throw new Error("NAVIGATION_PLAN_CONTEXT_UNAVAILABLE");
      }
      const previous = await this.business.getArtifactLatest(scope, fact.routeId);
      if (previous && previous.artifactType !== "navigation.route") {
        throw new Error("NAVIGATION_PLAN_ROUTE_ID_CONFLICT");
      }
      if (previous && previous.availability !== "available") {
        throw new Error("NAVIGATION_PLAN_ROUTE_INVALID");
      }
      const previousProperties =
        previous?.availability === "available" && "routeSource" in previous.properties
          ? previous.properties
          : undefined;
      if (previous && !previousProperties) throw new Error("NAVIGATION_PLAN_ROUTE_INVALID");
      const previousSourceRevision =
        previous?.source.sourceRevision === undefined
          ? undefined
          : Number(previous.source.sourceRevision);
      if (previousSourceRevision !== undefined && fact.routeRevision < previousSourceRevision) {
        return "duplicate";
      }
      if (previous && previousSourceRevision === fact.routeRevision) {
        if (
          previous.source.sourceRecordRef !== fact.sourceRecordId ||
          !isDeepStrictEqual(previous.content, fact.content) ||
          previousProperties?.routePlanId !== fact.routePlanId ||
          previousProperties.routeSource !== fact.routeSource ||
          !isDeepStrictEqual(previous.relations, [
            {
              relationType: "planned_for_mission",
              target: { externalType: "ugv.mission", externalId: fact.missionId },
            },
          ])
        ) {
          throw new Error("NAVIGATION_PLAN_SOURCE_VERSION_CONFLICT");
        }
        if (previousProperties.adoption === "adopted") return "duplicate";
        if (fact.adoption === "candidate") return "duplicate";
      }
      if (previous && compareIsoTimestamps(fact.observedAt, previous.updatedAt) < 0) {
        throw new Error("NAVIGATION_PLAN_SOURCE_TIME_REGRESSION");
      }
      if (fact.adoption === "adopted" && current.activeRefs.route) {
        const activeRoute = await this.business.getObjectVersion(scope, current.activeRefs.route);
        if (
          activeRoute?.kind !== "artifact" ||
          activeRoute.value.artifactType !== "navigation.route" ||
          activeRoute.value.availability !== "available"
        ) {
          throw new Error("NAVIGATION_PLAN_ACTIVE_ROUTE_INVALID");
        }
        if (compareIsoTimestamps(fact.observedAt, activeRoute.value.updatedAt) <= 0) {
          throw new Error("NAVIGATION_PLAN_STALE_ADOPTION");
        }
      }
      const revision = (previous?.revision ?? 0) + 1;
      const artifact = TaskArtifactSchema.parse({
        schemaVersion: "sdar.task-artifact/1.0-rc2",
        artifactId: fact.routeId,
        artifactType: "navigation.route",
        revision,
        semantics: "planned",
        lifecycle: "active",
        identity: scopeBusinessIdentity(scope),
        source: {
          producer: "device_planner",
          sourceRecordRef: fact.sourceRecordId,
          sourceRevision: String(fact.routeRevision),
          method: fact.routeSource,
        },
        createdAt: previous?.createdAt ?? fact.observedAt,
        updatedAt: fact.observedAt,
        availability: "available",
        properties: {
          adoption: fact.adoption,
          purpose: "navigation",
          routeSource: fact.routeSource,
          routePlanId: fact.routePlanId,
        },
        relations: [
          {
            relationType: "planned_for_mission",
            target: { externalType: "ugv.mission", externalId: fact.missionId },
          },
        ],
        content: fact.content,
      });
      const ref = { kind: "artifact" as const, id: artifact.artifactId, revision };
      const activeRefs =
        fact.adoption === "adopted" ? { ...current.activeRefs, route: ref } : current.activeRefs;
      const context = TaskBusinessContextSchema.parse({
        ...current,
        contextRevision: current.contextRevision + 1,
        effectivePlanRevision:
          current.effectivePlanRevision + (fact.adoption === "adopted" ? 1 : 0),
        activeRefs,
        artifactRefs: [...current.artifactRefs, ref],
        updatedAt:
          compareIsoTimestamps(fact.observedAt, current.updatedAt) >= 0
            ? fact.observedAt
            : current.updatedAt,
      });
      const reasonCode =
        fact.adoption === "adopted" ? "NAVIGATION_ROUTE_ADOPTED" : "NAVIGATION_ROUTE_CANDIDATE";
      const body = TaskBusinessFeedbackBodySchema.parse({
        schemaVersion: "sdar.task-business-feedback/1.0-rc2",
        kind: "ARTIFACT_CHANGED",
        contextRevision: context.contextRevision,
        providerRecordedAt: fact.observedAt,
        payload: {
          change: previous ? "update" : "create",
          artifactRef: ref,
          ...(previous === undefined ? {} : { previousRevision: previous.revision }),
          reasonCode,
        },
      });
      const drafts = [{ body, description: reasonCode, reasonCode, severityHint: "info" as const }];
      if (fact.adoption === "adopted")
        drafts.push({
          body: TaskBusinessFeedbackBodySchema.parse({
            schemaVersion: "sdar.task-business-feedback/1.0-rc2",
            kind: "BUSINESS_EVENT",
            contextRevision: context.contextRevision,
            providerRecordedAt: fact.observedAt,
            payload: {
              eventType: "navigation.route_adopted",
              severity: "info",
              reasonCode,
              description: "Planner route adoption confirmed by source fact",
              subjects: [ref],
              contextDelta: { activeRefs, effectivePlanRevision: context.effectivePlanRevision },
            },
          }),
          description: "Planner route adopted",
          reasonCode,
          severityHint: "info",
        });
      try {
        const committed = await this.business.commitBusinessChangeSet(
          {
            scope,
            expectedContextRevision: current.contextRevision,
            context,
            objects: [{ kind: "artifact", value: artifact }],
          },
          drafts,
        );
        for (const event of committed.events) this.notifyCommitted(event);
        return "committed";
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "BUSINESS_CONTEXT_REVISION_CONFLICT" ||
          attempt === 2
        )
          throw error;
      }
    }
    throw new Error("NAVIGATION_PLAN_RETRY_EXHAUSTED");
  }
}
