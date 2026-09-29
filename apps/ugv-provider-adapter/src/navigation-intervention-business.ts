import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import type { AdapterBusinessEvent } from "../../../packages/adapter-protocol/src/index.js";
import {
  BoundExecutionScope,
  type BusinessCommandRecord,
  type BusinessObjectVersion,
  type ProviderExecution,
  type TaskBusinessEventDraft,
  type TaskBusinessStore,
} from "../../../packages/provider-adapter-kit/src/index.js";
import {
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
  type BusinessObjectRef,
  type TaskBusinessContext,
} from "../../../packages/vehicle-provider-core/src/task-business-contract.js";
import {
  RuntimeInterventionSchema,
  type RuntimeIntervention,
} from "../../../packages/vehicle-provider-core/src/task-business-interaction.js";
import { NavigationPlanningRequestSchema } from "./navigation-planner.js";

export const NavigationAdjustmentInputSchema = NavigationPlanningRequestSchema.pick({
  waypoints: true,
  density: true,
});
const destination = NavigationPlanningRequestSchema.shape.start;
/** The Context transaction is authoritative. Execution may cache this after commit. */
export const EffectiveNavigationSchema = z
  .object({
    missionId: z.string().min(1).max(256),
    planId: z.string().min(1).max(256),
    planRevision: z.number().int().positive(),
    routeRef: z
      .object({
        kind: z.literal("artifact"),
        id: z.string().min(1),
        revision: z.number().int().positive(),
      })
      .strict(),
    requested: NavigationAdjustmentInputSchema,
    destination,
    adoptedAt: z.iso.datetime({ offset: true }),
    commandId: z.string().min(1).max(256).optional(),
  })
  .strict();
export type EffectiveNavigation = z.infer<typeof EffectiveNavigationSchema>;

export function navigationAdjustmentEntry(
  context: TaskBusinessContext,
  at: string,
  suffix = "",
): RuntimeIntervention {
  return RuntimeInterventionSchema.parse({
    schemaVersion: "sdar.runtime-intervention/1.0-rc2",
    interventionId: `navigation-adjust-${context.effectivePlanRevision}${suffix}`,
    interventionType: "navigation.adjust_plan",
    identity: context.identity,
    revision: 1,
    effectivePlanRevision: context.effectivePlanRevision,
    blocking: false,
    state: "available",
    title: "调整导航路线",
    description: "通过现有道路规划与任务重执行调整路线；新任务运行确认后生效。",
    inputSchema: z.toJSONSchema(NavigationAdjustmentInputSchema),
    appliesTo: context.activeRefs.route ? [context.activeRefs.route] : [],
    reasonCode: "NAVIGATION_ADJUSTMENT_AVAILABLE",
    createdAt: at,
  });
}

export function interventionRef(
  entry: RuntimeIntervention,
): BusinessObjectRef & { kind: "intervention" } {
  return { kind: "intervention", id: entry.interventionId, revision: entry.revision };
}
export function navigationBusinessEvent(
  context: TaskBusinessContext,
  at: string,
  reasonCode: string,
  subjects: BusinessObjectRef[] = [],
): TaskBusinessEventDraft {
  return {
    description: reasonCode,
    reasonCode,
    severityHint: "info",
    body: TaskBusinessFeedbackBodySchema.parse({
      schemaVersion: "sdar.task-business-feedback/1.0-rc2",
      contextRevision: context.contextRevision,
      providerRecordedAt: at,
      kind: "BUSINESS_EVENT",
      payload: {
        eventType: "navigation.plan_transition",
        severity: "info",
        reasonCode,
        description: reasonCode,
        subjects,
        contextDelta: {
          activeRefs: context.activeRefs,
          effectivePlanRevision: context.effectivePlanRevision,
          summary: context.summary,
        },
      },
    }),
  };
}
export function interventionChanged(
  context: TaskBusinessContext,
  entry: RuntimeIntervention,
  at: string,
): TaskBusinessEventDraft {
  return {
    description: entry.reasonCode,
    reasonCode: entry.reasonCode,
    severityHint: "info",
    body: TaskBusinessFeedbackBodySchema.parse({
      schemaVersion: "sdar.task-business-feedback/1.0-rc2",
      contextRevision: context.contextRevision,
      providerRecordedAt: at,
      kind: "INTERVENTION_CHANGED",
      payload: {
        change: entry.revision === 1 ? "create" : "update",
        interventionRef: interventionRef(entry),
        ...(entry.revision === 1 ? {} : { previousRevision: entry.revision - 1 }),
        reasonCode: entry.reasonCode,
      },
    }),
  };
}

