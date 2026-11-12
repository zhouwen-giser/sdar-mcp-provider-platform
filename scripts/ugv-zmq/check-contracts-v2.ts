import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { checkContracts } from "./check-contracts.js";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const root = resolve(
  dirname(fileURLToPath(import.meta.url).replace(/\/dist\/scripts\//, "/scripts/")),
  "../..",
);
const directory = resolve(root, "contracts/ugv-zmq/v2");
const file = z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const lockSchema = z
  .object({ schemaVersion: z.literal("ugv.zmq-contract-lock/2"), files: z.array(file).min(6) })
  .strict();
export function checkContractsV2() {
  checkContracts();
  const lock = lockSchema.parse(
    JSON.parse(readFileSync(resolve(directory, "contract-lock.json"), "utf8")),
  );
  const source = z
    .object({
      schemaVersion: z.literal("ugv.zmq-source-lock/2"),
      upstreamCommit: z.literal("a0be6a51e17fb9e85bc4ba0b62f7157a1b77c82e"),
      protocols: z
        .object({
          chassis: z.literal("2.1"),
          eo: z.literal("2.3"),
          simulationEffect: z.literal("1.0"),
        })
        .strict(),
      sources: z.array(
        z
          .object({ snapshot: z.string(), sha256: z.string(), bytes: z.number().int().positive() })
          .loose(),
      ),
    })
    .loose()
    .parse(JSON.parse(readFileSync(resolve(directory, "source-lock.json"), "utf8")));
  const files = [
    ...lock.files,
    ...source.sources.map((f) => ({ path: f.snapshot, sha256: f.sha256, bytes: f.bytes })),
  ];
  for (const f of files) {
    const path = realpathSync(resolve(root, f.path));
    if (relative(root, path).startsWith("..")) throw Error("ZMQ_LOCK_PATH_ESCAPES_REPOSITORY");
    const bytes = readFileSync(path);
    if (sha(bytes) !== f.sha256 || ("bytes" in f && bytes.length !== f.bytes))
      throw Error(`ZMQ_CONTRACT_V2_DRIFT:${f.path}`);
  }
  return {
    schemaVersion: "ugv.zmq-lock-verification/2",
    status: "verified",
    checkedFiles: files.length,
    contractSha256: sha(readFileSync(resolve(directory, "contract-lock.json"))),
    protocols: source.protocols,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(checkContractsV2()));
