import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  RuntimeInterventionCommandSchema,
  RuntimeInterventionSchema,
  assertInterventionCommand,
  type RuntimeIntervention,
} from "../../packages/vehicle-provider-core/src/task-business-interaction.js";
import { runReadOnlyTaskBusinessProbe } from "./read-only-probe.js";
import {
  createWriteProbeClient,
  simulationProbeFetch,
  isProbeRecord as record,
  type ProbeRecord,
} from "./write-probe-client.js";

const id = z.string().min(1).max(256);

export const UgvInterventionProbeManifestSchema = z
  .object({
    schema: z.literal("sdar.ugv-intervention-probe/v1"),
    mcpUrl: z.url(),
    authorizationRef: id,
    sceneInstanceId: id,
    taskId: id,
    executionId: id,
    providerId: id,
    resourceId: id,
    correlationId: id.optional(),
    interventionId: id,
    interventionRevision: z.number().int().positive(),
    effectivePlanRevision: z.number().int().nonnegative(),
    commandId: id,
    input: z.record(id, z.unknown()),
    submitBefore: z.iso.datetime({ offset: true }),
    cleanupTaskAfter: z.boolean().default(false),
    maxPolls: z.number().int().min(1).max(60).default(10),
    pollIntervalMs: z.number().int().min(100).max(10_000).default(1_000),
  })
  .strict();

export type UgvInterventionProbeManifest = z.input<typeof UgvInterventionProbeManifestSchema>;

