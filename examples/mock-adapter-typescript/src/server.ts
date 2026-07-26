import * as grpc from "@grpc/grpc-js";
import {
  adapterServiceDefinition,
  ADAPTER_PROTOCOL_VERSION,
  jsonToProtoStruct,
  protoStructToJson,
} from "../../../packages/adapter-protocol/src/index.js";
import type {
  AdapterBusinessEvent,
  BusinessEventSourceCapability,
} from "../../../packages/adapter-protocol/src/index.js";
import { JsonFileStore } from "./store.js";

export interface MockAdapterOptions {
  providerId?: string;
  providerVersion?: string;
  onStartSideEffect?: (taskId: string, reservationRef?: string) => void;
  onControlSideEffect?: (taskId: string, command: string) => void;
  statePath?: string;
  startResponseDelayMs?: number;
  businessEventSources?: BusinessEventSourceCapability[];
  businessEvents?: Record<string, AdapterBusinessEvent[]>;
  businessEventTermination?: {
    sourceId: string;
    code: grpc.status;
    reasonCode: string;
  };
}

interface MockExecution {
  externalExecutionId: string;
  operationName: string;
  argumentHash: string;
  reservationRef?: string;
  executionContext: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  terminalSnapshot: Record<string, unknown>;
  waitingForInput?: boolean;
  scenario?: string;
  holdSnapshot?: boolean;
  holdReads?: number;
  inputRound?: number;
  cancelAttempts?: number;
  commandAcks: Record<string, Record<string, unknown>>;
}

function notFound(message: string): grpc.ServiceError {
  return Object.assign(new Error(message), { code: grpc.status.NOT_FOUND }) as grpc.ServiceError;
}

function sourceError(code: grpc.status, reasonCode: string): grpc.ServiceError {
  const metadata = new grpc.Metadata();
  metadata.set("io.sdar.business-events.reason-code", reasonCode);
  return Object.assign(new Error(reasonCode), { code, metadata }) as grpc.ServiceError;
}

