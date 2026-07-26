import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  CancelTaskRequestSchema,
  ErrorCode,
  GetTaskPayloadRequestSchema,
  GetTaskRequestSchema,
  ListToolsRequestSchema,
  McpError,
  RequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { protoStructToJson } from "../../adapter-protocol/src/index.js";
import type { GrpcAdapterGateway } from "../../adapter-protocol/src/index.js";
import type { ValidatedManifest } from "../../operation-registry/src/index.js";
import type {
  AuthorizationContext,
  AvailabilityCheck,
  TaskExecutionTiming,
} from "../../domain/src/index.js";
import {
  AdapterContractError,
  CapabilityNotSupportedError,
  InvalidParamsError,
  CommandInProgressError,
  isRuntimeError,
  TaskExpiredError,
  TaskNotFoundOrUnauthorizedError,
  RUNTIME_VERSION,
} from "../../domain/src/index.js";
import type { TaskEngine } from "../../task-engine/src/index.js";
import { z } from "zod";
import { createAuthorizationResolver } from "./security.js";
import type { AuthorizationResolver } from "./security.js";

const developmentAuthorization = createAuthorizationResolver({ mode: "development" });
// SDK 1.29.0 defines omitted sessionIdGenerator as explicit stateless mode.
// Its exact-optional type rejects spelling the property as `undefined`.
const StatelessTransportOptions = Object.freeze({});
const RuntimeCallToolRequestSchema = CallToolRequestSchema.extend({
  params: CallToolRequestSchema.shape.params.extend({
    // Accept the field long enough to map malformed TTL values to JSON-RPC
    // Invalid Params; the locked SDK otherwise reports its Zod failure as -32603.
    task: z.object({ ttl: z.unknown().optional() }).optional(),
  }),
});

export interface McpProtocolOptions {
  resolveAuthorization?: AuthorizationResolver;
  maxArgumentBytes?: number;
  maxJsonDepth?: number;
  maxJsonNodes?: number;
  onProtocolError?: (error: unknown, correlationId: string | null) => void;
  traceRequest?: <T>(
    name: string,
    headers: Record<string, string | string[] | undefined>,
    action: () => Promise<T>,
  ) => Promise<T>;
  currentTraceContext?: () => Pick<
    AuthorizationContext,
    "traceId" | "rootTraceparent" | "rootTracestate"
  > | null;
}

const AvailabilityCheckSchema = z.object({
  requestId: z.string().min(1).max(256),
  operationName: z.string().min(1).max(64),
  arguments: z.union([
    z.record(z.string(), z.unknown()),
    z.object({
      unresolved: z.literal(true),
      knownArguments: z.record(z.string(), z.unknown()),
      unresolvedPaths: z.array(z.string()).max(256),
    }),
  ]),
  timing: z
    .object({
      start: z
        .object({
          mode: z.enum(["immediate", "scheduled"]),
          scheduledAt: z.string().optional(),
          startToleranceMs: z.number().int().nonnegative().optional(),
        })
        .optional(),
      maxElapsedMs: z.number().int().positive().nullable().optional(),
    })
    .optional(),
});

const CheckAvailabilityRequestSchema = RequestSchema.extend({
  method: z.literal("io.sdar/taskExecution/checkAvailability"),
  params: z.object({ checks: z.array(AvailabilityCheckSchema).min(1).max(128) }),
});

const TaskTimingSchema = z.object({
  start: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("immediate"), startToleranceMs: z.number().int().nonnegative() }),
    z.object({
      mode: z.literal("scheduled"),
      scheduledAt: z.string(),
      startToleranceMs: z.number().int().nonnegative(),
    }),
  ]),
  maxElapsedMs: z.number().int().positive().nullable(),
});

const UpdateTaskRequestSchema = RequestSchema.extend({
  method: z.literal("tasks/update"),
  params: z.object({
    taskId: z.uuid(),
    inputs: z.record(z.string().min(1).max(256), z.unknown()),
  }),
});

