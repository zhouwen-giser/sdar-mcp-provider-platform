import { z } from "zod";
import {
  RequiredInputSchema,
  type RequiredInput,
} from "../../packages/vehicle-provider-core/src/task-business-interaction.js";
import { runReadOnlyTaskBusinessProbe } from "./read-only-probe.js";
import { createWriteProbeClient, simulationProbeFetch } from "./write-probe-client.js";

const nonempty = z.string().min(1).max(512);

/** Every field is an exact, operator-supplied bound for one isolated run. */
export const UgvManualInputProbeManifestSchema = z
  .object({
    schema: z.literal("sdar.ugv-manual-input-probe/v1"),
    mcpUrl: z.url(),
    authorizationRef: nonempty,
    sceneInstanceId: nonempty,
    taskId: nonempty,
    executionId: nonempty,
    providerId: nonempty,
    resourceId: nonempty,
    requestId: nonempty,
    requestKey: nonempty,
    requestRevision: z.number().int().positive(),
    deadlineAt: z.iso.datetime({ offset: true }),
    lockSessionId: nonempty,
    targetId: nonempty,
    decision: z.enum(["continue_observation", "decline", "cancel"]),
    cleanupTaskAfter: z.boolean().default(false),
    maxPolls: z.number().int().min(1).max(60).default(10),
    pollIntervalMs: z.number().int().min(100).max(10_000).default(1_000),
    maxPageBytes: z.number().int().min(1_024).max(1_048_576).default(65_536),
  })
  .strict();

export type UgvManualInputProbeManifest = z.input<typeof UgvManualInputProbeManifestSchema>;

type RecordValue = Record<string, unknown>;

