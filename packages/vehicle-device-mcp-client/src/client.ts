import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ProviderStore } from "../../provider-adapter-kit/src/index.js";
import { mockUgvToolContracts, type CapturedToolContract } from "./fixtures.js";
import { isAllowedUgvDeviceTool, type UgvDeviceToolName } from "./tool-allowlist.js";

export interface UgvDeviceMcpClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  connected(): boolean;
  contracts(): CapturedToolContract[];
  hasTool(name: UgvDeviceToolName): boolean;
  call(
    name: UgvDeviceToolName,
    argumentsValue: Record<string, unknown>,
    taskId?: string,
  ): Promise<Record<string, unknown>>;
}

export interface DeviceMcpProfile<TTool extends string> {
  clientName: string;
  errorPrefix: string;
  mockServerName: string;
  isAllowed(name: string): name is TTool;
  mockContracts(capturedAt?: string): CapturedToolContract[];
}

export interface VehicleDeviceMcpClient<TTool extends string> {
  connect(): Promise<void>;
  close(): Promise<void>;
  connected(): boolean;
  contracts(): CapturedToolContract[];
  hasTool(name: TTool): boolean;
  call(
    name: TTool,
    argumentsValue: Record<string, unknown>,
    taskId?: string,
  ): Promise<Record<string, unknown>>;
}

const UGV_PROFILE: DeviceMcpProfile<UgvDeviceToolName> = {
  clientName: "sdar-ugv-adapter",
  errorPrefix: "UGV",
  mockServerName: "mock-ugv-device-mcp",
  isAllowed: isAllowedUgvDeviceTool,
  mockContracts: mockUgvToolContracts,
};

export class StreamableHttpVehicleDeviceMcpClient<
  TTool extends string,
> implements VehicleDeviceMcpClient<TTool> {
  #client: Client | undefined;
  #transport: StreamableHTTPClientTransport | undefined;
  #contracts: CapturedToolContract[] = [];
  constructor(
    readonly options: {
      url: string;
      timeoutMs: number;
      headersFile?: string;
      maxResponseBytes: number;
      contractReportPath: string;
      useMockContractWhenUnavailable: boolean;
    },
    readonly store: ProviderStore,
    readonly profile: DeviceMcpProfile<TTool>,
  ) {}
  async connect(): Promise<void> {
    if (this.#client !== undefined) return;
    const headers =
      this.options.headersFile === undefined ? {} : loadHeaders(this.options.headersFile);
    const client = new Client({ name: this.profile.clientName, version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(this.options.url), {
      requestInit: { headers },
    });
    try {
      await client.connect(transport as unknown as Transport, { timeout: this.options.timeoutMs });
      const response = await client.listTools({}, { timeout: this.options.timeoutMs });
      const capturedAt = new Date().toISOString();
      this.#contracts = response.tools.map((tool) => {
        const schemaHash = createHash("sha256").update(canonical(tool.inputSchema)).digest("hex");
        return {
          name: tool.name,
          description: tool.description ?? "",
          inputSchema: tool.inputSchema,
          ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
          ...(tool.annotations === undefined ? {} : { annotations: { ...tool.annotations } }),
          capturedAt,
          schemaHash,
        };
      });
      this.#client = client;
      this.#transport = transport;
      this.#writeContract("captured", client.getServerVersion(), transport.protocolVersion);
    } catch (error) {
      await transport.close().catch(() => undefined);
      if (!this.options.useMockContractWhenUnavailable) throw error;
      this.#contracts = this.profile.mockContracts();
      this.#writeContract(
        "mock_fixture",
        { name: this.profile.mockServerName, version: "1.0.0" },
        "2025-11-25",
      );
    }
  }
  async close(): Promise<void> {
    await this.#transport?.close();
    this.#client = undefined;
    this.#transport = undefined;
  }
  connected(): boolean {
    return this.#client !== undefined;
  }
  contracts(): CapturedToolContract[] {
    return structuredClone(this.#contracts);
  }
  hasTool(name: TTool): boolean {
    return this.#contracts.some(
      (tool) =>
        tool.name === name &&
        this.profile.isAllowed(tool.name) &&
        tool.inputSchema.type === "object",
    );
  }
  async call(
    name: TTool,
    argumentsValue: Record<string, unknown>,
    taskId?: string,
  ): Promise<Record<string, unknown>> {
    if (!this.profile.isAllowed(name))
      throw new Error(`${this.profile.errorPrefix}_DEVICE_TOOL_NOT_ALLOWED`);
    if (!this.hasTool(name)) throw new Error(`${this.profile.errorPrefix}_DEVICE_TOOL_UNAVAILABLE`);
    if (this.#client === undefined)
      throw new Error(`${this.profile.errorPrefix}_DEVICE_MCP_UNAVAILABLE`);
    const started = Date.now();
    let outcome: "accepted" | "rejected" | "timeout" | "protocol_error" = "accepted";
    try {
      const response = await this.#client.callTool({ name, arguments: argumentsValue }, undefined, {
        timeout: this.options.timeoutMs,
      });
      if (response.isError === true) {
        outcome = "rejected";
        throw new Error(`${this.profile.errorPrefix}_DEVICE_TOOL_REJECTED`);
      }
      return parseToolResult(response, this.options.maxResponseBytes);
    } catch (error) {
      outcome =
        error instanceof Error && /timeout/i.test(error.message) ? "timeout" : "protocol_error";
      throw error;
    } finally {
      await this.store.appendDeviceToolCall({
        callId: randomUUID(),
        ...(taskId === undefined ? {} : { taskId }),
        toolName: name,
        argumentHash: createHash("sha256").update(canonical(argumentsValue)).digest("hex"),
        outcome,
        durationMs: Date.now() - started,
        occurredAt: new Date().toISOString(),
      });
    }
  }
  #writeContract(mode: string, serverInfo: unknown, protocolVersion: string | undefined): void {
    const report = {
      mode,
      capturedAt: new Date().toISOString(),
      serverInfo,
      protocolVersion: protocolVersion ?? "unknown",
      tools: this.#contracts,
      callableTools: this.#contracts
        .filter((tool) => this.hasTool(tool.name as TTool))
        .map((tool) => tool.name),
    };
    mkdirSync(dirname(this.options.contractReportPath), { recursive: true });
    writeFileSync(this.options.contractReportPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}

