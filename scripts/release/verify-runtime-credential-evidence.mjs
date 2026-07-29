import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const path = resolve(
  process.cwd(),
  process.argv[2] ?? "reports/evidence/G5-P1-B02-runtime-credential-isolation.json",
);
const evidence = JSON.parse(readFileSync(path, "utf8"));
const requiredAssertions = [
  "twoDeploymentsActive",
  "crossTokenConfigPullRejected",
  "crossTokenConfigWatchRejected",
  "crossTokenConfigAckRejected",
  "crossTokenRegisterRejected",
  "crossTokenHeartbeatRejected",
  "missingCredentialDidNotStartPm2",
  "identityMappingSurvivedApiWorkerRestart",
  "isolatedRuntimeUnaffectedByPeerCrashOrRotation",
];

if (
  evidence.taskId !== "G5-P1-B02" ||
  evidence.resourceClassification?.qualification !==
    "controlled production-path E2E; not real-provider certification" ||
  requiredAssertions.some((name) => evidence.assertions?.[name] !== true)
) {
  throw new Error("RUNTIME_CREDENTIAL_ISOLATION_EVIDENCE_INVALID");
}
const serialized = JSON.stringify(evidence);
if (/postgres(?:ql)?:\/\/|management-[0-9a-f-]+|runtime-control-[0-9a-f-]+/i.test(serialized)) {
  throw new Error("RUNTIME_CREDENTIAL_ISOLATION_EVIDENCE_SECRET");
}
process.stdout.write(`RUNTIME_CREDENTIAL_ISOLATION_EVIDENCE_OK ${requiredAssertions.length}\n`);
