import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkContractsV2 } from "./check-contracts-v2.js";
const root = resolve(
  dirname(fileURLToPath(import.meta.url).replace(/\/dist\/scripts\//, "/scripts/")),
  "../..",
);
const path = "contracts/ugv-zmq/site-interop-v1/contract-lock.json";
const files = [
  "packages/vehicle-zmq-contract/src/chassis-site.ts",
  "packages/vehicle-zmq-contract/src/interop-profile.ts",
  "packages/vehicle-zmq-contract/src/dashboard-v2.ts",
  "packages/provider-adapter-kit/src/scene-enu.ts",
  "packages/provider-adapter-kit/src/dashboard-v2-planner.ts",
  "packages/vehicle-zmq-control/src/planner-v2-contract.ts",
  "contracts/ugv-zmq/site-interop-v1/chassis-captured.json",
  "contracts/ugv-zmq/site-interop-v1/enu-reference-observed.json",
  "contracts/ugv-zmq/site-interop-v1/scene-reference-source.json",
  "contracts/ugv-zmq/provider-v1.5.1-site-control/catalog.json",
  "contracts/ugv-zmq/provider-v1.5.1-readonly/catalog.json",
];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export function checkInteropContracts(write = false) {
  const parent = checkContractsV2();
  const lock = {
    schemaVersion: "ugv.zmq-site-interop-lock/1",
    parentContractSha256: parent.contractSha256,
    upstreamCommit: "a0be6a51e17fb9e85bc4ba0b62f7157a1b77c82e",
    publicationFraming: "prefix_business_length_crc",
    commandFraming: "prefix_wire_length_crc",
    planner: "dashboard-v2-scene-enu",
    files: files.map((path) => ({ path, sha256: hash(readFileSync(resolve(root, path))) })),
  };
  const bytes = JSON.stringify(lock, null, 2) + "\n";
  if (write) writeFileSync(resolve(root, path), bytes);
  if (readFileSync(resolve(root, path), "utf8") !== bytes)
    throw Error("ZMQ_INTEROP_CONTRACT_DRIFT");
  return {
    status: "verified",
    contractSha256: hash(Buffer.from(bytes)),
    checkedFiles: files.length,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(checkInteropContracts(process.argv.includes("--write"))));
