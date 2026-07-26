import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildConfigurationArtifacts,
  checkConfigurationArtifactDrift,
  PLATFORM_CONFIGURATION_DEFINITIONS,
  writeConfigurationArtifacts,
} from "./index.js";

describe("configuration artifact generator", () => {
  it("generates deterministic schema, defaults, and UI metadata for every definition", async () => {
    const first = await buildConfigurationArtifacts();
    const second = await buildConfigurationArtifacts(
      [...PLATFORM_CONFIGURATION_DEFINITIONS].reverse(),
    );

    expect(first).toEqual(second);
    expect(first).toHaveLength(PLATFORM_CONFIGURATION_DEFINITIONS.length * 3);
    expect(new Set(first.map(({ fileName }) => fileName)).size).toBe(first.length);
  });

  it("marks every Secret schema property write-only and emits Apply Mode descriptions", async () => {
    const artifacts = await buildConfigurationArtifacts();
    for (const definition of PLATFORM_CONFIGURATION_DEFINITIONS) {
      const schema = JSON.parse(
        artifacts.find(
          ({ definitionId, kind }) => definitionId === definition.definitionId && kind === "schema",
        )?.content ?? "null",
      ) as { properties: Record<string, Record<string, unknown>> };
      const ui = JSON.parse(
        artifacts.find(
          ({ definitionId, kind }) => definitionId === definition.definitionId && kind === "ui",
        )?.content ?? "null",
      ) as {
        fields: {
          path: string;
          description: string;
          applyMode: string;
          secretRef: boolean;
        }[];
      };
      for (const path of definition.secretPaths) {
        expect(schema.properties[path.slice(1)]).toMatchObject({
          writeOnly: true,
          "x-sdar-secretRef": true,
        });
        expect(schema.properties[path.slice(1)]).not.toHaveProperty("default");
      }
      for (const field of ui.fields) {
        expect(field.description.length).toBeGreaterThan(0);
        expect(["hot_reload", "reconnect_required", "restart_required", "immutable"]).toContain(
          field.applyMode,
        );
        expect(field.secretRef).toBe(definition.secretPaths.includes(field.path));
      }
    }
  });

  it("detects byte-level generated artifact drift", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sdar-config-schema-"));
    try {
      const artifacts = await writeConfigurationArtifacts(directory);
      expect(await checkConfigurationArtifactDrift(directory)).toEqual([]);

      const changed = artifacts[0];
      if (changed === undefined) throw new Error("Expected generated configuration artifacts");
      writeFileSync(join(directory, changed.fileName), "{}\n");
      expect(await checkConfigurationArtifactDrift(directory)).toContain(
        `changed:${changed.fileName}`,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
