import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compose = readFileSync("deploy/release-compose.yml", "utf8").replace(/\r\n?/g, "\n");
const smoke = readFileSync("scripts/run-release-artifact-smoke.mjs", "utf8").replace(
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