export async function runUgvManualInputProbe(input: {
  manifest: UgvManualInputProbeManifest;
  bearerToken: string;
  emit: (line: RecordValue) => void | Promise<void>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  wait?: (ms: number) => Promise<void>;
}): Promise<void> {
  const manifest = UgvManualInputProbeManifestSchema.parse(input.manifest);
  const fetchImpl = simulationProbeFetch(input.fetchImpl ?? fetch, manifest.sceneInstanceId);
  const now = input.now ?? (() => new Date());
  const wait = input.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const emit = async (line: RecordValue) =>
    input.emit({ schema: "sdar.ugv-manual-input-probe-result/v1", ...line });
  const request = createWriteProbeClient({
    mcpUrl: manifest.mcpUrl,
    taskId: manifest.taskId,
    bearerToken: input.bearerToken,
    clientName: "sdar-ugv-manual-input-probe",
    errorPrefix: "UGV_INPUT_PROBE",
    fetchImpl,
  });
  const publicSnapshot = async () => {
    let contextRevision: number | undefined;
    let activeRefs: RecordValue | undefined;
    let selected: RequiredInput | undefined;
    await runReadOnlyTaskBusinessProbe({
      mcpUrl: manifest.mcpUrl,
      taskId: manifest.taskId,
      bearerToken: input.bearerToken,
      snapshotOnly: true,
      maxPageBytes: manifest.maxPageBytes,
      durationMs: 15_000,
      emit: (line) => {
        if (line.type === "snapshot") {
          contextRevision = line.contextRevision as number;
          activeRefs = line.activeRefs as RecordValue;
        } else if (line.type === "businessObject" && record(line.object)) {
          const object = line.object;
          if (object.kind !== "input_request" || !record(object.value)) return;
          if (object.value.requestId !== manifest.requestId) return;
          const parsed = RequiredInputSchema.parse(object.value);
          if (!selected || parsed.revision > selected.revision) selected = parsed;
        }
      },
      fetchImpl,
    });
    if (contextRevision === undefined || !activeRefs || !selected)
      throw new Error("UGV_INPUT_PROBE_PUBLIC_REQUEST_MISSING");
    return { contextRevision, activeRefs, selected };
  };

  const before = await publicSnapshot();
  const pending = before.selected;
  const binding = pending.subjectBinding;
  const active = before.activeRefs["input:visualLock"];
  if (
    !record(active) ||
    active.kind !== "input_request" ||
    active.id !== manifest.requestId ||
    active.revision !== manifest.requestRevision ||
    pending.requestId !== manifest.requestId ||
    pending.requestKey !== manifest.requestKey ||
    pending.revision !== manifest.requestRevision ||
    pending.state !== "pending" ||
    pending.inputType !== "target.disposition_decision" ||
    pending.requiredResponder !== "user" ||
    pending.deadlineAt !== manifest.deadlineAt ||
    pending.identity.taskId !== manifest.taskId ||
    pending.identity.executionId !== manifest.executionId ||
    pending.identity.providerId !== manifest.providerId ||
    pending.identity.resourceId !== manifest.resourceId ||
    (pending.identity.simulationId !== undefined &&
      pending.identity.simulationId !== manifest.sceneInstanceId) ||
    pending.identity.operationName !== "vehicle_area_recon" ||
    binding.kind !== "visual_lock" ||
    binding.lockSessionId !== manifest.lockSessionId ||
    binding.targetId !== manifest.targetId ||
    binding.actionRef.id !== manifest.lockSessionId ||
    now().getTime() >= Date.parse(manifest.deadlineAt)
  )
    throw new Error("UGV_INPUT_PROBE_BINDING_MISMATCH");
  const task = await request("tasks/get", { taskId: manifest.taskId });
  const inputRequests = record(task.inputRequests) ? task.inputRequests : undefined;
  const visible = inputRequests?.[manifest.requestKey];
  const params = record(visible) && record(visible.params) ? visible.params : undefined;
  const metadata =
    params && record(params._meta) ? params._meta["io.sdar/taskBusiness"] : undefined;
  if (
    task.taskId !== manifest.taskId ||
    task.status !== "input_required" ||
    !record(metadata) ||
    metadata.requestId !== manifest.requestId ||
    metadata.requestKey !== manifest.requestKey ||
    metadata.revision !== manifest.requestRevision ||
    metadata.deadlineAt !== manifest.deadlineAt
  )
    throw new Error("UGV_INPUT_PROBE_RUNTIME_REQUEST_MISMATCH");
  await emit({
    type: "preflight",
    authorizationRef: manifest.authorizationRef,
    sceneInstanceId: manifest.sceneInstanceId,
    taskId: manifest.taskId,
    executionId: manifest.executionId,
    contextRevision: before.contextRevision,
    request: pending,
    taskStatus: task.status,
    sourceKind: "public_runtime_and_provider",
  });

  let pollFailure: Error | undefined;
  let confirmed = false;
  let updateAttempted = false;
  try {
    // The write may reach Runtime even when its HTTP response is lost. Once
    // attempted, the named Task cleanup policy applies to both ACK and error.
    if (now().getTime() >= Date.parse(manifest.deadlineAt))
      throw new Error("UGV_INPUT_PROBE_DEADLINE_EXPIRED_BEFORE_UPDATE");
    updateAttempted = true;
    const updated = await request("tasks/update", {
      taskId: manifest.taskId,
      inputResponses: {
        [manifest.requestKey]:
          manifest.decision === "continue_observation"
            ? { action: "accept", content: { decision: "continue_observation" } }
            : { action: manifest.decision },
      },
    });
    if (updated.resultType !== "complete") throw new Error("UGV_INPUT_PROBE_UPDATE_ACK_INVALID");
    await emit({
      type: "runtimeAccepted",
      taskId: manifest.taskId,
      requestId: manifest.requestId,
      resultType: updated.resultType,
      businessApplied: false,
    });
    for (let attempt = 0; attempt < manifest.maxPolls; attempt += 1) {
      await wait(manifest.pollIntervalMs);
      const after = await publicSnapshot();
      const answered = after.selected;
      const expectedState =
        manifest.decision === "continue_observation"
          ? "answered"
          : manifest.decision === "decline"
            ? "declined"
            : "cancelled";
      const expectedAction =
        manifest.decision === "continue_observation" ? "accept" : manifest.decision;
      const responseMatches =
        answered.response?.action === expectedAction &&
        (manifest.decision === "continue_observation"
          ? record(answered.response.value) &&
            answered.response.value.decision === "continue_observation"
          : answered.response.value === undefined);
      if (
        answered.revision === manifest.requestRevision + 1 &&
        answered.state === expectedState &&
        responseMatches &&
        !Object.values(after.activeRefs).some(
          (value) =>
            record(value) && value.kind === "input_request" && value.id === manifest.requestId,
        )
      ) {
        const finalTask = await request("tasks/get", { taskId: manifest.taskId });
        if (finalTask.taskId !== manifest.taskId || finalTask.status !== "working")
          throw new Error("UGV_INPUT_PROBE_TASK_NOT_RUNNING_AFTER_DECISION");
        await emit({
          type: "businessAnswerConfirmed",
          taskId: manifest.taskId,
          request: answered,
          contextRevision: after.contextRevision,
          taskStatus: finalTask.status,
          qualification: "runtime_wire_only",
          deviceEffectConfirmed: false,
        });
        confirmed = true;
        break;
      }
      if (answered.state !== "pending")
        throw new Error("UGV_INPUT_PROBE_UNEXPECTED_TERMINAL_REQUEST");
    }
    if (!confirmed) throw new Error("UGV_INPUT_PROBE_BUSINESS_ANSWER_NOT_CONFIRMED");
  } catch (error) {
    pollFailure = error instanceof Error ? error : new Error("UGV_INPUT_PROBE_POLL_FAILED");
  }
  let cleanupFailure: Error | undefined;
  if (manifest.cleanupTaskAfter && updateAttempted) {
    try {
      const cleanup = await request("tasks/cancel", { taskId: manifest.taskId });
      if (cleanup.resultType !== "complete") throw new Error("UGV_INPUT_PROBE_CLEANUP_ACK_INVALID");
      await emit({
        type: "cleanupRequested",
        taskId: manifest.taskId,
        resultType: cleanup.resultType,
        physicalStopConfirmed: false,
      });
    } catch (error) {
      cleanupFailure = error instanceof Error ? error : new Error("UGV_INPUT_PROBE_CLEANUP_FAILED");
    }
  }
  if (pollFailure && cleanupFailure)
    throw new AggregateError(
      [pollFailure, cleanupFailure],
      "UGV_INPUT_PROBE_POLL_AND_CLEANUP_FAILED",
    );
  if (pollFailure) throw pollFailure;
  if (cleanupFailure) throw cleanupFailure;
}

function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
