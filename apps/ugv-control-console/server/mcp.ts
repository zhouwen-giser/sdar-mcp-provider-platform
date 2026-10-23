import { randomUUID } from "node:crypto";
import { array, record, text, type Json } from "../shared/model.js";
export class UpstreamError extends Error {
  constructor(
    readonly code: string,
    readonly uncertain = false,
  ) {
    super(code);
  }
}
export const protocolMeta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "smpp-ugv-control-console", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {
    extensions: {
      "io.modelcontextprotocol/tasks": {},
      "io.sdar/taskExecution": { profileVersion: "1.0" },
      "io.sdar/taskBusiness": { profileVersion: "1.0-rc2" },
      "io.sdar/businessEvents": { profileVersion: "1.0" },
    },
  },
};
const named = new Set([
  "tasks/get",
  "tasks/update",
  "tasks/cancel",
  "io.sdar/taskExecution/tasks/pause",
  "io.sdar/taskExecution/tasks/resume",
  "io.sdar/taskBusiness/context/get",
  "io.sdar/taskBusiness/artifacts/get",
  "io.sdar/taskBusiness/interventions/apply",
]);
export class Mcp {
  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
    readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async open(method: string, params: Json, signal: AbortSignal): Promise<Response> {
    const name =
      method === "tools/call" ? text(params.name) : named.has(method) ? text(params.taskId) : "";
    try {
      return await this.fetchImpl(this.url, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          ...this.headers,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": method,
          ...(name ? { "mcp-name": name } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: randomUUID(),
          method,
          params: { ...params, _meta: { ...protocolMeta, ...record(params._meta) } },
        }),
      });
    } catch {
      throw new UpstreamError("MCP_TRANSPORT_UNCERTAIN", true);
    }
  }
  async rpc(method: string, params: Json = {}, timeoutMs = 15000): Promise<Json> {
    const response = await this.open(method, params, AbortSignal.timeout(timeoutMs));
    let envelope: Json;
    try {
      const bytes = await response.text();
      if (bytes.length > 32 * 1024 * 1024) throw Error();
      envelope = record(JSON.parse(bytes));
    } catch {
      throw new UpstreamError("MCP_RESPONSE_INVALID", true);
    }
    if (envelope.error) {
      const err = record(envelope.error),
        details = record(err.data);
      const reason = text(details.reasonCode ?? details.reason ?? err.message);
      throw new UpstreamError(
        /^[A-Z][A-Z0-9_]{2,100}$/.test(reason) ? reason : `MCP_RPC_ERROR_${text(err.code)}`,
        response.status >= 500 || err.code === -32603,
      );
    }
    if (!response.ok) throw new UpstreamError(`MCP_HTTP_${response.status}`);
    if (!envelope.result || typeof envelope.result !== "object")
      throw new UpstreamError("MCP_RESPONSE_INVALID", true);
    return record(envelope.result);
  }
  async tool(name: string, args: Json) {
    return this.rpc("tools/call", { name, arguments: args });
  }
  async listen(
    method: string,
    params: Json,
    onMessage: (value: Json) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await this.open(method, params, signal);
    if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream"))
      throw new UpstreamError("MCP_EVENT_STREAM_RESET");
    if (!response.body) throw new UpstreamError("MCP_EVENT_STREAM_MISSING");
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!signal.aborted) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");
        if (buffer.length > 2 * 1024 * 1024) throw Error("MCP_EVENT_FRAME_TOO_LARGE");
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = frame
            .split("\n")
            .filter((s) => s.startsWith("data:"))
            .map((s) => s.slice(5).trimStart())
            .join("\n");
          if (data) onMessage(record(JSON.parse(data)));
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}
export function toolContent(value: Json): Json {
  if (value.isError === true)
    throw new UpstreamError(text(record(value.structuredContent).reasonCode) || "MCP_TOOL_FAILED");
  return record(value.structuredContent);
}
export function findTools(value: Json) {
  return array(value.tools).map(record);
}