export class StreamableHttpUgvDeviceMcpClient
  extends StreamableHttpVehicleDeviceMcpClient<UgvDeviceToolName>
  implements UgvDeviceMcpClient
{
  constructor(
    options: ConstructorParameters<
      typeof StreamableHttpVehicleDeviceMcpClient<UgvDeviceToolName>
    >[0],
    store: ProviderStore,
  ) {
    super(options, store, UGV_PROFILE);
  }
}

export class MockVehicleDeviceMcpClient<
  TTool extends string,
> implements VehicleDeviceMcpClient<TTool> {
  #connected = false;
  readonly calls: {
    name: TTool;
    arguments: Record<string, unknown>;
    taskId?: string;
  }[] = [];
  readonly responses = new Map<TTool, Record<string, unknown>>();
  readonly failures = new Map<TTool, Error>();
  constructor(
    readonly profile: DeviceMcpProfile<TTool>,
    readonly available = new Set<TTool>(profile.mockContracts().map((x) => x.name as TTool)),
  ) {}
  connect(): Promise<void> {
    this.#connected = true;
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.#connected = false;
    return Promise.resolve();
  }
  connected(): boolean {
    return this.#connected;
  }
  contracts(): CapturedToolContract[] {
    return this.profile.mockContracts().filter((tool) => this.available.has(tool.name as TTool));
  }
  hasTool(name: TTool): boolean {
    return this.available.has(name);
  }
  call(
    name: TTool,
    argumentsValue: Record<string, unknown>,
    taskId?: string,
  ): Promise<Record<string, unknown>> {
    if (!this.#connected)
      return Promise.reject(new Error(`${this.profile.errorPrefix}_DEVICE_MCP_UNAVAILABLE`));
    if (!this.available.has(name))
      return Promise.reject(new Error(`${this.profile.errorPrefix}_DEVICE_TOOL_UNAVAILABLE`));
    const failure = this.failures.get(name);
    if (failure !== undefined) return Promise.reject(failure);
    this.calls.push({
      name,
      arguments: structuredClone(argumentsValue),
      ...(taskId === undefined ? {} : { taskId }),
    });
    return Promise.resolve(structuredClone(this.responses.get(name) ?? { accepted: true }));
  }
}

export class MockUgvDeviceMcpClient
  extends MockVehicleDeviceMcpClient<UgvDeviceToolName>
  implements UgvDeviceMcpClient
{
  constructor(
    available = new Set<UgvDeviceToolName>(
      mockUgvToolContracts().map((x) => x.name as UgvDeviceToolName),
    ),
  ) {
    super(UGV_PROFILE, available);
  }
}

function parseToolResult(value: unknown, maxResponseBytes: number): Record<string, unknown> {
  if (!record(value)) throw new Error("UGV_DEVICE_MCP_RESPONSE_INVALID");
  const candidates: Record<string, unknown>[] = [];
  if (record(value.structuredContent)) candidates.push(value.structuredContent);
  if (Array.isArray(value.content))
    for (const item of value.content) {
      if (!record(item) || item.type !== "text" || typeof item.text !== "string") continue;
      if (Buffer.byteLength(item.text, "utf8") > maxResponseBytes)
        throw new Error("UGV_DEVICE_MCP_RESPONSE_TOO_LARGE");
      try {
        const parsed: unknown = JSON.parse(item.text);
        if (record(parsed)) candidates.push(parsed);
      } catch {
        // Non-JSON text is descriptive only and cannot prove a state transition.
      }
    }
  const unique = new Map(candidates.map((candidate) => [canonical(candidate), candidate]));
  if (unique.size !== 1) throw new Error("UGV_DEVICE_MCP_RESPONSE_CONFLICT");
  const parsed = [...unique.values()][0];
  if (parsed === undefined) throw new Error("UGV_DEVICE_MCP_STRUCTURED_RESULT_REQUIRED");
  if (Buffer.byteLength(JSON.stringify(parsed), "utf8") > maxResponseBytes)
    throw new Error("UGV_DEVICE_MCP_RESPONSE_TOO_LARGE");
  return parsed;
}
function loadHeaders(path: string): Record<string, string> {
  const raw = readFileSync(path, "utf8");
  if (Buffer.byteLength(raw, "utf8") > 16_384) throw new Error("UGV_DEVICE_MCP_HEADERS_TOO_LARGE");
  const value: unknown = JSON.parse(raw);
  if (!record(value) || Object.values(value).some((header) => typeof header !== "string"))
    throw new Error("UGV_DEVICE_MCP_HEADERS_INVALID");
  return value as Record<string, string>;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value))
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
