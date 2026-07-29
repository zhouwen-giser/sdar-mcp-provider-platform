import { Ajv2020 } from "ajv/dist/2020.js";
import { canonicalize } from "./canonical.js";
import {
  CatalogDiscoveryError,
  FROZEN_PROTOCOL_VERSION,
  type CatalogDiscoveryOptions,
  type CatalogDiscoveryRequest,
  type CatalogDiscoveryTransport,
  type CatalogTool,
  type DiscoveredCatalog,
  type ResourceBinding,
  type RuntimeDiscovery,
  type TaskExecutionProfile,
} from "./model.js";

const TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,63}$/;
const JSON_POINTER = /^(?:\/(?:[^~/]|~0|~1)*)+$/;
const TASK_BEHAVIORS = new Set(["synchronous_only", "server_directed", "task_required"]);
const AVAILABILITY = new Set(["dynamic", "not_supported"]);
const IDEMPOTENCY = new Set(["server_managed", "none"]);

const DEFAULT_OPTIONS = {
  timeoutMs: 5_000,
  maxAttempts: 3,
  retryDelayMs: 100,
  maxResponseBytes: 1_048_576,
  maxTools: 128,
  clientName: "sdar-pms-catalog-manager",
  clientVersion: "0.1.0",
} as const;

export class CatalogDiscoveryClient {
  readonly #options: Required<CatalogDiscoveryOptions>;
  readonly #ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });

  constructor(
    readonly transport: CatalogDiscoveryTransport,
    options: CatalogDiscoveryOptions = {},
  ) {
    this.#options = { ...DEFAULT_OPTIONS, ...options };
    if (
      this.#options.timeoutMs < 1 ||
      this.#options.maxAttempts < 1 ||
      this.#options.retryDelayMs < 0 ||
      this.#options.maxResponseBytes < 1 ||
      this.#options.maxTools < 1
    ) {
      throw new Error("INVALID_CATALOG_DISCOVERY_OPTIONS");
    }
  }

  async discover(): Promise<DiscoveredCatalog> {
    const discoveryResponse = await this.#request("server/discover");
    const toolsResponse = await this.#request("tools/list");
    const discovery = validateDiscovery(rpcResult(discoveryResponse, "server/discover"));
    const tools = this.#validateTools(rpcResult(toolsResponse, "tools/list"));
    const snapshot = { discovery, tools };
    return { ...snapshot, canonicalJson: canonicalize(snapshot) };
  }

