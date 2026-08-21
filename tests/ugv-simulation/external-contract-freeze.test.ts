import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildExternalContractReports,
  freezeExternalContracts,
} from "../../scripts/ugv-agent-profile-simulation/freeze-contracts.mjs";

const sourcePath = "reports/ugv-agent-profile-simulation/external-preflight.redacted.json";

function sourceEvidence(): Record<string, unknown> {
  return JSON.parse(readFileSync(sourcePath, "utf8")) as Record<string, unknown>;
}

describe("UAP-P0-B02 external contract freeze", () => {
  it("freezes only the three Goal tools with full input/output schema and stable hashes", () => {
    const first = buildExternalContractReports(sourceEvidence());
    const second = buildExternalContractReports(sourceEvidence());
    expect(second).toEqual(first);
    expect(first.device).toMatchObject({
      schemaVersion: "ugv-agent-profile.device-mcp-contract/v1",
      status: "FROZEN",
      evidenceClass: "external_simulation",
      productionEligible: false,
      physicalVehicleQualified: false,
      contract: {
        deviceProtocol: { negotiatedProtocolVersion: "2025-11-25" },
        scope: {
          requiredToolNames: ["get_status", "ugv_path_follow_mission", "ugv_mission_control"],
          nonGoalToolSchemasFrozen: false,
        },
        mockContractDecision: { resolvedValue: false, goalPolicy: "forbidden" },
        safety: {
          toolsCallCount: 0,
          mqttPublishCount: 0,
          controlInvocationCount: 0,
        },
      },
    });
    const tools = first.device.contract.tools;
    expect(tools).toHaveLength(3);
    expect(tools.map(({ name }) => name)).toEqual([
      "get_status",
      "ugv_path_follow_mission",
      "ugv_mission_control",
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema).toBeTypeOf("object");
      expect(tool).toHaveProperty("outputSchema", null);
      expect(tool.schemaCanonicalHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(tool.toolCanonicalHash).toMatch(/^[0-9a-f]{64}$/u);
    }
    expect(first.device.contractCanonicalHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("freezes 18 exact topics, explicit wire/time semantics, and resolved safety thresholds", () => {
    const { mqtt } = buildExternalContractReports(sourceEvidence());
    expect(mqtt).toMatchObject({
      schemaVersion: "ugv-agent-profile.mqtt-contract/v1",
      status: "FROZEN",
      evidenceClass: "external_simulation",
      productionEligible: false,
      physicalVehicleQualified: false,
      contract: {
        scope: { exactTopicCount: 18, wildcardSubscriptionsAllowed: false },
        wire: { mode: "ros_bridge_json", automaticDetectionAllowed: false },
        thresholds: {
          freshnessMs: {
            chassis: 3000,
            mission: 3000,
            health: 5000,
            target: 3000,
            payload: 3000,
          },
          maximumFutureSkewMs: 1000,
          stationary: { speedThresholdKmh: 0.1, stabilityMs: 500, minimumSamples: 2 },
        },
        mockContractDecision: { resolvedValue: false, goalPolicy: "forbidden" },
        safety: {
          toolsCallCount: 0,
          mqttPublishCount: 0,
          controlInvocationCount: 0,
          passiveSubscribeOnly: true,
        },
      },
    });
    const subscriptions = mqtt.contract.subscriptions;
    expect(subscriptions).toHaveLength(18);
    expect(new Set(subscriptions.map(({ topic }) => topic)).size).toBe(18);
    expect(subscriptions.every(({ topic }) => !topic.includes("#") && !topic.includes("+"))).toBe(
      true,
    );
    expect(mqtt.contractCanonicalHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("refuses missing Goal tools and refuses to overwrite frozen drift", async () => {
    const missing = structuredClone(sourceEvidence());
    const device = missing.deviceMcp as {
      tools: Record<string, unknown>[];
      toolCount: number;
    };
    device.tools = device.tools.filter(({ name }) => name !== "get_status");
    device.toolCount = device.tools.length;
    expect(() => buildExternalContractReports(missing)).toThrow(
      "UGV_DEVICE_MCP_DISCOVERY_HASH_DRIFT",
    );

    const directory = join(tmpdir(), `ugv-contract-freeze-${process.pid}-${Date.now()}`);
    rmSync(directory, { recursive: true, force: true });
    const first = await freezeExternalContracts({
      inputPath: sourcePath,
      outputDirectory: directory,
      mode: "write",
    });
    await expect(
      freezeExternalContracts({ inputPath: sourcePath, outputDirectory: directory, mode: "check" }),
    ).resolves.toBeDefined();
    writeFileSync(first.paths.device, `${readFileSync(first.paths.device, "utf8")} `, "utf8");
    await expect(
      freezeExternalContracts({ inputPath: sourcePath, outputDirectory: directory, mode: "write" }),
    ).rejects.toThrow("UGV_EXTERNAL_DEVICE_CONTRACT_ARTIFACT_DRIFT");
    rmSync(directory, { recursive: true, force: true });
  });
});
