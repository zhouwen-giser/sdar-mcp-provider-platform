import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  RUNTIME_DEPLOYMENT_STATUSES,
  createRuntimeProcessProjection,
  requestRuntimeDeployment,
  runtimeConfigProfileId,
  runtimeDeploymentId,
  runtimeEnvironmentId,
  runtimeInstanceId,
  runtimeProviderId,
  databaseProfileId,
} from "../../packages/runtime-deployment/src/index.js";

const schema = JSON.parse(
  readFileSync(new URL("../../schemas/runtime-deployment-v1.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  formats: { "date-time": true },
});
ajv.addSchema(schema);
const validateDeployment = ajv.getSchema("https://sdar.local/schemas/runtime-deployment-v1.json");
const validateProcess = ajv.compile({
  $ref: "https://sdar.local/schemas/runtime-deployment-v1.json#/$defs/runtimeProcess",
});

describe("RuntimeDeployment JSON Schema contract", () => {
  it("accepts domain deployment snapshots and carries the exact status vocabulary", () => {
    const snapshot = requestRuntimeDeployment(
      {
        deploymentId: runtimeDeploymentId("deployment-1"),
        providerId: runtimeProviderId("provider-1"),
        environment: runtimeEnvironmentId("production"),
        desiredState: "running",
        desiredReplicas: 1,
        runtimeVersion: "0.1.0",
        databaseProfileId: databaseProfileId("database-1"),
        configProfileId: runtimeConfigProfileId("config-1"),
      },
      new Date("2026-07-26T00:00:00.000Z"),
    ).snapshot;

    expect(validateDeployment?.(snapshot), JSON.stringify(validateDeployment?.errors)).toBe(true);
    expect(
      (
        (schema.$defs as Record<string, unknown>).runtimeDeployment as {
          properties: { status: { enum: readonly string[] } };
        }
      ).properties.status.enum,
    ).toEqual(RUNTIME_DEPLOYMENT_STATUSES);
  });

  it("rejects invalid replica/state pairs and unknown fields", () => {
    const invalid = {
      deploymentId: "deployment-1",
      providerId: "provider-1",
      environment: "production",
      desiredState: "running",
      desiredReplicas: 0,
      runtimeVersion: "0.1.0",
      databaseProfileId: "database-1",
      configProfileId: "config-1",
      status: "REQUESTED",
      desiredRevision: 0,
      observedRevision: 0,
      secret: "must-not-cross-contract",
    };

    expect(validateDeployment?.(invalid)).toBe(false);
  });

  it("validates the persisted RuntimeProcess projection shape", () => {
    const process = createRuntimeProcessProjection(
      {
        instanceId: runtimeInstanceId("instance-1"),
        deploymentId: runtimeDeploymentId("deployment-1"),
        pm2Name: "sdar-runtime-provider-1",
        port: 3101,
      },
      {
        pid: 1201,
        processState: "online",
        livenessState: "live",
        readinessState: "ready",
        registrationState: "registered",
        catalogState: "valid",
        configState: "current",
        lastHeartbeatAt: new Date("2026-07-26T00:00:00.000Z"),
        runtimeVersion: "0.1.0",
        configRevision: 3,
        restartCount: 0,
      },
    );
    const serialized = {
      ...process,
      lastHeartbeatAt: process.lastHeartbeatAt?.toISOString() ?? null,
    };

    expect(validateProcess(serialized), JSON.stringify(validateProcess.errors)).toBe(true);
  });
});
