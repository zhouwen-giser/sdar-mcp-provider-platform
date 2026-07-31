export const PRODUCT_SCENARIOS = [
  "healthy",
  "empty",
  "provider-degraded",
  "runtime-failed",
  "runtime-revision-conflict",
  "configuration-invalid",
  "configuration-no-change",
  "configuration-rollback",
  "registry-drift",
  "job-failed",
  "partial-data",
  "network-error",
  "slow-network",
] as const;
export type ProductScenario = (typeof PRODUCT_SCENARIOS)[number];
export function isProductScenario(value: unknown): value is ProductScenario {
  return typeof value === "string" && PRODUCT_SCENARIOS.includes(value as ProductScenario);
}
