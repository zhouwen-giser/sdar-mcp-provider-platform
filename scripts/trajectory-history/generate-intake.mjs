import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import ts from "typescript";
import { format, resolveConfig } from "prettier";
import { captureTrajectoryReceipt } from "../../packages/trajectory-history/src/capture.js";
import { VehicleMqttIngress } from "../../packages/vehicle-mqtt-ingress/src/index.js";
import {
  receptionHash,
  signHistoryManifest,
  historySha256,
} from "../../packages/trajectory-history/src/proof.js";
import {
  buildProjectionEvidence,
  signProjectionEvidence,
} from "../../packages/trajectory-history/src/projection.js";
import { TaskArtifactSchema } from "../../packages/vehicle-provider-core/src/task-business-artifact.js";

const folder = "contracts/ugv-trajectory-history/v1";
const check = process.argv.includes("--check");
async function output(file, bytes) {
  if (/\.(json|js)$/.test(file))
    bytes = await format(bytes, { ...(await resolveConfig(file)), filepath: file });
  if (check) {
    if (readFileSync(file, "utf8") !== bytes) throw Error("HISTORY_INTAKE_ASSET_DRIFT: " + file);
  } else writeFileSync(file, bytes);
}
mkdirSync(folder + "/sdk", { recursive: true });
mkdirSync(folder + "/examples", { recursive: true });
const sources = [];
for (const name of ["contract", "proof", "projection"]) {
  const file = `packages/trajectory-history/src/${name}.ts`,
    source = readFileSync(file, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  await output(`${folder}/sdk/${name}.js`, compiled);
  sources.push({ path: file, sha256: historySha256(source) });
}
const zodVersion = JSON.parse(readFileSync("node_modules/zod/package.json", "utf8")).version;
await output(
  folder + "/sdk/package.json",
  JSON.stringify(
    {
      name: "@smpp/trajectory-history-proof",
      version: "1.0.0",
      private: true,
      type: "module",
      exports: { ".": "./proof.js", "./artifact": "./projection.js", "./schemas": "./contract.js" },
      engines: { node: ">=22 <23" },
      dependencies: { zod: zodVersion },
    },
    null,
    2,
  ),
);
await output(
  folder + "/sdk/SOURCE_INPUTS.json",
  JSON.stringify({ schemaVersion: "smpp.trajectory-proof-sdk-sources/1", sources }, null, 2),
);
// RFC 8032 test vector 1 seed, public test data only. Never a deployment trust key.
const seed = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const key = createPrivateKey({
  key: Buffer.from("302e020100300506032b657004220420" + seed, "hex"),
  format: "der",
  type: "pkcs8",
});
const publicKey = createPublicKey(key).export({ format: "pem", type: "spki" });
await output(folder + "/examples/SIMULATED_PUBLIC_KEY.pem", publicKey.toString());
const scope = {
  providerId: "isr.vehicle.ugv.SIMULATED-example",
  resourceId: "vehicle:SIMULATED-example",
  deviceId: "SIMULATED-ugv1",
  deviceIdentityAuthority: "PROVIDER_RESOURCE_CONFIGURATION",
  streamId: "11111111-1111-4111-8111-111111111111",
  sourceSessionKey: "SIMULATED-example",
};
const ingress = new VehicleMqttIngress("direct_domain_json", {
  maxPayloadBytes: 65536,
  maxDepth: 16,
  maxNodes: 4096,
  maxStringBytes: 16384,
});
let previous = "0".repeat(64);
const entries = [];
for (let index = 1; index <= 3; index++) {
  const wire = Buffer.from(
    JSON.stringify({ entity_id: "ugv1", longitude: 114 + index / 1000, latitude: 30 }),
  );
  const receipt = captureTrajectoryReceipt(
    ingress,
    "/ugv/gnss",
    wire,
    {
      receptionId: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
      sessionId: "33333333-3333-4333-8333-333333333333",
      receivedUtc: "2026-10-01T00:00:00.001Z",
      monotonicNanoseconds: String(1000000 + index),
      clockId: "SIMULATED-example-clock",
      qos: 1,
      packetId: index,
      duplicateDeliveryHint: false,
      retainedDelivery: false,
    },
    "SIMULATED",
  );
  const recordedAt = `2026-10-01T00:00:00.00200${index}Z`,
    sequence = String(index);
  const hash = receptionHash(scope, sequence, previous, receipt, recordedAt);
  entries.push({
    sequence,
    previousHash: previous,
    hash,
    receipt,
    recordedAt,
    recordingClockOwner: "POSTGRESQL_RECORD_INSERTION_CLOCK",
    recordingResolution: "MICROSECOND",
    exactTransactionCommittedAt: null,
  });
  previous = hash;
}
const manifest = {
  schemaVersion: "ugv.trajectory-history-manifest/1.0",
  scope,
  snapshotId: "44444444-4444-4444-8444-444444444444",
  capturedFromSequence: "1",
  capturedFromRecordingTime: "2026-10-01T00:00:00.000000Z",
  activationClockOwner: "POSTGRESQL_STREAM_CREATION_CLOCK",
  guaranteedSinceHistoryVersion: "1.0",
  fromSequence: "1",
  throughSequence: "3",
  highWatermark: "3",
  retainedEntryCount: "3",
  expectedOrdinalCount: "3",
  previousHash: "0".repeat(64),
  terminalHash: previous,
  chainAlgorithm: "SMPP_CANONICAL_JSON_SHA256_CHAIN_V1",
  ordering: "DURABLE_PROVIDER_RECEIPT_SEQUENCE",
  deduplication: "RECEPTIONS_NOT_COLLAPSED_INTO_DEVICE_SAMPLES",
  retainedHistory: { status: "complete", reasons: [] },
  providerCaptureCoverage: {
    status: "unknown",
    reasons: ["COMMITTED_RECEIPT_RANGE_NOT_ALL_PHYSICAL_CALLBACKS"],
  },
  deviceGenerationHistory: {
    status: "unknown",
    reasons: ["PRODUCER_BOUNDARY_ATTESTATION_MISSING", "PRODUCER_EPOCH_NOT_ATTESTED"],
  },
  legacyHistory: "NO_RETROACTIVE_RECEPTION_TIME_OR_DEVICE_COMPLETENESS_CLAIM",
  prunedThroughSequence: "0",
  recovery: { uncleanSessionCount: 0, disconnectCount: 0, captureFailureCount: 0 },
  evidenceClass: "SIMULATED",
};
await output(
  folder + "/examples/complete-retained-range.json",
  JSON.stringify(
    {
      schemaVersion: "ugv.trajectory-history-page/1.0",
      snapshot: signHistoryManifest(manifest, key),
      entries,
      nextCursor: null,
      rangeReadFinished: true,
    },
    null,
    2,
  ),
);
await output(
  folder + "/examples/incomplete-retained-range.json",
  JSON.stringify(
    {
      schemaVersion: "ugv.trajectory-history-page/1.0",
      snapshot: signHistoryManifest(
        {
          ...manifest,
          snapshotId: "55555555-5555-4555-8555-555555555555",
          retainedEntryCount: "2",
          retainedHistory: { status: "incomplete", reasons: ["RETAINED_RECEIPT_SEQUENCE_GAP"] },
        },
        key,
      ),
      entries: [entries[0], entries[2]],
      nextCursor: null,
      rangeReadFinished: true,
    },
    null,
    2,
  ),
);
const artifact = TaskArtifactSchema.parse({
  schemaVersion: "sdar.task-artifact/1.0-rc2",
  artifactId: "SIMULATED-legacy",
  artifactType: "navigation.trajectory",
  revision: 1,
  semantics: "observed",
  lifecycle: "active",
  identity: {
    taskId: "SIMULATED-legacy-task",
    executionId: "SIMULATED-legacy-execution",
    providerId: scope.providerId,
    resourceId: scope.resourceId,
    operationName: "vehicle_navigate",
  },
  source: { producer: "provider", method: "legacy_projection_unknown" },
  createdAt: "2020-01-01T00:00:00Z",
  updatedAt: "2020-01-01T00:00:00Z",
  availability: "available",
  properties: { sampleCount: 2 },
  content: {
    kind: "geojson",
    crs: "OGC:CRS84",
    geometry: {
      type: "LineString",
      coordinates: [
        [114, 30],
        [114.1, 30.1],
      ],
    },
  },
});
await output(
  folder + "/examples/unknown-legacy-artifact.json",
  JSON.stringify(
    { artifact, signedEvidence: signProjectionEvidence(buildProjectionEvidence(artifact), key) },
    null,
    2,
  ),
);
console.log(
  check
    ? "PASS: independently consumable SDK and SIMULATED examples match source"
    : "Generated SDK and SIMULATED trajectory evidence examples",
);
