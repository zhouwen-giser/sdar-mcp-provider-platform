import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  FetchRuntimeConfigAcknowledgementPort,
  FetchRuntimeConfigHttpPort,
  FetchRuntimeConfigWatchPort,
  FileRuntimeConfigAckOutbox,
  FileRuntimeConfigCacheStore,
  RuntimeConfigApplyHandlerRegistry,
  RuntimeConfigClient,
  RuntimeConfigWorkflow,
  type RuntimeConfigSyncResult,
  type RuntimeConfigTarget,
} from "../../../packages/runtime-config-client/src/index.js";
import { RuntimeObservabilityResolvedSchema } from "../../../packages/runtime-configuration-contract/src/runtime/observability.js";
import type { RuntimeConfig } from "./config.js";
import { resolveRuntimePlatformIdentity, type RuntimePlatformIdentity } from "./config.js";

const IdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const BootstrapSchema = z
  .object({
    PMS_RUNTIME_CONFIG_URL: z.url().optional(),
    PMS_RUNTIME_CONFIG_TOKEN_FILE: z.string().min(1).optional(),
    PMS_RUNTIME_CONFIG_CACHE_PATH: z.string().min(1).optional(),
    PMS_DEPLOYMENT_ID: IdentifierSchema.optional(),
    PMS_INSTANCE_ID: IdentifierSchema.optional(),
    RUNTIME_DEPLOYMENT_ID: IdentifierSchema.optional(),
    RUNTIME_INSTANCE_ID: IdentifierSchema.optional(),
  })
  .superRefine((value, context) => {
    const enabled = value.PMS_RUNTIME_CONFIG_URL !== undefined;
    for (const field of [
      "PMS_RUNTIME_CONFIG_TOKEN_FILE",
      "PMS_RUNTIME_CONFIG_CACHE_PATH",
    ] as const) {
      if (enabled && value[field] === undefined) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is required when PMS Runtime Config is enabled`,
        });
      }
      if (!enabled && value[field] !== undefined) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "PMS_RUNTIME_CONFIG_URL is required for Runtime Config bootstrap",
        });
      }
    }
  });

export interface RuntimeConfigClientBootstrap {
  readonly baseUrl: string;
  readonly tokenFile: string;
  readonly cachePath: string;
  readonly target: RuntimeConfigTarget;
}

export interface RuntimeObservabilityControl {
  applyOtelEnabled(enabled: boolean): Promise<void>;
}

export interface RuntimeConfigIntegrationLogger {
  warn(value: Readonly<Record<string, unknown>>, message: string): void;
}

export interface RuntimeConfigIntegrationOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly reconnectDelay?: (attempt: number, signal: AbortSignal) => Promise<void>;
  readonly readTokenFile?: (path: string) => Promise<string>;
}

export function loadRuntimeConfigClientBootstrap(
  runtime: RuntimeConfig,
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfigClientBootstrap | null {
  const input = BootstrapSchema.parse(environment);
  if (input.PMS_RUNTIME_CONFIG_URL === undefined) return null;
  const identity = mergePlatformIdentity(
    runtime.platformIdentity,
    resolveRuntimePlatformIdentity(environment),
  );
  if (identity === null) throw new Error("RUNTIME_CONFIG_PLATFORM_IDENTITY_REQUIRED");
  const url = new URL(input.PMS_RUNTIME_CONFIG_URL);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error("PMS_RUNTIME_CONFIG_URL_INVALID");
  }
  if (runtime.RUNTIME_ENV === "production" && url.protocol !== "https:") {
    throw new Error("PMS_RUNTIME_CONFIG_PRODUCTION_HTTPS_REQUIRED");
  }
  return {
    baseUrl: url.toString(),
    tokenFile: required(input.PMS_RUNTIME_CONFIG_TOKEN_FILE),
    cachePath: required(input.PMS_RUNTIME_CONFIG_CACHE_PATH),
    target: {
      environment: runtime.RUNTIME_ENV,
      deploymentId: identity.deploymentId,
      instanceId: identity.instanceId,
      configGroup: "runtime.observability",
      dataId: "main",
    },
  };
}

function mergePlatformIdentity(
  configured: RuntimePlatformIdentity | null,
  bootstrap: RuntimePlatformIdentity | null,
): RuntimePlatformIdentity | null {
  if (configured === null) return bootstrap;
  if (bootstrap === null) return configured;
  if (
    configured.deploymentId !== bootstrap.deploymentId ||
    configured.instanceId !== bootstrap.instanceId
  ) {
    throw new Error("RUNTIME_PLATFORM_IDENTITY_CONFLICT");
  }
  return configured;
}

export class RuntimeConfigIntegration {
  readonly #controller = new AbortController();
  readonly #workflow: RuntimeConfigWorkflow;
  #running: Promise<void> | undefined;

  constructor(
    bootstrap: RuntimeConfigClientBootstrap,
    control: RuntimeObservabilityControl,
    private readonly logger: RuntimeConfigIntegrationLogger,
    options: RuntimeConfigIntegrationOptions = {},
  ) {
    const readTokenFile = options.readTokenFile ?? ((path: string) => readFile(path, "utf8"));
    const authorization = async (): Promise<string> => {
      const token = (await readTokenFile(bootstrap.tokenFile)).trim();
      if (token.length === 0 || token.length > 8_192 || /\s/.test(token)) {
        throw new Error("PMS_RUNTIME_CONFIG_TOKEN_FILE_INVALID");
      }
      return `Bearer ${token}`;
    };
    const fetchOptions = {
      baseUrl: bootstrap.baseUrl,
      authorization,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    };
    const lkg = new FileRuntimeConfigCacheStore(bootstrap.cachePath);
    const client = new RuntimeConfigClient(new FetchRuntimeConfigHttpPort(fetchOptions), lkg, {
      validate: (content) => {
        const result = RuntimeObservabilityResolvedSchema.safeParse(content);
        return result.success
          ? { valid: true }
          : {
              valid: false,
              issues: result.error.issues.map((issue) => issue.path.join(".")),
            };
      },
    });
    const handlers = new RuntimeConfigApplyHandlerRegistry();
    handlers.register(bootstrap.target.configGroup, {
      apply: async (document) => {
        const content = RuntimeObservabilityResolvedSchema.parse(document.content);
        await control.applyOtelEnabled(content.OTEL_ENABLED);
      },
    });
    this.#workflow = new RuntimeConfigWorkflow(
      bootstrap.target,
      client,
      lkg,
      handlers,
      new FetchRuntimeConfigAcknowledgementPort(fetchOptions),
      new FileRuntimeConfigAckOutbox(`${bootstrap.cachePath}.acks`),
      new FetchRuntimeConfigWatchPort(fetchOptions),
      options.reconnectDelay === undefined ? {} : { reconnectDelay: options.reconnectDelay },
    );
  }

  syncOnce(): Promise<RuntimeConfigSyncResult> {
    return this.#workflow.syncOnce();
  }

  start(): void {
    if (this.#running !== undefined) return;
    this.#running = this.#workflow.run(this.#controller.signal).catch(() => {
      this.logger.warn(
        { code: "RUNTIME_CONFIG_BACKGROUND_LOOP_FAILED" },
        "Runtime Config background loop stopped",
      );
    });
  }

  async stop(): Promise<void> {
    this.#controller.abort();
    await this.#running;
  }
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("RUNTIME_CONFIG_BOOTSTRAP_INCOMPLETE");
  return value;
}
