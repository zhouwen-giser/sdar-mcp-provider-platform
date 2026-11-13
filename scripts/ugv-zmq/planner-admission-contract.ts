import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkInteropContracts } from "./interop-contract.js";
const root = resolve(
  dirname(fileURLToPath(import.meta.url).replace(/\/dist\/scripts\//, "/scripts/")),
  "../..",
);
const path = "contracts/ugv-zmq/planner-admission-v1/contract-lock.json";
const files = [
  "packages/vehicle-zmq-contract/src/planner-admission-profile.ts",
  "packages/provider-adapter-kit/src/dashboard-v2-component-planner.ts",
  "packages/vehicle-zmq-control/src/planner-v3-contract.ts",
  "contracts/ugv-zmq/provider-v1.5.2-site-control/catalog.json",
  "contracts/ugv-zmq/provider-v1.5.2-readonly/catalog.json",
];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export function checkPlannerAdmissionContracts(write = false) {
  const lock = {
    schemaVersion: "ugv.zmq-planner-admission-lock/1",
    parentContractSha256: checkInteropContracts().contractSha256,
    plannerReadinessPolicy: "runtime_scene_and_entity_v1",
    files: files.map((path) => ({ path, sha256: hash(readFileSync(resolve(root, path))) })),
  };
  const bytes = JSON.stringify(lock, null, 2) + "\n";
  if (write) writeFileSync(resolve(root, path), bytes);
  if (readFileSync(resolve(root, path), "utf8") !== bytes)
    throw Error("ZMQ_PLANNER_ADMISSION_CONTRACT_DRIFT");
  return {
    status: "verified",
    contractSha256: hash(Buffer.from(bytes)),
    checkedFiles: files.length,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(checkPlannerAdmissionContracts(process.argv.includes("--write"))));
