import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

if (process.argv.length !== 3 || process.argv[2] !== "--write")
  throw Error("ZMQ_FREEZE_REQUIRES_EXPLICIT_WRITE");
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const files = [
  "packages/vehicle-zmq-contract/package.json",
  "packages/vehicle-zmq-contract/src/index.ts",
  "deploy/ugv-zmq/task-business.candidate.json",
  "contracts/ugv-zmq/v1/known-gaps.json",
  "contracts/ugv-zmq/v1/message-inventory.json",
  "contracts/ugv-zmq/v1/fixtures/chassis-reference.json",
  "packages/vehicle-zmq-contract/src/error.ts",
  "packages/vehicle-zmq-contract/src/json.ts",
  "packages/vehicle-zmq-contract/src/chassis.ts",
  "packages/vehicle-zmq-contract/src/schema.ts",
  "packages/vehicle-zmq-contract/src/wire.ts",
  "packages/vehicle-zmq-contract/src/profile.ts",
  "packages/vehicle-zmq-contract/src/capture.ts",
];
const root = resolve("contracts/ugv-zmq/v1");
const lock = {
  schemaVersion: "ugv.zmq-contract-lock/1",
  sourceLockSha256: sha(resolve(root, "source-lock.json")),
  files: files.map((path) => ({ path, sha256: sha(path) })),
};
writeFileSync(resolve(root, "contract-lock.json"), JSON.stringify(lock, null, 2) + "\n");
console.log(
  JSON.stringify({ status: "candidate_contract_frozen", files: files.length, sourceDocuments: 3 }),
);
