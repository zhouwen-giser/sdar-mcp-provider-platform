import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ProtocolGaps } from "../../packages/vehicle-zmq-contract/src/index.js";

export const contractRoot = resolve(
  dirname(fileURLToPath(import.meta.url).replace(/\/dist\/scripts\//, "/scripts/")),
  "../../contracts/ugv-zmq/v1",
);
const lockedFile = z
  .object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const lockSchema = z
  .object({
    schemaVersion: z.literal("ugv.zmq-contract-lock/1"),
    sourceLockSha256: z.string(),
    files: z.array(lockedFile).min(4),
  })
  .strict();
const sources = z
  .object({
    schemaVersion: z.literal("ugv.zmq-source-lock/1"),
    frozenAt: z.literal("2026-10-23"),
    status: z.literal("candidate"),
    contracts: z
      .array(
        z
          .object({
            component: z.enum(["chassis", "eo", "simulationEffect"]),
            protocolVersion: z.string(),
            sourcePath: z.string(),
            snapshot: z.string(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            bytes: z.number().int().positive(),
            authority: z.literal("user_supplied_document"),
            providerImplementationVerified: z.literal(false),
            presentationRevision: z
              .object({
                authority: z.literal("operator_requested_terminology_revision"),
                originalSnapshot: z.string(),
                originalSha256: z.string().regex(/^[a-f0-9]{64}$/),
                originalBytes: z.number().int().positive(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .length(3),
  })
  .strict();
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8")) as unknown;

export function checkContracts(directory = contractRoot) {
  const root = resolve(directory, "../../..");
  const lock = lockSchema.parse(read(resolve(directory, "contract-lock.json")));
  const sourceFile = resolve(directory, "source-lock.json"),
    sourceBytes = readFileSync(sourceFile);
  if (sha(sourceBytes) !== lock.sourceLockSha256) throw Error("ZMQ_SOURCE_LOCK_DRIFT");
  const source = sources.parse(JSON.parse(sourceBytes.toString("utf8")) as unknown);
  const names = new Set(source.contracts.map((c) => `${c.component}@${c.protocolVersion}`));
  if (!["chassis@2.0", "eo@2.2", "simulationEffect@1.0"].every((n) => names.has(n)))
    throw Error("ZMQ_COMPONENT_VERSION_DRIFT");
  const checked: string[] = [];
  for (const item of [
    ...lock.files,
    ...source.contracts.flatMap((c) => [
      { path: `contracts/ugv-zmq/v1/${c.snapshot}`, sha256: c.sha256, bytes: c.bytes },
      ...(c.presentationRevision
        ? [
            {
              path: `contracts/ugv-zmq/v1/${c.presentationRevision.originalSnapshot}`,
              sha256: c.presentationRevision.originalSha256,
              bytes: c.presentationRevision.originalBytes,
            },
          ]
        : []),
    ]),
  ]) {
    const path = realpathSync(resolve(root, item.path));
    if (relative(root, path).startsWith("..")) throw Error("ZMQ_LOCK_PATH_ESCAPES_REPOSITORY");
    const bytes = readFileSync(path);
    if (sha(bytes) !== item.sha256 || ("bytes" in item && bytes.length !== item.bytes))
      throw Error(`ZMQ_CONTRACT_DRIFT:${item.path}`);
    checked.push(item.path);
  }
  const wireExamples = (text: string) =>
    [...text.matchAll(/^```(?:json|yaml)\n([\s\S]*?)^```/gm)].map((match) => match[1]);
  for (const item of source.contracts) {
    if (!item.presentationRevision) continue;
    const before = readFileSync(
      resolve(directory, item.presentationRevision.originalSnapshot),
      "utf8",
    );
    const after = readFileSync(resolve(directory, item.snapshot), "utf8");
    if (JSON.stringify(wireExamples(before)) !== JSON.stringify(wireExamples(after)))
      throw Error("ZMQ_PRESENTATION_CHANGED_WIRE_EXAMPLES");
  }
  ProtocolGaps.parse(read(resolve(directory, "known-gaps.json")));
  return {
    schemaVersion: "ugv.zmq-lock-verification/1",
    sourceDocuments: source.contracts.length,
    checkedFiles: checked,
    status: "verified",
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(checkContracts(), null, 2));
}
