import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import {
  ObservationEvent,
  archiveEntryHash,
  reconstructFrames,
  sha256,
} from "../../packages/vehicle-zmq-observer/src/index.js";
import {
  resultPage,
  ResultIdentity,
  type ResultRecord,
} from "../../packages/vehicle-zmq-control/src/results.js";

const path = process.argv[2],
  results = process.argv[3];
if (!path || !results) throw Error("CONTROL_EVIDENCE_PATHS_REQUIRED");
const bytes = readFileSync(path),
  raw = path.endsWith(".gz") ? gunzipSync(bytes) : bytes;
const session = z
  .object({
    sessionId: z.uuid(),
    genesisHash: z.string(),
    headHash: z.string().optional(),
    lastOrdinal: z.string().optional(),
  })
  .loose();
const source = z.object({
  partitionHash: z.string(),
  sessionId: z.string(),
  ordinal: z.string(),
  entryHash: z.string(),
});
const heads = new Map<
  string,
  {
    head: string;
    ordinal: bigint;
    expectedHead: string | undefined;
    expectedOrdinal: string | undefined;
  }
>();
const refs = new Set<string>();
let receptions = 0,
  entries = 0;
for (const line of raw.toString().split("\n").filter(Boolean)) {
  const record = z
    .object({ kind: z.enum(["session", "entry"]), partitionHash: z.string() })
    .loose()
    .parse(JSON.parse(line) as unknown);
  if (record.kind === "session") {
    const s = session.parse(record.session),
      key = `${record.partitionHash}/${s.sessionId}`;
    if (heads.has(key)) throw Error("CONTROL_EVIDENCE_DUPLICATE_SESSION");
    heads.set(key, {
      head: s.genesisHash,
      ordinal: 0n,
      expectedHead: s.headHash,
      expectedOrdinal: s.lastOrdinal,
    });
  } else {
    const value = z
      .object({
        ordinal: z.string(),
        previousHash: z.string(),
        entryHash: z.string(),
        payload: ObservationEvent,
      })
      .parse(record.entry);
    const ref = source.parse({
        partitionHash: record.partitionHash,
        sessionId: record.sessionId,
        ordinal: value.ordinal,
        entryHash: value.entryHash,
      }),
      key = `${ref.partitionHash}/${ref.sessionId}`,
      previous = heads.get(key);
    if (
      !previous ||
      BigInt(value.ordinal) !== previous.ordinal + 1n ||
      value.previousHash !== previous.head ||
      archiveEntryHash(value.previousHash, value.ordinal, value.payload) !== value.entryHash
    )
      throw Error("CONTROL_EVIDENCE_CHAIN_INVALID");
    if (value.payload.type === "reception") {
      reconstructFrames(value.payload);
      receptions++;
    }
    previous.head = value.entryHash;
    previous.ordinal++;
    refs.add(JSON.stringify([ref.partitionHash, ref.sessionId, ref.ordinal, ref.entryHash]));
    entries++;
  }
}
const outcome = z
  .object({
    classification: z.enum(["SIMULATED_ONLY", "ISOLATED_FORMAL_RUNTIME_SIMULATED_ONLY"]),
    evidence: z.array(z.record(z.string(), z.unknown())),
  })
  .parse(JSON.parse(readFileSync(results, "utf8")) as unknown);
for (const head of heads.values())
  if (head.head !== head.expectedHead || head.ordinal.toString() !== head.expectedOrdinal)
    throw Error("CONTROL_EVIDENCE_SESSION_TAIL_MISSING");
let referencedReceipts = 0,
  resultRecords = 0;
for (const item of outcome.evidence) {
  if (Array.isArray(item.resultPages)) {
    let cursor = 0;
    for (const input of item.resultPages) {
      const page = z
        .object({
          identity: ResultIdentity,
          records: z.array(z.record(z.string(), z.unknown())),
          nextRevision: z.number(),
        })
        .parse(input);
      const checked = resultPage(page.identity, page.records as unknown as ResultRecord[], cursor);
      if (checked.nextRevision !== page.nextRevision)
        throw Error("CONTROL_RESULT_REVISION_INVALID");
      for (const record of checked.records) {
        const ref = record.sourceRef;
        if (
          !refs.has(JSON.stringify([ref.partitionHash, ref.sessionId, ref.ordinal, ref.entryHash]))
        )
          throw Error("CONTROL_RESULT_SOURCE_UNRESOLVED");
        if (record.revision <= cursor) throw Error("CONTROL_RESULT_REVISION_INVALID");
        cursor = record.revision;
        resultRecords++;
      }
    }
  }
  if (!item.final) continue;
  const final = z
    .object({ zmqControl: z.object({ latestEvidence: z.array(source) }) })
    .parse(item.final);
  for (const ref of final.zmqControl.latestEvidence) {
    if (!refs.has(JSON.stringify([ref.partitionHash, ref.sessionId, ref.ordinal, ref.entryHash])))
      throw Error("CONTROL_SOURCE_REFERENCE_UNRESOLVED");
    referencedReceipts++;
  }
}
process.stdout.write(
  JSON.stringify(
    {
      classification: outcome.classification,
      sessions: heads.size,
      entries,
      receptions,
      referencedEntries: referencedReceipts,
      resultRecords,
      rawSha256: sha256(raw),
      storedSha256: sha256(bytes),
    },
    null,
    2,
  ) + "\n",
);
