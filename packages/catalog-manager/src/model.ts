export const FROZEN_PROTOCOL_VERSION = "2026-07-28";

export interface CatalogDiscoveryRequest {
  readonly method: "server/discover" | "tools/list";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface CatalogDiscoveryTransport {
  call(request: CatalogDiscoveryRequest, signal: AbortSignal): Promise<unknown>;
}

export interface CatalogDiscoveryOptions {
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxTools?: number;
  readonly clientName?: string;
  readonly clientVersion?: string;
}

export type TaskBehavior = "synchronous_only" | "server_directed" | "task_required";

export interface TaskExecutionProfile {
  readonly profileVersion: "1.0";
  readonly taskBehavior: TaskBehavior;
  readonly availability: "dynamic" | "not_supported";
  readonly supportsScheduling: boolean;
  readonly supportsMaxElapsed: boolean;
  readonly supportsObservations: boolean;
  readonly supportsInputRequired: boolean;
  readonly idempotency: "server_managed" | "none";
}

export type ResourceBinding =
  | { readonly mode: "NONE" }
  | { readonly mode: "ARGUMENT_REFERENCE"; readonly resourceIdJsonPointer: string };

export interface CatalogTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly taskExecution: TaskExecutionProfile;
  readonly resourceBinding?: ResourceBinding;
}

export interface RuntimeDiscovery {
  readonly resultType: "complete";
  readonly supportedVersions: readonly string[];
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly serverInfo: {
    readonly name: string;
    readonly version: string;
  };
  readonly instructions?: string;
  readonly ttlMs?: number;
  readonly cacheScope?: string;
}

export interface DiscoveredCatalog {
  readonly discovery: RuntimeDiscovery;
  readonly tools: readonly CatalogTool[];
  readonly canonicalJson: string;
}

export type CatalogDiscoveryErrorCode =
  | "CATALOG_REQUEST_FAILED"
  | "CATALOG_REQUEST_TIMEOUT"
  | "CATALOG_RESPONSE_TOO_LARGE"
  | "CATALOG_INVALID_JSON_RPC"
  | "CATALOG_REMOTE_ERROR"
  | "CATALOG_INVALID_DISCOVERY"
  | "CATALOG_INCOMPLETE_TOOLS_LIST"
  | "CATALOG_INVALID_TOOL"
  | "CATALOG_INVALID_SCHEMA"
  | "CATALOG_SENSITIVE_DATA"
  | "CATALOG_DUPLICATE_TOOL";

export class CatalogDiscoveryError extends Error {
  constructor(
    readonly code: CatalogDiscoveryErrorCode,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "CatalogDiscoveryError";
  }
}
