import { describe, expect, it } from "vitest";
import type {
  RegistryProviderProjection,
  RegistrySnapshot,
} from "../../../packages/registry-snapshot/src/index.js";
import {
  SdarRegistryProjectionError,
  hashSdarRegistryProjection,
  projectSdarRegistrySnapshot,
  safeSdarRegistryProjectionUrl,
  type SdarRegistryProjectionProvider,
} from "../src/sdar-registry-projection.js";

describe("SDAR Registry consumer projection mapping", () => {
  it("maps the native LKG to the strict DTO without mutating native authority", () => {
    const native = snapshot([
      provider("ha-light-lab", "ha-light-server", "http://127.0.0.1:18082/mcp/", 7),
      provider(
        "ha-climate-lab",
        "ha-climate-server",
        "https://runtime.example/climate/#catalog",
        3,
      ),
    ]);
    const before = JSON.stringify(native);

    const projection = projectSdarRegistrySnapshot(native, "home-lab-smpp", 86_400);

    expect(Object.keys(projection).sort()).toEqual([
      "checksum",
      "expiresAt",
      "generatedAt",
      "providers",
      "revision",
    ]);
    expect(projection).toMatchObject({
      revision: 4,
      generatedAt: "2026-08-04T00:00:00.000Z",
      expiresAt: "2026-08-05T00:00:00.000Z",
    });
    expect(projection.providers.map((item) => item.externalProviderId)).toEqual([
      "ha-climate-lab",
      "ha-light-lab",
    ]);
    expect(projection.providers[0]).toEqual({
      externalProviderId: "ha-climate-lab",
      externalServerId: "ha-climate-server",
      serverEndpoint: "https://runtime.example/climate",
      catalogRevision: "3",
      labels: { environment: "home-lab", protocolMode: "frozen_v1" },
    });
    for (const candidate of projection.providers) {
      expect(Object.keys(candidate).sort()).toEqual([
        "catalogRevision",
        "externalProviderId",
        "externalServerId",
        "labels",
        "serverEndpoint",
      ]);
      expect(Object.keys(candidate.labels).sort()).toEqual(["environment", "protocolMode"]);
    }
    expect(JSON.stringify(projection)).not.toMatch(
      /tools|displayName|entity_id|device-secret|taskBehavior|taskId/u,
    );
    expect(JSON.stringify(native)).toBe(before);
  });

  it("is deterministic and binds checksum to source, revision, and fixed TTL", () => {
    const native = snapshot([]);
    const baseline = projectSdarRegistrySnapshot(native, "home-lab-smpp", 86_400);

    expect(projectSdarRegistrySnapshot(native, "home-lab-smpp", 86_400)).toEqual(baseline);
    expect(projectSdarRegistrySnapshot(native, "other-smpp", 86_400).checksum).not.toBe(
      baseline.checksum,
    );
    expect(
      projectSdarRegistrySnapshot({ ...native, revision: 5 }, "home-lab-smpp", 86_400).checksum,
    ).not.toBe(baseline.checksum);
    expect(projectSdarRegistrySnapshot(native, "home-lab-smpp", 3_600).checksum).not.toBe(
      baseline.checksum,
    );
  });

  it("uses SDAR-compatible URL normalization and rejects unsafe endpoints", () => {
    expect(safeSdarRegistryProjectionUrl("https://runtime.example/mcp/#ignored")).toBe(
      "https://runtime.example/mcp",
    );
    expect(safeSdarRegistryProjectionUrl("https://runtime.example/mcp?mode=read#ignored")).toBe(
      "https://runtime.example/mcp?mode=read",
    );
    for (const endpoint of [
      "ftp://runtime.example/mcp",
      "https://device-user:device-secret@runtime.example/mcp",
      "/relative/mcp",
    ]) {
      expect(capture(() => safeSdarRegistryProjectionUrl(endpoint))).toMatchObject({
        code: "SDAR_REGISTRY_PROJECTION_ENDPOINT_INVALID",
      });
    }
  });

  it("fails closed on invalid source, TTL, duplicate identity, and native revision", () => {
    const native = snapshot([]);
    expect(capture(() => projectSdarRegistrySnapshot(native, "bad source", 60))).toMatchObject({
      code: "SDAR_REGISTRY_PROJECTION_SOURCE_ID_INVALID",
    });
    expect(capture(() => projectSdarRegistrySnapshot(native, "home-lab-smpp", 0))).toMatchObject({
      code: "SDAR_REGISTRY_PROJECTION_TTL_INVALID",
    });
    expect(
      capture(() => projectSdarRegistrySnapshot({ ...native, revision: 0 }, "home-lab-smpp")),
    ).toMatchObject({ code: "SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID" });

    const candidate = {
      externalProviderId: "provider-a",
      externalServerId: "server-a",
      serverEndpoint: "https://runtime.example/mcp",
      catalogRevision: "1",
      labels: { environment: "home-lab", protocolMode: "frozen_v1" as const },
    };
    expect(
      capture(() =>
        hashSdarRegistryProjection({
          smppSourceId: "home-lab-smpp",
          revision: 1,
          generatedAt: "2026-08-04T00:00:00.000Z",
          expiresAt: "2026-09-03T00:00:00.000Z",
          candidates: [candidate, candidate],
        }),
      ),
    ).toMatchObject({ code: "SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID" });

    for (const invalid of [
      { ...candidate, displayName: "must-not-enter-v1" },
      { ...candidate, catalogRevision: "7beta" },
    ] as unknown as readonly SdarRegistryProjectionProvider[]) {
      expect(
        capture(() =>
          hashSdarRegistryProjection({
            smppSourceId: "home-lab-smpp",
            revision: 1,
            generatedAt: "2026-08-04T00:00:00.000Z",
            expiresAt: "2026-09-03T00:00:00.000Z",
            candidates: [invalid],
          }),
        ),
      ).toMatchObject({ code: "SDAR_REGISTRY_PROJECTION_NATIVE_SNAPSHOT_INVALID" });
    }
  });
});

export function snapshot(
  providers: readonly RegistryProviderProjection[],
  overrides: Partial<RegistrySnapshot> = {},
): RegistrySnapshot {
  return {
    environment: "home-lab",
    revision: 4,
    checksum: "a".repeat(64),
    document: { environment: "home-lab", providers },
    publishedAt: new Date("2026-08-04T00:00:00.000Z"),
    createdAt: new Date("2026-08-04T00:00:01.000Z"),
    ...overrides,
  };
}

export function provider(
  providerId: string,
  serverId: string,
  effectiveEndpoint: string,
  catalogRevision: number,
): RegistryProviderProjection {
  return {
    providerId,
    serverId,
    protocolMode: "frozen_v1",
    effectiveEndpoint,
    catalogRevision,
    tools: [
      {
        name: "operate_entity_id",
        description: "entity_id and device-secret must remain native-only",
        inputSchema: { type: "object", properties: { entity_id: { type: "string" } } },
        outputSchema: { type: "object" },
        taskExecution: {
          profileVersion: "1.0",
          taskBehavior: "task_required",
          availability: "dynamic",
          supportsScheduling: true,
          supportsMaxElapsed: true,
          supportsObservations: true,
          supportsInputRequired: true,
          idempotency: "server_managed",
        },
      },
    ],
  };
}

function capture(action: () => unknown): unknown {
  try {
    action();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(SdarRegistryProjectionError);
    return error;
  }
}
