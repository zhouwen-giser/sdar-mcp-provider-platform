import { FrozenErrorCode, FrozenProtocolError, invalidParams } from "./errors.js";

export const FROZEN_PROTOCOL_VERSION = "2026-07-28";
export const TASKS_EXTENSION = "io.modelcontextprotocol/tasks";

export interface FrozenRequestMeta {
  protocolVersion: string;
  clientInfo: { name: string; version: string };
  clientCapabilities: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface FrozenJsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params: Record<string, unknown> & { _meta: Record<string, unknown> };
  meta: FrozenRequestMeta;
}

export function validateFrozenRequest(value: unknown): FrozenJsonRpcRequest {
  const envelope = object(value);
  if (envelope.jsonrpc !== "2.0") throw invalidParams();
  if (typeof envelope.id !== "string" && !Number.isInteger(envelope.id)) throw invalidParams();
  if (typeof envelope.method !== "string" || envelope.method.length === 0) throw invalidParams();
  const params = object(envelope.params);
  const rawMeta = object(params._meta);

  const protocolVersion = rawMeta["io.modelcontextprotocol/protocolVersion"];
  if (typeof protocolVersion !== "string") throw invalidParams();
  if (protocolVersion !== FROZEN_PROTOCOL_VERSION) {
    throw new FrozenProtocolError(
      FrozenErrorCode.UnsupportedProtocolVersion,
      "Unsupported protocol version",
      400,
      { supportedVersions: [FROZEN_PROTOCOL_VERSION] },
    );
  }

  const clientInfo = object(rawMeta["io.modelcontextprotocol/clientInfo"]);
  if (typeof clientInfo.name !== "string" || typeof clientInfo.version !== "string") {
    throw invalidParams();
  }
  const clientCapabilities = object(rawMeta["io.modelcontextprotocol/clientCapabilities"]);

  return {
    jsonrpc: "2.0",
    id: envelope.id as string | number,
    method: envelope.method,
    params: params as FrozenJsonRpcRequest["params"],
    meta: {
      protocolVersion,
      clientInfo: { name: clientInfo.name, version: clientInfo.version },
      clientCapabilities,
      raw: rawMeta,
    },
  };
}

export function requireTasksCapability(request: FrozenJsonRpcRequest): void {
  const extensions = recordOrUndefined(request.meta.clientCapabilities.extensions);
  if (extensions === undefined || !isObject(extensions[TASKS_EXTENSION])) {
    throw new FrozenProtocolError(
      FrozenErrorCode.MissingRequiredClientCapability,
      "Missing required client capability",
      400,
      { requiredCapabilities: { extensions: { [TASKS_EXTENSION]: {} } } },
    );
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw invalidParams();
  return value;
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