/** One explicit navigation.adjust_plan command; the public result never proves device effect. */
export async function runUgvInterventionProbe(input: {
  manifest: UgvInterventionProbeManifest;
  bearerToken: string;
  emit: (line: ProbeRecord) => void | Promise<void>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  wait?: (ms: number) => Promise<void>;
}): Promise<void> {
  const manifest = UgvInterventionProbeManifestSchema.parse(input.manifest);
  const fetchImpl = simulationProbeFetch(input.fetchImpl ?? fetch, manifest.sceneInstanceId);
  const now = input.now ?? (() => new Date());
  const wait = input.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const request = createWriteProbeClient({
    mcpUrl: manifest.mcpUrl,
    taskId: manifest.taskId,
    bearerToken: input.bearerToken,
    clientName: "sdar-ugv-intervention-probe",
    errorPrefix: "UGV_INTERVENTION_PROBE",
    fetchImpl,
  });
  const emit = async (line: ProbeRecord) =>
    input.emit({ schema: "sdar.ugv-intervention-probe-result/v1", ...line });
  const identity = {
    taskId: manifest.taskId,
    executionId: manifest.executionId,
    providerId: manifest.providerId,
    resourceId: manifest.resourceId,
    operationName: "vehicle_navigate",
    ...(manifest.correlationId === undefined ? {} : { correlationId: manifest.correlationId }),
  };
  const command = RuntimeInterventionCommandSchema.parse({
    schemaVersion: "sdar.runtime-intervention-command/1.0-rc2",
    commandId: manifest.commandId,
    taskId: manifest.taskId,
    executionId: manifest.executionId,
    interventionId: manifest.interventionId,
    guard: {
      mode: "semantic",
      expectedInterventionRevision: manifest.interventionRevision,
      expectedEffectivePlanRevision: manifest.effectivePlanRevision,
    },
    input: manifest.input,
  });
  const snapshot = async () => {
    let summary: ProbeRecord | undefined;
    let selected: RuntimeIntervention | undefined;
    const objects = new Map<string, ProbeRecord>();
    await runReadOnlyTaskBusinessProbe({
      mcpUrl: manifest.mcpUrl,
      taskId: manifest.taskId,
      bearerToken: input.bearerToken,
      snapshotOnly: true,
      durationMs: 15_000,
      fetchImpl,
      emit: (line) => {
        if (line.type === "snapshot") summary = line;
        if (line.type !== "businessObject" || !record(line.object)) return;
        const object = line.object;
        if (!record(object.value)) return;
        const value = object.value;
        const objectId =
          value.artifactId ?? value.actionId ?? value.requestId ?? value.interventionId;
        objects.set(`${String(object.kind)}:${String(objectId)}:${String(value.revision)}`, object);
        if (object.kind === "intervention" && value.interventionId === manifest.interventionId) {
          const parsed = RuntimeInterventionSchema.parse(value);
          if (!selected || parsed.revision > selected.revision) selected = parsed;
        }
      },
    });
    const snapshotIdentity = record(summary?.identity) ? summary.identity : undefined;
    if (
      !summary ||
      !selected ||
      !record(summary.activeRefs) ||
      !Number.isSafeInteger(summary.contextRevision) ||
      !Number.isSafeInteger(summary.effectivePlanRevision) ||
      !snapshotIdentity ||
      !Object.entries(identity).every(([key, value]) =>
        isDeepStrictEqual(snapshotIdentity[key], value),
      ) ||
      (snapshotIdentity.simulationId !== undefined &&
        snapshotIdentity.simulationId !== manifest.sceneInstanceId) ||
      !isDeepStrictEqual(selected.identity, snapshotIdentity) ||
      selected.interventionType !== "navigation.adjust_plan" ||
      selected.effectivePlanRevision !== manifest.effectivePlanRevision
    )
      throw new Error("UGV_INTERVENTION_PROBE_BINDING_MISMATCH");
    return {
      selected,
      objects,
      activeRefs: summary.activeRefs,
      contextRevision: summary.contextRevision as number,
      effectivePlanRevision: summary.effectivePlanRevision as number,
    };
  };
  const before = await snapshot();
  if (
    !Object.values(before.activeRefs).some(
      (ref) =>
        record(ref) &&
        ref.kind === "intervention" &&
        ref.id === manifest.interventionId &&
        ref.revision === manifest.interventionRevision,
    )
  )
    throw new Error("UGV_INTERVENTION_PROBE_ENTRY_NOT_ACTIVE");
  assertInterventionCommand(
    before.selected,
    command,
    before.contextRevision,
    before.effectivePlanRevision,
    now(),
  );
  const task = await request("tasks/get", { taskId: manifest.taskId });
  if (task.taskId !== manifest.taskId || task.status !== "working")
    throw new Error("UGV_INTERVENTION_PROBE_TASK_NOT_RUNNING");
  await emit({
    type: "preflight",
    authorizationRef: manifest.authorizationRef,
    identity,
    contextRevision: before.contextRevision,
    intervention: before.selected,
    command,
  });

  let attempted = false;
  let failure: Error | undefined;
  try {
    if (!Number.isFinite(now().getTime()) || now().getTime() >= Date.parse(manifest.submitBefore))
      throw new Error("UGV_INTERVENTION_PROBE_SUBMISSION_EXPIRED");
    assertInterventionCommand(
      before.selected,
      command,
      before.contextRevision,
      before.effectivePlanRevision,
      now(),
    );
    attempted = true;
    const accepted = await request("io.sdar/taskBusiness/interventions/apply", {
      ...command,
      externalExecutionId: manifest.executionId,
      resourceId: manifest.resourceId,
      executionMode: "simulation",
      simulationId: manifest.sceneInstanceId,
    });
    const receipt = accepted.receipt;
    if (
      accepted.resultType !== "complete" ||
      accepted.profileVersion !== "1.0-rc2" ||
      !record(receipt) ||
      receipt.commandId !== manifest.commandId ||
      !Number.isSafeInteger(receipt.commandSequence) ||
      Number(receipt.commandSequence) < 1 ||
      typeof receipt.commandState !== "string" ||
      typeof receipt.duplicate !== "boolean" ||
      receipt.durablyAccepted !== true ||
      receipt.businessApplied !== false
    )
      throw new Error("UGV_INTERVENTION_PROBE_RECEIPT_INVALID");
    await emit({
      type: "runtimeAccepted",
      taskId: manifest.taskId,
      receipt,
      businessApplied: false,
    });
    let confirmed = false;
    for (let attempt = 0; attempt < manifest.maxPolls; attempt += 1) {
      await wait(manifest.pollIntervalMs);
      const after = await snapshot();
      const entry = after.selected;
      if (entry.state === "available") continue;
      if (
        entry.acceptedCommandId !== manifest.commandId ||
        entry.revision <= manifest.interventionRevision
      )
        throw new Error("UGV_INTERVENTION_PROBE_COMMAND_MISMATCH");
      await emit({
        type: "providerState",
        taskId: manifest.taskId,
        contextRevision: after.contextRevision,
        intervention: entry,
        deviceEffectConfirmed: false,
      });
      if (["failed", "expired", "withdrawn"].includes(entry.state))
        throw new Error(`UGV_INTERVENTION_PROBE_PROVIDER_${entry.state.toUpperCase()}`);
      if (entry.state !== "applied") continue;
      const results = (entry.resultRefs ?? []).map((ref) =>
        after.objects.get(`${ref.kind}:${ref.id}:${ref.revision}`),
      );
      const routeRef = after.activeRefs.route;
      const route = record(routeRef)
        ? after.objects.get(`artifact:${String(routeRef.id)}:${String(routeRef.revision)}`)
        : undefined;
      if (
        after.effectivePlanRevision !== manifest.effectivePlanRevision + 1 ||
        after.contextRevision <= before.contextRevision ||
        results.length === 0 ||
        results.some((object) => object === undefined) ||
        Object.values(after.activeRefs).some(
          (ref) => record(ref) && ref.kind === "intervention" && ref.id === entry.interventionId,
        ) ||
        !route ||
        !results.includes(route) ||
        !record(route.value) ||
        route.value.artifactType !== "navigation.route" ||
        route.value.availability !== "available" ||
        !record(route.value.properties) ||
        route.value.properties.adoption !== "adopted"
      )
        throw new Error("UGV_INTERVENTION_PROBE_APPLIED_RESULT_INVALID");
      const currentTask = await request("tasks/get", { taskId: manifest.taskId });
      if (
        currentTask.taskId !== manifest.taskId ||
        !["working", "completed"].includes(String(currentTask.status))
      )
        throw new Error("UGV_INTERVENTION_PROBE_TASK_STATE_INVALID");
      await emit({
        type: "businessAppliedConfirmed",
        taskId: manifest.taskId,
        commandId: manifest.commandId,
        contextRevision: after.contextRevision,
        effectivePlanRevision: after.effectivePlanRevision,
        intervention: entry,
        results,
        taskStatus: currentTask.status,
        qualification: "runtime_wire_only",
        deviceEffectConfirmed: false,
      });
      confirmed = true;
      break;
    }
    if (!confirmed) throw new Error("UGV_INTERVENTION_PROBE_APPLIED_NOT_CONFIRMED");
  } catch (error) {
    failure =
      error instanceof Error ? error : new Error("UGV_INTERVENTION_PROBE_FAILED", { cause: error });
  }
  if (manifest.cleanupTaskAfter && attempted) {
    try {
      const cleanup = await request("tasks/cancel", { taskId: manifest.taskId });
      if (cleanup.resultType !== "complete")
        throw new Error("UGV_INTERVENTION_PROBE_CLEANUP_ACK_INVALID");
      await emit({
        type: "cleanupRequested",
        taskId: manifest.taskId,
        physicalStopConfirmed: false,
      });
    } catch (error) {
      if (failure)
        throw new AggregateError([failure, error], "UGV_INTERVENTION_PROBE_AND_CLEANUP_FAILED", {
          cause: error,
        });
      throw error;
    }
  }
  if (failure) throw failure;
}