export class NavigationInterventionBusiness {
  constructor(
    readonly business: TaskBusinessStore,
    readonly notify: (event: AdapterBusinessEvent) => void,
    readonly now: () => Date = () => new Date(),
  ) {}

  async pending(execution: ProviderExecution): Promise<BusinessCommandRecord | undefined> {
    const scope = BoundExecutionScope.fromExecution(execution);
    const context = await this.business.getContext(scope);
    const ref = context?.activeRefs.navigationAdjustment;
    if (ref?.kind !== "intervention") return undefined;
    const version = await this.business.getObjectVersion(scope, ref);
    if (
      version?.kind !== "intervention" ||
      version.value.interventionType !== "navigation.adjust_plan" ||
      !["submitted", "applying"].includes(version.value.state) ||
      !version.value.acceptedCommandId
    )
      return undefined;
    const command = await this.business.getCommand(scope, version.value.acceptedCommandId);
    if (
      command?.state !== "accepted" ||
      command.entryKey !== `intervention:${ref.id}` ||
      !command.interventionRequest
    )
      throw new Error("UGV_NAVIGATION_COMMAND_RECOVERY_INVALID");
    return command;
  }

  async transition(
    execution: ProviderExecution,
    commandId: string,
    state: "applying" | "failed" | "withdrawn",
    reasonCode: string,
  ): Promise<void> {
    const scope = BoundExecutionScope.fromExecution(execution);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const command = await this.business.getCommand(scope, commandId);
      if (command?.commandType !== "intervention")
        throw new Error("UGV_NAVIGATION_COMMAND_MISSING");
      if (command.state !== "accepted") return;
      const context = await this.business.getContext(scope);
      const ref = context?.activeRefs.navigationAdjustment;
      if (
        !context ||
        !ref ||
        command.entryKey !== `intervention:${ref.id}` ||
        context.summary.status !== "in_progress"
      )
        throw new Error("UGV_NAVIGATION_ENTRY_NOT_CURRENT");
      const version = await this.business.getObjectVersion(scope, ref);
      if (version?.kind !== "intervention" || version.value.acceptedCommandId !== commandId)
        throw new Error("UGV_NAVIGATION_ENTRY_NOT_CURRENT");
      if (state === "applying" && version.value.state === "applying") return;
      const at = new Date(
        Math.max(this.now().getTime(), Date.parse(context.updatedAt)),
      ).toISOString();
      const entry = RuntimeInterventionSchema.parse({
        ...version.value,
        revision: version.value.revision + 1,
        state,
        reasonCode,
      });
      const activeRefs = { ...context.activeRefs };
      if (state === "applying") activeRefs.navigationAdjustment = interventionRef(entry);
      else delete activeRefs.navigationAdjustment;
      const next = TaskBusinessContextSchema.parse({
        ...context,
        contextRevision: context.contextRevision + 1,
        activeRefs,
        interventionRefs: [...context.interventionRefs, interventionRef(entry)],
        updatedAt: at,
      });
      const objects: BusinessObjectVersion[] = [{ kind: "intervention", value: entry }];
      try {
        const result = await this.business.commitBusinessChangeSet(
          {
            scope,
            expectedContextRevision: context.contextRevision,
            context: next,
            objects,
            ...(state === "applying"
              ? {}
              : {
                  command: {
                    ...command,
                    state: "rejected" as const,
                    resultCode: reasonCode,
                    updatedAt: at,
                  },
                }),
          },
          [
            interventionChanged(next, entry, at),
            navigationBusinessEvent(next, at, reasonCode, [interventionRef(entry)]),
          ],
        );
        for (const event of result.events) this.notify(event);
        return;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "BUSINESS_CONTEXT_REVISION_CONFLICT" ||
          attempt === 2
        )
          throw error;
      }
    }
  }
}