const TaskObservationsRequestSchema = RequestSchema.extend({
  method: z.literal("tasks/observations"),
  params: z.object({
    taskId: z.uuid(),
    cursor: z
      .string()
      .regex(/^[1-9]\d*$/)
      .optional(),
    limit: z.number().int().min(1).max(100).default(100),
  }),
});

const ControlTaskRequestSchema = (
  method: "io.sdar/taskExecution/tasks/pause" | "io.sdar/taskExecution/tasks/resume",
) =>
  RequestSchema.extend({
    method: z.literal(method),
    params: z.object({ taskId: z.uuid() }),
  });

export class McpProtocolHandler {
  constructor(
    readonly manifest: ValidatedManifest,
    readonly gateway: GrpcAdapterGateway,
    readonly taskEngine?: TaskEngine,
    readonly options: McpProtocolOptions = {},
  ) {}

  async handle(request: IncomingMessage, response: ServerResponse, body: unknown): Promise<void> {
    const authorization = (this.options.resolveAuthorization ?? developmentAuthorization)(request);
    const profileCapability = {
      version: "1.0",
      availability: this.manifest.operations.some(
        (operation) => operation.capabilities.availability,
      ),
      scheduling: this.manifest.operations.some((operation) => operation.capabilities.scheduling),
      observations: this.manifest.operations.some(
        (operation) => operation.capabilities.observations,
      ),
      idempotency: this.manifest.operations.some((operation) => operation.capabilities.idempotency),
    };
    const capabilities = {
      tools: {},
      tasks: { cancel: {}, requests: { tools: { call: {} } } },
      experimental: {
        "io.modelcontextprotocol/tasks": {},
        "io.sdar/taskExecution": profileCapability,
      },
      extensions: {
        "io.modelcontextprotocol/tasks": {},
        "io.sdar/taskExecution": profileCapability,
      },
    };
    // The low-level SDK server is intentional: Adapter JSON Schemas are already
    // validated Draft 2020-12 documents, not Zod schemas owned by the Runtime.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const server = new Server(
      { name: "sdar-mcp-tasks-provider-runtime", version: RUNTIME_VERSION },
      {
        capabilities,
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: this.manifest.operations.map((operation) => operation.tool),
    }));
    server.setRequestHandler(RuntimeCallToolRequestSchema, ({ params }) =>
      this.#tracedProtocolResult(
        "mcp.tools.call",
        request,
        authorization.correlationId ?? null,
        authorization,
        async () => {
          const operation = this.manifest.operations.find(
            (candidate) => candidate.name === params.name,
          );
          if (operation === undefined)
            throw new InvalidParamsError("UNKNOWN_TOOL", "Unknown tool.");
          const argumentsValue = params.arguments ?? {};
          const ttl = taskTtl(params.task?.ttl);
          assertJsonLimits(
            argumentsValue,
            this.options.maxArgumentBytes ?? 1_048_576,
            this.options.maxJsonDepth ?? 32,
            this.options.maxJsonNodes ?? 10_000,
          );
          operation.validateArguments(argumentsValue);
          if (this.taskEngine !== undefined) {
            const invocation = await this.taskEngine.callOperation(
              operation,
              argumentsValue,
              authorization,
              ttl,
              idempotencyKey(params._meta),
              taskTiming(params._meta),
            );
            return invocation.kind === "result" ? invocation.result : { task: invocation.task };
          }
          const start = await this.gateway.startOperation(operation.name, argumentsValue);
          if (start.result === "rejected" || start.rejected !== undefined) {
            const rejected = start.rejected;
            return {
              content: [{ type: "text", text: rejected?.message ?? "Operation rejected." }],
              isError: true,
              structuredContent: {
                outcome: "admission_rejected",
                reasonCode: rejected?.reasonCode ?? "ADMISSION_REJECTED",
                retryable: rejected?.retryable ?? false,
                completedAt: new Date().toISOString(),
              },
            };
          }
          const snapshot = start.accepted?.initialSnapshot;
          if (snapshot?.state !== "SUCCEEDED") {
            throw new AdapterContractError("R2_NONTERMINAL_EXECUTION_REQUIRES_TASK_ENGINE");
          }
          const result = protoStructToJson(snapshot.result);
          operation.validateOutput(result);
          return {
            content: [{ type: "text", text: snapshot.message || "Operation completed." }],
            isError: false,
            structuredContent: result,
          };
        },
      ),
    );
    const taskEngine = this.taskEngine;
    if (taskEngine !== undefined) {
      server.setRequestHandler(
        CheckAvailabilityRequestSchema,
        ({ params }) =>
          this.#protocolResult(authorization.correlationId ?? null, async () => {
            const result = await taskEngine.checkAvailability(
              legacyAvailabilityChecks(params.checks),
              authorization,
            );
            return {
              profileVersion: result.profileVersion,
              checkedAt: new Date().toISOString(),
              checks: result.results,
            };
          }) as never,
      );
      server.setRequestHandler(GetTaskRequestSchema, ({ params }) =>
        this.#tracedProtocolResult(
          "mcp.tasks.get",
          request,
          authorization.correlationId ?? null,
          authorization,
          () => taskEngine.getTask(params.taskId, authorization),
        ),
      );
      server.setRequestHandler(GetTaskPayloadRequestSchema, ({ params }) =>
        this.#protocolResult(authorization.correlationId ?? null, () =>
          taskEngine.getTaskResult(params.taskId, authorization),
        ),
      );
      server.setRequestHandler(CancelTaskRequestSchema, ({ params }) =>
        this.#tracedProtocolResult(
          "mcp.tasks.cancel",
          request,
          authorization.correlationId ?? null,
          authorization,
          () => taskEngine.cancelTask(params.taskId, authorization),
        ),
      );
      server.setRequestHandler(UpdateTaskRequestSchema, ({ params }) =>
        this.#tracedProtocolResult(
          "mcp.tasks.update",
          request,
          authorization.correlationId ?? null,
          authorization,
          async () => {
            assertJsonLimits(
              params.inputs,
              this.options.maxArgumentBytes ?? 1_048_576,
              this.options.maxJsonDepth ?? 32,
              this.options.maxJsonNodes ?? 10_000,
            );
            return await taskEngine.updateTask(params.taskId, params.inputs, authorization);
          },
        ),
      );
      server.setRequestHandler(
        TaskObservationsRequestSchema,
        ({ params }) =>
          this.#tracedProtocolResult(
            "mcp.tasks.observations",
            request,
            authorization.correlationId ?? null,
            authorization,
            () =>
              taskEngine.getTaskObservations(
                params.taskId,
                authorization,
                params.cursor === undefined ? undefined : Number(params.cursor),
                params.limit,
              ),
          ) as never,
      );
      server.setRequestHandler(
        ControlTaskRequestSchema("io.sdar/taskExecution/tasks/pause"),
        ({ params }) =>
          this.#tracedProtocolResult(
            "mcp.tasks.pause",
            request,
            authorization.correlationId ?? null,
            authorization,
            () => taskEngine.controlTask(params.taskId, "PAUSE", authorization),
          ),
      );
      server.setRequestHandler(
        ControlTaskRequestSchema("io.sdar/taskExecution/tasks/resume"),
        ({ params }) =>
          this.#tracedProtocolResult(
            "mcp.tasks.resume",
            request,
            authorization.correlationId ?? null,
            authorization,
            () => taskEngine.controlTask(params.taskId, "RESUME", authorization),
          ),
      );
    }

    const transport = new StreamableHTTPServerTransport(StatelessTransportOptions);
    await server.connect(transport as unknown as Transport);
    response.once("close", () => {
      void transport.close();
      void server.close();
    });
    await transport.handleRequest(request, response, body);
  }

  async #protocolResult<T>(correlationId: string | null, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      const mapped = mapProtocolError(error);
      if (mapped.code === -32603) {
        this.options.onProtocolError?.(error, correlationId);
      }
      throw mapped;
    }
  }

  #tracedProtocolResult<T>(
    name: string,
    request: IncomingMessage,
    correlationId: string | null,
    authorization: AuthorizationContext,
    action: () => Promise<T>,
  ): Promise<T> {
    const execute = () => {
      const traceContext = this.options.currentTraceContext?.();
      if (traceContext !== null && traceContext !== undefined) {
        Object.assign(authorization, traceContext);
      }
      return this.#protocolResult(correlationId, action);
    };
    return this.options.traceRequest?.(name, request.headers, execute) ?? execute();
  }
}

