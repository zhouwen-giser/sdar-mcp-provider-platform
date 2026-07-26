import * as grpc from "@grpc/grpc-js";
import { createHash, randomUUID } from "node:crypto";
import { adapterClientConstructor } from "./proto.js";
import { jsonToProtoStruct, jsonToProtoValue } from "./struct.js";
import { ADAPTER_PROTOCOL_VERSION } from "./types.js";
import type {
  AvailabilityCheckInput,
  AdapterBusinessEvent,
  CheckAvailabilityResponse,
  CommandAck,
  ExecutionSnapshot,
  McpTaskInputResponse,
  ProviderManifest,
  ReconcileExecutionResponse,
  StartOperationResponse,
  StreamBusinessEventsRequest,
} from "./types.js";

type UnaryAdapterMethod<T> = (
  request: unknown,
  metadata: grpc.Metadata,
  options: grpc.CallOptions,
  callback: grpc.requestCallback<T>,
) => grpc.ClientUnaryCall;

type AdapterClient = grpc.Client & {
  describeProvider: UnaryAdapterMethod<ProviderManifest>;
  getExecution: UnaryAdapterMethod<ExecutionSnapshot>;
  startOperation: UnaryAdapterMethod<StartOperationResponse>;
  checkAvailability: UnaryAdapterMethod<CheckAvailabilityResponse>;
  reconcileExecution: UnaryAdapterMethod<ReconcileExecutionResponse>;
  requestCancel: UnaryAdapterMethod<CommandAck>;
  updateExecution: UnaryAdapterMethod<CommandAck>;
  pauseExecution: UnaryAdapterMethod<CommandAck>;
  resumeExecution: UnaryAdapterMethod<CommandAck>;
  streamBusinessEvents: (
    request: unknown,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
  ) => grpc.ClientReadableStream<AdapterBusinessEvent>;
};

export const BUSINESS_EVENT_REASON_METADATA = "io.sdar.business-events.reason-code";

export function businessEventReasonFromError(error: grpc.ServiceError): string | undefined {
  const values = error.metadata.get(BUSINESS_EVENT_REASON_METADATA);
  const value = values[0];
  return typeof value === "string" ? value : undefined;
}

export interface AdapterGatewayOptions {
  endpoint: string;
  providerId: string;
  credentials?: grpc.ChannelCredentials;
  timeoutMs?: number;
  onRpc?: (
    method: string,
    outcome: "success" | "error",
    durationMs: number,
    context: AdapterRpcContext,
  ) => void;
  traceRpc?: <T>(
    method: string,
    context: AdapterRpcContext,
    operation: (metadata: grpc.Metadata) => Promise<T>,
  ) => Promise<T>;
  traceStreamRpc?: <T>(
    method: string,
    context: AdapterRpcContext,
    open: (metadata: grpc.Metadata) => grpc.ClientReadableStream<T>,
  ) => grpc.ClientReadableStream<T>;
}

export interface AdapterRpcContext {
  taskId?: string;
  externalExecutionId?: string;
  operationName?: string;
  commandSequence?: number;
  traceparent?: string;
  tracestate?: string;
  sourceId?: string;
}

export interface StartOperationOptions {
  taskId?: string;
  authorizationContextHash?: string;
  executionMode?: "live" | "simulation" | "historical-replay";
  simulationId?: string | null;
  argumentHash?: string;
  externalExecutionId?: string | null;
  invocationAttempt?: number;
  timing?: Record<string, unknown>;
  correlationId?: string;
  rootTraceparent?: string;
  rootTracestate?: string;
  reservationRef?: string;
}

export class GrpcAdapterGateway {
  readonly #client: AdapterClient;
  readonly #providerId: string;
  readonly #timeoutMs: number;
  readonly #onRpc: AdapterGatewayOptions["onRpc"];
  readonly #traceRpc: AdapterGatewayOptions["traceRpc"];
  readonly #traceStreamRpc: AdapterGatewayOptions["traceStreamRpc"];

