import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readSecureTextFile, run } from "../../scripts/npc-tank-simulation/pms-onboarding.js";

const root = resolve(process.cwd());
const script = resolve(root, "scripts/npc-tank-simulation/pms-onboarding.ts");

describe("Goal 11 NPC Tank PMS onboarding script", () => {
  it("renders the complete formal authority chain without credentials or external calls", () => {
    let stdout = "";
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    return run(["--dry-run"]).then((status) => {
      write.mockRestore();
      expect(status).toBe(0);
      const evidence = JSON.parse(stdout) as {
        readonly status: string;
        readonly evidenceClass: string;
        readonly simulatorCalls: number;
        readonly formalChain: readonly string[];
        readonly identifiers: { readonly packageRealResourceStatus: string };
        readonly authorityPolicy: Record<string, boolean>;
        readonly credentialRequirements: {
          readonly apiRuntimeDescriptor: {
            readonly requiredConfigScopes: readonly string[];
            readonly requiredRegistrationScopes: readonly string[];
          };
        };
      };
      expect(evidence).toMatchObject({
        status: "passed",
        evidenceClass: "dry_run",
        simulatorCalls: 0,
        identifiers: { packageRealResourceStatus: "pending" },
        authorityPolicy: {
          directProviderTableWrite: false,
          directResourceTableWrite: false,
          directDeploymentTableWrite: false,
          directRegistryTableWrite: false,
          registryEndpointRequiredForRuntimeEvidence: true,
        },
      });
      expect(evidence.formalChain).toEqual([
        "PMS application Provider Package projection",
        "PMS API Provider Type",
        "PMS API Provider",
        "PMS API Resource",
        "PMS API Binding",
        "PMS API Configuration",
        "PMS repository/PostgresProvisioner Database Profile",
        "PMS API RuntimeDeployment",
        "PMS Worker reconcile",
        "Runtime ready",
        "Catalog publication",
        "Registry publication",
        "Registry-backed read-only Runtime calls",
      ]);
      expect(evidence.credentialRequirements.apiRuntimeDescriptor.requiredConfigScopes).toEqual([
        "runtime:config:read",
        "runtime:config:watch",
        "runtime:config:ack",
      ]);
      expect(
        evidence.credentialRequirements.apiRuntimeDescriptor.requiredRegistrationScopes,
      ).toEqual(["runtime:register", "runtime:heartbeat"]);
    });
  });

  it("contains no direct authority-table mutation or simulator-control surface", () => {
    const source = readFileSync(script, "utf8");
    expect(source).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:provider|resource|runtime_deployment|registry(?:_snapshot)?)/i,
    );
    expect(source).not.toContain("NPC_TANK_SIM_DEVICE_MCP_URL");
    expect(source).not.toContain("NPC_TANK_SIM_MQTT_URL");
    expect(source).not.toContain("vehicle_move");
    expect(source).not.toContain("vehicle_recon");
    expect(source).not.toContain("vehicle_fire");
  });

  it("rejects ambiguous management-token sources before live onboarding", async () => {
    await expect(
      run([
        "--dry-run",
        "--management-token-stdin",
        "--management-token-file",
        "/run/secrets/token",
      ]),
    ).rejects.toThrow("NPC_PMS_MANAGEMENT_TOKEN_SOURCE_CONFLICT");
  });

  it("accepts a regular Unix credential file whose permission bits are exactly 0600", async () => {
    const directory = await mkdtemp(join(tmpdir(), "npc-pms-credential-mode-"));
    const token = join(directory, "management.token");
    try {
      await writeFile(token, "bounded-token\n", { mode: 0o600 });
      await expect(readSecureTextFile(token, "TOKEN_INVALID")).resolves.toBe("bounded-token");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
