import { sign, verify, type KeyObject } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { TaskArtifact } from "../../vehicle-provider-core/src/task-business-artifact.js";
import {
  ProjectionEvidenceSchema,
  SignedProjectionEvidenceSchema,
  type ProjectionEvidence,
  type ReceptionEntry,
  type ReceptionScope,
  type TrajectoryProjectionWrite,
} from "./contract.js";
import { historyCanonicalJson, historyKeyId, historySha256 } from "./proof.js";

export function trajectoryCoordinates(artifact: TaskArtifact): number[][] {
  if (
    artifact.artifactType !== "navigation.trajectory" ||
    artifact.availability !== "available" ||
    artifact.content.kind !== "geojson"
  )
    throw Error("TRAJECTORY_EVIDENCE_ARTIFACT_INVALID");
  const geometry = artifact.content.geometry;
  if (geometry.type !== "Point" && geometry.type !== "LineString")
    throw Error("TRAJECTORY_EVIDENCE_GEOMETRY_INVALID");
  const points = geometry.type === "Point" ? [geometry.coordinates] : geometry.coordinates;
  if (!points.length || points.length > 256)
    throw Error("TRAJECTORY_EVIDENCE_POINT_BOUND_EXCEEDED");
  return points;
}

export function buildProjectionEvidence(
  artifact: TaskArtifact,
  write?: TrajectoryProjectionWrite,
  previous?: ProjectionEvidence,
  linked?: { scope: ReceptionScope; entry: ReceptionEntry },
): ProjectionEvidence {
  const coordinates = trajectoryCoordinates(artifact);
  if (artifact.availability !== "available" || artifact.content.kind !== "geojson")
    throw Error("TRAJECTORY_EVIDENCE_ARTIFACT_INVALID");
  if (write && (write.artifactId !== artifact.artifactId || write.revision !== artifact.revision))
    throw Error("TRAJECTORY_EVIDENCE_ARTIFACT_VERSION_MISMATCH");
  if (
    previous &&
    (previous.artifactId !== artifact.artifactId ||
      previous.revision !== artifact.revision - 1 ||
      !isDeepStrictEqual(previous.identity, artifact.identity) ||
      previous.points.length !== coordinates.length - 1 ||
      previous.points.some(
        (point, index) =>
          historyCanonicalJson(point.coordinate) !== historyCanonicalJson(coordinates[index]),
      ))
  )
    throw Error("TRAJECTORY_EVIDENCE_PREDECESSOR_MISMATCH");
  if (write?.receptionId && linked?.entry.receipt.receptionId !== write.receptionId)
    throw Error("TRAJECTORY_EVIDENCE_RECEIPT_NOT_FOUND");
  if (linked) {
    const { scope, entry } = linked;
    const position = entry.receipt.position;
    const coordinate = position
      ? [
          position.longitude,
          position.latitude,
          ...(position.altitude === undefined ? [] : [position.altitude]),
        ]
      : null;
    if (
      scope.providerId !== artifact.identity.providerId ||
      scope.resourceId !== artifact.identity.resourceId ||
      entry.receipt.disposition !== "POSITION_OBSERVATION" ||
      entry.receipt.transport.retainedDelivery ||
      historyCanonicalJson(coordinate) !== historyCanonicalJson(coordinates.at(-1))
    )
      throw Error("TRAJECTORY_EVIDENCE_RECEIPT_SCOPE_OR_POSITION_MISMATCH");
  }
  return ProjectionEvidenceSchema.parse({
    schemaVersion: "ugv.trajectory-artifact-evidence/1.0",
    identity: artifact.identity,
    artifactId: artifact.artifactId,
    revision: artifact.revision,
    artifactGeometrySha256: historySha256(historyCanonicalJson(artifact.content.geometry)),
    projectionPolicy: "SAMPLED_GEOMETRY_NOT_FULL_RECEPTION_HISTORY",
    sampleEveryMilliseconds: write?.sampleEveryMilliseconds ?? null,
    missionBinding: {
      missionId: write?.missionId ?? null,
      authority: "PROVIDER_CURRENT_MISSION_AND_UNIQUE_ACTIVE_EXECUTION",
      deviceExecutionOwnership: "NOT_ATTESTED",
    },
    points: coordinates.map((coordinate, coordinateIndex) => {
      const old = previous?.points[coordinateIndex];
      if (old) return old;
      const reception =
        linked && coordinateIndex === coordinates.length - 1
          ? {
              scope: linked.scope,
              receptionId: linked.entry.receipt.receptionId,
              sequence: linked.entry.sequence,
              entryHash: linked.entry.hash,
              originalMessageSha256: linked.entry.receipt.originalMessageSha256,
              providerReceivedAt: linked.entry.receipt.providerReceivedAt,
              evidenceClass: linked.entry.receipt.evidenceClass,
            }
          : null;
      return {
        coordinateIndex,
        coordinate,
        reception,
        receptionTimeQuality: reception
          ? "ENTRANCE_RECEIPT_LINKED"
          : "UNKNOWN_LEGACY_OR_UNJOURNALED",
      };
    }),
    deviceGenerationHistory: "UNKNOWN_PRODUCER_BOUNDARIES_NOT_ATTESTED",
  });
}

export function signProjectionEvidence(evidence: ProjectionEvidence, key: KeyObject) {
  const parsed = ProjectionEvidenceSchema.parse(evidence);
  return SignedProjectionEvidenceSchema.parse({
    evidence: parsed,
    signature: {
      algorithm: "Ed25519",
      keyId: historyKeyId(key),
      value: sign(null, Buffer.from(historyCanonicalJson(parsed)), key).toString("base64url"),
    },
  });
}

/** The trusted key and exact Artifact version are independently supplied by the consumer. */
export function verifyProjectionEvidence(
  input: unknown,
  trustedPublicKey: KeyObject,
  artifact: TaskArtifact,
): ProjectionEvidence {
  const signed = SignedProjectionEvidenceSchema.parse(input);
  const signature = Buffer.from(signed.signature.value, "base64url");
  if (
    historyKeyId(trustedPublicKey) !== signed.signature.keyId ||
    signature.length !== 64 ||
    signature.toString("base64url") !== signed.signature.value ||
    !verify(null, Buffer.from(historyCanonicalJson(signed.evidence)), trustedPublicKey, signature)
  )
    throw Error("TRAJECTORY_EVIDENCE_SIGNATURE_INVALID");
  const expected = buildProjectionEvidence(artifact);
  const evidence = signed.evidence;
  if (
    !isDeepStrictEqual(expected.identity, evidence.identity) ||
    expected.artifactId !== evidence.artifactId ||
    expected.revision !== evidence.revision ||
    expected.artifactGeometrySha256 !== evidence.artifactGeometrySha256 ||
    evidence.points.length !== expected.points.length ||
    evidence.points.some(
      (point, index) =>
        point.coordinateIndex !== index ||
        historyCanonicalJson(point.coordinate) !==
          historyCanonicalJson(expected.points[index]?.coordinate) ||
        (point.reception === null) !==
          (point.receptionTimeQuality === "UNKNOWN_LEGACY_OR_UNJOURNALED"),
    )
  )
    throw Error("TRAJECTORY_EVIDENCE_ARTIFACT_MISMATCH");
  return evidence;
}
