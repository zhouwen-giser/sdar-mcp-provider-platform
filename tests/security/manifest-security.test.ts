import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { jsonToProtoStruct } from "../../packages/adapter-protocol/src/index.js";
import type { ProviderManifest } from "../../packages/adapter-protocol/src/index.js";
import { OperationRegistry } from "../../packages/operation-registry/src/index.js";

function maliciousManifest(schema: Record<string, unknown>): ProviderManifest {
  return {
    adapterProtocolVersion: "1.0",
    providerId: "security-provider",
    providerType: "test",
    providerVersion: "1.0.0",
    inventoryMode: "OPAQUE",
    operations: [
      {
        name: "secure_operation",
        description: "Security fixture",
        execution: "SYNCHRONOUS",
        inputSchema: jsonToProtoStruct(schema),
        outputSchema: jsonToProtoStruct({ type: "object" }),
        capabilities: {
          availability: false,
          scheduling: false,
          maxElapsed: false,
          cancel: false,
          pauseResume: false,
          inputRequired: false,
          idempotency: false,
          observations: false,
        },
      },
    ],
  };
}

describe("Manifest security boundaries", () => {
  it("rejects executable-looking custom schema keywords without loading modules", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "sdar-manifest-security-"));
    const marker = resolve(directory, "executed");
    const modulePath = resolve(directory, "payload.mjs");
    writeFileSync(
      modulePath,
      `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'bad');`,
    );

    expect(() =>
      new OperationRegistry().validate(
        maliciousManifest({ type: "object", "x-runtime-module": modulePath }),
      ),
    ).toThrow();
    expect(existsSync(marker)).toBe(false);
  });

  it("rejects oversized regular expressions before AJV compilation", () => {
    expect(() =>
      new OperationRegistry().validate(
        maliciousManifest({ type: "string", pattern: "a".repeat(513) }),
      ),
    ).toThrow("MANIFEST_REGEX_TOO_LARGE");
  });
});