  async #request(method: CatalogDiscoveryRequest["method"]): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.#options.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#options.timeoutMs);
      try {
        const result = await this.transport.call(this.#buildRequest(method), controller.signal);
        assertResponseBound(result, this.#options.maxResponseBytes);
        return result;
      } catch (error) {
        lastError = normalizeTransportError(error, controller.signal.aborted);
        if (
          !(lastError instanceof CatalogDiscoveryError) ||
          !lastError.retryable ||
          attempt === this.#options.maxAttempts
        ) {
          throw lastError;
        }
        if (this.#options.retryDelayMs > 0) await delay(this.#options.retryDelayMs);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  #buildRequest(method: CatalogDiscoveryRequest["method"]): CatalogDiscoveryRequest {
    return {
      method,
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": FROZEN_PROTOCOL_VERSION,
        "mcp-method": method,
      },
      body: {
        jsonrpc: "2.0",
        id: `catalog-${method}`,
        method,
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": FROZEN_PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientInfo": {
              name: this.#options.clientName,
              version: this.#options.clientVersion,
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      },
    };
  }

  #validateTools(result: unknown): readonly CatalogTool[] {
    const object = record(result, "CATALOG_INCOMPLETE_TOOLS_LIST");
    if ("nextCursor" in object || object.resultType === "partial") {
      throw new CatalogDiscoveryError("CATALOG_INCOMPLETE_TOOLS_LIST", false);
    }
    if (!Array.isArray(object.tools) || object.tools.length > this.#options.maxTools) {
      throw new CatalogDiscoveryError("CATALOG_INCOMPLETE_TOOLS_LIST", false);
    }
    const names = new Set<string>();
    const tools = object.tools.map((value) => {
      const tool = this.#validateTool(value);
      if (names.has(tool.name)) {
        throw new CatalogDiscoveryError("CATALOG_DUPLICATE_TOOL", false);
      }
      names.add(tool.name);
      return tool;
    });
    return tools.sort((left, right) => left.name.localeCompare(right.name));
  }

  #validateTool(value: unknown): CatalogTool {
    const tool = record(value, "CATALOG_INVALID_TOOL");
    if (
      typeof tool.name !== "string" ||
      !TOOL_NAME.test(tool.name) ||
      typeof tool.description !== "string"
    ) {
      throw new CatalogDiscoveryError("CATALOG_INVALID_TOOL", false);
    }
    const inputSchema = schema(tool.inputSchema, this.#ajv);
    const outputSchema = schema(tool.outputSchema, this.#ajv);
    const metadata = record(tool._meta, "CATALOG_INVALID_TOOL");
    const taskExecution = validateTaskExecution(metadata["io.sdar/taskExecution"]);
    const bindingValue = metadata["io.sdar/resourceBinding"];
    return {
      name: tool.name,
      description: tool.description,
      inputSchema,
      outputSchema,
      taskExecution,
      ...(bindingValue === undefined
        ? {}
        : { resourceBinding: validateResourceBinding(bindingValue) }),
    };
  }
}

function rpcResult(response: unknown, method: CatalogDiscoveryRequest["method"]): unknown {
  const envelope = record(response, "CATALOG_INVALID_JSON_RPC");
  if (envelope.jsonrpc !== "2.0" || envelope.id !== `catalog-${method}`) {
    throw new CatalogDiscoveryError("CATALOG_INVALID_JSON_RPC", false);
  }
  if ("error" in envelope) throw new CatalogDiscoveryError("CATALOG_REMOTE_ERROR", false);
  if (!("result" in envelope)) throw new CatalogDiscoveryError("CATALOG_INVALID_JSON_RPC", false);
  return envelope.result;
}

function validateDiscovery(value: unknown): RuntimeDiscovery {
  const discovery = record(value, "CATALOG_INVALID_DISCOVERY");
  const capabilities = record(discovery.capabilities, "CATALOG_INVALID_DISCOVERY");
  const extensions = record(capabilities.extensions, "CATALOG_INVALID_DISCOVERY");
  const taskExtension = extensions["io.modelcontextprotocol/tasks"];
  const taskProfile = record(extensions["io.sdar/taskExecution"], "CATALOG_INVALID_DISCOVERY");
  const metadata = record(discovery._meta, "CATALOG_INVALID_DISCOVERY");
  const serverInfo = record(
    metadata["io.modelcontextprotocol/serverInfo"],
    "CATALOG_INVALID_DISCOVERY",
  );
  if (
    discovery.resultType !== "complete" ||
    !Array.isArray(discovery.supportedVersions) ||
    !discovery.supportedVersions.every(
      (version): version is string => typeof version === "string",
    ) ||
    !discovery.supportedVersions.includes(FROZEN_PROTOCOL_VERSION) ||
    typeof taskExtension !== "object" ||
    taskExtension === null ||
    Array.isArray(taskExtension) ||
    taskProfile.profileVersion !== "1.0" ||
    taskProfile.taskNotifications !== true ||
    typeof serverInfo.name !== "string" ||
    serverInfo.name.length === 0 ||
    typeof serverInfo.version !== "string" ||
    serverInfo.version.length === 0
  ) {
    throw new CatalogDiscoveryError("CATALOG_INVALID_DISCOVERY", false);
  }
  return {
    resultType: "complete",
    supportedVersions: [...discovery.supportedVersions],
    capabilities,
    serverInfo: { name: serverInfo.name, version: serverInfo.version },
    ...(typeof discovery.instructions === "string" ? { instructions: discovery.instructions } : {}),
    ...(typeof discovery.ttlMs === "number" ? { ttlMs: discovery.ttlMs } : {}),
    ...(typeof discovery.cacheScope === "string" ? { cacheScope: discovery.cacheScope } : {}),
  };
}

function validateTaskExecution(value: unknown): TaskExecutionProfile {
  const profile = record(value, "CATALOG_INVALID_TOOL");
  if (
    profile.profileVersion !== "1.0" ||
    typeof profile.taskBehavior !== "string" ||
    !TASK_BEHAVIORS.has(profile.taskBehavior) ||
    typeof profile.availability !== "string" ||
    !AVAILABILITY.has(profile.availability) ||
    typeof profile.supportsScheduling !== "boolean" ||
    typeof profile.supportsMaxElapsed !== "boolean" ||
    typeof profile.supportsObservations !== "boolean" ||
    typeof profile.supportsInputRequired !== "boolean" ||
    typeof profile.idempotency !== "string" ||
    !IDEMPOTENCY.has(profile.idempotency)
  ) {
    throw new CatalogDiscoveryError("CATALOG_INVALID_TOOL", false);
  }
  return profile as unknown as TaskExecutionProfile;
}

function validateResourceBinding(value: unknown): ResourceBinding {
  const binding = record(value, "CATALOG_INVALID_TOOL");
  if (binding.mode === "NONE" && binding.resourceIdJsonPointer === undefined) {
    return { mode: "NONE" };
  }
  if (
    binding.mode === "ARGUMENT_REFERENCE" &&
    typeof binding.resourceIdJsonPointer === "string" &&
    JSON_POINTER.test(binding.resourceIdJsonPointer)
  ) {
    return {
      mode: "ARGUMENT_REFERENCE",
      resourceIdJsonPointer: binding.resourceIdJsonPointer,
    };
  }
  throw new CatalogDiscoveryError("CATALOG_INVALID_TOOL", false);
}

function schema(value: unknown, ajv: Ajv2020): Readonly<Record<string, unknown>> {
  const candidate = record(value, "CATALOG_INVALID_SCHEMA");
  try {
    ajv.compile(candidate);
  } catch (error) {
    throw new CatalogDiscoveryError("CATALOG_INVALID_SCHEMA", false, { cause: error });
  }
  return candidate;
}

function record(
  value: unknown,
  code:
    | "CATALOG_INVALID_JSON_RPC"
    | "CATALOG_INVALID_DISCOVERY"
    | "CATALOG_INCOMPLETE_TOOLS_LIST"
    | "CATALOG_INVALID_TOOL"
    | "CATALOG_INVALID_SCHEMA",
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CatalogDiscoveryError(code, false);
  }
  return value as Record<string, unknown>;
}

function assertResponseBound(value: unknown, maxBytes: number): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new CatalogDiscoveryError("CATALOG_INVALID_JSON_RPC", false, { cause: error });
  }
  if (Buffer.byteLength(serialized) > maxBytes) {
    throw new CatalogDiscoveryError("CATALOG_RESPONSE_TOO_LARGE", false);
  }
}

function normalizeTransportError(error: unknown, timedOut: boolean): CatalogDiscoveryError {
  if (error instanceof CatalogDiscoveryError) return error;
  return new CatalogDiscoveryError(
    timedOut ? "CATALOG_REQUEST_TIMEOUT" : "CATALOG_REQUEST_FAILED",
    true,
    { cause: error },
  );
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
