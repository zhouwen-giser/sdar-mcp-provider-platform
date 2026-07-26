const schema = "https://json-schema.org/draft/2020-12/schema";
const protocolVersion = "2026-07-28";
const profileVersion = "1.0";
const operationNamePattern = "^[A-Za-z0-9][A-Za-z0-9_./-]{0,63}$";
const requestIdPattern = "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$";
const runtimeRevisionPattern = "^(0|[1-9][0-9]{0,19})$";
const rfc3339 = "date-time";

const implementation = {
  type: "object",
  required: ["name", "version"],
  properties: { name: { type: "string", minLength: 1 }, version: { type: "string", minLength: 1 } },
  additionalProperties: true,
};

const clientCapabilities = {
  type: "object",
  properties: {
    extensions: {
      type: "object",
      properties: { "io.modelcontextprotocol/tasks": { type: "object" } },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};

const taskClientCapabilities = {
  ...clientCapabilities,
  required: ["extensions"],
  properties: {
    extensions: {
      type: "object",
      required: ["io.modelcontextprotocol/tasks"],
      properties: { "io.modelcontextprotocol/tasks": { type: "object" } },
      additionalProperties: true,
    },
  },
};

const requestMeta = (requiresTasks = false) => ({
  type: "object",
  required: [
    "io.modelcontextprotocol/protocolVersion",
    "io.modelcontextprotocol/clientInfo",
    "io.modelcontextprotocol/clientCapabilities",
  ],
  properties: {
    "io.modelcontextprotocol/protocolVersion": { const: protocolVersion },
    "io.modelcontextprotocol/clientInfo": implementation,
    "io.modelcontextprotocol/clientCapabilities": requiresTasks
      ? taskClientCapabilities
      : clientCapabilities,
    "io.modelcontextprotocol/logLevel": { type: "string" },
    "io.sdar/taskExecution": { type: "object" },
    progressToken: { type: ["string", "integer"] },
  },
  additionalProperties: true,
});

const requestEnvelope = (method, params, requiresTasks = false) => ({
  type: "object",
  required: ["jsonrpc", "id", "method", "params"],
  properties: {
    jsonrpc: { const: "2.0" },
    id: { type: ["string", "integer"] },
    method: { const: method },
    params: {
      ...params,
      required: [...new Set([...(params.required ?? []), "_meta"])],
      properties: { ...(params.properties ?? {}), _meta: requestMeta(requiresTasks) },
    },
  },
  additionalProperties: false,
});

const completeResult = {
  type: "object",
  required: ["resultType"],
  properties: { resultType: { const: "complete" }, _meta: { type: "object" } },
  additionalProperties: true,
};

const taskExecutionMeta = {
  type: "object",
  required: ["profileVersion", "runtimeRevision"],
  properties: {
    profileVersion: { const: profileVersion },
    runtimeRevision: { type: "string", pattern: runtimeRevisionPattern },
    providerRevision: { type: "string" },
    eventId: { type: "string" },
    observedAt: { type: "string", format: rfc3339 },
    substate: { enum: ["scheduled", "queued", "running", "paused", "resuming", "stopping"] },
    progress: {
      type: "object",
      properties: { percent: { type: "number", minimum: 0, maximum: 100 } },
      additionalProperties: true,
    },
    cancellationRequested: { type: "boolean" },
  },
  additionalProperties: true,
};

const detailedTaskBase = {
  type: "object",
  required: ["taskId", "status", "createdAt", "lastUpdatedAt", "ttlMs", "_meta"],
  properties: {
    taskId: { type: "string", minLength: 1 },
    status: { enum: ["working", "input_required", "completed", "cancelled", "failed"] },
    statusMessage: { type: "string" },
    createdAt: { type: "string", format: rfc3339 },
    lastUpdatedAt: { type: "string", format: rfc3339 },
    ttlMs: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    pollIntervalMs: { type: "integer", minimum: 0 },
    inputRequests: { $ref: "#/$defs/InputRequests" },
    result: { $ref: "#/$defs/CallToolResult" },
    error: { $ref: "#/$defs/JsonRpcError" },
    _meta: {
      type: "object",
      required: ["io.sdar/taskExecution"],
      properties: { "io.sdar/taskExecution": taskExecutionMeta },
      additionalProperties: true,
    },
  },
  additionalProperties: false,
  allOf: [
    {
      if: { properties: { status: { const: "input_required" } }, required: ["status"] },
      then: {
        required: ["inputRequests"],
        not: { anyOf: [{ required: ["result"] }, { required: ["error"] }] },
      },
    },
    {
      if: { properties: { status: { const: "completed" } }, required: ["status"] },
      then: {
        required: ["result"],
        not: { anyOf: [{ required: ["inputRequests"] }, { required: ["error"] }] },
      },
    },
    {
      if: { properties: { status: { const: "failed" } }, required: ["status"] },
      then: {
        required: ["error"],
        not: { anyOf: [{ required: ["inputRequests"] }, { required: ["result"] }] },
      },
    },
    {
      if: { properties: { status: { enum: ["working", "cancelled"] } }, required: ["status"] },
      then: {
        not: {
          anyOf: [
            { required: ["inputRequests"] },
            { required: ["result"] },
            { required: ["error"] },
          ],
        },
      },
    },
  ],
};

const createTaskBase = {
  type: "object",
  required: detailedTaskBase.required,
  properties: Object.fromEntries(
    Object.entries(detailedTaskBase.properties).filter(
      ([name]) => !["inputRequests", "result", "error"].includes(name),
    ),
  ),
  additionalProperties: false,
};

const evidencePayloadRef = {
  oneOf: [
    {
      type: "object",
      required: ["kind", "jsonPointer"],
      properties: {
        kind: { const: "structured_content" },
        jsonPointer: {
          type: "string",
          maxLength: 512,
          pattern: "^(?:|(?:/(?:[^~/]|~[01])*)*)$",
        },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["kind", "uri"],
      properties: {
        kind: { const: "uri" },
        uri: { type: "string", maxLength: 2048, pattern: "^(https|s3|gs|azblob|urn):" },
        mediaType: { type: "string" },
        sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
      },
      additionalProperties: false,
    },
  ],
};

const evidenceItem = {
  type: "object",
  required: ["evidenceId", "evidenceType", "observedAt", "payloadRef"],
  properties: {
    evidenceId: { type: "string", minLength: 1, maxLength: 128 },
    evidenceType: { type: "string", minLength: 1, maxLength: 128 },
    observedAt: { type: "string", format: rfc3339 },
    subjectRef: { type: "string", minLength: 1, maxLength: 512 },
    payloadRef: evidencePayloadRef,
    producer: { type: "array", maxItems: 16, items: { type: "string" } },
  },
  additionalProperties: false,
};

const evidenceProfile = {
  type: "object",
  required: ["profileVersion", "items"],
  properties: {
    profileVersion: { const: profileVersion },
    items: { type: "array", minItems: 0, maxItems: 64, items: evidenceItem },
  },
  additionalProperties: false,
};

const callToolResult = {
  type: "object",
  required: ["resultType", "content", "structuredContent", "isError"],
  properties: {
    resultType: { const: "complete" },
    content: { type: "array" },
    structuredContent: { type: "object" },
    isError: { type: "boolean" },
    _meta: {
      type: "object",
      properties: { "io.sdar/evidence": evidenceProfile },
      additionalProperties: true,
    },
  },
  additionalProperties: false,
};

const inputRequest = {
  type: "object",
  required: ["method", "params"],
  properties: { method: { const: "elicitation/create" }, params: { type: "object" } },
  additionalProperties: false,
};

const inputResponse = {
  type: "object",
  required: ["action"],
  properties: { action: { enum: ["accept", "decline", "cancel"] }, content: {} },
  additionalProperties: false,
};

const taskDefs = {
  RequestMeta: requestMeta(false),
  TaskRequestMeta: requestMeta(true),
  TaskExecutionMeta: taskExecutionMeta,
  JsonRpcError: {
    type: "object",
    required: ["code", "message"],
    properties: { code: { type: "integer" }, message: { type: "string" }, data: {} },
    additionalProperties: false,
  },
  EvidencePayloadRef: evidencePayloadRef,
  EvidenceItem: evidenceItem,
  EvidenceProfile: evidenceProfile,
  CallToolResult: callToolResult,
  InputRequest: inputRequest,
  InputRequests: {
    type: "object",
    propertyNames: { minLength: 1, maxLength: 128 },
    additionalProperties: { $ref: "#/$defs/InputRequest" },
  },
  InputResponse: inputResponse,
  InputResponses: {
    type: "object",
    propertyNames: { minLength: 1, maxLength: 128 },
    additionalProperties: { $ref: "#/$defs/InputResponse" },
  },
  DetailedTask: detailedTaskBase,
};

export function protocolSchemas() {
  return {
    "mcp-stateless-base.schema.json": {
      $schema: schema,
      $id: "https://sdar.dev/protocol/v1/mcp-stateless-base.schema.json",
      title: "Frozen MCP Stateless Base 2026-07-28",
      $defs: {
        RequestMeta: requestMeta(false),
        TaskRequestMeta: requestMeta(true),
        CompleteResult: completeResult,
        DiscoverRequest: requestEnvelope("server/discover", {
          type: "object",
          properties: {},
          additionalProperties: false,
        }),
        DiscoverResult: {
          type: "object",
          required: [
            "resultType",
            "supportedVersions",
            "capabilities",
            "_meta",
            "ttlMs",
            "cacheScope",
          ],
          properties: {
            resultType: { const: "complete" },
            supportedVersions: { const: [protocolVersion] },
            capabilities: {
              type: "object",
              required: ["tools", "extensions"],
              properties: {
                tools: { type: "object" },
                extensions: {
                  type: "object",
                  required: ["io.modelcontextprotocol/tasks", "io.sdar/taskExecution"],
                  properties: {
                    "io.modelcontextprotocol/tasks": { type: "object" },
                    "io.sdar/taskExecution": {
                      type: "object",
                      required: ["profileVersion", "taskNotifications"],
                      properties: {
                        profileVersion: { const: profileVersion },
                        taskNotifications: { const: true },
                      },
                    },
                  },
                },
              },
            },
            _meta: {
              type: "object",
              required: ["io.modelcontextprotocol/serverInfo"],
              properties: { "io.modelcontextprotocol/serverInfo": implementation },
            },
            instructions: { type: "string" },
            ttlMs: { type: "integer", minimum: 0 },
            cacheScope: { const: "public" },
          },
          additionalProperties: false,
        },
      },
      oneOf: [{ $ref: "#/$defs/DiscoverRequest" }, { $ref: "#/$defs/DiscoverResult" }],
    },
    "mcp-streamable-http-routing.schema.json": {
      $schema: schema,
      $id: "https://sdar.dev/protocol/v1/mcp-streamable-http-routing.schema.json",
      title: "Frozen Streamable HTTP Routing Headers",
      type: "object",
      required: ["accept", "content-type", "mcp-protocol-version", "mcp-method"],
      properties: {
        accept: {
          type: "string",
          pattern: "application/json",
          allOf: [{ pattern: "text/event-stream" }],
        },
        "content-type": { const: "application/json" },
        "mcp-protocol-version": { const: protocolVersion },
        "mcp-method": {
          enum: [
            "server/discover",
            "tools/list",
            "tools/call",
            "io.sdar/taskExecution/checkAvailability",
            "tasks/get",
            "tasks/update",
            "tasks/cancel",
            "subscriptions/listen",
            "io.sdar/taskExecution/tasks/observations",
          ],
        },
        "mcp-name": { type: "string", minLength: 1 },
      },
      additionalProperties: true,
      allOf: [
        {
          if: {
            properties: {
              "mcp-method": { enum: ["tools/call", "tasks/get", "tasks/update", "tasks/cancel"] },
            },
            required: ["mcp-method"],
          },
          then: { required: ["mcp-name"] },
        },
        {
          if: {
            properties: { "mcp-method": { const: "subscriptions/listen" } },
            required: ["mcp-method"],
          },
          then: { not: { required: ["mcp-name"] } },
        },
      ],
    },
    "mcp-tasks-sep2663.schema.json": {
      $schema: schema,
      $id: "https://sdar.dev/protocol/v1/mcp-tasks-sep2663.schema.json",
      title: "Frozen SEP-2663 Task Shapes",
      $defs: {
        ...taskDefs,
        CreateTaskResult: {
          ...createTaskBase,
          properties: { ...createTaskBase.properties, resultType: { const: "task" } },
          required: [...createTaskBase.required, "resultType"],
        },
        DetailedTaskResult: {
          ...detailedTaskBase,
          properties: { ...detailedTaskBase.properties, resultType: { const: "complete" } },
          required: [...detailedTaskBase.required, "resultType"],
        },
        GetTaskRequest: requestEnvelope(
          "tasks/get",
          {
            type: "object",
            required: ["taskId"],
            properties: { taskId: { type: "string", minLength: 1 } },
            additionalProperties: false,
          },
          true,
        ),
        UpdateTaskRequest: requestEnvelope(
          "tasks/update",
          {
            type: "object",
            required: ["taskId", "inputResponses"],
            properties: {
              taskId: { type: "string", minLength: 1 },
              inputResponses: { $ref: "#/$defs/InputResponses" },
            },
            additionalProperties: false,
          },
          true,
        ),
        CancelTaskRequest: requestEnvelope(
          "tasks/cancel",
          {
            type: "object",
            required: ["taskId"],
            properties: { taskId: { type: "string", minLength: 1 } },
            additionalProperties: false,
          },
          true,
        ),
        CompleteAck: completeResult,
      },
      oneOf: [
        { $ref: "#/$defs/CreateTaskResult" },
        { $ref: "#/$defs/DetailedTaskResult" },
        { $ref: "#/$defs/GetTaskRequest" },
        { $ref: "#/$defs/UpdateTaskRequest" },
        { $ref: "#/$defs/CancelTaskRequest" },
        { $ref: "#/$defs/CompleteAck" },
      ],
    },
    "mcp-task-notifications-sep2663.schema.json": {
      $schema: schema,
      $id: "https://sdar.dev/protocol/v1/mcp-task-notifications-sep2663.schema.json",
      title: "Frozen SEP-2663 Task Notification Shapes",
      $defs: {
        ...taskDefs,
        ListenRequest: requestEnvelope(
          "subscriptions/listen",
          {
            type: "object",
            required: ["notifications"],
            properties: {
              notifications: {
                type: "object",
                required: ["taskIds"],
                properties: {
                  taskIds: {
                    type: "array",
                    maxItems: 256,
                    uniqueItems: true,
                    items: { type: "string", minLength: 1 },
                  },
                },
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
          true,
        ),
        Acknowledged: {
          type: "object",
          required: ["jsonrpc", "method", "params"],
          properties: {
            jsonrpc: { const: "2.0" },
            method: { const: "notifications/subscriptions/acknowledged" },
            params: {
              type: "object",
              required: ["_meta", "notifications"],
              properties: {
                _meta: {
                  type: "object",
                  required: ["io.modelcontextprotocol/subscriptionId"],
                  properties: {
                    "io.modelcontextprotocol/subscriptionId": { type: ["string", "integer"] },
                  },
                },
                notifications: {
                  type: "object",
                  required: ["taskIds"],
                  properties: {
                    taskIds: {
                      type: "array",
                      maxItems: 256,
                      uniqueItems: true,
                      items: { type: "string" },
                    },
                  },
                  additionalProperties: false,
                },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        TaskNotification: {
          type: "object",
          required: ["jsonrpc", "method", "params"],
          properties: {
            jsonrpc: { const: "2.0" },
            method: { const: "notifications/tasks" },
            params: {
              ...detailedTaskBase,
              properties: {
                ...detailedTaskBase.properties,
                _meta: {
                  ...detailedTaskBase.properties._meta,
                  required: ["io.modelcontextprotocol/subscriptionId", "io.sdar/taskExecution"],
                  properties: {
                    ...detailedTaskBase.properties._meta.properties,
                    "io.modelcontextprotocol/subscriptionId": { type: ["string", "integer"] },
                  },
                },
              },
            },
          },
          additionalProperties: false,
        },
      },
      oneOf: [
        { $ref: "#/$defs/ListenRequest" },
        { $ref: "#/$defs/Acknowledged" },
        { $ref: "#/$defs/TaskNotification" },
      ],
    },
    "sdar-task-execution-profile-v1.schema.json": {
      $schema: schema,
      $id: "https://sdar.dev/protocol/v1/sdar-task-execution-profile-v1.schema.json",
      title: "SDAR Task Execution Profile V1",
      type: "object",
      required: [
        "profileVersion",
        "taskBehavior",
        "availability",
        "supportsScheduling",
        "supportsMaxElapsed",
        "supportsObservations",
        "supportsInputRequired",
        "idempotency",
      ],
      properties: {
        profileVersion: { const: profileVersion },
        taskBehavior: { enum: ["synchronous_only", "server_directed", "task_required"] },
        availability: { enum: ["not_supported", "dynamic"] },
        supportsScheduling: { type: "boolean" },
        supportsMaxElapsed: { type: "boolean" },
        supportsObservations: { type: "boolean" },
        supportsInputRequired: { type: "boolean" },
        idempotency: { enum: ["none", "client_request_key", "server_managed", "unknown"] },
      },
      additionalProperties: false,
    },
    "sdar-availability-v1.schema.json": availabilitySchema(),
    "sdar-evidence-v1.schema.json": {
      $schema: schema,
      $id: "https://sdar.dev/protocol/v1/sdar-evidence-v1.schema.json",
      title: "SDAR Evidence Profile V1 type_only",
      ...evidenceProfile,
      $defs: { EvidencePayloadRef: evidencePayloadRef, EvidenceItem: evidenceItem },
    },
    "pms-mismatch.schema.json": mismatchSchema(),
  };
}

function availabilitySchema() {
  const timing = {
    type: "object",
    properties: {
      start: {
        oneOf: [
          {
            type: "object",
            required: ["mode"],
            properties: {
              mode: { const: "immediate" },
              startToleranceMs: { type: "integer", minimum: 0, maximum: 86400000 },
            },
            additionalProperties: false,
          },
          {
            type: "object",
            required: ["mode", "scheduledAt"],
            properties: {
              mode: { const: "scheduled" },
              scheduledAt: { type: "string", format: rfc3339 },
              startToleranceMs: { type: "integer", minimum: 0, maximum: 86400000 },
            },
            additionalProperties: false,
          },
        ],
      },
      maxElapsedMs: {
        anyOf: [{ type: "integer", minimum: 1, maximum: 31536000000 }, { type: "null" }],
      },
    },
    additionalProperties: false,
  };
  const check = {
    type: "object",
    required: ["requestId", "operationName", "arguments"],
    properties: {
      requestId: { type: "string", minLength: 1, maxLength: 128, pattern: requestIdPattern },
      operationName: { type: "string", pattern: operationNamePattern },
      arguments: {
        oneOf: [
          {
            type: "object",
            required: ["state", "value"],
            properties: { state: { const: "complete" }, value: {} },
            additionalProperties: false,
          },
          {
            type: "object",
            required: ["state", "knownValue", "unresolvedPaths"],
            properties: {
              state: { const: "partial" },
              knownValue: {},
              unresolvedPaths: {
                type: "array",
                minItems: 1,
                maxItems: 128,
                uniqueItems: true,
                items: { type: "string", maxLength: 512, pattern: "^(?:|(?:/(?:[^~/]|~[01])*)*)$" },
              },
            },
            additionalProperties: false,
          },
        ],
      },
      timing,
    },
    additionalProperties: false,
  };
  const result = {
    type: "object",
    required: ["requestId", "operationName", "availability", "riskLevel", "reservationMode"],
    properties: {
      requestId: { type: "string", minLength: 1, maxLength: 128 },
      operationName: { type: "string", pattern: operationNamePattern },
      availability: { enum: ["available", "restricted", "disabled", "unknown"] },
      riskLevel: { enum: ["low", "medium", "high", "critical"] },
      reasonCode: { type: "string", maxLength: 128 },
      description: { type: "string", maxLength: 2048 },
      validUntil: { type: "string", format: rfc3339 },
      earliestStartTime: { type: "string", format: rfc3339 },
      nextAvailableWindows: {
        type: "array",
        maxItems: 32,
        items: {
          type: "object",
          required: ["startTime", "endTime"],
          properties: {
            startTime: { type: "string", format: rfc3339 },
            endTime: { type: "string", format: rfc3339 },
          },
          additionalProperties: false,
        },
      },
      estimatedDelayMs: { type: "integer", minimum: 0 },
      reservationMode: { enum: ["none", "best_effort", "guaranteed"] },
      reservationRef: { type: "string", minLength: 1, maxLength: 256 },
      possibleEffects: {
        type: "array",
        uniqueItems: true,
        items: {
          enum: [
            "task_preemption",
            "task_pause",
            "start_rejection",
            "start_window_missed",
            "deadline_reached",
            "partial_completion",
          ],
        },
      },
    },
    additionalProperties: false,
    allOf: [
      {
        if: { properties: { availability: { const: "restricted" } }, required: ["availability"] },
        then: {
          required: ["validUntil"],
          anyOf: [{ required: ["earliestStartTime"] }, { required: ["nextAvailableWindows"] }],
        },
      },
      {
        if: {
          properties: { reservationMode: { const: "guaranteed" } },
          required: ["reservationMode"],
        },
        then: { required: ["reservationRef"] },
        else: { not: { required: ["reservationRef"] } },
      },
    ],
  };
  return {
    $schema: schema,
    $id: "https://sdar.dev/protocol/v1/sdar-availability-v1.schema.json",
    title: "SDAR Availability V1",
    $defs: { RequestMeta: requestMeta(false), Check: check, Result: result },
    oneOf: [
      requestEnvelope("io.sdar/taskExecution/checkAvailability", {
        type: "object",
        required: ["profileVersion", "checks"],
        properties: {
          profileVersion: { const: profileVersion },
          checks: { type: "array", minItems: 1, maxItems: 64, items: { $ref: "#/$defs/Check" } },
        },
        additionalProperties: false,
      }),
      {
        type: "object",
        required: ["resultType", "profileVersion", "results"],
        properties: {
          resultType: { const: "complete" },
          profileVersion: { const: profileVersion },
          results: { type: "array", minItems: 1, maxItems: 64, items: { $ref: "#/$defs/Result" } },
        },
        additionalProperties: false,
      },
    ],
  };
}

function mismatchSchema() {
  const codes = [
    "PROTOCOL_BASELINE_MISMATCH",
    "PROTOCOL_SOURCE_COMMIT_MISMATCH",
    "PROTOCOL_SCHEMA_HASH_MISMATCH",
    "SERVER_DISCOVER_SHAPE_MISMATCH",
    "SERVER_SUPPORTED_VERSIONS_MISSING",
    "PROTOCOL_VERSION_MISSING",
    "PROTOCOL_VERSION_UNSUPPORTED",
    "CLIENT_INFO_MISSING",
    "CLIENT_CAPABILITIES_MISSING",
    "REQUEST_META_SHAPE_MISMATCH",
    "REQUEST_META_REQUIRED_FIELD_MISSING",
    "MCP_PROTOCOL_VERSION_HEADER_MISSING",
    "MCP_METHOD_HEADER_MISSING",
    "MCP_NAME_HEADER_MISSING",
    "MCP_HEADER_BODY_MISMATCH",
    "MCP_HEADER_VALUE_INVALID",
    "TASK_EXTENSION_CAPABILITY_MISSING",
    "TASK_EXTENSION_SERVER_DISCOVERY_MISSING",
    "LEGACY_TASK_CAPABILITY_DECLARATION",
    "LEGACY_TASK_WIRE_DETECTED",
    "LEGACY_TASK_SUPPORT_FIELD",
    "TASK_BEHAVIOR_PROFILE_MISMATCH",
    "TASK_BEHAVIOR_RUNTIME_MISMATCH",
    "CREATE_TASK_RESULT_SHAPE_MISMATCH",
    "TASK_RESULT_DISCRIMINATOR_MISSING",
    "LEGACY_NESTED_TASK_RESULT",
    "TASK_FIELD_MISMATCH",
    "TASK_TTL_SEMANTICS_MISMATCH",
    "TASK_POLL_INTERVAL_FIELD_MISMATCH",
    "TASK_META_ALIAS_PRESENT",
    "TASK_UPDATE_FIELD_MISMATCH",
    "TASK_UPDATE_ACK_MISMATCH",
    "INPUT_REQUEST_MAP_MISMATCH",
    "INPUT_REQUEST_PROTOCOL_SHAPE_MISMATCH",
    "INPUT_RESPONSE_PROTOCOL_SHAPE_MISMATCH",
    "INPUT_REQUEST_KEY_REUSED",
    "UNSUPPORTED_TASK_METHOD",
    "CUSTOM_METHOD_NAMESPACE_MISMATCH",
    "RESERVED_TASK_METHOD_COLLISION",
    "METHOD_MISMATCH",
    "REQUEST_ENVELOPE_MISMATCH",
    "CORRELATION_FIELD_MISMATCH",
    "PROFILE_VERSION_MISMATCH",
    "ARGUMENT_STATE_MODEL_MISMATCH",
    "AVAILABILITY_RESULT_SET_MISMATCH",
    "AVAILABILITY_RESTRICTED_HINT_MISSING",
    "AVAILABILITY_WINDOW_INVALID",
    "AVAILABILITY_RESERVATION_INVALID",
    "TASK_NOTIFICATION_CAPABILITY_MISSING",
    "TASK_NOTIFICATION_LISTEN_UNSUPPORTED",
    "TASK_NOTIFICATION_REQUEST_SHAPE_MISMATCH",
    "TASK_NOTIFICATION_ACK_MISSING",
    "TASK_NOTIFICATION_ACK_NOT_FIRST",
    "TASK_NOTIFICATION_SUBSCRIPTION_ID_MISSING",
    "TASK_NOTIFICATION_ACK_TASK_SET_MISMATCH",
    "TASK_NOTIFICATION_UNAUTHORIZED_TASK_EXPOSED",
    "TASK_NOTIFICATION_DETAIL_SHAPE_MISMATCH",
    "TASK_NOTIFICATION_REVISION_REGRESSION",
    "TASK_NOTIFICATION_RESULT_MISMATCH",
    "TASK_NOTIFICATION_FORBIDDEN_EVENT_TYPE",
    "TASK_NOTIFICATION_RECONNECT_GAP_UNHANDLED",
    "EVIDENCE_CHANNEL_MISSING",
    "EVIDENCE_SCHEMA_MISMATCH",
    "EVIDENCE_DATA_REFERENCE_INVALID",
    "EVIDENCE_TYPE_MISMATCH",
    "EVIDENCE_PAYLOAD_NOT_FOUND",
    "EVIDENCE_URI_HASH_MISSING",
    "EVIDENCE_PROFILE_LIMIT_EXCEEDED",
    "EVIDENCE_FORBIDDEN_REQUIREMENT_ID",
  ];
  return {
    $schema: schema,
    $id: "https://sdar.dev/protocol/v1/pms-mismatch.schema.json",
    title: "Frozen PMS Protocol Mismatch",
    type: "object",
    required: ["code", "severity", "message"],
    properties: {
      code: { enum: codes },
      severity: { enum: ["error", "warning"] },
      message: { type: "string", minLength: 1 },
      path: { type: "string" },
      details: { type: "object" },
    },
    additionalProperties: false,
  };
}

export const frozenConformanceTitles = [
  "embodied.move exact discovery",
  "tool name containing dot",
  "tool name containing slash",
  "server discover fixed supportedVersions",
  "server discover tasks and notification capabilities",
  "source commit or schema hash mismatch rejected",
  "request missing protocolVersion",
  "request missing clientCapabilities",
  "SDAR request missing clientInfo",
  "client omits tasks extension",
  "task_required without tasks extension",
  "server returns synchronous result",
  "server returns flat CreateTaskResult",
  "created task immediately queryable",
  "legacy nested task rejected",
  "tasks/get working",
  "tasks/get input_required",
  "partial tasks/update",
  "unknown input key ignored",
  "answered input key repeated",
  "input key reuse detected",
  "cancel acknowledgement",
  "working after cancel",
  "cancelled after cancel",
  "completed after cancel",
  "ttlMs null",
  "TTL extension updates wire value",
  "dynamic pollIntervalMs",
  "completed with isError false",
  "completed with isError true",
  "failed with JSON-RPC error",
  "evidence hard gate passes",
  "evidence missing",
  "evidence pointer missing",
  "URI evidence missing SHA",
  "tasks/observations namespace collision",
  "PMS detects legacy tasks",
  "task queryable after Runtime restart",
  "SDAR resumes query after restart",
  "sync and async evidence shapes equal",
  "HTTP missing MCP-Protocol-Version",
  "HTTP missing Mcp-Method",
  "applicable request missing Mcp-Name",
  "header and body mismatch",
  "subscriptions/listen establishes SSE",
  "task subscription missing capability",
  "subscription acknowledgement is first",
  "ack includes only authorized accepted task IDs",
  "subscription messages contain subscriptionId",
  "current DetailedTask sent after ack",
  "input_required notification has full input requests",
  "completed notification has result and evidence",
  "failed notification has JSON-RPC error",
  "duplicate notification idempotent",
  "runtime revision does not regress",
  "no non-terminal notification after terminal",
  "HTTP SSE close releases subscription",
  "STDIO cancelled notification stops subscription",
  "reconnect fills gap with tasks/get",
  "slow consumer closes without blocking task",
  "task stream excludes progress notifications",
  "task stream excludes message notifications",
  "concurrent subscriptions route by request ID",
  "unknown or unauthorized tasks not disclosed",
  "notification equals tasks/get at same revision",
  "missing clientInfo returns Invalid Params",
  "CallToolResult missing resultType rejected",
  "task_required synchronous success rejected",
  "task_required admission_rejected allowed",
  "runtime revision consistent across create get notification",
  "Provider evidence requirementId rejected",
  "SDAR binds requirement locally by evidenceType",
  "restricted availability requires valid hint",
  "URI hard-gate evidence requires valid SHA-256",
];