/** Add applied result, authoritative intent and next entry to the route transaction. */
export async function prepareNavigationAdoption(
  business: Pick<TaskBusinessStore, "getCommand" | "getObjectVersion">,
  scope: BoundExecutionScope,
  previous: TaskBusinessContext,
  context: TaskBusinessContext,
  effective: EffectiveNavigation,
  offerAdjustment: boolean,
): Promise<{
  context: TaskBusinessContext;
  objects: BusinessObjectVersion[];
  events: TaskBusinessEventDraft[];
  command?: BusinessCommandRecord;
}> {
  EffectiveNavigationSchema.parse(effective);
  const at = context.updatedAt;
  const objects: BusinessObjectVersion[] = [];
  let appliedCommand: BusinessCommandRecord | undefined;
  const activeRefs = { ...context.activeRefs };
  const interventionRefs = [...context.interventionRefs];
  if (effective.commandId) {
    const command = await business.getCommand(scope, effective.commandId);
    const ref = previous.activeRefs.navigationAdjustment;
    if (command?.state !== "accepted" || !ref || command.entryKey !== `intervention:${ref.id}`)
      throw new Error("UGV_NAVIGATION_COMMAND_NOT_CURRENT");
    const version = await business.getObjectVersion(scope, ref);
    if (
      version?.kind !== "intervention" ||
      version.value.interventionType !== "navigation.adjust_plan" ||
      version.value.state !== "applying" ||
      version.value.acceptedCommandId !== command.commandId
    )
      throw new Error("UGV_NAVIGATION_ENTRY_NOT_APPLYING");
    if (
      !command.interventionRequest ||
      !isDeepStrictEqual(
        NavigationAdjustmentInputSchema.parse(command.interventionRequest.input),
        effective.requested,
      )
    )
      throw new Error("UGV_NAVIGATION_REQUEST_BINDING_INVALID");
    const entry = RuntimeInterventionSchema.parse({
      ...version.value,
      revision: version.value.revision + 1,
      state: "applied",
      reasonCode: "NAVIGATION_REPLACEMENT_ADOPTED",
      resultRefs: [effective.routeRef],
    });
    objects.push({ kind: "intervention", value: entry });
    interventionRefs.push(interventionRef(entry));
    delete activeRefs.navigationAdjustment;
    appliedCommand = {
      ...command,
      state: "applied",
      resultCode: "NAVIGATION_REPLACEMENT_ADOPTED",
      resultRefs: [effective.routeRef],
      updatedAt: at,
    };
  } else if (previous.activeRefs.navigationAdjustment) {
    throw new Error("UGV_NAVIGATION_ADOPTION_COMMAND_REQUIRED");
  }
  let next = TaskBusinessContextSchema.parse({
    ...context,
    activeRefs,
    interventionRefs,
    summary: {
      ...context.summary,
      properties: { ...context.summary.properties, navigationEffective: effective },
    },
  });
  if (offerAdjustment) {
    const entry = navigationAdjustmentEntry(next, at);
    objects.push({ kind: "intervention", value: entry });
    next = TaskBusinessContextSchema.parse({
      ...next,
      activeRefs: { ...next.activeRefs, navigationAdjustment: interventionRef(entry) },
      interventionRefs: [...next.interventionRefs, interventionRef(entry)],
    });
  }
  const events = objects.flatMap((version) =>
    version.kind === "intervention" ? [interventionChanged(next, version.value, at)] : [],
  );
  events.push(
    navigationBusinessEvent(
      next,
      at,
      effective.commandId ? "NAVIGATION_REPLACEMENT_ADOPTED" : "NAVIGATION_ROUTE_ADOPTED",
      [effective.routeRef],
    ),
  );
  return { context: next, objects, events, ...(appliedCommand ? { command: appliedCommand } : {}) };
}
