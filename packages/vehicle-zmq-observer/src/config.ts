import { createHash } from "node:crypto";
import { z } from "zod";
import { DeploymentProfile } from "../../vehicle-zmq-contract/src/index.js";

export const COMPONENTS = ["chassis", "eo", "simulationEffect"] as const;
export type Component = (typeof COMPONENTS)[number];
export const ObserverSettings = z
  .object({
    schemaVersion: z.literal("ugv.zmq-observer-settings/1"),
    diagnosticPartition: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/),
    schema: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,62}$/)
      .default("ugv_zmq_observation"),
    host: z.string().min(1).max(253).default("127.0.0.1"),
    port: z.number().int().min(0).max(65535).default(19102),
    maxPendingRecords: z.number().int().min(1).max(65536).default(4096),
    maxPendingBytes: z.number().int().min(1024).max(268435456).default(16777216),
    maxBatchRecords: z.number().int().min(1).max(1024).default(128),
    maxBatchBytes: z.number().int().min(1024).max(16777216).default(1048576),
    flushIntervalMs: z.number().int().min(1).max(1000).default(25),
    receiveHighWaterMark: z.number().int().min(1).max(65536).default(2048),
    maxArchivePayloadBytes: z
      .number()
      .int()
      .min(1024)
      .max(1_000_000_000_000)
      .default(1_073_741_824),
    stateFreshForMs: z.number().int().min(100).max(60000).default(5000),
    positionFreshForMs: z.number().int().min(100).max(60000).default(2000),
    maxSourceClockSkewMs: z.number().int().min(0).max(60000).default(5000),
    databaseTimeoutMs: z.number().int().min(100).max(30000).default(2000),
    shutdownTimeoutMs: z.number().int().min(100).max(60000).default(10000),
  })
  .strict();
export type ObserverSettings = z.infer<typeof ObserverSettings>;
export const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Canonical local archive representation; never a replacement for the original wire bytes. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(",")}}`;
  }
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint" ||
    (typeof value === "number" && !Number.isFinite(value))
  )
    throw Error("ZMQ_ARCHIVE_NON_JSON_VALUE");
  return JSON.stringify(value);
}

export function observerIdentity(
  profileInput: unknown,
  partition: string,
  profileSha256: string,
  contractSha256: string,
) {
  const profile = DeploymentProfile.parse(profileInput);
  const digest = z.string().regex(/^[a-f0-9]{64}$/);
  digest.parse(profileSha256);
  digest.parse(contractSha256);
  const identity = {
    schemaVersion: "ugv.zmq-observation-scope/2.0" as const,
    diagnosticPartition: ObserverSettings.shape.diagnosticPartition.parse(partition),
    profileSha256,
    contractSha256,
    executionDomain: profile.executionDomain,
    providerBinding: profile.providerBinding,
    deploymentBinding: "unqualified_diagnostic" as const,
    sourceProducerEpoch: null,
    components: profile.components,
  };
  return { identity, partitionHash: sha256(canonical(identity)) };
}
export type ObserverIdentity = ReturnType<typeof observerIdentity>;
