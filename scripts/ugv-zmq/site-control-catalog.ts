import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import {
  SITE_CONTROL_PROFILE as SITE_PROFILE,
  siteControlManifest as siteManifest,
} from "../../packages/vehicle-zmq-control/src/site-control-catalog.js";
import type { ProviderManifest } from "../../packages/adapter-protocol/src/index.js";

export function siteControlCatalogContract() {
  const manifest = siteManifest(
    "isr.vehicle.ugv.site",
    "__RESOURCE_ID__",
    new MemoryProviderStore(),
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
  return {
    schemaVersion: "ugv.zmq-provider-catalog-contract/1",
    profile: SITE_PROFILE,
    tools: new OperationRegistry().validate(manifest).operations.map((o) => o.tool),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const contract = siteControlCatalogContract();
  let bytes = JSON.stringify(contract, null, 2) + "\n";
  if (!process.argv.includes("--check")) {
    const { format, resolveConfig } = await import("prettier");
    bytes = await format(bytes, {
      ...(await resolveConfig(resolve("package.json"))),
      parser: "json",
    });
  }
  for (const path of [
    "contracts/ugv-zmq/provider-v1.2.0-site-control/catalog.json",
    "apps/ugv-control-console/shared/zmq-site-control-catalog.json",
  ]) {
    if (process.argv.includes("--check")) {
      if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(contract))
        throw Error("ZMQ_SITE_CATALOG_DRIFT");
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
    }
  }
  process.stdout.write(
    JSON.stringify({
      profile: SITE_PROFILE,
      tools: 13,
      checked: process.argv.includes("--check"),
    }) + "\n",
  );
}
