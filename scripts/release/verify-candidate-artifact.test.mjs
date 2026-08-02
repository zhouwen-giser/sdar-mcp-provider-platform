import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const script = resolve("scripts/release/verify-candidate-artifact.mjs");
const candidate = "a".repeat(40);

test("accepts an exact-head artifact report", () => {
  const result = run(candidate);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`RELEASE_CANDIDATE_ARTIFACT_OK ${candidate}`));
});

test("rejects an artifact report for a different head", () => {
  const result = run("b".repeat(40));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RELEASE_CANDIDATE_ARTIFACT_SHA_MISMATCH/);
});

function run(revision) {
  const root = mkdtempSync(join(tmpdir(), "sdar-candidate-artifact-"));
  mkdirSync(join(root, "reports", "ci"), { recursive: true });
  writeFileSync(
    join(root, "reports", "ci", "release-artifacts.json"),
    `${JSON.stringify({
      revision,
      artifacts: Object.fromEntries(
        ["runtime", "api", "worker", "web"].map((name) => [
          name,
          { imageId: `sha256:${"c".repeat(64)}` },
        ]),
      ),
    })}\n`,
  );
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CANDIDATE_SHA: candidate },
  });
}
