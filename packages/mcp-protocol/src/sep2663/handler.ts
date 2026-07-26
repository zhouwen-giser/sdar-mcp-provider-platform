import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { ValidatedManifest } from "../../../operation-registry/src/index.js";
import type { AuthorizationContext } from "../../../domain/src/index.js";
import { RUNTIME_VERSION } from "../../../domain/src/index.js";
import type { TaskEngine } from "../../../task-engine/src/index.js";
import { createAuthorizationResolver, type AuthorizationResolver } from "../security.js";
import { frozenDiscoveryResult } from "./discovery.js";
import { FrozenErrorCode, FrozenProtocolError, frozenErrorResponse } from "./errors.js";
import { validateFrozenHeaders } from "./headers.js";
import { validateFrozenRequest } from "./request-validator.js";
import { requireTasksCapability } from "./request-validator.js";
import {
  parseTaskId,
  parseTaskInputResponses,
  parseTaskObservations,
  parseTaskReference,
} from "./tasks.js";
import { TaskNotificationStream } from "./notifications.js";
import { parseFrozenToolCall } from "./tools-call.js";
import { parseFrozenAvailability } from "./availability.js";
import { mapFrozenRuntimeError } from "./error-mapper.js";
import type {
  BusinessEventNotificationManager,
  BusinessEventRelationManager,
} from "../business-events.js";

const developmentAuthorization = createAuthorizationResolver({ mode: "development" });

export interface FrozenDispatchResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

export class Sep2663ProtocolHandler {
  readonly notificationStream: TaskNotificationStream | undefined;
  readonly #transportScopes = new WeakMap<object, string>();

  constructor(
    readonly manifest: ValidatedManifest,
    readonly serverVersion = RUNTIME_VERSION,
    readonly taskEngine?: TaskEngine,
    readonly resolveAuthorization: AuthorizationResolver = developmentAuthorization,
    notificationStream?: TaskNotificationStream,
    readonly businessEventManager?: BusinessEventNotificationManager,
    readonly businessEventDiscovery?: Record<string, unknown>,
    readonly businessEventRelationManager?: BusinessEventRelationManager,
  ) {
    this.notificationStream =
      notificationStream ??
      (taskEngine === undefined ? undefined : new TaskNotificationStream(taskEngine));
  }

  dispatch(body: unknown, headers: IncomingHttpHeaders): FrozenDispatchResult {
    const id = requestId(body);
    try {
      const request = validateFrozenRequest(body);
      validateFrozenHeaders(headers, request);
      let result: Record<string, unknown>;
      switch (request.method) {
        case "server/discover":
          result = frozenDiscoveryResult(this.serverVersion, this.businessEventDiscovery);
          break;
        case "tools/list":
          result = {
            tools: this.manifest.operations.map((operation) => operation.tool),
          };
          break;
        default:
          throw new FrozenProtocolError(FrozenErrorCode.MethodNotFound, "Method not found", 404);
      }
      return {
        httpStatus: 200,
        body: { jsonrpc: "2.0", id: request.id, result },
      };
    } catch (error) {
      const mapped =
        error instanceof FrozenProtocolError
          ? error
          : new FrozenProtocolError(FrozenErrorCode.InternalError, "Internal error", 500);
      return { httpStatus: mapped.httpStatus, body: frozenErrorResponse(id, mapped) };
    }
  }

