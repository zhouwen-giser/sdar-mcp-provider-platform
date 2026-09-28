import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../../adapter-protocol/src/index.js";
import type { AdapterBusinessEvent } from "../../adapter-protocol/src/index.js";
import {
  RequiredInputResponseCommandSchema,
  RuntimeInterventionCommandSchema,
  assessRequiredInputResponse,
  assertInterventionCommand,
  type RequiredInput,
  type RequiredInputResponseCommand,
  type RuntimeInterventionCommand,
  type TrustedResponder,
} from "../../vehicle-provider-core/src/task-business-interaction.js";
import {
  assertBoundExecutionScope,
  assertBusinessCommandEntryCurrent,
  scopeBusinessIdentity,
  taskBusinessInputResponseHash,
  type BoundExecutionScope,
  type BusinessCommandRecord,
  type TaskBusinessStore,
} from "./task-business-store.js";
import type { BusinessObjectRef } from "../../vehicle-provider-core/src/task-business-contract.js";

const sequence = /^[1-9][0-9]{0,18}$/;

/** Hash only the typed semantic request; display text and arrival time are absent. */
export function taskBusinessCommandRequestHash(
  command: RequiredInputResponseCommand | RuntimeInterventionCommand,
): string {
  const normalized =
    "requestId" in command
      ? RequiredInputResponseCommandSchema.parse(command)
      : RuntimeInterventionCommandSchema.parse(command);
  const semanticRequest = Object.fromEntries(
    Object.entries(normalized).filter(([key]) => key !== "commandId"),
  );
  return createHash("sha256").update(canonicalJson(semanticRequest)).digest("hex");
}

export interface BusinessCommandAcceptance {
  claimed: boolean;
  record: BusinessCommandRecord;
  /** Committed source events for a newly submitted Intervention, if any. */
  events?: AdapterBusinessEvent[];
  /** For a new input response only; retry uses the persisted record. */
  nextDisposition?:
    "await_result" | "release_and_resume_scan" | "end_observation" | "reissue_request";
}

/** Admits intent. Intervention admission also publishes `submitted`; device effects follow. */
export class TaskBusinessCommandService {
  constructor(
    readonly store: TaskBusinessStore,
    readonly now: () => Date = () => new Date(),
  ) {}

