import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  assessDeployment,
  DeploymentProfile,
  G0_EVIDENCE,
  inspectCapture,
} from "../../packages/vehicle-zmq-contract/src/index.js";
import { assertUgvTaskBusinessSettingsSupported } from "../../apps/ugv-provider-adapter/src/task-business-bootstrap.js";
import { UgvTaskBusinessSettingsSchema } from "../../packages/runtime-configuration-contract/src/providers/ugv-business.js";
import { checkContracts } from "../../scripts/ugv-zmq/check-contracts.js";

const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8")) as unknown;
const profile = () => DeploymentProfile.parse(read("deploy/ugv-zmq/deployment.candidate.json"));
const gaps = () => read("contracts/ugv-zmq/v1/known-gaps.json");
const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
const temp = () => {
  const path = mkdtempSync(resolve(tmpdir(), "ugv-zmq-contract-"));
  temporary.push(path);
  return path;
};

describe("ZMQ deployment contract and G0", () => {
  it("keeps the observed candidate pending and never grants runtime admission", () => {
    const report = assessDeployment(profile(), gaps(), () => false);
    expect(report.g0Ready).toBe(false);
    expect(report.missing).toContain("SIMULATION_ID_UNCONFIRMED");
    expect(report.missing).toContain("CONTROLLER_SYSTEM_ID_UNCONFIRMED");
    expect(report.decisions.find((d) => d.operation === "navigation.point")?.blockers).toContain(
      "CHASSIS_FEEDBACK_UNCORRELATED",
    );
    expect(report.decisions.find((d) => d.operation === "inspection.complete")?.blockers).toContain(
      "INSPECTION_SOURCE_STREAM_NOT_RECOVERABLE",
    );
    expect(report.runtimeAdmission).toBe("not_published");
  });
  it("separates a complete static read-only candidate from runtime publication", () => {
    const p = profile();
    p.executionDomain.simulationId = "test-scene";
    p.providerBinding = {
      providerId: "test-provider",
      resourceId: "vehicle:test",
      sourceSessionKey: "test-session",
    };
    p.components.chassis.controllerSystemId = "2";
    p.planner = { policy: "disable", endpoint: null };
    p.intendedOperations = ["state.read"];
    for (const key of G0_EVIDENCE)
      p.evidence[key] = { path: "test-attestation", sha256: "0".repeat(64) };
    expect(assessDeployment(p, gaps(), () => true)).toMatchObject({
      g0Ready: true,
      runtimeAdmission: "not_published",
    });
    expect(assessDeployment(p, gaps(), () => false).g0Ready).toBe(false);
    p.intendedOperations = ["navigation.point"];
    expect(assessDeployment(p, gaps(), () => true).g0Ready).toBe(false);
  });
  it("rejects unapproved versions, live-domain substitution and forged admission fields", () => {
    const p = profile();
    expect(() => DeploymentProfile.parse({ ...p, runtimeAdmission: "available" })).toThrow();
    expect(() => DeploymentProfile.parse({ ...p, status: "approved" })).toThrow();
    expect(() =>
      DeploymentProfile.parse({ ...p, executionDomain: { mode: "live", simulationId: null } }),
    ).toThrow();
    expect(() =>
      DeploymentProfile.parse({
        ...p,
        components: { ...p.components, eo: { ...p.components.eo, protocolVersion: "2.3" } },
      }),
    ).toThrow();
  });
  it.each([
    "tcp://*:5555",
    "http://192.168.2.63:5555",
    "tcp://user:password@192.168.2.63:5555",
    "tcp://192.168.2.63:5555/path",
  ])("rejects invalid endpoint %s", (endpoint) => {
    const p = profile();
    p.components.eo.commandEndpoint = endpoint;
    expect(() => DeploymentProfile.parse(p)).toThrow();
  });
  it("rejects endpoint collisions, ambiguous controller identity and unsupported invented methods", () => {
    const p = profile();
    p.components.eo.commandEndpoint = p.components.chassis.commandEndpoint;
    expect(() => DeploymentProfile.parse(p)).toThrow("ENDPOINTS_COLLIDE");
    const q = profile();
    q.components.chassis.controllerSystemId = q.components.chassis.systemId;
    expect(() => DeploymentProfile.parse(q)).toThrow("CONTROLLER_EQUALS_VEHICLE");
    expect(() =>
      DeploymentProfile.parse({ ...profile(), intendedOperations: ["navigation.distance"] }),
    ).toThrow();
  });
  it("provides a business profile accepted without the legacy planner/visual lock", () => {
    const settings = UgvTaskBusinessSettingsSchema.parse(
      read("deploy/ugv-zmq/task-business.candidate.json"),
    );
    expect(() => assertUgvTaskBusinessSettingsSupported(settings, false)).not.toThrow();
    expect(settings).toMatchObject({
      visualLockOwner: "disabled",
      decisionMode: "none",
      footprint: { mode: "disabled" },
      adjustments: { navigation: false },
    });
  });
});

