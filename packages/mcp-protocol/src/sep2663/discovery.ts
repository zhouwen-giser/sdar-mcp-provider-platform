import { FROZEN_PROTOCOL_VERSION } from "./request-validator.js";

export interface FrozenProviderCatalog {
  readonly providerId: string;
  readonly providerType: string;
  readonly providerVersion: string;
  readonly manifestHash: string;
}

export function frozenDiscoveryResult(
  serverVersion: string,
  providerCatalog: FrozenProviderCatalog,
  businessEvents?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    resultType: "complete",
    supportedVersions: [FROZEN_PROTOCOL_VERSION],
    capabilities: {
      tools: {},
      extensions: {
        "io.modelcontextprotocol/tasks": {},
        "io.sdar/taskExecution": {
          profileVersion: "1.0",
          taskNotifications: true,
        },
        "io.sdar/providerCatalog": {
          providerId: providerCatalog.providerId,
          providerType: providerCatalog.providerType,
          providerVersion: providerCatalog.providerVersion,
          manifestHash: providerCatalog.manifestHash,
        },
        ...(businessEvents === undefined ? {} : { "io.sdar/businessEvents": businessEvents }),
      },
    },
    _meta: {
      "io.modelcontextprotocol/serverInfo": {
        name: "sdar-mcp-tasks-provider-runtime",
        version: serverVersion,
      },
    },
    instructions: "This server provides SDAR task-capable tools.",
    ttlMs: 3_600_000,
    cacheScope: "public",
  };
}
