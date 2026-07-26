import type { IncomingHttpHeaders } from "node:http";
import { FrozenErrorCode, FrozenProtocolError } from "./errors.js";
import type { FrozenJsonRpcRequest } from "./request-validator.js";
import { FROZEN_PROTOCOL_VERSION } from "./request-validator.js";

const namedMethods = new Set([
  "tools/call",
  "tasks/get",
  "tasks/update",
  "tasks/cancel",
  "io.sdar/businessEvents/relatedTasks/list",
]);

export function validateFrozenHeaders(
  headers: IncomingHttpHeaders,
  request: FrozenJsonRpcRequest,
): void {
  const accept = requiredHeader(headers, "accept");
  const acceptedTypes = accept
    .split(",")
    .map((value) => value.trim().split(";", 1)[0]?.toLowerCase());
  if (!acceptedTypes.includes("application/json") || !acceptedTypes.includes("text/event-stream")) {
    throw headerMismatch();
  }

  const contentType = requiredHeader(headers, "content-type")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") throw headerMismatch();

  const protocolVersion = requiredHeader(headers, "mcp-protocol-version");
  if (protocolVersion !== request.meta.protocolVersion) throw headerMismatch();
  if (protocolVersion !== FROZEN_PROTOCOL_VERSION) {
    throw new FrozenProtocolError(
      FrozenErrorCode.UnsupportedProtocolVersion,
      "Unsupported protocol version",
      400,
      { supportedVersions: [FROZEN_PROTOCOL_VERSION] },
    );
  }

  if (requiredHeader(headers, "mcp-method") !== request.method) throw headerMismatch();
  const name = header(headers, "mcp-name");
  if (namedMethods.has(request.method)) {
    const expected =
      request.method === "tools/call"
        ? request.params.name
        : request.method === "io.sdar/businessEvents/relatedTasks/list"
          ? request.params.eventId
          : request.params.taskId;
    if (typeof expected !== "string" || name !== expected) throw headerMismatch();
  } else if (
    (request.method === "subscriptions/listen" ||
      request.method === "io.sdar/businessEvents/listen") &&
    name !== undefined
  ) {
    throw headerMismatch();
  }
}

function requiredHeader(headers: IncomingHttpHeaders, name: string): string {
  const value = header(headers, name);
  if (value === undefined) throw headerMismatch();
  return value;
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  if (Array.isArray(value)) throw headerMismatch();
  if (value === undefined) return undefined;
  if (!/^[\x20-\x7e]+$/.test(value)) throw headerMismatch();
  return value;
}

function headerMismatch(): FrozenProtocolError {
  return new FrozenProtocolError(FrozenErrorCode.HeaderMismatch, "Header mismatch", 400);
}
