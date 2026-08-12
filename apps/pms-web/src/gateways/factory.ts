/// <reference types="vite/client" />

import { createMockGateways } from "./mock/create-mock-gateways.js";
import { createHttpGateways } from "./openapi/http-gateways.js";
import type { GatewayBundle } from "./contracts/index.js";
import type { ProductScenario } from "../scenarios/types.js";
import type { ConsoleHttpClientOptions } from "./openapi/http-client.js";

export type PmsDataMode = "mock" | "api";

export function dataMode(): PmsDataMode {
  const configured: unknown = import.meta.env.VITE_PMS_DATA_MODE;
  return resolveDataMode(
    runtimeMeta("pms-web-data-mode") ?? (typeof configured === "string" ? configured : undefined),
    { production: import.meta.env.PROD },
  );
}

export function resolveDataMode(
  configured: string | undefined,
  options: { readonly production: boolean },
): PmsDataMode {
  if (configured === "api") return configured;
  if (configured === "mock" && !options.production) return configured;
  if (configured === "mock") throw new Error("PMS_DATA_MODE_MOCK_FORBIDDEN_IN_PRODUCTION");
  if (configured === undefined && !options.production) return "mock";
  throw new Error(configured === undefined ? "PMS_DATA_MODE_REQUIRED" : "PMS_DATA_MODE_INVALID");
}

export function browserApiBase(): string {
  const configured = runtimeMeta("pms-web-api-base") ?? "/api/console/v1";
  const normalized = configured.trim().replace(/\/+$/u, "");
  if (normalized !== "/api/console/v1" || normalized.includes("?") || normalized.includes("#")) {
    throw new Error("PMS_WEB_API_BASE_MUST_BE_SAME_ORIGIN_CONSOLE_V1");
  }
  return normalized;
}

export function createGateways(
  scenario: ProductScenario,
  options: {
    readonly mode?: PmsDataMode;
    readonly http?: ConsoleHttpClientOptions;
  } = {},
): GatewayBundle {
  const mode = options.mode ?? dataMode();
  return mode === "mock"
    ? createMockGateways(scenario)
    : createHttpGateways({ baseUrl: browserApiBase(), ...options.http });
}

function runtimeMeta(name: string): string | undefined {
  const runtimeDocument = (globalThis as { readonly document?: RuntimeDocument }).document;
  if (runtimeDocument === undefined) return undefined;
  const value = runtimeDocument.querySelector(`meta[name="${name}"]`)?.content.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

interface RuntimeDocument {
  querySelector(selector: string): { readonly content: string } | null;
}