  async submitInputResponse(input: {
    scope: BoundExecutionScope;
    command: RequiredInputResponseCommand;
    responder: unknown;
    currentSubjectBinding: RequiredInput["subjectBinding"];
    runtimeCommandSequence: string;
  }): Promise<BusinessCommandAcceptance> {
    const { scope } = input;
    assertBoundExecutionScope(scope);
    const command = RequiredInputResponseCommandSchema.parse(input.command);
    assertScopeCommand(scope, command);
    const responder = parseTrustedResponder(input.responder);
    const entryKey = `input:${command.requestKey}`;
    const record = this.#record(
      scope,
      command,
      "input_response",
      entryKey,
      input.runtimeCommandSequence,
    );
    const replay = await this.#replay(scope, record);
    if (replay) return replay;
    try {
      const context = await this.store.getContext(scope);
      const ref = latestEntryRef(context?.requiredInputRefs, command.requestId);
      if (!context || !ref) throw new Error("INPUT_NOT_AVAILABLE");
      const version = await this.store.getObjectVersion(scope, ref);
      if (version?.kind !== "input_request") throw new Error("INPUT_NOT_AVAILABLE");
      const assessment = assessRequiredInputResponse(
        version.value,
        command,
        responder,
        context.contextRevision,
        input.currentSubjectBinding,
        this.now(),
      );
      assertBusinessCommandEntryCurrent(context, ref, "input_response");
      const claim = await this.store.claimCommand(
        scope,
        record,
        ref,
        this.now(),
        command.guard.mode === "legacy_strict" ? command.guard.expectedContextRevision : undefined,
      );
      return {
        ...claim,
        ...(claim.claimed ? { nextDisposition: assessment.nextDisposition } : {}),
      };
    } catch (error) {
      const raced = await this.#replay(scope, record);
      if (raced) return raced;
      throw error;
    }
  }

  async submitIntervention(input: {
    scope: BoundExecutionScope;
    command: RuntimeInterventionCommand;
    responder: unknown;
    runtimeCommandSequence: string;
  }): Promise<BusinessCommandAcceptance> {
    const { scope } = input;
    assertBoundExecutionScope(scope);
    const command = RuntimeInterventionCommandSchema.parse(input.command);
    assertScopeCommand(scope, command);
    parseTrustedResponder(input.responder);
    const entryKey = `intervention:${command.interventionId}`;
    const record = this.#record(
      scope,
      command,
      "intervention",
      entryKey,
      input.runtimeCommandSequence,
    );
    const replay = await this.#replay(scope, record);
    if (replay) return replay;
    try {
      const context = await this.store.getContext(scope);
      const ref = latestEntryRef(context?.interventionRefs, command.interventionId);
      if (!context || !ref) throw new Error("INTERVENTION_NOT_AVAILABLE");
      const version = await this.store.getObjectVersion(scope, ref);
      if (version?.kind !== "intervention") throw new Error("INTERVENTION_NOT_AVAILABLE");
      assertInterventionCommand(
        version.value,
        command,
        context.contextRevision,
        context.effectivePlanRevision,
        this.now(),
      );
      assertBusinessCommandEntryCurrent(context, ref, "intervention");
      return await this.store.claimCommand(
        scope,
        record,
        ref,
        this.now(),
        command.guard.mode === "legacy_strict" ? command.guard.expectedContextRevision : undefined,
        { publishInterventionSubmission: true },
      );
    } catch (error) {
      const raced = await this.#replay(scope, record);
      if (raced) return raced;
      throw error;
    }
  }

  #record(
    scope: BoundExecutionScope,
    command: RequiredInputResponseCommand | RuntimeInterventionCommand,
    commandType: BusinessCommandRecord["commandType"],
    entryKey: string,
    runtimeCommandSequence: string,
  ): BusinessCommandRecord {
    if (!sequence.test(runtimeCommandSequence)) throw new Error("RUNTIME_COMMAND_SEQUENCE_INVALID");
    const timestamp = this.now().toISOString();
    return {
      commandId: command.commandId,
      commandType,
      entryKey,
      runtimeCommandSequence,
      identity: scopeBusinessIdentity(scope),
      requestHash: taskBusinessCommandRequestHash(command),
      ...("requestId" in command
        ? {
            responseHash: taskBusinessInputResponseHash(command.result),
            inputResponse: command.result,
          }
        : {}),
      state: "accepted",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  async #replay(
    scope: BoundExecutionScope,
    submitted: BusinessCommandRecord,
  ): Promise<BusinessCommandAcceptance | undefined> {
    const record = await this.store.getCommand(scope, submitted.commandId);
    if (!record) return undefined;
    if (
      record.commandType !== submitted.commandType ||
      record.entryKey !== submitted.entryKey ||
      record.runtimeCommandSequence !== submitted.runtimeCommandSequence ||
      record.requestHash !== submitted.requestHash ||
      record.responseHash !== submitted.responseHash
    ) {
      throw new Error("COMMAND_ID_CONFLICT");
    }
    return { claimed: false, record };
  }
}

/** Context keeps history, so command preflight must inspect the newest listed version. */
function latestEntryRef(
  refs: readonly BusinessObjectRef[] | undefined,
  id: string,
): BusinessObjectRef | undefined {
  let latest: BusinessObjectRef | undefined;
  for (const ref of refs ?? []) {
    if (ref.id === id && (latest === undefined || ref.revision > latest.revision)) latest = ref;
  }
  return latest;
}

function assertScopeCommand(
  scope: BoundExecutionScope,
  command: RequiredInputResponseCommand | RuntimeInterventionCommand,
): void {
  if (command.taskId !== scope.taskId || command.executionId !== scope.executionId) {
    throw new Error("BUSINESS_COMMAND_SCOPE_MISMATCH");
  }
}

function parseTrustedResponder(input: unknown): TrustedResponder {
  const parsed = z
    .object({
      source: z.literal("runtime_authorization_context"),
      actorType: z.enum(["user", "agent", "operator"]),
      verified: z.literal(true),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) throw new Error("RESPONDER_NOT_AUTHORIZED");
  return parsed.data;
}
