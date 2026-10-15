import { generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadHistorySigningKey } from "../../packages/trajectory-history/src/signing-key.js";
import { historyKeyId } from "../../packages/trajectory-history/src/proof.js";
import {
  buildProjectionEvidence,
  signProjectionEvidence,
  verifyProjectionEvidence,
} from "../../packages/trajectory-history/src/projection.js";
import { TaskArtifactSchema } from "../../packages/vehicle-provider-core/src/task-business-artifact.js";
import { loadUgvProviderConfig } from "../../apps/ugv-provider-adapter/src/config.js";

const artifact = TaskArtifactSchema.parse({
  schemaVersion: "sdar.task-artifact/1.0-rc2",
  artifactId: "old-trajectory",
  artifactType: "navigation.trajectory",
  revision: 1,
  semantics: "observed",
  source: { producer: "provider", method: "legacy_projection_unknown" },
  lifecycle: "active",
  identity: {
    taskId: "legacy-task",
    executionId: "legacy-execution",
    providerId: "provider-a",
    resourceId: "vehicle:a",
    operationName: "vehicle_navigate",
  },
  createdAt: "2020-01-01T00:00:00Z",
  updatedAt: "2020-01-01T00:00:00Z",
  availability: "available",
  properties: { sampleCount: 2 },
  content: {
    kind: "geojson",
    crs: "OGC:CRS84",
    geometry: {
      type: "LineString",
      coordinates: [
        [114, 30],
        [114.1, 30.1],
      ],
    },
  },
});

describe("trajectory history authority and legacy downgrade", () => {
  it("keeps JSON-equivalent negative zero coordinates verifiable after transport and PostgreSQL encoding", () => {
    const zero = TaskArtifactSchema.parse({
      ...artifact,
      properties: { sampleCount: 1 },
      content: {
        kind: "geojson",
        crs: "OGC:CRS84",
        geometry: { type: "Point", coordinates: [-0, 30] },
      },
    });
    const key = generateKeyPairSync("ed25519");
    const signed = signProjectionEvidence(buildProjectionEvidence(zero), key.privateKey);
    const transported: unknown = JSON.parse(JSON.stringify(signed));
    expect(
      verifyProjectionEvidence(transported, key.publicKey, zero).points[0]?.coordinate,
    ).toEqual([0, 30]);
  });
  it("requires a private, persistent Ed25519 key and refuses symlinks, weak permissions and wrong algorithms", () => {
    const dir = mkdtempSync(join(tmpdir(), "history-key-test-"));
    const key = generateKeyPairSync("ed25519");
    const file = join(dir, "key.pem");
    try {
      writeFileSync(file, key.privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
      expect(historyKeyId(loadHistorySigningKey(file))).toBe(historyKeyId(key.publicKey));
      expect(historyKeyId(loadHistorySigningKey(file))).toBe(historyKeyId(key.publicKey));
      symlinkSync(file, join(dir, "link.pem"));
      expect(() => loadHistorySigningKey(join(dir, "link.pem"))).toThrow();
      chmodSync(file, 0o644);
      expect(() => loadHistorySigningKey(file)).toThrow(
        "HISTORY_SIGNING_KEY_PRIVATE_FILE_REQUIRED",
      );
      chmodSync(file, 0o600);
      writeFileSync(
        file,
        generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({
          format: "pem",
          type: "pkcs8",
        }),
      );
      expect(() => loadHistorySigningKey(file)).toThrow("HISTORY_ED25519_KEY_REQUIRED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("keeps every legacy coordinate reception time unknown and binds a signed sidecar to the exact Artifact", () => {
    const key = generateKeyPairSync("ed25519");
    const evidence = buildProjectionEvidence(artifact);
    expect(evidence.points.every((point) => point.reception === null)).toBe(true);
    expect(
      evidence.points.every(
        (point) => point.receptionTimeQuality === "UNKNOWN_LEGACY_OR_UNJOURNALED",
      ),
    ).toBe(true);
    const signed = signProjectionEvidence(evidence, key.privateKey);
    expect(verifyProjectionEvidence(signed, key.publicKey, artifact)).toEqual(evidence);
    expect(() =>
      verifyProjectionEvidence(signed, generateKeyPairSync("ed25519").publicKey, artifact),
    ).toThrow("SIGNATURE_INVALID");
    expect(() =>
      verifyProjectionEvidence(signed, key.publicKey, { ...artifact, revision: 2 }),
    ).toThrow("ARTIFACT_MISMATCH");
    expect(() =>
      verifyProjectionEvidence(
        signProjectionEvidence({ ...evidence, points: evidence.points.slice(1) }, key.privateKey),
        key.publicKey,
        artifact,
      ),
    ).toThrow("ARTIFACT_MISMATCH");
    const tampered = structuredClone(signed);
    const first = tampered.evidence.points[0];
    if (!first) throw Error("EXPECTED_LEGACY_POINT_MISSING");
    first.coordinate[0] = 115;
    expect(() => verifyProjectionEvidence(tampered, key.publicKey, artifact)).toThrow(
      "SIGNATURE_INVALID",
    );
  });
  it("never accepts a synthetic receipt ID to manufacture a coordinate timestamp", () => {
    expect(() =>
      buildProjectionEvidence(artifact, {
        artifactId: artifact.artifactId,
        revision: 1,
        missionId: "mission-a",
        sampleEveryMilliseconds: 1000,
        receptionId: "not-a-retained-receipt",
        sourceStreamId: null,
      }),
    ).toThrow("RECEIPT_NOT_FOUND");
  });
  it("keeps old configurations disabled and fails closed for partial opt-in configuration", () => {
    expect(loadUgvProviderConfig({}).UGV_TRAJECTORY_HISTORY_ENABLED).toBe(false);
    expect(() => loadUgvProviderConfig({ UGV_TRAJECTORY_HISTORY_ENABLED: "true" })).toThrow(
      "UGV_TRAJECTORY_HISTORY_REQUIRES_POSTGRES_AND_PERSISTENT_SIGNING_KEY",
    );
    expect(() =>
      loadUgvProviderConfig({
        UGV_TRAJECTORY_HISTORY_ENABLED: "true",
        UGV_ADAPTER_STORE_MODE: "postgres",
        UGV_ADAPTER_DATABASE_POOL_MAX: "1",
        UGV_TRAJECTORY_HISTORY_SIGNING_KEY_FILE: "/operator/key.pem",
      }),
    ).toThrow("UGV_TRAJECTORY_HISTORY_REQUIRES_POSTGRES_AND_PERSISTENT_SIGNING_KEY");
  });
});
