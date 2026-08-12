import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compose = readFileSync("deploy/release-compose.yml", "utf8").replace(/\r\n?/g, "\n");
const smoke = readFileSync("scripts/run-release-artifact-smoke.mjs", "utf8").replace(
  /\r\n?/g,
  "\n",
);
const imageVerifier = readFileSync("scripts/verify-release-images.mjs", "utf8").replace(
  /\r\n?/g,
  "\n",
);
const runtimeImageCheck = readFileSync("scripts/check-runtime-image.mjs", "utf8").replace(
  /\r\n?/g,
  "\n",
);
const capacityBaseline = readFileSync("scripts/run-capacity-baseline.mjs", "utf8").replace(
  /\r\n?/g,
  "\n",
);

test("release fixtures use Docker-managed volumes instead of host credential bind mounts", () => {
  assert.doesNotMatch(compose, /RELEASE_ARTIFACT_FIXTURE_ROOT/);
  assert.match(compose, /release-api:\/run\/release\/api:ro/);
  assert.match(compose, /release-worker:\/run\/release\/worker:ro/);
  assert.match(compose, /release-runtime-releases:\/opt\/sdar\/runtime-releases:ro/);
  assert.match(compose, /release-worker-state:\/var\/lib\/sdar/);
});

test("release smoke copies fixtures into managed volumes with restrictive modes", () => {
  assert.match(smoke, /prepareComposeVolumes\(\)/);
  assert.match(smoke, /chmod 0700/);
  assert.match(smoke, /chmod 0600/);
});

test("release smoke materializes dependencies and starts the exact extracted runtime through PM2", () => {
  assert.match(smoke, /\["dist", "proto", "migrations", "node_modules"\]/);
  assert.match(smoke, /worker: \[[\s\S]*?"runtime-releases",\n\s*\],\n\s*web:/);
  assert.match(smoke, /verifyExtractedRuntimeWithPm2\(\)/);
  assert.match(
    smoke,
    /\/opt\/sdar\/runtime-releases\/2\.0\.0-rc\.1\/dist\/apps\/runtime\/src\/main\.js/,
  );
  assert.match(smoke, /EXTRACTED_RUNTIME_PM2_READINESS_FAILED/);
});

test("release PMS Web uses the same-origin Console API proxy", () => {
  assert.match(compose, /PMS_WEB_API_BASE: \/api\/console\/v1/);
  assert.match(compose, /PMS_WEB_API_UPSTREAM: http:\/\/pms-api:8090/);
  assert.doesNotMatch(compose, /PMS_WEB_API_BASE: http:\/\/pms-api:8090/);
  assert.match(smoke, /html\.includes\("\/api\/console\/v1"\)/);
  assert.match(imageVerifier, /PMS_WEB_API_BASE=\/api\/console\/v1/);
  assert.match(imageVerifier, /PMS_WEB_API_UPSTREAM=http:\/\/pms-api:8090/);
  assert.doesNotMatch(imageVerifier, /PMS_WEB_API_BASE=https?:\/\//);
  assert.match(imageVerifier, /html\.includes\("\/api\/console\/v1"\)/);
  assert.match(imageVerifier, /waitForContainer\(name, \(\) =>/);
});

test("Runtime image verification records size without enforcing a fixed ceiling", () => {
  assert.match(runtimeImageCheck, /sizeBytes: first\.Size/);
  assert.match(runtimeImageCheck, /sizeLimitEnforced: false/);
  assert.doesNotMatch(runtimeImageCheck, /maximumBytes/);
  assert.doesNotMatch(runtimeImageCheck, /first\.Size\s*>/);
  assert.doesNotMatch(capacityBaseline, /image\.sizeBytes\s*>\s*image\.maximumBytes/);
  assert.match(capacityBaseline, /Number\.isSafeInteger\(image\.sizeBytes\)/);
});