export function createMockAdapterServer(options: MockAdapterOptions = {}): grpc.Server {
  const providerId = options.providerId ?? "mock-provider";
  const providerVersion = options.providerVersion ?? "1.0.0";
  const server = new grpc.Server();
  const executions = new JsonFileStore<MockExecution>(
    options.statePath ?? process.env.ADAPTER_STATE_PATH,
  );

  server.addService(adapterServiceDefinition(), {
    checkAvailability: (
      call: grpc.ServerUnaryCall<
        { checks?: { requestId?: string; operationName?: string; arguments?: unknown }[] },
        unknown
      >,
      callback: grpc.sendUnaryData<unknown>,
    ) => {
      const checkedAt = new Date();
      const validUntil = new Date(checkedAt.getTime() + 10_000);
      callback(null, {
        profileVersion: "1.0",
        checkedAt: timestamp(checkedAt),
        checks: (call.request.checks ?? []).map((check) => {
          const argumentsValue = protoStructToJson(check.arguments);
          if (argumentsValue.scenario === "restricted") {
            return {
              requestId: check.requestId,
              operationName: check.operationName,
              availability: "RESTRICTED",
              riskLevel: "HIGH",
              reservationMode: "NONE",
              reasonCode: "PREEMPTIBLE_TASK_ACTIVE",
              description: "The resource may require preemption.",
              validUntil: timestamp(validUntil),
              earliestStartTime: timestamp(validUntil),
              nextAvailableWindows: [
                {
                  startTime: timestamp(validUntil),
                  endTime: timestamp(new Date(validUntil.getTime() + 60_000)),
                },
              ],
              estimatedDelayMs: "10000",
              possibleEffects: ["task_preemption", "start_rejection"],
            };
          }
          if (argumentsValue.scenario === "disabled") {
            return {
              requestId: check.requestId,
              operationName: check.operationName,
              availability: "DISABLED",
              riskLevel: "LOW",
              reservationMode: "NONE",
              reasonCode: "RESOURCE_DISABLED",
              description: "The resource is disabled.",
            };
          }
          if (argumentsValue.scenario === "unknown") {
            return {
              requestId: check.requestId,
              operationName: check.operationName,
              availability: "UNKNOWN",
              riskLevel: "MEDIUM",
              reservationMode: "NONE",
              reasonCode: "RESOURCE_STATE_UNKNOWN",
              description: "The reference resource state is unknown.",
              validUntil: timestamp(validUntil),
            };
          }
          return {
            requestId: check.requestId,
            operationName: check.operationName,
            availability: "AVAILABLE",
            riskLevel: "LOW",
            reservationMode: "NONE",
            reasonCode: "AVAILABLE",
            description: "The operation is currently predicted to be available.",
            validUntil: timestamp(validUntil),
          };
        }),
      });
    },
    describeProvider: (
      _call: grpc.ServerUnaryCall<unknown, unknown>,
      callback: grpc.sendUnaryData<unknown>,
    ) => {
      callback(null, {
        adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
        providerId,
        providerType: "reference",
        providerVersion,
        inventoryMode: "RUNTIME_VISIBLE",
        businessEventSources: options.businessEventSources ?? [],
        operations: [
          {
            name: "echo_sync",
            description: "Returns the supplied message synchronously.",
            execution: "SYNCHRONOUS",
            inputSchema: jsonToProtoStruct({
              type: "object",
              properties: { message: { type: "string" } },
              required: ["message"],
              additionalProperties: false,
            }),
            outputSchema: jsonToProtoStruct({
              type: "object",
              properties: { message: { type: "string" } },
              required: ["message"],
              additionalProperties: false,
            }),
            capabilities: {
              availability: true,
              scheduling: false,
              maxElapsed: false,
              cancel: false,
              pauseResume: false,
              inputRequired: false,
              idempotency: true,
              observations: false,
            },
            resourceBinding: { mode: "NONE" },
          },
          {
            name: "durable_task",
            description: "Reference long-running task used by conformance scenarios.",
            execution: "TASK_REQUIRED",
            inputSchema: jsonToProtoStruct({
              type: "object",
              properties: {
                resourceId: { type: "string" },
                scenario: { type: "string" },
              },
              required: ["resourceId"],
              additionalProperties: false,
            }),
            outputSchema: jsonToProtoStruct({
              type: "object",
              properties: {
                resourceId: { type: "string" },
                completed: { type: "boolean" },
              },
              required: ["resourceId", "completed"],
              additionalProperties: false,
            }),
            capabilities: {
              availability: true,
              scheduling: true,
              maxElapsed: true,
              cancel: true,
              pauseResume: true,
              inputRequired: true,
              idempotency: true,
              observations: true,
            },
            resourceBinding: {
              mode: "ARGUMENT_REFERENCE",
              resourceIdJsonPointer: "/resourceId",
            },
          },
          {
            name: "flex_task",
            description: "Completes inline or continues as a task according to the scenario.",
            execution: "TASK_CAPABLE",
            inputSchema: jsonToProtoStruct({
              type: "object",
              properties: {
                resourceId: { type: "string" },
                scenario: {
                  type: "string",
                  enum: ["terminal", "terminal_invalid_output", "running"],
                },
              },
              required: ["resourceId", "scenario"],
              additionalProperties: false,
            }),
            outputSchema: jsonToProtoStruct({
              type: "object",
              properties: {
                resourceId: { type: "string" },
                completed: { type: "boolean" },
              },
              required: ["resourceId", "completed"],
              additionalProperties: false,
            }),
            capabilities: {
              availability: true,
              scheduling: false,
              maxElapsed: false,
              cancel: false,
              pauseResume: false,
              inputRequired: false,
              idempotency: true,
              observations: true,
            },
            resourceBinding: {
              mode: "ARGUMENT_REFERENCE",
              resourceIdJsonPointer: "/resourceId",
            },
          },
        ],
      });
    },
    streamBusinessEvents: (
      call: grpc.ServerWritableStream<
        {
          sourceId?: string;
          sourceStreamId?: string;
          afterSourceSequence?: string;
          _afterSourceSequence?: string;
        },
        AdapterBusinessEvent
      >,
    ) => {
      const source = (options.businessEventSources ?? []).find(
        (candidate) => candidate.sourceId === call.request.sourceId,
      );
      if (source === undefined) {
        call.emit("error", sourceError(grpc.status.NOT_FOUND, "SOURCE_NOT_FOUND"));
        return;
      }
      if (source.sourceStreamId !== call.request.sourceStreamId) {
        call.emit("error", sourceError(grpc.status.FAILED_PRECONDITION, "SOURCE_STREAM_RESET"));
        return;
      }
      const hasCursor = call.request._afterSourceSequence === "afterSourceSequence";
      if (source.deliverySemantics === "best_effort_live" && hasCursor) {
        call.emit("error", sourceError(grpc.status.OUT_OF_RANGE, "SOURCE_CURSOR_AHEAD"));
        return;
      }
      const termination = options.businessEventTermination;
      if (termination?.sourceId === source.sourceId) {
        call.emit("error", sourceError(termination.code, termination.reasonCode));
        return;
      }
      const after = BigInt(hasCursor ? (call.request.afterSourceSequence ?? "0") : "0");
      for (const event of options.businessEvents?.[source.sourceId] ?? []) {
        if (
          source.deliverySemantics === "best_effort_live" ||
          BigInt(event.sourceSequence) > after
        ) {
          call.write(event);
        }
      }
      call.end();
    },
    getExecution: (
      call: grpc.ServerUnaryCall<{ taskId?: string }, unknown>,
      callback: grpc.sendUnaryData<unknown>,
    ) => {
      const taskId = call.request.taskId ?? "";
      const execution = executions.get(taskId);
      if (execution === undefined) {
        callback(notFound(`Execution ${taskId || "<missing>"} does not exist`));
        return;
      }
      if (execution.scenario === "get_transient_failure") {
        callback(
          Object.assign(new Error("injected GetExecution transient failure"), {
            code: grpc.status.UNAVAILABLE,
          }),
        );
        return;
      }
      if ((execution.holdReads ?? 0) > 0) {
        execution.holdReads = (execution.holdReads ?? 1) - 1;
      } else if (!execution.waitingForInput && !execution.holdSnapshot) {
        execution.snapshot = execution.terminalSnapshot;
      }
      executions.set(taskId, execution);
      callback(
        null,
        execution.scenario === "get_external_identity_mismatch"
          ? { ...execution.snapshot, externalExecutionId: `wrong-${execution.externalExecutionId}` }
          : execution.snapshot,
      );
    },
    reconcileExecution: (
      call: grpc.ServerUnaryCall<
        {
          taskId?: string;
          operationName?: string;
          argumentHash?: string;
          externalExecutionId?: string;
          executionContext?: Record<string, unknown>;
        },
        unknown
      >,
      callback: grpc.sendUnaryData<unknown>,
    ) => {
      const execution = executions.get(call.request.taskId ?? "");
      if (execution === undefined) {
        callback(null, {
          status: "NOT_FOUND",
          reasonCode: "EXECUTION_NOT_FOUND",
          message: "No execution is bound to this taskId.",
          retryable: false,
        });
        return;
      }
      if (execution.scenario === "get_transient_failure") {
        callback(null, {
          status: "TRANSIENT_UNAVAILABLE",
          reasonCode: "ADAPTER_TRANSIENT_UNAVAILABLE",
          message: "Injected Adapter outage.",
          retryable: true,
        });
        return;
      }
      if (
        execution.argumentHash !== (call.request.argumentHash ?? "") ||
        execution.operationName !== (call.request.operationName ?? "") ||
        !sameExecutionContext(execution.executionContext, call.request.executionContext) ||
        ((call.request.externalExecutionId ?? "") !== "" &&
          call.request.externalExecutionId !== execution.externalExecutionId)
      ) {
        callback(null, {
          status: "CONFLICT",
          reasonCode: "ARGUMENT_HASH_CONFLICT",
          message: "The taskId is bound to different arguments.",
          retryable: false,
        });
        return;
      }
      callback(null, {
        status: "FOUND",
        snapshot:
          execution.scenario === "reconcile_identity_mismatch"
            ? {
                ...execution.snapshot,
                argumentHash: "f".repeat(64),
                executionContext: {
                  ...execution.executionContext,
                  authorizationContextHash: "e".repeat(64),
                },
              }
            : execution.snapshot,
        externalExecutionId: execution.externalExecutionId,
        reasonCode: "EXECUTION_FOUND",
        message: "Execution recovered.",
        retryable: false,
      });
    },
    requestCancel: (
      call: grpc.ServerUnaryCall<
        { identity?: { taskId?: string; commandSequence?: string | number } },
        unknown
      >,
      callback: grpc.sendUnaryData<unknown>,
    ) => {
      const taskId = call.request.identity?.taskId ?? "";
      const execution = executions.get(taskId);
      if (execution === undefined) {
        callback(null, {
          accepted: false,
          reasonCode: "EXECUTION_NOT_FOUND",
          message: "Execution does not exist.",
          commandSequence: call.request.identity?.commandSequence ?? "0",
          identity: call.request.identity,
        });
        return;
      }
      const commandKey = `cancel:${String(call.request.identity?.commandSequence ?? "0")}`;
      const existingAck = execution.commandAcks[commandKey];
      if (existingAck !== undefined) {
        callback(null, existingAck);
        return;
      }
      execution.cancelAttempts = (execution.cancelAttempts ?? 0) + 1;
      if (execution.scenario === "cancel_permanent_reject") {
        executions.set(taskId, execution);
        callback(null, {
          accepted: false,
          reasonCode: "CANCEL_NOT_PERMITTED",
          message: "Reference execution rejected user cancellation.",
          commandSequence: call.request.identity?.commandSequence ?? "1",
          identity: call.request.identity,
        });
        return;
      }
      if (execution.scenario === "cancel_retryable_reject" && execution.cancelAttempts === 1) {
        executions.set(taskId, execution);
        callback(null, {
          accepted: false,
          reasonCode: "TRANSIENT_UNAVAILABLE",
          message: "Reference execution requests a retry.",
          commandSequence: call.request.identity?.commandSequence ?? "1",
          identity: call.request.identity,
        });
        return;
      }
      if (execution.scenario === "cancel_transport_failure") {
        executions.set(taskId, execution);
        callback(
          Object.assign(new Error("injected cancel transport failure"), {
            code: grpc.status.UNAVAILABLE,
          }),
        );
        return;
      }
      options.onControlSideEffect?.(taskId, "cancel");
      execution.snapshot =
        execution.scenario === "natural_completion"
          ? execution.terminalSnapshot
          : {
              ...execution.snapshot,
              state: "CANCELLED",
              revision: String(Number(execution.snapshot.revision ?? 1) + 1),
              reasonCode: "SAFE_STOP_CONFIRMED",
              message: "Reference execution safely stopped.",
              observedAt: timestamp(new Date()),
            };
      execution.terminalSnapshot = execution.snapshot;
      const ack = {
        accepted: true,
        reasonCode: "STOP_ACCEPTED",
        message: "Safe stop accepted.",
        commandSequence:
          execution.scenario === "command_sequence_mismatch"
            ? Number(call.request.identity?.commandSequence ?? 1) + 1
            : (call.request.identity?.commandSequence ?? "1"),
        identity: call.request.identity,
      };
      execution.commandAcks[commandKey] = ack;
      executions.set(taskId, execution);
      if (execution.scenario === "cancel_response_loss") {
        callback(
          Object.assign(new Error("injected RequestCancel response loss"), {
            code: grpc.status.UNAVAILABLE,
          }),
        );
        return;
      }
      callback(null, ack);
    },
    updateExecution: (
      call: grpc.ServerUnaryCall<
        {
          identity?: { taskId?: string; commandSequence?: string | number };
          inputs?: { inputRequestKey?: string }[];
          inputResponses?: { key?: string; result?: unknown }[];
        },
        unknown
      >,
      callback: grpc.sendUnaryData<unknown>,
    ) => {
      const taskId = call.request.identity?.taskId ?? "";
      const execution = executions.get(taskId);
      const commandKey = `update:${String(call.request.identity?.commandSequence ?? "0")}`;
      const existingAck = execution?.commandAcks[commandKey];
      if (existingAck !== undefined) {
        callback(null, existingAck);
        return;
      }
      const expectedKey = execution?.inputRound === 2 ? "comment" : "approval";
      const legacyInputs = call.request.inputs ?? [];
      const frozenResponses = call.request.inputResponses ?? [];
      const accepted =
        execution?.waitingForInput === true &&
        ((legacyInputs.length > 0 &&
          frozenResponses.length === 0 &&
          legacyInputs.every((input) => input.inputRequestKey === expectedKey)) ||
          (frozenResponses.length > 0 &&
            legacyInputs.length === 0 &&
            frozenResponses.every((response) => {
              const result = protoStructToJson(response.result);
              return response.key === expectedKey && result.action === "accept";
            })));
      if (accepted) {
        options.onControlSideEffect?.(taskId, "update");
        if (execution.scenario === "multi_round_input" && execution.inputRound !== 2) {
          execution.inputRound = 2;
          execution.snapshot = {
            ...execution.snapshot,
            state: "WAITING_INPUT",
            revision: "2",
            reasonCode: "COMMENT_REQUIRED",
            message: "A second input round is required.",
            inputRequests: [
              {
                key: "comment",
                description: "Provide an audit comment.",
                inputSchema: jsonToProtoStruct({ type: "string", minLength: 1 }),
                required: true,
              },
            ],
          };
        } else {
          execution.waitingForInput = false;
          execution.snapshot = {
            ...execution.snapshot,
            state: "RUNNING",
            revision: execution.inputRound === 2 ? "3" : "2",
            reasonCode: "INPUT_ACCEPTED",
            message: "Input accepted; execution resumed.",
            inputRequests: [],
            mcpInputRequests: [],
          };
          execution.terminalSnapshot = {
            ...execution.terminalSnapshot,
            revision: execution.inputRound === 2 ? "4" : "3",
          };
        }
      }
      const ack = {
        accepted,
        reasonCode: accepted ? "INPUT_ACCEPTED" : "INPUT_REJECTED",
        message: accepted ? "Input accepted." : "Input was not expected.",
        commandSequence: call.request.identity?.commandSequence ?? "0",
        identity: call.request.identity,
      };
      if (execution !== undefined) {
        execution.commandAcks[commandKey] = ack;
        executions.set(taskId, execution);
      }
      callback(null, ack);
    },
    pauseExecution: createPauseResumeHandler(executions, options, "PAUSED", "pause"),
    resumeExecution: createPauseResumeHandler(executions, options, "RESUMING", "resume"),
    startOperation: (
      call: grpc.ServerUnaryCall<
        {
          taskId?: string;
          operationName?: string;
          arguments?: unknown;
          argumentHash?: string;
          invocationAttempt?: string | number;
          executionContext?: Record<string, unknown>;
          reservationRef?: string;
        },
        unknown
      >,
      callback: grpc.sendUnaryData<unknown>,
    ) => {
      const taskId = call.request.taskId ?? "missing";
      const existing = executions.get(taskId);
      if (existing !== undefined) {
        if (
          existing.argumentHash !== (call.request.argumentHash ?? "") ||
          existing.reservationRef !== call.request.reservationRef
        ) {
          callback(
            Object.assign(new Error("taskId argument conflict"), {
              code: grpc.status.ALREADY_EXISTS,
            }),
          );
          return;
        }
        callback(null, {
          accepted: {
            externalExecutionId: existing.externalExecutionId,
            initialSnapshot: existing.snapshot,
          },
          result: "accepted",
        });
        return;
      }
      if (
        call.request.operationName !== "echo_sync" &&
        call.request.operationName !== "durable_task" &&
        call.request.operationName !== "flex_task"
      ) {
        callback(null, {
          rejected: {
            reasonCode: "UNSUPPORTED_R1_SCENARIO",
            message: "Unknown reference operation.",
            retryable: false,
          },
          result: "rejected",
        });
        return;
      }
      const result = protoStructToJson(call.request.arguments);
      if (
        call.request.operationName === "echo_sync" &&
        result.message === "__technical_failure__"
      ) {
        callback(
          Object.assign(new Error("injected synchronous technical failure"), {
            code: grpc.status.INTERNAL,
          }),
        );
        return;
      }
      const invocationAttempt = Number(call.request.invocationAttempt ?? 1);
      if (
        (result.scenario === "scheduled_retry_once" && invocationAttempt === 1) ||
        result.scenario === "scheduled_retry_always"
      ) {
        callback(null, {
          rejected: {
            reasonCode: "START_CAPACITY_RETRY",
            message: "Reference Adapter requests a bounded scheduled retry.",
            retryable: true,
          },
          result: "rejected",
        });
        return;
      }
      if (result.scenario === "scheduled_permanent_reject") {
        callback(null, {
          rejected: {
            reasonCode: "START_NOT_PERMITTED",
            message: "Reference Adapter permanently rejected scheduled admission.",
            retryable: false,
          },
          result: "rejected",
        });
        return;
      }
      const now = new Date();
      options.onStartSideEffect?.(taskId, call.request.reservationRef);
      if (
        call.request.operationName === "flex_task" &&
        (result.scenario === "terminal" || result.scenario === "terminal_invalid_output")
      ) {
        const externalExecutionId = `inline-${taskId}`;
        const terminalSnapshot = {
          taskId,
          externalExecutionId,
          operationName: call.request.operationName ?? "",
          argumentHash: call.request.argumentHash ?? "",
          executionContext: call.request.executionContext ?? {},
          state: "SUCCEEDED",
          revision: "1",
          reasonCode: "SUCCESS",
          message: "Task-capable operation completed inline.",
          result: jsonToProtoStruct(
            result.scenario === "terminal_invalid_output"
              ? { resourceId: 42, completed: "yes" }
              : { resourceId: result.resourceId, completed: true },
          ),
          observedAt: timestamp(now),
        };
        executions.set(taskId, {
          externalExecutionId,
          operationName: call.request.operationName ?? "",
          argumentHash: call.request.argumentHash ?? "",
          ...(call.request.reservationRef === undefined
            ? {}
            : { reservationRef: call.request.reservationRef }),
          executionContext: call.request.executionContext ?? {},
          snapshot: terminalSnapshot,
          terminalSnapshot,
          commandAcks: {},
        });
        callback(null, {
          accepted: { externalExecutionId, initialSnapshot: terminalSnapshot },
          result: "accepted",
        });
        return;
      }
      if (
        call.request.operationName === "durable_task" ||
        call.request.operationName === "flex_task"
      ) {
        const externalExecutionId = `task-${taskId}`;
        const initialSnapshot = {
          taskId,
          externalExecutionId,
          operationName: call.request.operationName ?? "",
          argumentHash: call.request.argumentHash ?? "",
          executionContext: call.request.executionContext ?? {},
          state: "RUNNING",
          revision: "1",
          reasonCode: "STARTED",
          message: "Reference task is running.",
          retryable: false,
          observedAt: { seconds: String(Math.floor(now.getTime() / 1000)), nanos: 0 },
        };
        if (result.scenario === "queued_start") {
          initialSnapshot.state = "QUEUED";
          initialSnapshot.reasonCode = "QUEUED";
          initialSnapshot.message = "Reference task is queued before execution begins.";
        }
        if (
          result.scenario === "input_required" ||
          result.scenario === "multi_round_input" ||
          result.scenario === "input_required_frozen"
        ) {
          initialSnapshot.state = "WAITING_INPUT";
          initialSnapshot.reasonCode = "APPROVAL_REQUIRED";
          initialSnapshot.message = "Approval input is required.";
          Object.assign(
            initialSnapshot,
            result.scenario === "input_required_frozen"
              ? {
                  mcpInputRequests: [
                    {
                      key: "approval",
                      method: "elicitation/create",
                      params: jsonToProtoStruct({
                        mode: "form",
                        message: "Approve the reference operation.",
                        requestedSchema: { type: "boolean" },
                      }),
                    },
                  ],
                }
              : {
                  inputRequests: [
                    {
                      key: "approval",
                      description: "Approve the reference operation.",
                      inputSchema: jsonToProtoStruct({ type: "boolean" }),
                      required: true,
                    },
                  ],
                },
          );
        }
        const terminalSnapshot = {
          ...initialSnapshot,
          state: "SUCCEEDED",
          revision: "2",
          reasonCode: "SUCCESS",
          message: "Reference task completed.",
          result: jsonToProtoStruct({ resourceId: result.resourceId, completed: true }),
        };
        if (result.scenario === "evidence_success") {
          Object.assign(terminalSnapshot, {
            evidence: [
              {
                evidenceId: `evidence-${taskId}`,
                evidenceType: "resource.completion",
                observedAt: now.toISOString(),
                subjectRef: `resource:${String(result.resourceId)}`,
                payloadRef: { kind: "structured_content", jsonPointer: "/resourceId" },
                producer: [providerId],
              },
            ],
          });
        }
        if (result.scenario === "output_invalid") {
          terminalSnapshot.result = jsonToProtoStruct({ resourceId: 42, completed: "yes" });
        } else if (result.scenario === "partial_valid") {
          Object.assign(initialSnapshot, {
            state: "PARTIALLY_COMPLETED",
            reasonCode: "PARTIAL_RESULT",
            message: "Reference task partially completed.",
            result: jsonToProtoStruct({ resourceId: result.resourceId, completed: false }),
          });
        } else if (result.scenario === "partial_invalid") {
          Object.assign(initialSnapshot, {
            state: "PARTIALLY_COMPLETED",
            reasonCode: "PARTIAL_RESULT",
            message: "Reference task returned an invalid partial payload.",
            result: jsonToProtoStruct({ resourceId: 42, completed: "no" }),
          });
        } else if (result.scenario === "business_failure") {
          Object.assign(initialSnapshot, {
            state: "BUSINESS_FAILED",
            reasonCode: "BUSINESS_RULE_REJECTED",
            message: "Reference business rule rejected the operation.",
            result: jsonToProtoStruct({ resourceId: result.resourceId, completed: false }),
          });
        } else if (result.scenario === "technical_failure") {
          Object.assign(initialSnapshot, {
            state: "TECHNICAL_FAILED",
            reasonCode: "ADAPTER_EXECUTION_FAILED",
            message: "Reference Adapter reported a technical failure.",
          });
        }
        executions.set(taskId, {
          externalExecutionId,
          operationName: call.request.operationName ?? "",
          argumentHash: call.request.argumentHash ?? "",
          ...(call.request.reservationRef === undefined
            ? {}
            : { reservationRef: call.request.reservationRef }),
          executionContext: call.request.executionContext ?? {},
          snapshot: initialSnapshot,
          terminalSnapshot,
          commandAcks: {},
          waitingForInput:
            result.scenario === "input_required" ||
            result.scenario === "multi_round_input" ||
            result.scenario === "input_required_frozen",
          ...(result.scenario === "multi_round_input" ? { inputRound: 1 } : {}),
          ...(typeof result.scenario === "string" ? { scenario: result.scenario } : {}),
          ...(result.scenario === "queued_start" ? { holdSnapshot: true } : {}),
        });
        if (result.scenario === "response_loss") {
          callback(
            Object.assign(new Error("injected StartOperation response loss"), {
              code: grpc.status.UNAVAILABLE,
            }),
          );
          return;
        }
        const acceptedResponse = {
          accepted: {
            externalExecutionId:
              result.scenario === "start_external_identity_mismatch"
                ? `wrong-${externalExecutionId}`
                : externalExecutionId,
            initialSnapshot:
              result.scenario === "start_task_identity_mismatch"
                ? { ...initialSnapshot, taskId: `wrong-${taskId}` }
                : initialSnapshot,
          },
          result: "accepted",
        };
        if (result.scenario === "slow_start" && (options.startResponseDelayMs ?? 0) > 0) {
          setTimeout(() => callback(null, acceptedResponse), options.startResponseDelayMs);
        } else {
          callback(null, acceptedResponse);
        }
        return;
      }
      const externalExecutionId = `sync-${taskId}`;
      const terminalSnapshot = {
        taskId,
        externalExecutionId,
        operationName: call.request.operationName ?? "",
        argumentHash: call.request.argumentHash ?? "",
        executionContext: call.request.executionContext ?? {},
        state: "SUCCEEDED",
        revision: "1",
        reasonCode: "SUCCESS",
        message: "Synchronous echo completed.",
        result: jsonToProtoStruct(
          result.message === "__invalid_output__" ? { message: 42 } : result,
        ),
        observedAt: timestamp(now),
      };
      executions.set(taskId, {
        externalExecutionId,
        operationName: call.request.operationName ?? "",
        argumentHash: call.request.argumentHash ?? "",
        ...(call.request.reservationRef === undefined
          ? {}
          : { reservationRef: call.request.reservationRef }),
        executionContext: call.request.executionContext ?? {},
        snapshot: terminalSnapshot,
        terminalSnapshot,
        commandAcks: {},
      });
      callback(null, {
        accepted: { externalExecutionId, initialSnapshot: terminalSnapshot },
        result: "accepted",
      });
    },
  });

  return server;
}

