import { writeFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";
import { siteControlV14Manifest } from "../../packages/vehicle-zmq-control/src/site-control-v14.js";
import { MemoryProviderStore } from "../../packages/provider-adapter-kit/src/index.js";
import type { ProviderManifest } from "../../packages/adapter-protocol/src/index.js";
if (!global.gc) throw Error("RUN_WITH_EXPOSE_GC");
const manifest = siteControlV14Manifest(
  "isr.vehicle.ugv.site",
  "vehicle:ugv",
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
const original = Ajv2020.prototype.compile;
let cacheEntries = 0;
const instrumented = function (this: Ajv2020, ...args: Parameters<typeof original>) {
  const result = original.apply(this, args);
  cacheEntries = Math.max(
    cacheEntries,
    (this as unknown as { _cache: Map<unknown, unknown> })._cache.size,
  );
  return result;
};
Ajv2020.prototype.compile = instrumented as typeof original;
const registry = new OperationRegistry(),
  samples: { round: number; heapUsed: number; cacheEntries: number }[] = [];
for (let round = 0; round <= 60; round++) {
  if (round > 0) registry.validate(structuredClone(manifest));
  if (round % 10 === 0) {
    global.gc();
    samples.push({ round, heapUsed: process.memoryUsage().heapUsed, cacheEntries });
  }
}
const delta = samples.at(-1)!.heapUsed - samples[2]!.heapUsed;
const report = {
  scenario: "repeated unchanged 1.4 catalog validation with reused registry",
  samples,
  retainedGrowthAfterWarmup: delta,
  status: cacheEntries <= 64 && delta < 12 * 1024 * 1024 ? "passed" : "failed",
};
writeFileSync(
  "reports/ugv-zmq-v15/manifest-memory-after.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
if (report.status !== "passed") process.exitCode = 1;
