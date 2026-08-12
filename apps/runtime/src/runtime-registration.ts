import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { FROZEN_PROTOCOL_VERSION } from "../../../packages/mcp-protocol/src/index.js";
import {
  FetchRuntimeRegistrationTransport,
  RuntimeHeartbeatLoop,
  type RuntimeHeartbeatLoopObservation,
} from "../../../packages/runtime-registration/src/index.js";
import { RUNTIME_VERSION } from "../../../packages/domain/src/index.js";
import type { RuntimeConfig } from "./config.js";
import { resolveRuntimePlatformIdentity } from "./config.js";

const IdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const BootstrapSchema = z
  .object({
    PMS_RUNTIME_REGISTRATION_URL: z.url().optional(),
    PMS_RUNTIME_REGISTRATION_TOKEN_FILE: z.string().min(1).optional(),
    PMS_RUNTIME_HEARTBEAT_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(120_000)
      .default(10_000),
    PMS_DEPLOYMENT_ID: IdentifierSchema.optional(),
    PMS_INSTANCE_ID: IdentifierSchema.optional(),
    RUNTIME_DEPLOYMENT_ID: IdentifierSchema.optional(),
    RUNTIME_INSTANCE_ID: IdentifierSchema.optional(),
  })
  .superRefine((value, context) => {
    const enabled = value.PMS_RUNTIME_REGISTRATION_URL !== undefined;
    if (enabled !== (value.PMS_RUNTIME_REGISTRATION_TOKEN_FILE !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["PMS_RUNTIME_REGISTRATION_TOKEN_FILE"],
        message: "Runtime Registration URL and token file must be configured together",
      });
    }
  });

export interface RuntimeRegistrationClientBootstrap {
  readonly baseUrl: string;
  readonly tokenFile: string;
  readonly intervalMs: number;
  readonly providerId: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly runtimeVersion: string;
  readonly protocolVersion: string;
}

export interface RuntimeRegistrationIntegrationLogger {
  warn(value: Readonly<Record<string, unknown>>, message: string): void;
}

export interface RuntimeRegistrationIntegrationOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly readTokenFile?: (path: string) => Promise<string>;
  readonly delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly correlationId?: () => string;
  readonly sessionId?: string;
}

export function loadRuntimeRegistrationBootstrap(
  runtime: RuntimeConfig,
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeRegistrationClientBootstrap | null {
  const input = BootstrapSchema.parse(environment);
  if (input.PMS_RUNTIME_REGISTRATION_URL === undefined) return null;
  const identity = resolveRuntimePlatformIdentity(environment) ?? runtime.platformIdentity;
  if (identity === null) throw new Error("RUNTIME_REGISTRATION_PLATFORM_IDENTITY_REQUIRED");
  if (
    runtime.platformIdentity !== null &&
    (runtime.platformIdentity.deploymentId !== identity.deploymentId ||
      runtime.platformIdentity.instanceId !== identity.instanceId)
  ) {
    throw new Error("RUNTIME_PLATFORM_IDENTITY_CONFLICT");
  }
  const url = new URL(input.PMS_RUNTIME_REGISTRATION_URL);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error("PMS_RUNTIME_REGISTRATION_URL_INVALID");
  }
  if (
    runtime.RUNTIME_ENV === "production" &&
    !runtime.ALLOW_INSECURE_INTERNAL_TRANSPORT &&
    url.protocol !== "https:"
  ) {
    throw new Error("PMS_RUNTIME_REGISTRATION_PRODUCTION_HTTPS_REQUIRED");
  }
  return Object.freeze({
    baseUrl: url.toString(),
    tokenFile: required(input.PMS_RUNTIME_REGISTRATION_TOKEN_FILE),
    intervalMs: input.PMS_RUNTIME_HEARTBEAT_INTERVAL_MS,
    providerId: runtime.PROVIDER_ID,
    deploymentId: identity.deploymentId,
    instanceId: identity.instanceId,
    runtimeVersion: RUNTIME_VERSION,
    protocolVersion: FROZEN_PROTOCOL_VERSION,
  });
}

export class RuntimeRegistrationIntegration {
  readonly #controller = new AbortController();
  readonly #loop: RuntimeHeartbeatLoop;
  #running: Promise<void> | undefined;

  constructor(
    bootstrap: RuntimeRegistrationClientBootstrap,
    observe: () => RuntimeHeartbeatLoopObservation,
    private readonly logger: RuntimeRegistrationIntegrationLogger,
    options: RuntimeRegistrationIntegrationOptions = {},
  ) {
    const readTokenFile = options.readTokenFile ?? ((path: string) => readFile(path, "utf8"));
    const authorization = async (): Promise<string> => {
      const token = (await readTokenFile(bootstrap.tokenFile)).trim();
      if (token.length === 0 || token.length > 8_192 || /\s/.test(token)) {
        throw new Error("PMS_RUNTIME_REGISTRATION_TOKEN_FILE_INVALID");
      }
      return `Bearer ${token}`;
    };
    this.#loop = new RuntimeHeartbeatLoop(
      new FetchRuntimeRegistrationTransport({
        baseUrl: bootstrap.baseUrl,
        authorization,
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      }),
      {
        providerId: bootstrap.providerId,
        deploymentId: bootstrap.deploymentId,
        instanceId: bootstrap.instanceId,
        sessionId: options.sessionId ?? randomUUID(),
        runtimeVersion: bootstrap.runtimeVersion,
        protocolVersion: bootstrap.protocolVersion,
      },
      {
        intervalMs: bootstrap.intervalMs,
        observe,
        correlationId: options.correlationId ?? randomUUID,
        ...(options.delay === undefined ? {} : { delay: options.delay }),
        onUnavailable: ({ code, retryable }) => {
          this.logger.warn(
            { code, retryable },
            "Runtime registration is unavailable; Runtime remains operational",
          );
        },
      },
    );
  }

  start(): void {
    if (this.#running !== undefined) return;
    this.#running = this.#loop.run(this.#controller.signal).catch(() => {
      this.logger.warn(
        { code: "RUNTIME_REGISTRATION_BACKGROUND_LOOP_FAILED" },
        "Runtime registration background loop stopped",
      );
    });
  }

  async stop(): Promise<void> {
    this.#controller.abort();
    await this.#running;
  }
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("RUNTIME_REGISTRATION_BOOTSTRAP_INCOMPLETE");
  return value;
}