  async dispatchAsync(
    body: unknown,
    headers: IncomingHttpHeaders,
    authorization: AuthorizationContext,
  ): Promise<FrozenDispatchResult> {
    const id = requestId(body);
    try {
      const request = validateFrozenRequest(body);
      validateFrozenHeaders(headers, request);
      if (request.method === "server/discover" || request.method === "tools/list") {
        return this.dispatch(body, headers);
      }
      if (request.method === "io.sdar/businessEvents/relatedTasks/list") {
        if (this.businessEventRelationManager === undefined) {
          throw new FrozenProtocolError(FrozenErrorCode.MethodNotFound, "Method not found", 404);
        }
        const relation = await this.businessEventRelationManager.list(request, authorization);
        return { httpStatus: 200, body: { jsonrpc: "2.0", id: request.id, result: relation } };
      }
      if (this.taskEngine === undefined) {
        throw new FrozenProtocolError(FrozenErrorCode.MethodNotFound, "Method not found", 404);
      }
      let result: Record<string, unknown>;
      if (request.method === "io.sdar/taskExecution/checkAvailability") {
        result = {
          ...(await this.taskEngine.checkAvailability(
            parseFrozenAvailability(request),
            authorization,
          )),
        };
        return { httpStatus: 200, body: { jsonrpc: "2.0", id: request.id, result } };
      }
      if (request.method === "tools/call") {
        const call = parseFrozenToolCall(request);
        const operation = this.manifest.operations.find(
          (candidate) => candidate.name === call.name,
        );
        if (operation === undefined) {
          throw new FrozenProtocolError(FrozenErrorCode.InvalidParams, "Unknown tool", 400);
        }
        if (operation.execution !== "SYNCHRONOUS") requireTasksCapability(request);
        operation.validateArguments(call.arguments);
        result = await this.taskEngine.callFrozenOperation(
          operation,
          call.arguments,
          authorization,
          call.idempotencyKey,
          call.timing,
          call.reservationRef,
        );
        return { httpStatus: 200, body: { jsonrpc: "2.0", id: request.id, result } };
      }
      requireTasksCapability(request);
      switch (request.method) {
        case "tasks/get": {
          const taskId = parseTaskReference(request.params);
          result = await this.taskEngine.getFrozenTask(taskId, authorization, "get");
          break;
        }
        case "tasks/update": {
          const taskId = parseTaskId(request.params);
          const inputResponses = parseTaskInputResponses(request.params);
          await this.taskEngine.updateTaskInputResponses(taskId, inputResponses, authorization);
          result = { resultType: "complete" };
          break;
        }
        case "tasks/cancel": {
          const taskId = parseTaskReference(request.params);
          await this.taskEngine.cancelTaskCooperatively(taskId, authorization);
          result = { resultType: "complete" };
          break;
        }
        case "io.sdar/taskExecution/tasks/observations": {
          const parsed = parseTaskObservations(request.params);
          result = {
            resultType: "complete",
            ...(await this.taskEngine.getTaskObservations(
              parsed.taskId,
              authorization,
              parsed.cursor,
              parsed.limit,
            )),
          };
          break;
        }
        default:
          throw new FrozenProtocolError(FrozenErrorCode.MethodNotFound, "Method not found", 404);
      }
      return { httpStatus: 200, body: { jsonrpc: "2.0", id: request.id, result } };
    } catch (error) {
      const mapped = mapFrozenError(error);
      return { httpStatus: mapped.httpStatus, body: frozenErrorResponse(id, mapped) };
    }
  }

  async handle(request: IncomingMessage, response: ServerResponse, body: unknown): Promise<void> {
    let dispatched: FrozenDispatchResult;
    try {
      const authorization = this.resolveAuthorization(request);
      const validated = validateFrozenRequest(body);
      if (validated.method === "io.sdar/businessEvents/listen") {
        validateFrozenHeaders(request.headers, validated);
        if (this.businessEventManager === undefined) {
          throw new FrozenProtocolError(FrozenErrorCode.MethodNotFound, "Method not found", 404);
        }
        await this.businessEventManager.listen(validated, response, authorization);
        return;
      }
      if (validated.method === "subscriptions/listen") {
        validateFrozenHeaders(request.headers, validated);
        requireTasksCapability(validated);
        if (this.notificationStream === undefined) {
          throw new FrozenProtocolError(FrozenErrorCode.MethodNotFound, "Method not found", 404);
        }
        await this.notificationStream.listen(
          validated,
          response,
          authorization,
          this.#transportScope(request),
        );
        return;
      }
      dispatched = await this.dispatchAsync(body, request.headers, authorization);
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const mapped = mapFrozenError(error);
      dispatched = {
        httpStatus: mapped.httpStatus,
        body: frozenErrorResponse(requestId(body), mapped),
      };
    }
    const serialized = JSON.stringify(dispatched.body);
    response.statusCode = dispatched.httpStatus;
    response.setHeader("content-type", "application/json");
    response.setHeader("content-length", String(Buffer.byteLength(serialized)));
    response.end(serialized);
  }

  #transportScope(request: IncomingMessage): string {
    const transport = request.socket;
    const existing = this.#transportScopes.get(transport);
    if (existing !== undefined) return existing;
    const created = randomUUID();
    this.#transportScopes.set(transport, created);
    return created;
  }
}

function mapFrozenError(error: unknown): FrozenProtocolError {
  return mapFrozenRuntimeError(error);
}

function requestId(value: unknown): string | number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" || (typeof id === "number" && Number.isInteger(id)) ? id : null;
}
