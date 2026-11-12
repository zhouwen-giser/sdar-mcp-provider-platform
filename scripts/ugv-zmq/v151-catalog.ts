import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import {
  siteV151Manifest,
  SITE_CONTROL_V151_PROFILE,
  SITE_READONLY_V151_PROFILE,
} from "../../packages/vehicle-zmq-control/src/site-v151.js";
import type { ProviderManifest } from "../../packages/adapter-protocol/src/index.js";
import { siteControlV14CatalogContract } from "./site-control-v14-catalog.js";
void siteControlV14CatalogContract;
for (const readonly of [false, true]) {
  const manifest = siteV151Manifest(
    "isr.vehicle.ugv.site",
    "__RESOURCE_ID__",
    new MemoryProviderStore(),
    readonly,
  ) as unknown as ProviderManifest;
  manifest.businessEventSources = [
    {
      sourceId: "vehicle.business",
      sourceStreamId: "12345678-1234-1234-1234-123456789abc",
      deliverySemantics: "durable_at_least_once",
      replaySupported: true,
      sourceRetentionMs: "604800000",
      maxEventBytes: "262144",
      maxPayloadDepth: 32,
      maxPayloadNodes: 10000,
      maxPayloadStringBytes: "65536",
    },
  ];
  const contract = {
    schemaVersion: "ugv.zmq-provider-catalog-contract/1",
    profile: readonly ? SITE_READONLY_V151_PROFILE : SITE_CONTROL_V151_PROFILE,
    tools: new OperationRegistry().validate(manifest).operations.map((o) => o.tool),
  };
  for (const path of [
    `contracts/ugv-zmq/provider-v1.5.1-${readonly ? "readonly" : "site-control"}/catalog.json`,
    `apps/ugv-control-console/shared/zmq-v151-${readonly ? "readonly" : "control"}-catalog.json`,
  ]) {
    if (process.argv.includes("--check")) {
      if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(contract))
        throw Error("ZMQ_SITE_CATALOG_DRIFT");
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(contract, null, 2) + "\n");
    }
  }
  console.log(
    JSON.stringify({
      profile: contract.profile,
      tools: contract.tools.length,
      checked: process.argv.includes("--check"),
    }),
  );
}