  constructor(options: AdapterGatewayOptions) {
    const Client = adapterClientConstructor();
    this.#client = new Client(
      options.endpoint,
      options.credentials ?? grpc.credentials.createInsecure(),
    ) as unknown as AdapterClient;
    this.#providerId = options.providerId;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#onRpc = options.onRpc;
    this.#traceRpc = options.traceRpc;
    this.#traceStreamRpc = options.traceStreamRpc;
  }

  describeProvider(): Promise<ProviderManifest> {
    return this.#unary<ProviderManifest>("describeProvider", {
      metadata: this.#metadata(),
    });
  }

  streamBusinessEvents(
    request: StreamBusinessEventsRequest,
  ): grpc.ClientReadableStream<AdapterBusinessEvent> {
    const open = (metadata: grpc.Metadata) =>
      this.#client.streamBusinessEvents(
        {
          metadata: this.#metadata(),
          sourceId: request.sourceId,
          sourceStreamId: request.sourceStreamId,
          ...(request.afterSourceSequence === undefined
            ? {}
            : { afterSourceSequence: request.afterSourceSequence }),
        },
        metadata,
        {},
      );
    return (
      this.#traceStreamRpc?.("streamBusinessEvents", { sourceId: request.sourceId }, open) ??
      open(new grpc.Metadata())
    );
  }

  getExecution(
    taskId: string,
    externalExecutionId = "",
    options: StartOperationOptions = {},
  ): Promise<ExecutionSnapshot> {
    return this.#unary<ExecutionSnapshot>(
      "getExecution",
      {
        metadata: this.#metadata(options.correlationId),
        taskId,
        externalExecutionId,
        executionContext: {
          ...this.#executionContext(options),
        },
      },
      rpcContext(taskId, externalExecutionId, undefined, undefined, options),
    );
  }

  checkAvailability(
    checks: AvailabilityCheckInput[],
    options: StartOperationOptions = {},
  ): Promise<CheckAvailabilityResponse> {
    return this.#unary<CheckAvailabilityResponse>("checkAvailability", {
      metadata: this.#metadata(options.correlationId),
      executionContext: this.#executionContext(options),
      checks: checks.map((check) => ({
        requestId: check.requestId,
        operationName: check.operationName,
        ...(check.arguments === undefined
          ? {
              unresolvedArguments: {
                knownArguments: jsonToProtoStruct(check.unresolvedArguments?.knownArguments ?? {}),
                unresolvedPaths: check.unresolvedArguments?.unresolvedPaths ?? [],
              },
              argumentsValue: "unresolvedArguments",
            }
          : {
              arguments: jsonToProtoStruct(check.arguments),
              argumentsValue: "arguments",
            }),
        timing: check.timing ?? { start: { mode: "IMMEDIATE" } },
      })),
    });
  }

  reconcileExecution(
    taskId: string,
    operationName: string,
    argumentHash: string,
    options: StartOperationOptions = {},
  ): Promise<ReconcileExecutionResponse> {
    return this.#unary<ReconcileExecutionResponse>(
      "reconcileExecution",
      {
        metadata: this.#metadata(options.correlationId),
        taskId,
        operationName,
        argumentHash,
        executionContext: this.#executionContext(options),
        externalExecutionId: options.externalExecutionId ?? "",
      },
      rpcContext(taskId, options.externalExecutionId, undefined, operationName, options),
    );
  }

  requestCancel(
    taskId: string,
    operationName: string,
    argumentHash: string,
    reason: "USER_REQUESTED" | "DEADLINE_REACHED" | "START_WINDOW_MISSED",
    commandSequence: number,
    options: StartOperationOptions = {},
  ): Promise<CommandAck> {
    return this.#unary<CommandAck>(
      "requestCancel",
      {
        metadata: this.#metadata(options.correlationId),
        identity: {
          taskId,
          externalExecutionId: options.externalExecutionId ?? "",
          operationName,
          argumentHash,
          executionContext: this.#executionContext(options),
          commandSequence,
        },
        reason,
      },
      rpcContext(taskId, options.externalExecutionId, commandSequence, operationName, options),
    );
  }

  updateExecution(
    identity: {
      taskId: string;
      operationName: string;
      argumentHash: string;
      commandSequence: number;
    },
    inputs: { key: string; value: unknown; answerHash: string }[],
    options: StartOperationOptions = {},
  ): Promise<CommandAck> {
    return this.#unary<CommandAck>(
      "updateExecution",
      {
        metadata: this.#metadata(options.correlationId),
        identity: {
          ...identity,
          externalExecutionId: options.externalExecutionId ?? "",
          executionContext: this.#executionContext(options),
        },
        inputs: inputs.map((input) => ({
          inputRequestKey: input.key,
          value: jsonToProtoValue(input.value),
          answerHash: input.answerHash,
        })),
      },
      rpcContext(
        identity.taskId,
        options.externalExecutionId,
        identity.commandSequence,
        identity.operationName,
        options,
      ),
    );
  }

  updateMcpTaskExecution(
    identity: {
      taskId: string;
      operationName: string;
      argumentHash: string;
      commandSequence: number;
    },
    inputResponses: McpTaskInputResponse[],
    options: StartOperationOptions = {},
  ): Promise<CommandAck> {
    return this.#unary<CommandAck>(
      "updateExecution",
      {
        metadata: this.#metadata(options.correlationId),
        identity: {
          ...identity,
          externalExecutionId: options.externalExecutionId ?? "",
          executionContext: this.#executionContext(options),
        },
        inputResponses: inputResponses.map((response) => ({
          key: response.key,
          result: jsonToProtoStruct(response.result),
        })),
      },
      rpcContext(
        identity.taskId,
        options.externalExecutionId,
        identity.commandSequence,
        identity.operationName,
        options,
      ),
    );
  }

  pauseExecution(
    identity: {
      taskId: string;
      operationName: string;
      argumentHash: string;
      commandSequence: number;
    },
    options: StartOperationOptions = {},
  ): Promise<CommandAck> {
    return this.#unary<CommandAck>(
      "pauseExecution",
      {
        metadata: this.#metadata(options.correlationId),
        identity: {
          ...identity,
          externalExecutionId: options.externalExecutionId ?? "",
          executionContext: this.#executionContext(options),
        },
        reasonCode: "CLIENT_REQUESTED",
      },
      rpcContext(
        identity.taskId,
        options.externalExecutionId,
        identity.commandSequence,
        identity.operationName,
        options,
      ),
    );
  }

  resumeExecution(
    identity: {
      taskId: string;
      operationName: string;
      argumentHash: string;
      commandSequence: number;
    },
    options: StartOperationOptions = {},
  ): Promise<CommandAck> {
    return this.#unary<CommandAck>(
      "resumeExecution",
      {
        metadata: this.#metadata(options.correlationId),
        identity: {
          ...identity,
          externalExecutionId: options.externalExecutionId ?? "",
          executionContext: this.#executionContext(options),
        },
        reasonCode: "CLIENT_REQUESTED",
      },
      rpcContext(
        identity.taskId,
        options.externalExecutionId,
        identity.commandSequence,
        identity.operationName,
        options,
      ),
    );
  }

  startOperation(
    operationName: string,
    argumentsValue: Record<string, unknown>,
    options: StartOperationOptions = {},
  ): Promise<StartOperationResponse> {
    const taskId = options.taskId ?? randomUUID();
    const canonicalArguments = JSON.stringify(argumentsValue, Object.keys(argumentsValue).sort());
    return this.#unary<StartOperationResponse>(
      "startOperation",
      {
        metadata: this.#metadata(options.correlationId),
        taskId,
        operationName,
        arguments: jsonToProtoStruct(argumentsValue),
        timing: options.timing ?? { start: { mode: "IMMEDIATE", startToleranceMs: "0" } },
        executionContext: this.#executionContext(options),
        argumentHash:
          options.argumentHash ?? createHash("sha256").update(canonicalArguments).digest("hex"),
        invocationAttempt: options.invocationAttempt ?? 1,
        reservationRef: options.reservationRef,
      },
      rpcContext(taskId, options.externalExecutionId, undefined, operationName, options),
    );
  }

  close(): void {
    this.#client.close();
  }

  #metadata(correlationId: string = randomUUID()): Record<string, string> {
    return {
      adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION,
      providerId: this.#providerId,
      correlationId,
    };
  }

  #executionContext(options: StartOperationOptions): Record<string, string> {
    return {
      authorizationContextHash: options.authorizationContextHash ?? "r2-development",
      executionMode: (options.executionMode ?? "live").replace("-", "_").toUpperCase(),
      simulationId: options.simulationId ?? "",
      correlationId: options.correlationId ?? randomUUID(),
    };
  }

  #unary<T>(
    method:
      | "describeProvider"
      | "getExecution"
      | "startOperation"
      | "checkAvailability"
      | "reconcileExecution"
      | "requestCancel"
      | "updateExecution"
      | "pauseExecution"
      | "resumeExecution",
    request: unknown,
    context: AdapterRpcContext = {},
  ): Promise<T> {
    const deadline = new Date(Date.now() + this.#timeoutMs);
    const startedAt = performance.now();
    const invoke = (metadata: grpc.Metadata): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const callback: grpc.requestCallback<T> = (error, value) => {
          if (error !== null) {
            this.#onRpc?.(method, "error", performance.now() - startedAt, context);
            reject(error);
          } else if (value === undefined) {
            this.#onRpc?.(method, "error", performance.now() - startedAt, context);
            reject(new Error(`Adapter ${method} returned no value`));
          } else {
            this.#onRpc?.(method, "success", performance.now() - startedAt, context);
            resolve(value);
          }
        };
        if (method === "describeProvider") {
          this.#client.describeProvider(
            request,
            metadata,
            { deadline },
            callback as grpc.requestCallback<ProviderManifest>,
          );
        } else if (method === "getExecution") {
          this.#client.getExecution(
            request,
            metadata,
            { deadline },
            callback as grpc.requestCallback<ExecutionSnapshot>,
          );
        } else if (method === "startOperation") {
          this.#client.startOperation(
            request,
            metadata,
            { deadline },
            callback as grpc.requestCallback<StartOperationResponse>,
          );
        } else if (method === "checkAvailability") {
          this.#client.checkAvailability(
            request,
            metadata,
            { deadline },
            callback as grpc.requestCallback<CheckAvailabilityResponse>,
          );
        } else if (method === "reconcileExecution") {
          this.#client.reconcileExecution(
            request,
            metadata,
            { deadline },
            callback as grpc.requestCallback<ReconcileExecutionResponse>,
          );
        } else if (method === "requestCancel") {
          this.#client.requestCancel(
            request,
            metadata,
            { deadline },
            callback as grpc.requestCallback<CommandAck>,
          );
        } else {
          this.#client[method](
            request,
            metadata,
            { deadline },
            callback as grpc.requestCallback<CommandAck>,
          );
        }
      });
    return this.#traceRpc?.(method, context, invoke) ?? invoke(new grpc.Metadata());
  }
}

function rpcContext(
  taskId: string,
  externalExecutionId?: string | null,
  commandSequence?: number,
  operationName?: string,
  options: StartOperationOptions = {},
): AdapterRpcContext {
  return {
    taskId,
    ...(externalExecutionId === undefined || externalExecutionId === null
      ? {}
      : { externalExecutionId }),
    ...(commandSequence === undefined ? {} : { commandSequence }),
    ...(operationName === undefined ? {} : { operationName }),
    ...(options.rootTraceparent === undefined ? {} : { traceparent: options.rootTraceparent }),
    ...(options.rootTracestate === undefined ? {} : { tracestate: options.rootTracestate }),
  };
}
