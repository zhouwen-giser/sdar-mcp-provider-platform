import type { GatewayBundle } from "../contracts/index.js";
import type { ProductScenario } from "../../scenarios/types.js";

const unavailable = () => Promise.reject(new Error("API_DATA_SOURCE_NOT_CONFIGURED"));
const controller = {
  current: () => "healthy" as ProductScenario,
  set: () => undefined,
  revision: () => 0,
  subscribe: () => () => undefined,
};
export function createUnconfiguredOpenApiGateways(): GatewayBundle {
  const proxy = new Proxy({}, { get: () => unavailable });
  return {
    providers: proxy as GatewayBundle["providers"],
    resources: proxy as GatewayBundle["resources"],
    configuration: proxy as GatewayBundle["configuration"],
    runtime: proxy as GatewayBundle["runtime"],
    registry: proxy as GatewayBundle["registry"],
    audit: proxy as GatewayBundle["audit"],
    scenarios: controller,
  };
}
