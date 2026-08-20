import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ProviderStore } from "../../provider-adapter-kit/src/index.js";
import {
  DeviceToolCircuitOpenError,
  DeviceToolProtocolError,
  DeviceToolRejectedError,
  UncertainMutatingDeviceCallError,
} from "./errors.js";
import {
  capturedToolSchemaHash,
  mockUgvToolContracts,
  type CapturedToolContract,
} from "./fixtures.js";
import {
  isAllowedUgvDeviceTool,
  isMutatingUgvDeviceTool,
  type UgvDeviceToolName,
} from "./tool-allowlist.js";
import { validateUgvToolResult } from "./ugv-result.js";

export type DeviceMcpConnectionState =
  "disconnected" | "connecting" | "connected" | "reconnecting" | "closed";

export type DeviceToolHealthState = "healthy" | "degraded" | "open" | "unavailable";

export interface DeviceToolHealthSnapshot<TTool extends string = string> {
  toolName: TTool;
  state: DeviceToolHealthState;
  consecutiveFailures: number;
  lastFailureAt?: string;
  lastSuccessAt?: string;
  openUntil?: string;
}

export interface DeviceToolCallOptions {
  kind?: "read" | "mutating";
  /** Number of retries after the initial read attempt. Mutations ignore it. */
  readRetryAttempts?: number;
}

export interface DeviceToolCallObservation<TTool extends string = string> {
  toolName: TTool;
  kind: "read" | "mutating";
  outcome: "accepted" | "rejected" | "timeout" | "protocol_error";
  attempts: number;
  retries: number;
  durationMs: number;
  uncertain: boolean;
}

export interface UgvDeviceMcpClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  connected(): boolean;
  connectionState(): DeviceMcpConnectionState;
  onConnectionState(listener: (state: DeviceMcpConnectionState) => void): () => void;
  contracts(): CapturedToolContract[];
  hasTool(name: UgvDeviceToolName): boolean;
  toolAvailable(name: UgvDeviceToolName): boolean;
  toolHealth(name: UgvDeviceToolName): DeviceToolHealthSnapshot<UgvDeviceToolName>;
  onToolHealth(listener: (health: DeviceToolHealthSnapshot<UgvDeviceToolName>) => void): () => void;
  onCallObservation(
    listener: (observation: DeviceToolCallObservation<UgvDeviceToolName>) => void,
  ): () => void;
  call(
    name: UgvDeviceToolName,
    argumentsValue: Record<string, unknown>,
    taskId?: string,
    options?: DeviceToolCallOptions,
  ): Promise<Record<string, unknown>>;
}

export interface DeviceMcpProfile<TTool extends string> {
  clientName: string;
  errorPrefix: string;
  mockServerName: string;
  isAllowed(name: string): name is TTool;
  mockContracts(capturedAt?: string): CapturedToolContract[];
  /** Opt in to reconnect, read retry, per-tool circuit and uncertain-mutation semantics. */
  resilientCalls?: boolean;
  isMutating?(name: TTool): boolean;
  validateResult?(
    name: TTool,
    result: Record<string, unknown>,
    argumentsValue?: Record<string, unknown>,
  ): Record<string, unknown>;
  mockResult?(name: TTool, argumentsValue: Record<string, unknown>): Record<string, unknown>;
  contractSchemaHash?(
    contract: Pick<CapturedToolContract, "name" | "inputSchema" | "outputSchema" | "annotations">,
  ): string;
}

export interface VehicleDeviceMcpClient<TTool extends string> {
  connect(): Promise<void>;
  close(): Promise<void>;
  connected(): boolean;
  connectionState(): DeviceMcpConnectionState;
  onConnectionState(listener: (state: DeviceMcpConnectionState) => void): () => void;
  contracts(): CapturedToolContract[];
  hasTool(name: TTool): boolean;
  toolAvailable(name: TTool): boolean;
  toolHealth(name: TTool): DeviceToolHealthSnapshot<TTool>;
  onToolHealth(listener: (health: DeviceToolHealthSnapshot<TTool>) => void): () => void;
  onCallObservation(listener: (observation: DeviceToolCallObservation<TTool>) => void): () => void;
  call(
    name: TTool,
    argumentsValue: Record<string, unknown>,
    taskId?: string,
    options?: DeviceToolCallOptions,
  ): Promise<Record<string, unknown>>;
}

