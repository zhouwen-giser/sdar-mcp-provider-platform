import type { ConfigurationDefinition } from "@sdar/runtime-configuration-contract";
import { HomeAssistantClimateConfigurationDefinition } from "../../runtime-configuration-contract/src/providers/home-assistant.js";
import { NpcTankProviderConfigurationDefinition } from "../../runtime-configuration-contract/src/providers/npc-tank.js";
import { UgvProviderConfigurationDefinition } from "../../runtime-configuration-contract/src/providers/ugv.js";
import { RuntimeBootstrapConfigurationDefinition } from "../../runtime-configuration-contract/src/runtime/bootstrap.js";
import { RuntimeObservabilityConfigurationDefinition } from "../../runtime-configuration-contract/src/runtime/observability.js";
import { RuntimeWorkerEventsConfigurationDefinition } from "../../runtime-configuration-contract/src/runtime/worker-events.js";
import { ConfigurationCenter } from "./center.js";

const platformConfigurationDefinitions: readonly ConfigurationDefinition[] = [
  RuntimeBootstrapConfigurationDefinition,
  RuntimeObservabilityConfigurationDefinition,
  RuntimeWorkerEventsConfigurationDefinition,
  UgvProviderConfigurationDefinition,
  NpcTankProviderConfigurationDefinition,
  HomeAssistantClimateConfigurationDefinition,
];

export function createDefaultConfigurationCenter(): ConfigurationCenter {
  return new ConfigurationCenter(platformConfigurationDefinitions);
}
