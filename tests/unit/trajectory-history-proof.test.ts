import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  HISTORY_CHAIN_ALGORITHM,
  ReceptionReceiptSchema,
  type HistoryManifest,
  type ReceptionEntry,
  type ReceptionReceipt,
  type ReceptionScope,
} from "../../packages/trajectory-history/src/contract.js";
import {
  historyCanonicalJson,
  receptionHash,
  RetainedHistoryVerifier,
  signHistoryManifest,
  verifyHistoryManifest,
} from "../../packages/trajectory-history/src/proof.js";

const scope: ReceptionScope = {
  providerId: "isr.vehicle.ugv.fixture",
  resourceId: "vehicle:fixture",
  deviceId: "ugv:fixture",
  deviceIdentityAuthority: "GOWM_DEVICE_BINDING",
  streamId: randomUUID(),
  sourceSessionKey: "SIMULATED-local-fixture",
};
const genesis = "0".repeat(64);
const keys = generateKeyPairSync("ed25519");

function receipt(): ReceptionReceipt {
  return {
    schemaVersion: "ugv.trajectory-reception/1.0",
    receptionId: randomUUID(),
    sessionId: randomUUID(),
    sourceTopic: "/ugv/gnss",
    originalMessageSha256: "a".repeat(64),
    originalMessageBytes: 64,
    originalMessageReference: "mqtt-wire:sha256:" + "a".repeat(64),
    providerReceivedAt: {
      utc: "2026-10-12T00:00:00.000Z",
      owner: "PROVIDER_MQTT_MESSAGE_CALLBACK",
      clockId: "SIMULATED-fixture-clock",
      resolution: "MILLISECOND",
      synchronization: "UNVERIFIED",
      accuracyBoundMilliseconds: null,
      processMonotonicNanoseconds: "123456789",
    },
    reportedTime: null,
    deviceAcquisitionTime: null,
    deviceClockAttribution: "NOT_ATTESTED_BY_PRODUCER_CONTRACT",
    sourceReportedSequence: null,
    sourceProducerEpoch: null,
    transport: { qos: 1, packetId: 1, duplicateDeliveryHint: false, retainedDelivery: false },
    disposition: "POSITION_OBSERVATION",
    reasonCode: "POSITION_NORMALIZED",
    position: {
      longitude: 113,
      latitude: 23,
      crs: "OGC:CRS84",
      derivation: "VERSIONED_PROVIDER_NORMALIZER",
    },
    reportedMission: null,
    evidenceClass: "SIMULATED",
    diagnostics: [],
  };
}

function fixture(count = 3) {
  const entries: ReceptionEntry[] = [];
  let previous = genesis;
  for (let i = 1; i <= count; i++) {
    const body = receipt();
    body.providerReceivedAt.processMonotonicNanoseconds = String(123456789 + i);
    if (!body.position) throw Error("EXPECTED_POSITION_FIXTURE_MISSING");
    body.position.longitude += i / 1000;
    const sequence = String(i),
      recordedAt = `2026-10-12T00:00:00.00000${i}Z`;
    const hash = receptionHash(scope, sequence, previous, body, recordedAt);
    entries.push({
      sequence,
      previousHash: previous,
      hash,
      receipt: body,
      recordedAt,
      recordingClockOwner: "POSTGRESQL_RECORD_INSERTION_CLOCK",
      recordingResolution: "MICROSECOND",
      exactTransactionCommittedAt: null,
    });
    previous = hash;
  }
  const manifest: HistoryManifest = {
    schemaVersion: "ugv.trajectory-history-manifest/1.0",
    scope,
    snapshotId: randomUUID(),
    capturedFromSequence: "1",
    capturedFromRecordingTime: "2026-10-12T00:00:00.000Z",
    activationClockOwner: "POSTGRESQL_STREAM_CREATION_CLOCK",
    guaranteedSinceHistoryVersion: "1.0",
    fromSequence: "1",
    throughSequence: String(count),
    highWatermark: String(count),
    retainedEntryCount: String(count),
    expectedOrdinalCount: String(count),
    previousHash: genesis,
    terminalHash: previous,
    chainAlgorithm: HISTORY_CHAIN_ALGORITHM,
    ordering: "DURABLE_PROVIDER_RECEIPT_SEQUENCE",
    deduplication: "RECEPTIONS_NOT_COLLAPSED_INTO_DEVICE_SAMPLES",
    retainedHistory: { status: "complete", reasons: [] },
    providerCaptureCoverage: { status: "unknown", reasons: ["DEVICE_TRANSPORT_NOT_ATTESTED"] },
    deviceGenerationHistory: {
      status: "unknown",
      reasons: ["PRODUCER_BOUNDARY_ATTESTATION_MISSING"],
    },
    legacyHistory: "NO_RETROACTIVE_RECEPTION_TIME_OR_DEVICE_COMPLETENESS_CLAIM",
    prunedThroughSequence: "0",
    recovery: { uncleanSessionCount: 0, disconnectCount: 0, captureFailureCount: 0 },
    evidenceClass: "SIMULATED",
  };
  return { entries, manifest, signed: signHistoryManifest(manifest, keys.privateKey) };
}