const UGV_PROFILE: DeviceMcpProfile<UgvDeviceToolName> = {
  clientName: "sdar-ugv-adapter",
  errorPrefix: "UGV",
  mockServerName: "mock-ugv-device-mcp",
  isAllowed: isAllowedUgvDeviceTool,
  mockContracts: mockUgvToolContracts,
  resilientCalls: true,
  isMutating: isMutatingUgvDeviceTool,
  validateResult: validateUgvToolResult,
  mockResult: mockUgvResult,
  contractSchemaHash: capturedToolSchemaHash,
};

interface ToolHealthRecord {
  state: "healthy" | "degraded" | "open";
  consecutiveFailures: number;
  lastFailureAt?: string;
  lastSuccessAt?: string;
  openUntilMs?: number;
  halfOpenProbeInFlight: boolean;
}

export class StreamableHttpVehicleDeviceMcpClient<
  TTool extends string,
> implements VehicleDeviceMcpClient<TTool> {
  #client: Client | undefined;
  #transport: StreamableHTTPClientTransport | undefined;
  #contracts: CapturedToolContract[] = [];
  #state: DeviceMcpConnectionState = "disconnected";
  #closing = false;
  #connectPromise: Promise<void> | undefined;
  #reconnectTimer: NodeJS.Timeout | undefined;
  #reconnectDelayMs: number;
  readonly #connectionListeners = new Set<(state: DeviceMcpConnectionState) => void>();
  readonly #healthListeners = new Set<(health: DeviceToolHealthSnapshot<TTool>) => void>();
  readonly #callListeners = new Set<(observation: DeviceToolCallObservation<TTool>) => void>();
  readonly #toolHealth = new Map<TTool, ToolHealthRecord>();

  constructor(
    readonly options: {
      url: string;
      timeoutMs: number;
      headersFile?: string;
      maxResponseBytes: number;
      contractReportPath: string;
      useMockContractWhenUnavailable: boolean;
      reconnectMinMs?: number;
      reconnectMaxMs?: number;
      readRetryAttempts?: number;
      circuitBreakerThreshold?: number;
      circuitBreakerResetMs?: number;
    },
    readonly store: ProviderStore,
    readonly profile: DeviceMcpProfile<TTool>,
  ) {
    this.#reconnectDelayMs = this.reconnectMinMs;
  }

  get reconnectMinMs(): number {
    return boundedInteger(this.options.reconnectMinMs, 250, 50, 60_000);
  }
  get reconnectMaxMs(): number {
    return boundedInteger(this.options.reconnectMaxMs, 5_000, this.reconnectMinMs, 300_000);
  }
  get circuitBreakerThreshold(): number {
    return boundedInteger(this.options.circuitBreakerThreshold, 3, 1, 100);
  }
  get circuitBreakerResetMs(): number {
    return boundedInteger(this.options.circuitBreakerResetMs, 5_000, 100, 300_000);
  }

  async connect(): Promise<void> {
    this.#closing = false;
    if (this.connected()) return;
    try {
      await this.#connect(false);
    } catch (error) {
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
    if (this.profile.resilientCalls !== true) {
      const transport = this.#transport;
      await transport?.close();
      this.#client = undefined;
      this.#transport = undefined;
      this.#setConnectionState("closed");
      return;
    }
    this.#closing = true;
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    const transport = this.#transport;
    this.#client = undefined;
    this.#transport = undefined;
    if (transport !== undefined) await transport.close().catch(() => undefined);
    this.#setConnectionState("closed");
  }

  connected(): boolean {
    return (
      this.#state === "connected" && this.#client !== undefined && this.#transport !== undefined
    );
  }

  connectionState(): DeviceMcpConnectionState {
    return this.#state;
  }

  onConnectionState(listener: (state: DeviceMcpConnectionState) => void): () => void {
    this.#connectionListeners.add(listener);
    return () => this.#connectionListeners.delete(listener);
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

  toolAvailable(name: TTool): boolean {
    if (!this.hasTool(name)) return false;
    const health = this.#toolHealth.get(name);
    return health?.state !== "open" || (health.openUntilMs ?? 0) <= Date.now();
  }

  toolHealth(name: TTool): DeviceToolHealthSnapshot<TTool> {
    if (!this.hasTool(name))
      return { toolName: name, state: "unavailable", consecutiveFailures: 0 };
    return this.#healthSnapshot(name, this.#healthRecord(name));
  }

  onToolHealth(listener: (health: DeviceToolHealthSnapshot<TTool>) => void): () => void {
    this.#healthListeners.add(listener);
    return () => this.#healthListeners.delete(listener);
  }

  onCallObservation(listener: (observation: DeviceToolCallObservation<TTool>) => void): () => void {
    this.#callListeners.add(listener);
    return () => this.#callListeners.delete(listener);
  }

  async call(
    name: TTool,
    argumentsValue: Record<string, unknown>,
    taskId?: string,
    callOptions: DeviceToolCallOptions = {},
  ): Promise<Record<string, unknown>> {
    if (!this.profile.isAllowed(name))
      throw new Error(`${this.profile.errorPrefix}_DEVICE_TOOL_NOT_ALLOWED`);
    if (!this.hasTool(name)) throw new Error(`${this.profile.errorPrefix}_DEVICE_TOOL_UNAVAILABLE`);
    if (this.profile.resilientCalls !== true) return this.#callLegacy(name, argumentsValue, taskId);
    this.#assertCircuitAllows(name);
    const mutating = callOptions.kind
      ? callOptions.kind === "mutating"
      : (this.profile.isMutating?.(name) ?? true);
    const retryAttempts = mutating
      ? 0
      : boundedInteger(callOptions.readRetryAttempts ?? this.options.readRetryAttempts, 1, 0, 10);
    const started = Date.now();
    let attempt = 0;
    let outcome: "accepted" | "rejected" | "timeout" | "protocol_error" | undefined;
    try {
      for (;;) {
        try {
          if (!this.connected()) {
            if (mutating) throw new Error(`${this.profile.errorPrefix}_DEVICE_MCP_UNAVAILABLE`);
            await this.#connect(true);
          }
          const result = await this.#performCall(name, argumentsValue, mutating);
          this.#recordToolSuccess(name);
          outcome = "accepted";
          return result;
        } catch (error) {
          if (error instanceof DeviceToolRejectedError) {
            outcome = "rejected";
            // A structured rejection proves that the tool and transport are
            // responsive, so it also completes a half-open health probe.
            this.#recordToolSuccess(name);
            throw error;
          }
          if (error instanceof DeviceToolCircuitOpenError) throw error;
          if (error instanceof UncertainMutatingDeviceCallError) {
            outcome = "timeout";
            this.#recordToolFailure(name);
            throw error;
          }
          if (!transportFailure(error)) {
            if (preDispatchUnavailable(error, this.profile.errorPrefix))
              this.#deferHalfOpenProbe(name);
            else this.#recordToolFailure(name);
            throw error;
          }
          outcome = isTimeout(error) ? "timeout" : "protocol_error";
          await this.#disconnectAfterFailure();
          this.#recordToolFailure(name);
          if (mutating)
            throw new UncertainMutatingDeviceCallError(
              this.profile.errorPrefix,
              name,
              errorOptions(error),
            );
          if (attempt >= retryAttempts) throw error;
          attempt++;
          await delay(Math.min(this.reconnectMinMs * 2 ** (attempt - 1), this.reconnectMaxMs));
        }
      }
    } catch (error) {
      if (error instanceof DeviceToolRejectedError) outcome = "rejected";
      else if (error instanceof UncertainMutatingDeviceCallError || isTimeout(error))
        outcome = "timeout";
      else outcome = "protocol_error";
      throw error;
    } finally {
      const observation: DeviceToolCallObservation<TTool> = {
        toolName: name,
        kind: mutating ? "mutating" : "read",
        outcome: outcome ?? "protocol_error",
        attempts: attempt + 1,
        retries: attempt,
        durationMs: Date.now() - started,
        uncertain: outcome === "timeout" && mutating,
      };
      for (const listener of this.#callListeners) listener(structuredClone(observation));
      // The device outcome is authoritative. A local audit-write outage must not
      // turn an accepted physical mutation into an apparent command failure.
      await this.store
        .appendDeviceToolCall({
          callId: randomUUID(),
          ...(taskId === undefined ? {} : { taskId }),
          toolName: name,
          argumentHash: createHash("sha256").update(canonical(argumentsValue)).digest("hex"),
          outcome: outcome ?? "protocol_error",
          durationMs: Date.now() - started,
          occurredAt: new Date().toISOString(),
        })
        .catch(() => undefined);
    }
  }

  async #callLegacy(
    name: TTool,
    argumentsValue: Record<string, unknown>,
    taskId?: string,
  ): Promise<Record<string, unknown>> {
    const client = this.#client;
    if (client === undefined) throw new Error(`${this.profile.errorPrefix}_DEVICE_MCP_UNAVAILABLE`);
    const started = Date.now();
    let outcome: "accepted" | "rejected" | "timeout" | "protocol_error" = "accepted";
    try {
      const response = await client.callTool({ name, arguments: argumentsValue }, undefined, {
        timeout: this.options.timeoutMs,
      });
      if (response.isError === true) {
        outcome = "rejected";
        throw new Error(`${this.profile.errorPrefix}_DEVICE_TOOL_REJECTED`);
      }
      // Profiles that have not opted in retain the reviewed shared-client
      // result/error contract, including its historical UGV parse codes.
      return parseToolResult(response, this.options.maxResponseBytes, "UGV");
    } catch (error) {
      outcome = isTimeout(error) ? "timeout" : "protocol_error";
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

  async #connect(reconnecting: boolean): Promise<void> {
    if (this.connected()) return;
    if (this.#connectPromise !== undefined) return this.#connectPromise;
    if (this.#closing) throw new Error(`${this.profile.errorPrefix}_DEVICE_MCP_CLOSED`);
    const promise = this.#open(reconnecting);
    this.#connectPromise = promise;
    try {
      await promise;
    } finally {
      if (this.#connectPromise === promise) this.#connectPromise = undefined;
    }
  }

  async #open(reconnecting: boolean): Promise<void> {
    this.#setConnectionState(reconnecting ? "reconnecting" : "connecting");
    const headers =
      this.options.headersFile === undefined ? {} : loadHeaders(this.options.headersFile);
    const client = new Client({ name: this.profile.clientName, version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(this.options.url), {
      requestInit: { headers },
    });
    if (this.profile.resilientCalls === true)
      client.onclose = () => this.#transportClosed(client, transport);
    try {
      await client.connect(transport as unknown as Transport, { timeout: this.options.timeoutMs });
      const response = await client.listTools({}, { timeout: this.options.timeoutMs });
      const capturedAt = new Date().toISOString();
      const contracts = response.tools.map((tool): CapturedToolContract => {
        const annotations =
          tool.annotations === undefined
            ? undefined
            : ({ ...tool.annotations } as Record<string, unknown>);
        const contract = {
          name: tool.name,
          description: tool.description ?? "",
          inputSchema: tool.inputSchema,
          ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
          ...(annotations === undefined ? {} : { annotations }),
        };
        return {
          ...contract,
          capturedAt,
          schemaHash:
            this.profile.contractSchemaHash?.(contract) ??
            createHash("sha256").update(canonical(contract.inputSchema)).digest("hex"),
        };
      });
      if (this.#closing) throw new Error(`${this.profile.errorPrefix}_DEVICE_MCP_CLOSED`);
      this.#client = client;
      this.#transport = transport;
      this.#contracts = contracts;
      this.#reconnectDelayMs = this.reconnectMinMs;
      this.#setConnectionState("connected");
      this.#writeContract("captured", client.getServerVersion(), transport.protocolVersion);
    } catch (error) {
      await transport.close().catch(() => undefined);
      if (!this.#closing) this.#setConnectionState("disconnected");
      throw error;
    }
  }

  async #performCall(
    name: TTool,
    argumentsValue: Record<string, unknown>,
    mutating: boolean,
  ): Promise<Record<string, unknown>> {
    const client = this.#client;
    if (client === undefined) throw new Error(`${this.profile.errorPrefix}_DEVICE_MCP_UNAVAILABLE`);
    try {
      const response = await client.callTool({ name, arguments: argumentsValue }, undefined, {
        timeout: this.options.timeoutMs,
      });
      let result: Record<string, unknown>;
      try {
        result = parseToolResult(response, this.options.maxResponseBytes, this.profile.errorPrefix);
      } catch (error) {
        if (response.isError === true)
          throw new DeviceToolRejectedError(this.profile.errorPrefix, name);
        throw error;
      }
      if (response.isError === true) {
        if (this.profile.validateResult === undefined)
          throw new DeviceToolRejectedError(this.profile.errorPrefix, name, undefined, result);
        try {
          this.profile.validateResult(name, result, argumentsValue);
        } catch (error) {
          if (error instanceof DeviceToolRejectedError) throw error;
          throw new DeviceToolRejectedError(this.profile.errorPrefix, name, undefined, result);
        }
        throw new DeviceToolProtocolError(
          this.profile.errorPrefix,
          name,
          "DEVICE_MCP_IS_ERROR_CONTRADICTORY",
        );
      }
      return this.profile.validateResult?.(name, result, argumentsValue) ?? result;
    } catch (error) {
      if (
        mutating &&
        !(error instanceof DeviceToolRejectedError) &&
        !(error instanceof UncertainMutatingDeviceCallError)
      ) {
        if (transportFailure(error)) await this.#disconnectAfterFailure();
        throw new UncertainMutatingDeviceCallError(
          this.profile.errorPrefix,
          name,
          errorOptions(error),
        );
      }
      throw error;
    }
  }

  #transportClosed(client: Client, transport: StreamableHTTPClientTransport): void {
    if (this.#client !== client && this.#transport !== transport) return;
    this.#client = undefined;
    this.#transport = undefined;
    if (this.#closing) return;
    this.#setConnectionState("disconnected");
    this.#scheduleReconnect();
  }

  async #disconnectAfterFailure(): Promise<void> {
    const transport = this.#transport;
    this.#client = undefined;
    this.#transport = undefined;
    if (!this.#closing) this.#setConnectionState("disconnected");
    if (transport !== undefined) await transport.close().catch(() => undefined);
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    if (this.profile.resilientCalls !== true) return;
    if (this.#closing || this.connected() || this.#reconnectTimer !== undefined) return;
    this.#setConnectionState("reconnecting");
    const reconnectInMs = this.#reconnectDelayMs;
    this.#reconnectDelayMs = Math.min(this.reconnectMaxMs, reconnectInMs * 2);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.#connect(true).catch(() => this.#scheduleReconnect());
    }, reconnectInMs);
    this.#reconnectTimer.unref();
  }

  #setConnectionState(state: DeviceMcpConnectionState): void {
    if (this.#state === state) return;
    this.#state = state;
    for (const listener of this.#connectionListeners)
      try {
        listener(state);
      } catch {
        // An observer cannot own transport liveness.
      }
  }

  #healthRecord(name: TTool): ToolHealthRecord {
    let health = this.#toolHealth.get(name);
    if (health === undefined) {
      health = { state: "healthy", consecutiveFailures: 0, halfOpenProbeInFlight: false };
      this.#toolHealth.set(name, health);
    }
    return health;
  }

  #assertCircuitAllows(name: TTool): void {
    const health = this.#healthRecord(name);
    if (health.halfOpenProbeInFlight)
      throw new DeviceToolCircuitOpenError(this.profile.errorPrefix, name);
    if (health.state !== "open") return;
    if ((health.openUntilMs ?? Number.POSITIVE_INFINITY) > Date.now())
      throw new DeviceToolCircuitOpenError(this.profile.errorPrefix, name);
    health.halfOpenProbeInFlight = true;
    this.#emitHealth(name, health);
  }

  #deferHalfOpenProbe(name: TTool): void {
    const health = this.#healthRecord(name);
    if (!health.halfOpenProbeInFlight) return;
    health.state = "open";
    health.halfOpenProbeInFlight = false;
    health.openUntilMs = Date.now() + this.circuitBreakerResetMs;
    this.#emitHealth(name, health);
  }

  #recordToolSuccess(name: TTool): void {
    const health = this.#healthRecord(name);
    health.state = "healthy";
    health.consecutiveFailures = 0;
    health.lastSuccessAt = new Date().toISOString();
    delete health.openUntilMs;
    health.halfOpenProbeInFlight = false;
    this.#emitHealth(name, health);
  }

  #recordToolFailure(name: TTool): void {
    const health = this.#healthRecord(name);
    health.consecutiveFailures++;
    health.lastFailureAt = new Date().toISOString();
    health.halfOpenProbeInFlight = false;
    if (health.consecutiveFailures >= this.circuitBreakerThreshold) {
      health.state = "open";
      health.openUntilMs = Date.now() + this.circuitBreakerResetMs;
    } else health.state = "degraded";
    this.#emitHealth(name, health);
  }

  #healthSnapshot(name: TTool, health: ToolHealthRecord): DeviceToolHealthSnapshot<TTool> {
    return {
      toolName: name,
      state: health.state,
      consecutiveFailures: health.consecutiveFailures,
      ...(health.lastFailureAt === undefined ? {} : { lastFailureAt: health.lastFailureAt }),
      ...(health.lastSuccessAt === undefined ? {} : { lastSuccessAt: health.lastSuccessAt }),
      ...(health.openUntilMs === undefined
        ? {}
        : { openUntil: new Date(health.openUntilMs).toISOString() }),
    };
  }

  #emitHealth(name: TTool, health: ToolHealthRecord): void {
    const snapshot = this.#healthSnapshot(name, health);
    for (const listener of this.#healthListeners)
      try {
        listener(snapshot);
      } catch {
        // Health observers are isolated from tool execution.
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
  readonly #connectionListeners = new Set<(state: DeviceMcpConnectionState) => void>();
  readonly #healthListeners = new Set<(health: DeviceToolHealthSnapshot<TTool>) => void>();
  readonly #callListeners = new Set<(observation: DeviceToolCallObservation<TTool>) => void>();
  readonly calls: {
    name: TTool;
    arguments: Record<string, unknown>;
    taskId?: string;
  }[] = [];
  readonly responses = new Map<TTool, Record<string, unknown>>();
  readonly failures = new Map<TTool, Error>();
  readonly handlers = new Map<
    TTool,
    (
      argumentsValue: Record<string, unknown>,
      taskId?: string,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>
  >();
  constructor(
    readonly profile: DeviceMcpProfile<TTool>,
    readonly available = new Set<TTool>(profile.mockContracts().map((x) => x.name as TTool)),
  ) {}
  connect(): Promise<void> {
    this.#connected = true;
    for (const listener of this.#connectionListeners) listener("connected");
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.#connected = false;
    for (const listener of this.#connectionListeners) listener("closed");
    return Promise.resolve();
  }
  connected(): boolean {
    return this.#connected;
  }
  connectionState(): DeviceMcpConnectionState {
    return this.#connected ? "connected" : "disconnected";
  }
  onConnectionState(listener: (state: DeviceMcpConnectionState) => void): () => void {
    this.#connectionListeners.add(listener);
    return () => this.#connectionListeners.delete(listener);
  }
  contracts(): CapturedToolContract[] {
    return this.profile.mockContracts().filter((tool) => this.available.has(tool.name as TTool));
  }
  hasTool(name: TTool): boolean {
    return this.available.has(name);
  }
  toolAvailable(name: TTool): boolean {
    return this.hasTool(name);
  }
  toolHealth(name: TTool): DeviceToolHealthSnapshot<TTool> {
    return {
      toolName: name,
      state: this.hasTool(name) ? "healthy" : "unavailable",
      consecutiveFailures: 0,
    };
  }
  onToolHealth(listener: (health: DeviceToolHealthSnapshot<TTool>) => void): () => void {
    this.#healthListeners.add(listener);
    return () => this.#healthListeners.delete(listener);
  }
  onCallObservation(listener: (observation: DeviceToolCallObservation<TTool>) => void): () => void {
    this.#callListeners.add(listener);
    return () => this.#callListeners.delete(listener);
  }
  async call(
    name: TTool,
    argumentsValue: Record<string, unknown>,
    taskId?: string,
  ): Promise<Record<string, unknown>> {
    const started = Date.now();
    let outcome: DeviceToolCallObservation<TTool>["outcome"] = "accepted";
    const mutating = this.profile.isMutating?.(name) ?? true;
    try {
      if (!this.#connected) throw new Error(`${this.profile.errorPrefix}_DEVICE_MCP_UNAVAILABLE`);
      if (!this.available.has(name))
        throw new Error(`${this.profile.errorPrefix}_DEVICE_TOOL_UNAVAILABLE`);
      const failure = this.failures.get(name);
      if (failure !== undefined) throw failure;
      this.calls.push({
        name,
        arguments: structuredClone(argumentsValue),
        ...(taskId === undefined ? {} : { taskId }),
      });
      const handler = this.handlers.get(name);
      const result =
        handler === undefined
          ? structuredClone(
              this.responses.get(name) ??
                this.profile.mockResult?.(name, argumentsValue) ?? {
                  accepted: true,
                },
            )
          : await handler(structuredClone(argumentsValue), taskId);
      return this.profile.validateResult?.(name, result, argumentsValue) ?? result;
    } catch (error) {
      outcome = error instanceof DeviceToolRejectedError ? "rejected" : "protocol_error";
      throw error;
    } finally {
      const observation: DeviceToolCallObservation<TTool> = {
        toolName: name,
        kind: mutating ? "mutating" : "read",
        outcome,
        attempts: 1,
        retries: 0,
        durationMs: Date.now() - started,
        uncertain: errorIsUncertain(outcome, mutating),
      };
      for (const listener of this.#callListeners) listener(structuredClone(observation));
    }
  }
}

function errorIsUncertain(
  outcome: DeviceToolCallObservation["outcome"],
  mutating: boolean,
): boolean {
  return mutating && outcome === "timeout";
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

function parseToolResult(
  value: unknown,
  maxResponseBytes: number,
  errorPrefix: string,
): Record<string, unknown> {
  if (!record(value)) throw new Error(`${errorPrefix}_DEVICE_MCP_RESPONSE_INVALID`);
  const candidates: Record<string, unknown>[] = [];
  if (record(value.structuredContent)) candidates.push(value.structuredContent);
  if (Array.isArray(value.content))
    for (const item of value.content) {
      if (!record(item) || item.type !== "text" || typeof item.text !== "string") continue;
      if (Buffer.byteLength(item.text, "utf8") > maxResponseBytes)
        throw new Error(`${errorPrefix}_DEVICE_MCP_RESPONSE_TOO_LARGE`);
      try {
        const parsed: unknown = JSON.parse(item.text);
        if (record(parsed)) candidates.push(parsed);
      } catch {
        // Non-JSON text is descriptive only and cannot prove a state transition.
      }
    }
  const unique = new Map(candidates.map((candidate) => [canonical(candidate), candidate]));
  if (unique.size !== 1) throw new Error(`${errorPrefix}_DEVICE_MCP_RESPONSE_CONFLICT`);
  const parsed = [...unique.values()][0];
  if (parsed === undefined) throw new Error(`${errorPrefix}_DEVICE_MCP_STRUCTURED_RESULT_REQUIRED`);
  if (Buffer.byteLength(JSON.stringify(parsed), "utf8") > maxResponseBytes)
    throw new Error(`${errorPrefix}_DEVICE_MCP_RESPONSE_TOO_LARGE`);
  return parsed;
}

function mockUgvResult(
  name: UgvDeviceToolName,
  argumentsValue: Record<string, unknown>,
): Record<string, unknown> {
  if (name === "get_status") return { available: true };
  if (name === "get_capabilities") return {};
  if (name === "ugv_area_recon_get_status")
    return {
      status: 1,
      status_label: "idle",
      scan_mode: 1,
      out_of_range: false,
      camera_fault: false,
      progress: 0,
      online: true,
      lock: { stage: 1, target_id: 0 },
      attack_ready: false,
    };
  if (name === "ugv_area_recon_get_targets") return { targets: [] };
  if (name === "ugv_laser_range") return { distance_m: 120.5, valid: true };
  const missionId =
    typeof argumentsValue.mission_id === "number" && Number.isSafeInteger(argumentsValue.mission_id)
      ? argumentsValue.mission_id || 1
      : 1;
  const common = {
    mission_id: missionId,
    state: name === "ugv_mission_control" && argumentsValue.action === "start" ? 1 : 0,
    state_label: "accepted",
    message: "accepted",
    error_code: 0,
  };
  if (name === "ugv_area_recon_configure") return { ...common, res: true, fail_data: "" };
  if (
    name === "ugv_area_recon_control" ||
    name === "ugv_area_recon_lock" ||
    name === "ugv_area_recon_reset" ||
    name === "ugv_area_recon_attack_confirm"
  )
    return { ...common, cmd_res: 0, fail_data: "" };
  return common;
}

function loadHeaders(path: string): Record<string, string> {
  const raw = readFileSync(path, "utf8");
  if (Buffer.byteLength(raw, "utf8") > 16_384) throw new Error("UGV_DEVICE_MCP_HEADERS_TOO_LARGE");
  const value: unknown = JSON.parse(raw);
  if (!record(value) || Object.values(value).some((header) => typeof header !== "string"))
    throw new Error("UGV_DEVICE_MCP_HEADERS_INVALID");
  return value as Record<string, string>;
}

function transportFailure(error: unknown): boolean {
  if (error instanceof McpError) return error.code === -32_000 || error.code === -32_001;
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  return /(?:timeout|timed out|connection (?:closed|lost|reset)|socket hang up|ECONNRESET|ECONNREFUSED|EPIPE|fetch failed)/iu.test(
    error.message,
  );
}

function isTimeout(error: unknown): boolean {
  return (
    (error instanceof McpError && error.code === -32_001) ||
    (error instanceof Error && /(?:timeout|timed out)/iu.test(error.message))
  );
}

function preDispatchUnavailable(error: unknown, errorPrefix: string): boolean {
  return error instanceof Error && error.message === `${errorPrefix}_DEVICE_MCP_UNAVAILABLE`;
}

function errorOptions(error: unknown): ErrorOptions | undefined {
  return error instanceof Error ? { cause: error } : undefined;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value ?? fallback;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
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
