import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessDeployment, inspectCapture } from "../../packages/vehicle-zmq-contract/src/index.js";
import { checkContracts, contractRoot } from "./check-contracts.js";

const args = process.argv.slice(2);
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  const key = args[i],
    value = args[i + 1];
  if (!key || !["--profile", "--capture", "--report"].includes(key) || !value || options.has(key))
    throw Error("ZMQ_PREFLIGHT_ARGUMENTS_INVALID");
  options.set(key, value);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8")) as unknown;
const profilePath = resolve(
  options.get("--profile") ?? resolve(root, "deploy/ugv-zmq/deployment.candidate.json"),
);
const profile = read(profilePath);
const contract = checkContracts();
const assessment = assessDeployment(
  profile,
  read(resolve(contractRoot, "known-gaps.json")),
  (ref) => {
    try {
      if (isAbsolute(ref.path)) return false;
      const path = realpathSync(resolve(root, ref.path));
      if (relative(root, path).startsWith("..")) return false;
      return createHash("sha256").update(readFileSync(path)).digest("hex") === ref.sha256;
    } catch {
      return false;
    }
  },
);
const capturePath = options.get("--capture");
const capture = capturePath ? inspectCapture(read(resolve(capturePath)), profile) : null;
const report = {
  ...assessment,
  generatedAt: new Date().toISOString(),
  profileSha256: createHash("sha256").update(readFileSync(profilePath)).digest("hex"),
  contract,
  capture,
  authority: "static_contract_and_supplied_evidence_not_runtime_or_control_acceptance",
};
if (options.has("--report"))
  writeFileSync(resolve(options.get("--report") ?? ""), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
process.exitCode =
  assessment.g0Ready &&
  (!capture ||
    (capture.allComponentsObserved && !capture.records.some((r) => r.invalidSamples > 0)))
    ? 0
    : 2;