describe("trajectory history authenticated retained-range verification", () => {
  it("retains distinct points in one millisecond without inventing device time", () => {
    const f = fixture();
    expect(new Set(f.entries.map((e) => e.receipt.receptionId)).size).toBe(3);
    expect(new Set(f.entries.map((e) => e.receipt.providerReceivedAt.utc)).size).toBe(1);
    expect(f.entries.every((e) => e.receipt.deviceAcquisitionTime === null)).toBe(true);
    const verifier = new RetainedHistoryVerifier(f.signed, keys.publicKey, scope);
    for (const entry of f.entries) verifier.accept(entry);
    expect(verifier.finish(true)).toEqual({
      retainedSetVerified: true,
      deviceHistoryComplete: false,
    });
  });

  it("cannot pass a page prefix or false end-of-range marker as complete history", () => {
    const f = fixture();
    const prefix = new RetainedHistoryVerifier(f.signed, keys.publicKey, scope);
    prefix.accept(f.entries[0]);
    expect(() => prefix.finish(true)).toThrow("HISTORY_RANGE_NOT_FULLY_VERIFIED");
    const all = new RetainedHistoryVerifier(f.signed, keys.publicKey, scope);
    f.entries.forEach((e) => all.accept(e));
    expect(() => all.finish(false)).toThrow("HISTORY_RANGE_NOT_FULLY_VERIFIED");
  });

  it("rejects missing, duplicated, reordered and changed receipt entries", () => {
    const f = fixture();
    const first = f.entries[0];
    if (!first) throw Error("SIMULATED_FIXTURE_FIRST_ENTRY_MISSING");
    for (const stream of [
      [f.entries[1]],
      [f.entries[0], f.entries[0]],
      [f.entries[0], f.entries[2]],
      [
        {
          ...first,
          receipt: {
            ...first.receipt,
            providerReceivedAt: {
              ...first.receipt.providerReceivedAt,
              utc: "2026-10-12T01:00:00.000Z",
            },
          },
        },
      ],
    ]) {
      const verifier = new RetainedHistoryVerifier(f.signed, keys.publicKey, scope);
      expect(() => stream.forEach((e) => verifier.accept(e))).toThrow(
        "HISTORY_ENTRY_CHAIN_INVALID",
      );
    }
  });

  it("rejects a valid proof copied to another device or resource", () => {
    const f = fixture();
    expect(() =>
      verifyHistoryManifest(f.signed, keys.publicKey, { ...scope, deviceId: "ugv:other" }),
    ).toThrow("HISTORY_PROOF_SCOPE_MISMATCH");
    expect(() =>
      verifyHistoryManifest(f.signed, keys.publicKey, { ...scope, resourceId: "vehicle:other" }),
    ).toThrow("HISTORY_PROOF_SCOPE_MISMATCH");
  });

  it("rejects forged count/quality claims and a substituted signing key", () => {
    const f = fixture();
    expect(() =>
      verifyHistoryManifest(
        {
          ...f.signed,
          manifest: { ...f.manifest, providerCaptureCoverage: { status: "complete", reasons: [] } },
        },
        keys.publicKey,
        scope,
      ),
    ).toThrow("HISTORY_PROOF_SIGNATURE_INVALID");
    const forged = signHistoryManifest(f.manifest, generateKeyPairSync("ed25519").privateKey);
    expect(() => verifyHistoryManifest(forged, keys.publicKey, scope)).toThrow(
      "HISTORY_PROOF_SIGNATURE_INVALID",
    );
    expect(() =>
      signHistoryManifest({ ...f.manifest, retainedEntryCount: "2" }, keys.privateKey),
    ).toThrow();
    expect(() =>
      signHistoryManifest(
        {
          ...f.manifest,
          deviceGenerationHistory: { status: "complete", reasons: [] },
        } as unknown as HistoryManifest,
        keys.privateKey,
      ),
    ).toThrow();
  });

  it("does not verify a retained range explicitly marked incomplete", () => {
    const f = fixture();
    const signed = signHistoryManifest(
      {
        ...f.manifest,
        retainedEntryCount: "2",
        retainedHistory: { status: "incomplete", reasons: ["RETENTION_TRIMMED_RANGE"] },
      },
      keys.privateKey,
    );
    expect(() => new RetainedHistoryVerifier(signed, keys.publicKey, scope)).toThrow(
      "HISTORY_RETAINED_SET_NOT_COMPLETE",
    );
  });

  it("rejects a metadata clock presented as reception time and non-JSON proof values", () => {
    const body = receipt();
    expect(() =>
      ReceptionReceiptSchema.parse({
        ...body,
        providerReceivedAt: {
          ...body.providerReceivedAt,
          owner: "TASKBUSINESS_CONTEXT_UPDATED_AT",
        },
      }),
    ).toThrow();
    for (const value of [NaN, Infinity, undefined, new Date(), { missing: undefined }])
      expect(() => historyCanonicalJson(value)).toThrow("HISTORY_CANONICAL_JSON_VALUE_INVALID");
    expect(historyCanonicalJson({ b: 2, a: [1, null] })).toBe('{"a":[1,null],"b":2}');
  });
});