function timestamp(value: Date): { seconds: string; nanos: number } {
  return { seconds: String(Math.floor(value.getTime() / 1000)), nanos: 0 };
}

function createPauseResumeHandler(
  executions: JsonFileStore<MockExecution>,
  options: MockAdapterOptions,
  state: "PAUSED" | "RESUMING",
  command: "pause" | "resume",
) {
  return (
    call: grpc.ServerUnaryCall<
      { identity?: { taskId?: string; commandSequence?: string | number } },
      unknown
    >,
    callback: grpc.sendUnaryData<unknown>,
  ) => {
    const taskId = call.request.identity?.taskId ?? "";
    const execution = executions.get(taskId);
    if (execution === undefined) {
      callback(null, {
        accepted: false,
        reasonCode: "EXECUTION_NOT_FOUND",
        message: "Execution does not exist.",
        commandSequence: call.request.identity?.commandSequence ?? "0",
        identity: call.request.identity,
      });
      return;
    }
    const commandKey = `${command}:${String(call.request.identity?.commandSequence ?? "0")}`;
    const existingAck = execution.commandAcks[commandKey];
    if (existingAck !== undefined) {
      callback(null, existingAck);
      return;
    }
    options.onControlSideEffect?.(taskId, command);
    execution.snapshot = {
      ...execution.snapshot,
      state,
      revision: String(Number(execution.snapshot.revision ?? 1) + 1),
      reasonCode: command === "pause" ? "PAUSED_BY_CLIENT" : "RESUMED_BY_CLIENT",
      message: command === "pause" ? "Execution paused." : "Execution resuming.",
    };
    execution.holdSnapshot = command === "pause";
    if (command === "resume") {
      execution.holdReads = 1;
      execution.terminalSnapshot = {
        ...execution.terminalSnapshot,
        revision: String(Number(execution.snapshot.revision ?? 1) + 1),
      };
    }
    const ack = {
      accepted: true,
      reasonCode: command === "pause" ? "PAUSE_ACCEPTED" : "RESUME_ACCEPTED",
      message: `${command} accepted.`,
      commandSequence: call.request.identity?.commandSequence ?? "1",
      identity: call.request.identity,
    };
    execution.commandAcks[commandKey] = ack;
    executions.set(taskId, execution);
    callback(null, ack);
  };
}

function sameExecutionContext(
  left: Record<string, unknown>,
  right: Record<string, unknown> | undefined,
): boolean {
  if (right === undefined) return false;
  return (
    left.authorizationContextHash === right.authorizationContextHash &&
    left.executionMode === right.executionMode &&
    (left.simulationId ?? "") === (right.simulationId ?? "")
  );
}

export function bindMockAdapter(server: grpc.Server, address: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (error, port) => {
      if (error === null) resolve(port);
      else reject(error);
    });
  });
}