function mapProtocolError(error: unknown): McpError {
  if (error instanceof McpError) return error;
  if (error instanceof TaskNotFoundOrUnauthorizedError) {
    return wireMcpError(ErrorCode.InvalidParams, error.safeMessage, {
      reasonCode: error.reasonCode,
    });
  }
  if (error instanceof TaskExpiredError) {
    return wireMcpError(ErrorCode.InvalidParams, error.safeMessage, {
      reasonCode: error.reasonCode,
    });
  }
  if (error instanceof InvalidParamsError || error instanceof CapabilityNotSupportedError) {
    return wireMcpError(ErrorCode.InvalidParams, error.safeMessage, {
      reasonCode: error.reasonCode,
    });
  }
  if (error instanceof CommandInProgressError) {
    return wireMcpError(-32009, error.safeMessage, {
      reasonCode: error.reasonCode,
      commandSequence: error.commandSequence,
      commandType: error.commandType,
      requestedCommandType: error.requestedCommandType,
      blockingCommandType: error.blockingCommandType,
      commandState: error.commandState,
      retryAfterMs: error.retryAfterMs,
    });
  }
  if (isRuntimeError(error)) {
    return wireMcpError(ErrorCode.InternalError, error.safeMessage, {
      reasonCode:
        error.kind === "business_tool" ? "BUSINESS_ERROR_CHANNEL_VIOLATION" : error.reasonCode,
    });
  }

  const reasonCode = error instanceof Error ? error.message : "INTERNAL_ERROR";
  if (reasonCode === "TASK_NOT_FOUND") {
    return wireMcpError(ErrorCode.InvalidParams, "Task not found.", {
      reasonCode: "TASK_NOT_FOUND",
    });
  }
  if (reasonCode.endsWith("_NOT_SUPPORTED")) {
    return wireMcpError(ErrorCode.InvalidParams, "Capability not supported.", { reasonCode });
  }
  if (
    reasonCode === "UNKNOWN_TOOL" ||
    reasonCode === "TASK_NOT_TERMINAL" ||
    reasonCode === "IDEMPOTENCY_KEY_CONFLICT" ||
    reasonCode === "INPUT_ANSWER_CONFLICT" ||
    reasonCode.startsWith("INVALID_") ||
    reasonCode.startsWith("UNKNOWN_INPUT_") ||
    reasonCode.startsWith("ARGUMENTS_")
  ) {
    return wireMcpError(ErrorCode.InvalidParams, "Invalid request parameters.", { reasonCode });
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "number"
  ) {
    return wireMcpError(ErrorCode.InternalError, "Runtime technical failure.", {
      reasonCode: "ADAPTER_RPC_FAILED",
    });
  }
  return wireMcpError(ErrorCode.InternalError, "Runtime technical failure.", {
    reasonCode: /^[A-Z][A-Z0-9_:]{2,127}$/.test(reasonCode) ? reasonCode : "INTERNAL_ERROR",
  });
}

