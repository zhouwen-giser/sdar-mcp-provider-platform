import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPublicKey, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  RetainedHistoryVerifier,
  verifyHistoryManifest,
} from "../../contracts/ugv-trajectory-history/v1/sdk/proof.js";
import { verifyProjectionEvidence } from "../../contracts/ugv-trajectory-history/v1/sdk/projection.js";

const folder = "contracts/ugv-trajectory-history/v1";
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const key = createPublicKey(readFileSync(folder + "/examples/SIMULATED_PUBLIC_KEY.pem"));
const complete = read(folder + "/examples/complete-retained-range.json");
const verifier = new RetainedHistoryVerifier(
  complete.snapshot,
  key,
  complete.snapshot.manifest.scope,
);
complete.entries.forEach((entry) => verifier.accept(entry));
assert.deepEqual(verifier.finish(complete.rangeReadFinished), {
  retainedSetVerified: true,
  deviceHistoryComplete: false,
});
const incomplete = read(folder + "/examples/incomplete-retained-range.json");
assert.equal(
  verifyHistoryManifest(incomplete.snapshot, key, complete.snapshot.manifest.scope).retainedHistory
    .status,
  "incomplete",
);
assert.throws(
  () => new RetainedHistoryVerifier(incomplete.snapshot, key, complete.snapshot.manifest.scope),
);
const legacy = read(folder + "/examples/unknown-legacy-artifact.json");
assert.equal(
  verifyProjectionEvidence(legacy.signedEvidence, key, legacy.artifact).points.every(
    (point) => point.reception === null,
  ),
  true,
);
const forged = globalThis.structuredClone(complete.snapshot);
forged.manifest.deviceGenerationHistory.status = "complete";
assert.throws(() => verifyHistoryManifest(forged, key, complete.snapshot.manifest.scope));
const changed = globalThis.structuredClone(complete.entries);
changed[0].receipt.providerReceivedAt.utc = "1900-01-01T00:00:00.000Z";
assert.throws(() =>
  new RetainedHistoryVerifier(complete.snapshot, key, complete.snapshot.manifest.scope).accept(
    changed[0],
  ),
);
const baseline = read("reports/trajectory-time-history-v1/BASELINE_FROZEN_ASSETS.json");
for (const item of baseline.baselineFrozenAssets) {
  const old = execFileSync("git", ["show", baseline.baselineCommit + ":" + item.path]);
  assert.equal(createHash("sha256").update(old).digest("hex"), item.sha256, item.path);
  assert.equal(
    createHash("sha256").update(readFileSync(item.path)).digest("hex"),
    item.sha256,
    item.path,
  );
}
console.log(
  JSON.stringify({
    status: "PASS",
    examples: "SIMULATED",
    sdk: "public-independent-module-import",
    frozenAssetsUnchanged: baseline.baselineFrozenAssets.length,
    realDeviceQualification: "NOT_RUN",
    siteOperations: "NOT_RUN",
    deployment: "NOT_RUN",
  }),
);
