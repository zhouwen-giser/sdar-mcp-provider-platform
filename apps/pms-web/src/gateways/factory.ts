/// <reference types="vite/client" />

import { createMockGateways } from "./mock/create-mock-gateways.js";
import { createUnconfiguredOpenApiGateways } from "./openapi/unconfigured-gateways.js";
import type { GatewayBundle } from "./contracts/index.js";
import type { ProductScenario } from "../scenarios/types.js";

export type PmsDataMode = "mock" | "api";
export function dataMode(): PmsDataMode {
  return import.meta.env.VITE_PMS_DATA_MODE === "api" ? "api" : "mock";
}
export function createGateways(scenario: ProductScenario): GatewayBundle {
  return dataMode() === "mock" ? createMockGateways(scenario) : createUnconfiguredOpenApiGateways();
}
