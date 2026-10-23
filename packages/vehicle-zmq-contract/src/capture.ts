import { createHash } from "node:crypto";
import { z } from "zod";
import { decodeChassisFrame } from "./chassis.js";
import { requireContract } from "./error.js";
import { parsePublication } from "./wire.js";
import { DeploymentProfile } from "./profile.js";

const frame = z
  .object({
    bytes: z.number().int().min(1).max(70_000),
    base64: z.string().max(94_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const PassiveCapture = z
  .object({
    schemaVersion: z.literal("ugv.zmq-passive-capture/1"),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    durationMs: z.number().int().min(1).max(60_000),
    businessCommandsSent: z.literal(0),
    method: z.string().max(1024),
    bindingVersion: z.string().max(128),
    libzmqVersion: z.string().max(128),
    records: z
      .array(
        z
          .object({
            component: z.enum(["chassis", "eo", "simulationEffect"]),
            endpoint: z.url(),
            prefix: z.string().max(128),
            endpointConfirmation: z.literal("candidate-not-operator-confirmed"),
            counts: z.record(z.string(), z.number().int().nonnegative()),
            samples: z
              .array(
                z
                  .object({ receivedAt: z.iso.datetime(), frames: z.array(frame).min(1).max(2) })
                  .strict(),
              )
              .max(32),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict()
  .refine(
    (c) => new Set(c.records.map((r) => r.component)).size === c.records.length,
    "ZMQ_CAPTURE_DUPLICATE_COMPONENT",
  );

/** Offline validation: captured data is evidence, never an executable input. */
export function inspectCapture(input: unknown, profileInput: unknown) {
  const capture = PassiveCapture.parse(input),
    profile = DeploymentProfile.parse(profileInput);
  return {
    schemaVersion: "ugv.zmq-capture-report/1",
    startedAt: capture.startedAt,
    finishedAt: capture.finishedAt,
    businessCommandsSent: capture.businessCommandsSent,
    allComponentsObserved:
      capture.records.length === 3 && capture.records.every((r) => r.samples.length > 0),
    records: capture.records.map((record) => {
      const config = profile.components[record.component];
      requireContract(
        record.endpoint === config.publicationEndpoint,
        "ZMQ_CAPTURE_ENDPOINT_MISMATCH",
      );
      const results = record.samples.map((sample) => {
        const frames = sample.frames.map((f) => {
          const bytes = Buffer.from(f.base64, "base64");
          requireContract(
            bytes.toString("base64") === f.base64 &&
              bytes.length === f.bytes &&
              createHash("sha256").update(bytes).digest("hex") === f.sha256,
            "ZMQ_CAPTURE_FRAME_HASH_INVALID",
          );
          return bytes;
        });
        try {
          if (record.component === "chassis") {
            requireContract(frames.length === 1 && frames[0], "ZMQ_CHASSIS_MULTIPART_INVALID");
            const parsed = decodeChassisFrame(
              frames[0],
              profile.components.chassis.systemId === null
                ? {}
                : { systemId: profile.components.chassis.systemId },
            );
            return {
              valid: true,
              receivedAt: sample.receivedAt,
              systemId: parsed.systemId,
              targetSystemId: parsed.targetSystemId,
              messageId: parsed.messageId,
              messageType: parsed.body.type,
              versionEvidence: "selected_contract_not_in_band",
            };
          }
          const parsed = parsePublication(
            record.component,
            frames,
            record.component === "eo"
              ? profile.components.eo.deviceId
              : profile.components.simulationEffect.deviceId,
          );
          return {
            valid: true,
            receivedAt: sample.receivedAt,
            deviceId: parsed.device_id,
            topic: parsed.topic,
            protocol: parsed.protocol,
            versionEvidence: "in_band",
          };
        } catch (error) {
          return {
            valid: false,
            receivedAt: sample.receivedAt,
            code: error instanceof Error ? error.message : "ZMQ_CAPTURE_VALIDATION_FAILED",
          };
        }
      });
      return {
        component: record.component,
        endpoint: record.endpoint,
        counts: record.counts,
        samples: results,
        validSamples: results.filter((r) => r.valid).length,
        invalidSamples: results.filter((r) => !r.valid).length,
        evidenceClass: "passive_observation_not_control_qualification",
      };
    }),
  };
}
