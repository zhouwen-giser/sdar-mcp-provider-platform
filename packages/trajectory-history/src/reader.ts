import { randomUUID, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import {
  HISTORY_CHAIN_ALGORITHM,
  HistoryManifestSchema,
  HistoryPageSchema,
  HistoryQuerySchema,
  SignedHistoryManifestSchema,
  type HistoryManifest,
  type HistoryPage,
  type HistoryQuery,
  type SignedHistoryManifest,
} from "./contract.js";
import {
  historyCanonicalJson,
  historyScopeHash,
  signHistoryManifest,
  verifyHistoryManifest,
} from "./proof.js";
import type { PostgresReceptionStore } from "./postgres-store.js";

const cursorSchema = z
  .object({
    version: z.literal(1),
    snapshotId: z.uuid(),
    scopeHash: z.string().regex(/^[a-f0-9]{64}$/),
    subjectHash: z.string().min(1).max(256),
    nextSequence: z.string().regex(/^[1-9][0-9]{0,18}$/),
  })
  .strict();

export class TrajectoryHistoryReader {
  readonly publicKey: KeyObject;
  constructor(
    readonly store: PostgresReceptionStore,
    readonly signingKey: KeyObject,
    readonly evidenceClass: "SIMULATED" | "UNQUALIFIED_SOURCE",
  ) {
    this.publicKey = createPublicKey(signingKey);
  }
  async read(input: HistoryQuery, subjectHash: string): Promise<HistoryPage> {
    return this.store.fenced((client) => this.readFenced(input, subjectHash, client));
  }
  private async readFenced(
    input: HistoryQuery,
    subjectHash: string,
    client: PoolClient,
  ): Promise<HistoryPage> {
    const query = HistoryQuerySchema.parse(input);
    if (query.resourceId !== this.store.scope.resourceId)
      throw Error("HISTORY_RESOURCE_SCOPE_MISMATCH");
    if (!subjectHash || subjectHash.length > 256) throw Error("HISTORY_AUTHORIZATION_REQUIRED");
    let signed: SignedHistoryManifest, after: string, limit: number, maxBytes: number;
    if (query.pageCursor) {
      const cursor = this.decodeCursor(query.pageCursor);
      if (
        cursor.scopeHash !== historyScopeHash(this.store.scope) ||
        cursor.subjectHash !== subjectHash
      )
        throw Error("HISTORY_CURSOR_SCOPE_OR_AUTHORIZATION_MISMATCH");
      const stored = await this.store.loadSnapshot(cursor.snapshotId, subjectHash, client);
      signed = SignedHistoryManifestSchema.parse(stored.signed);
      verifyHistoryManifest(signed, this.publicKey, this.store.scope);
      after = cursor.nextSequence;
      limit = stored.pageLimit;
      maxBytes = stored.maxPageBytes;
      if (
        (query.limit !== undefined && query.limit !== limit) ||
        (query.maxPageBytes !== undefined && query.maxPageBytes !== maxBytes) ||
        (query.fromSequence !== undefined && query.fromSequence !== signed.manifest.fromSequence) ||
        (query.throughSequence !== undefined &&
          query.throughSequence !== signed.manifest.throughSequence)
      )
        throw Error("HISTORY_CURSOR_QUERY_CHANGED");
    } else {
      limit = query.limit ?? 64;
      maxBytes = query.maxPageBytes ?? 65536;
      signed = await this.snapshot(query, subjectHash, maxBytes, limit, client);
      after = signed.manifest.fromSequence;
    }
    const manifest = signed.manifest;
    const state = await this.store.state(client);
    if (
      manifest.retainedHistory.status === "complete" &&
      BigInt(manifest.expectedOrdinalCount) > 0n &&
      BigInt(manifest.fromSequence) <= BigInt(state.prunedThrough)
    )
      throw Error("HISTORY_SNAPSHOT_RANGE_PRUNED");
    if (
      manifest.retainedHistory.status === "complete" &&
      (await this.store.count(manifest.fromSequence, manifest.throughSequence, client)) !==
        manifest.retainedEntryCount
    )
      throw Error("HISTORY_SNAPSHOT_RETAINED_SET_CHANGED");
    if (
      BigInt(after) < BigInt(manifest.fromSequence) ||
      BigInt(after) > BigInt(manifest.throughSequence) + 1n
    )
      throw Error("HISTORY_CURSOR_BOUNDARIES_INVALID");
    const candidates = await this.store.read(after, manifest.throughSequence, limit + 1, client);
    const entries: HistoryPage["entries"] = [];
    const nodeCount = (value: unknown): number => {
      if (value === null || typeof value !== "object") return 1;
      return 1 + Object.values(value).reduce<number>((count, child) => count + nodeCount(child), 0);
    };
    let nodes = nodeCount(signed);
    for (const candidate of candidates.slice(0, limit)) {
      const bytes = Buffer.byteLength(
        historyCanonicalJson({ snapshot: signed, entries: [...entries, candidate] }),
      );
      const entryNodes = nodeCount(candidate);
      if (bytes > maxBytes - 2048 || nodes + entryNodes > 9000) {
        if (entries.length === 0) throw Error("HISTORY_ENTRY_EXCEEDS_PAGE_BUDGET");
        break;
      }
      entries.push(candidate);
      nodes += entryNodes;
    }
    const last = entries.at(-1);
    const next = last ? (BigInt(last.sequence) + 1n).toString() : after;
    const hasMore = candidates.length > entries.length;
    const finished = !hasMore;
    if (
      finished &&
      manifest.retainedHistory.status === "complete" &&
      BigInt(next) <= BigInt(manifest.throughSequence)
    )
      throw Error("HISTORY_SNAPSHOT_PAGE_GAP");
    const nextCursor = finished
      ? null
      : this.encodeCursor({
          version: 1,
          snapshotId: manifest.snapshotId,
          scopeHash: historyScopeHash(this.store.scope),
          subjectHash,
          nextSequence: next,
        });
    return HistoryPageSchema.parse({
      schemaVersion: "ugv.trajectory-history-page/1.0",
      snapshot: signed,
      entries,
      nextCursor,
      rangeReadFinished: finished,
    });
  }
  private async snapshot(
    query: HistoryQuery,
    subject: string,
    maxBytes: number,
    limit: number,
    client: PoolClient,
  ): Promise<SignedHistoryManifest> {
    const state = await this.store.state(client);
    const from = query.fromSequence ?? "1",
      through = query.throughSequence ?? state.highWatermark;
    if (BigInt(through) > BigInt(state.highWatermark) || BigInt(from) > BigInt(through) + 1n)
      throw Error("HISTORY_RANGE_BOUNDARIES_INVALID");
    const expected = BigInt(through) < BigInt(from) ? 0n : BigInt(through) - BigInt(from) + 1n;
    const count = await this.store.count(from, through, client);
    const predecessor = BigInt(from) - 1n;
    const preceding =
      predecessor === 0n
        ? []
        : await this.store.read(predecessor.toString(), predecessor.toString(), 1, client);
    const previous =
      predecessor === 0n
        ? state.genesisHash
        : (preceding[0]?.hash ??
          (predecessor === BigInt(state.prunedThrough) ? state.prunedHeadHash : null));
    const terminal =
      expected === 0n
        ? previous
        : ((await this.store.read(through, through, 1, client))[0]?.hash ?? null);
    const reasons: string[] = [];
    if (expected > 0n && BigInt(from) <= BigInt(state.prunedThrough))
      reasons.push("RETENTION_TRIMMED_RANGE");
    if (BigInt(count) !== expected) reasons.push("RETAINED_RECEIPT_SEQUENCE_GAP");
    if (previous === null || terminal === null) reasons.push("CHAIN_BOUNDARY_ANCHOR_UNAVAILABLE");
    const recovery = await this.store.recovery(client);
    const coverageReasons = ["COMMITTED_RECEIPT_RANGE_NOT_ALL_PHYSICAL_CALLBACKS"];
    if (recovery.uncleanSessionCount) coverageReasons.push("UNCLEAN_PROCESS_RECOVERY_WINDOW");
    if (recovery.disconnectCount) coverageReasons.push("SOURCE_TRANSPORT_DISCONNECTION_OBSERVED");
    if (recovery.captureFailureCount) coverageReasons.push("SOURCE_CAPTURE_FAILURE_OBSERVED");
    const manifest: HistoryManifest = HistoryManifestSchema.parse({
      schemaVersion: "ugv.trajectory-history-manifest/1.0",
      scope: this.store.scope,
      snapshotId: randomUUID(),
      capturedFromSequence: "1",
      capturedFromRecordingTime: state.capturedAt,
      activationClockOwner: "POSTGRESQL_STREAM_CREATION_CLOCK",
      guaranteedSinceHistoryVersion: "1.0",
      fromSequence: from,
      throughSequence: through,
      highWatermark: state.highWatermark,
      retainedEntryCount: count,
      expectedOrdinalCount: expected.toString(),
      previousHash: previous,
      terminalHash: terminal,
      chainAlgorithm: HISTORY_CHAIN_ALGORITHM,
      ordering: "DURABLE_PROVIDER_RECEIPT_SEQUENCE",
      deduplication: "RECEPTIONS_NOT_COLLAPSED_INTO_DEVICE_SAMPLES",
      retainedHistory: { status: reasons.length ? "incomplete" : "complete", reasons },
      providerCaptureCoverage: { status: "unknown", reasons: coverageReasons },
      deviceGenerationHistory: {
        status: "unknown",
        reasons: ["PRODUCER_BOUNDARY_ATTESTATION_MISSING", "PRODUCER_EPOCH_NOT_ATTESTED"],
      },
      legacyHistory: "NO_RETROACTIVE_RECEPTION_TIME_OR_DEVICE_COMPLETENESS_CLAIM",
      prunedThroughSequence: state.prunedThrough,
      recovery,
      evidenceClass: this.evidenceClass,
    });
    const signed = signHistoryManifest(manifest, this.signingKey);
    await this.store.saveSnapshot(signed, subject, maxBytes, limit, client);
    return signed;
  }
  private encodeCursor(cursor: z.infer<typeof cursorSchema>): string {
    const body = Buffer.from(historyCanonicalJson(cursor));
    return (
      body.toString("base64url") + "." + sign(null, body, this.signingKey).toString("base64url")
    );
  }
  private decodeCursor(input: string): z.infer<typeof cursorSchema> {
    const parts = input.split(".");
    if (
      parts.length !== 2 ||
      !parts[0] ||
      !parts[1] ||
      !/^[A-Za-z0-9_-]+$/.test(parts[0] + parts[1])
    )
      throw Error("HISTORY_CURSOR_INVALID");
    const bytes = Buffer.from(parts[0], "base64url");
    const signature = Buffer.from(parts[1], "base64url");
    if (
      bytes.toString("base64url") !== parts[0] ||
      signature.toString("base64url") !== parts[1] ||
      signature.length !== 64
    )
      throw Error("HISTORY_CURSOR_NONCANONICAL_ENCODING");
    if (!verify(null, bytes, this.publicKey, signature))
      throw Error("HISTORY_CURSOR_SIGNATURE_INVALID");
    return cursorSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown);
  }
}
