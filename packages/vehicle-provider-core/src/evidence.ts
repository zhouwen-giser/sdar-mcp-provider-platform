import { createHash } from "node:crypto";
import type { ProviderEvidence } from "../../provider-adapter-kit/src/index.js";

const ALLOWED = new Set([
  "vehicle.state.observation",
  "vehicle.position.observation",
  "vehicle.health.observation",
  "vehicle.mission.state",
  "vehicle.payload.status",
  "vehicle.target.observation",
  "vehicle.target.lock",
  "vehicle.weapon.local_result",
]);

export function vehicleEvidence(
  type: string,
  observedAt: string,
  jsonPointer: string,
  subjectRef = "resource:vehicle:ugv1",
  producer: string[] = ["isr.vehicle.ugv.ugv1", "ugv-adapter"],
): ProviderEvidence {
  if (!ALLOWED.has(type)) throw new Error("UGV_EVIDENCE_TYPE_FORBIDDEN");
  if (!jsonPointer.startsWith("/")) throw new Error("UGV_EVIDENCE_POINTER_INVALID");
  return {
    evidenceId: createHash("sha256")
      .update(`${type}\0${observedAt}\0${jsonPointer}`)
      .digest("base64url"),
    evidenceType: type,
    observedAt,
    subjectRef,
    payloadRef: { kind: "structured_content", jsonPointer },
    producer,
  };
}