function wireMcpError(
  code: ErrorCode | number,
  message: string,
  data: Record<string, unknown>,
): McpError {
  const error = new McpError(code, message, data);
  // The low-level SDK serializes Error.message verbatim, while McpError's
  // constructor prefixes it for local display. Restore the protocol message so
  // the peer receives one stable JSON-RPC message rather than a nested prefix.
  error.message = message;
  return error;
}

function idempotencyKey(meta: unknown): string | undefined {
  const profile = profileMetadata(meta);
  if (profile === undefined) return undefined;
  const key = profile.idempotencyKey;
  if (key === undefined) return undefined;
  if (typeof key !== "string") throw new InvalidParamsError("INVALID_IDEMPOTENCY_KEY");
  return key;
}

function taskTtl(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 31_536_000_000) {
    throw new InvalidParamsError("INVALID_TASK_TTL");
  }
  return value as number;
}

function taskTiming(meta: unknown): TaskExecutionTiming | undefined {
  const timing = profileMetadata(meta)?.timing;
  if (timing === undefined) return undefined;
  const parsed = TaskTimingSchema.safeParse(timing);
  if (!parsed.success) {
    throw new InvalidParamsError("INVALID_TASK_TIMING", "Invalid Task timing parameters.", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function legacyAvailabilityChecks(
  checks: z.infer<typeof AvailabilityCheckSchema>[],
): AvailabilityCheck[] {
  return checks.map((check) => {
    const unresolved = check.arguments as Record<string, unknown>;
    return {
      requestId: check.requestId,
      operationName: check.operationName,
      arguments:
        unresolved.unresolved === true &&
        typeof unresolved.knownArguments === "object" &&
        unresolved.knownArguments !== null &&
        !Array.isArray(unresolved.knownArguments) &&
        Array.isArray(unresolved.unresolvedPaths)
          ? {
              state: "partial" as const,
              knownValue: unresolved.knownArguments as Record<string, unknown>,
              unresolvedPaths: unresolved.unresolvedPaths.filter(
                (value): value is string => typeof value === "string",
              ),
            }
          : { state: "complete" as const, value: unresolved },
      ...(check.timing === undefined ? {} : { timing: legacyAvailabilityTiming(check.timing) }),
    };
  });
}

function legacyAvailabilityTiming(
  timing: NonNullable<z.infer<typeof AvailabilityCheckSchema>["timing"]>,
): NonNullable<AvailabilityCheck["timing"]> {
  return {
    ...(timing.start === undefined
      ? {}
      : {
          start: {
            mode: timing.start.mode,
            ...(timing.start.scheduledAt === undefined
              ? {}
              : { scheduledAt: timing.start.scheduledAt }),
            ...(timing.start.startToleranceMs === undefined
              ? {}
              : { startToleranceMs: timing.start.startToleranceMs }),
          },
        }),
    ...(timing.maxElapsedMs === undefined ? {} : { maxElapsedMs: timing.maxElapsedMs }),
  };
}

function profileMetadata(meta: unknown): Record<string, unknown> | undefined {
  if (typeof meta !== "object" || meta === null) return undefined;
  const profile = (meta as Record<string, unknown>)["io.sdar/taskExecution"];
  if (typeof profile !== "object" || profile === null) return undefined;
  return profile as Record<string, unknown>;
}

export function assertJsonLimits(
  value: unknown,
  maxBytes: number,
  maxDepth: number,
  maxNodes: number,
): void {
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) {
    throw new InvalidParamsError("ARGUMENTS_TOO_LARGE");
  }
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > maxNodes) throw new InvalidParamsError("ARGUMENTS_TOO_COMPLEX");
    if (depth > maxDepth) throw new InvalidParamsError("ARGUMENTS_TOO_DEEP");
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
    } else if (typeof item === "object" && item !== null) {
      for (const child of Object.values(item)) visit(child, depth + 1);
    }
  };
  visit(value, 0);
}
