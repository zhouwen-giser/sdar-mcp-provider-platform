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
import {
  parsePublicArtifactQuery,
  parsePublicContextQuery,
  parsePublicInterventionApply,
  parsePublicSnapshotPartQuery,
  mapTaskBusinessRequestError,
  requireTaskBusinessCapability,
  TASK_BUSINESS_PUBLIC_PROFILE_VERSION,
  type PublicArtifactQuery,
  type PublicContextQuery,
  type PublicInterventionApply,
  type PublicSnapshotPartQuery,
} from "./task-business.js";
import { TASK_BUSINESS_INTERVENTION_COMMAND_SCHEMA_VERSION } from "../../../vehicle-provider-core/src/task-business-interaction.js";
import { TaskBusinessOperationProfileSchema } from "../../../adapter-protocol/src/task-business-profile.js";

const developmentAuthorization = createAuthorizationResolver({ mode: "development" });

export interface FrozenDispatchResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

export interface TaskBusinessPublicEndpoint {
  getContext(
    query: PublicContextQuery,
    authorization: AuthorizationContext,
  ): Promise<Record<string, unknown>>;
  getArtifact(
    query: PublicArtifactQuery,
    authorization: AuthorizationContext,
  ): Promise<Record<string, unknown>>;
  getSnapshotPart?(
    query: PublicSnapshotPartQuery,
    authorization: AuthorizationContext,
  ): Promise<Record<string, unknown>>;
  applyIntervention?(
    request: PublicInterventionApply,
    authorization: AuthorizationContext,
  ): Promise<Record<string, unknown>>;
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
    readonly onProtocolError?: (error: unknown, requestId: string | number | null) => void,
    readonly taskBusinessPublic?: TaskBusinessPublicEndpoint,
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
          result = frozenDiscoveryResult(
            this.serverVersion,
            {
              providerId: this.manifest.providerId,
              providerType: this.manifest.providerType,
              providerVersion: this.manifest.providerVersion,
              manifestHash: this.manifest.manifestHash,
            },
            this.businessEventDiscovery,
            this.taskBusinessDiscovery(),
          );
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
      if (
        request.method === "io.sdar/taskBusiness/context/get" ||
        request.method === "io.sdar/taskBusiness/snapshotParts/get" ||
        request.method === "io.sdar/taskBusiness/artifacts/get" ||
        request.method === "io.sdar/taskBusiness/interventions/apply"
      ) {
        if (this.taskBusinessPublic === undefined) {
          throw new FrozenProtocolError(FrozenErrorCode.MethodNotFound, "Method not found", 404);
        }
        requireTasksCapability(request);
        requireTaskBusinessCapability(request);
        let result: Record<string, unknown>;
        try {
          if (request.method === "io.sdar/taskBusiness/context/get") {
            result = await this.taskBusinessPublic.getContext(
              parsePublicContextQuery(request.params),
              authorization,
            );
          } else if (request.method === "io.sdar/taskBusiness/snapshotParts/get") {
            if (!this.taskBusinessPublic.getSnapshotPart) {
              throw new FrozenProtocolError(
                FrozenErrorCode.MethodNotFound,
                "Method not found",
                404,
              );
            }
            result = await this.taskBusinessPublic.getSnapshotPart(
              parsePublicSnapshotPartQuery(request.params),
              authorization,
            );
          } else if (request.method === "io.sdar/taskBusiness/artifacts/get") {
            result = await this.taskBusinessPublic.getArtifact(
              parsePublicArtifactQuery(request.params),
              authorization,
            );
          } else {
            if (!this.taskBusinessPublic.applyIntervention) {
              throw new FrozenProtocolError(
                FrozenErrorCode.MethodNotFound,
                "Method not found",
                404,
              );
            }
            result = await this.taskBusinessPublic.applyIntervention(
              parsePublicInterventionApply(request.params),
              authorization,
            );
          }
        } catch (error) {
          throw mapTaskBusinessRequestError(error);
        }
        return { httpStatus: 200, body: { jsonrpc: "2.0", id: request.id, result } };
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
        case "io.sdar/taskExecution/tasks/pause": {
          const taskId = parseTaskReference(request.params);
          await this.taskEngine.controlTask(taskId, "PAUSE", authorization);
          result = { resultType: "complete" };
          break;
        }
        case "io.sdar/taskExecution/tasks/resume": {
          const taskId = parseTaskReference(request.params);
          await this.taskEngine.controlTask(taskId, "RESUME", authorization);
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
      if (mapped.code === FrozenErrorCode.InternalError) this.onProtocolError?.(error, id);
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
      if (mapped.code === FrozenErrorCode.InternalError)
        this.onProtocolError?.(error, requestId(body));
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

  private taskBusinessDiscovery(): Record<string, unknown> | undefined {
    if (
      this.taskBusinessPublic === undefined ||
      !this.manifest.operations.some((operation) => operation.businessFeedbackProfile !== undefined)
    ) {
      return undefined;
    }
    const bindingProperties = {
      externalExecutionId: { type: "string", minLength: 1, maxLength: 256 },
      resourceId: { type: "string", minLength: 1, maxLength: 256 },
      executionMode: { enum: ["live", "simulation"] },
      simulationId: { anyOf: [{ type: "string", minLength: 1, maxLength: 256 }, { type: "null" }] },
    };
    const meta = { type: "object" };
    const interventionEnabled = this.manifest.operations.some((operation) => {
      const profile = TaskBusinessOperationProfileSchema.safeParse(
        operation.businessFeedbackProfile,
      );
      return (
        profile.success &&
        profile.data.methods.interventionApply &&
        profile.data.interventionTypes.length > 0
      );
    });
    const snapshotPartEnabled =
      this.taskBusinessPublic.getSnapshotPart !== undefined &&
      this.manifest.operations.some((operation) => {
        const profile = TaskBusinessOperationProfileSchema.safeParse(
          operation.businessFeedbackProfile,
        );
        return profile.success && profile.data.methods.snapshotPartGet !== undefined;
      });
    return {
      profileVersion: TASK_BUSINESS_PUBLIC_PROFILE_VERSION,
      schemaVersion: "sdar.task-business-public-query/1.0-rc2",
      methods: {
        contextGet: "io.sdar/taskBusiness/context/get",
        ...(snapshotPartEnabled
          ? { snapshotPartGet: "io.sdar/taskBusiness/snapshotParts/get" }
          : {}),
        artifactGet: "io.sdar/taskBusiness/artifacts/get",
        eventListen: "io.sdar/businessEvents/listen",
        ...(interventionEnabled
          ? { interventionApply: "io.sdar/taskBusiness/interventions/apply" }
          : {}),
      },
      snapshotResume: "public-watermark-before-adapter-snapshot",
      contextQuerySchema: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "_meta"],
        properties: {
          taskId: { type: "string", minLength: 1, maxLength: 256 },
          maxPageBytes: { type: "integer", minimum: 1024, maximum: 1048576 },
          pageCursor: { type: "string", minLength: 1, maxLength: 4096 },
          ...bindingProperties,
          _meta: meta,
        },
      },
      ...(snapshotPartEnabled
        ? {
            snapshotPartQuerySchema: {
              type: "object",
              additionalProperties: false,
              required: ["taskId", "snapshotToken", "_meta"],
              properties: {
                taskId: { type: "string", minLength: 1, maxLength: 256 },
                snapshotToken: { type: "string", minLength: 1, maxLength: 4096 },
                objectRef: {
                  type: "object",
                  additionalProperties: false,
                  required: ["kind", "id", "revision"],
                  properties: {
                    kind: { enum: ["artifact", "action", "input_request", "intervention"] },
                    id: { type: "string", minLength: 1, maxLength: 256 },
                    revision: { type: "integer", minimum: 1 },
                  },
                },
                offset: { type: "integer", minimum: 0 },
                maxBytes: { type: "integer", minimum: 1, maximum: 1048576 },
                ...bindingProperties,
                _meta: meta,
              },
            },
            snapshotPartResultSchema: {
              type: "object",
              additionalProperties: false,
              required: ["resultType", "profileVersion", "part"],
              properties: {
                resultType: { const: "complete" },
                profileVersion: { const: TASK_BUSINESS_PUBLIC_PROFILE_VERSION },
                part: {
                  type: "object",
                  additionalProperties: false,
                  required: ["encoding", "bytes", "totalBytes", "sha256", "offset"],
                  properties: {
                    encoding: { const: "base64" },
                    bytes: { type: "string" },
                    totalBytes: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
                    sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
                    offset: { type: "integer", minimum: 0 },
                    nextOffset: { type: "string", pattern: "^[1-9][0-9]*$" },
                  },
                },
              },
            },
          }
        : {}),
      artifactQuerySchema: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "artifactId", "_meta"],
        properties: {
          taskId: { type: "string", minLength: 1, maxLength: 256 },
          artifactId: { type: "string", minLength: 1, maxLength: 256 },
          revision: { type: "integer", minimum: 1 },
          representationName: { type: "string", maxLength: 128 },
          includeContent: { type: "boolean" },
          contentOffset: { type: "integer", minimum: 0 },
          maxContentBytes: { type: "integer", minimum: 1, maximum: 1048576 },
          ...bindingProperties,
          _meta: meta,
        },
      },
      contextResultSchema: {
        type: "object",
        additionalProperties: false,
        required: ["resultType", "profileVersion", "snapshot", "resumeFrom"],
        properties: {
          resultType: { const: "complete" },
          profileVersion: { const: TASK_BUSINESS_PUBLIC_PROFILE_VERSION },
          snapshotToken: { type: "string", minLength: 1, maxLength: 4096 },
          snapshot: {
            type: "object",
            required: ["contextRevision"],
            properties: { contextRevision: { type: "integer", minimum: 0 } },
          },
          resumeFrom: {
            type: "object",
            additionalProperties: false,
            required: ["streamId", "afterSequence"],
            properties: {
              streamId: { type: "string" },
              afterSequence: { type: "string", pattern: "^(0|[1-9][0-9]*)$" },
            },
          },
        },
      },
      artifactResultSchema: {
        type: "object",
        additionalProperties: false,
        required: ["resultType", "profileVersion", "artifact"],
        properties: {
          resultType: { const: "complete" },
          profileVersion: { const: TASK_BUSINESS_PUBLIC_PROFILE_VERSION },
          artifact: { type: "object" },
          content: {
            type: "object",
            additionalProperties: false,
            required: ["encoding", "bytes", "mediaType", "sha256", "totalBytes", "offset"],
            properties: {
              encoding: { const: "base64" },
              bytes: { type: "string" },
              mediaType: { type: "string" },
              sha256: { type: "string" },
              totalBytes: { type: "string" },
              offset: { type: "integer", minimum: 0 },
              nextOffset: { type: "string" },
            },
          },
        },
      },
      ...(interventionEnabled
        ? {
            interventionApplySchema: {
              type: "object",
              additionalProperties: false,
              required: [
                "schemaVersion",
                "commandId",
                "taskId",
                "executionId",
                "interventionId",
                "guard",
                "input",
                "_meta",
              ],
              properties: {
                schemaVersion: { const: TASK_BUSINESS_INTERVENTION_COMMAND_SCHEMA_VERSION },
                commandId: { type: "string", minLength: 1, maxLength: 256 },
                taskId: { type: "string", minLength: 1, maxLength: 256 },
                executionId: { type: "string", minLength: 1, maxLength: 256 },
                interventionId: { type: "string", minLength: 1, maxLength: 256 },
                guard: {
                  oneOf: [
                    {
                      type: "object",
                      additionalProperties: false,
                      required: [
                        "mode",
                        "expectedInterventionRevision",
                        "expectedEffectivePlanRevision",
                      ],
                      properties: {
                        mode: { const: "semantic" },
                        expectedInterventionRevision: { type: "integer", minimum: 1 },
                        expectedEffectivePlanRevision: { type: "integer", minimum: 0 },
                      },
                    },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["mode", "expectedContextRevision"],
                      properties: {
                        mode: { const: "legacy_strict" },
                        expectedContextRevision: { type: "integer", minimum: 0 },
                      },
                    },
                  ],
                },
                input: { type: "object" },
                ...bindingProperties,
                _meta: meta,
              },
            },
            interventionApplyResultSchema: {
              type: "object",
              additionalProperties: false,
              required: ["resultType", "profileVersion", "receipt"],
              properties: {
                resultType: { const: "complete" },
                profileVersion: { const: TASK_BUSINESS_PUBLIC_PROFILE_VERSION },
                receipt: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "commandId",
                    "commandSequence",
                    "commandState",
                    "durablyAccepted",
                    "businessApplied",
                    "duplicate",
                  ],
                  properties: {
                    commandId: { type: "string" },
                    commandSequence: { type: "integer", minimum: 1 },
                    commandState: { type: "string" },
                    durablyAccepted: { const: true },
                    businessApplied: { const: false },
                    duplicate: { type: "boolean" },
                    reasonCode: { type: "string" },
                  },
                },
              },
            },
          }
        : {}),
    };
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