describe("immutable source lock and passive evidence", () => {
  it("verifies exact protocol snapshots and executable contract inputs", () => {
    expect(checkContracts()).toMatchObject({ status: "verified", sourceDocuments: 3 });
  });
  it("detects document drift using a copied repository, without editing the original", () => {
    const root = temp(),
      contract = resolve(root, "contracts/ugv-zmq/v1");
    mkdirSync(dirname(contract), { recursive: true });
    cpSync("contracts/ugv-zmq/v1", contract, { recursive: true });
    const lock = z
      .object({ files: z.array(z.object({ path: z.string() })) })
      .parse(read("contracts/ugv-zmq/v1/contract-lock.json"));
    for (const file of lock.files) {
      const target = resolve(root, file.path);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(file.path, target);
    }
    expect(checkContracts(contract).status).toBe("verified");
    writeFileSync(resolve(contract, "sources/chassis-v2.0.md"), "drift");
    expect(() => checkContracts(contract)).toThrow("CONTRACT_DRIFT");
  });
  it("validates actual passive bytes while retaining their observation-only authority", () => {
    const result = inspectCapture(
      read("reports/ugv-zmq-phase1/raw/passive-publications-20261023.json"),
      profile(),
    );
    expect(result.allComponentsObserved).toBe(true);
    expect(result.businessCommandsSent).toBe(0);
    expect(result.records.every((r) => r.invalidSamples === 0)).toBe(true);
    expect(result.records.map((r) => r.validSamples)).toEqual([10, 4, 4]);
  });
  it("rejects tampered raw bytes and a foreign publication endpoint", () => {
    const input = read("reports/ugv-zmq-phase1/raw/passive-publications-20261023.json");
    const schema = z
      .object({
        records: z.array(
          z
            .object({
              samples: z.array(
                z.object({ frames: z.array(z.object({ sha256: z.string() }).loose()) }).loose(),
              ),
            })
            .loose(),
        ),
      })
      .loose();
    const tampered = schema.parse(input);
    const frame = tampered.records[0]?.samples[0]?.frames[0];
    if (!frame) throw Error("FIXTURE_MISSING");
    frame.sha256 = "0".repeat(64);
    expect(() => inspectCapture(tampered, profile())).toThrow("FRAME_HASH_INVALID");
    const p = profile();
    p.components.eo.publicationEndpoint = "tcp://192.168.2.64:5556";
    expect(() => inspectCapture(input, p)).toThrow("ENDPOINT_MISMATCH");
  });
  it("returns exit 2 and a usable report for a pending G0 candidate", () => {
    const output = resolve(temp(), "report.json");
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/ugv-zmq/preflight.ts", "--report", output],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(2);
    expect(read(output)).toMatchObject({ g0Ready: false, runtimeAdmission: "not_published" });
  });
});
