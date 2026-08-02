import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");

describe("PMS Console API frozen lock", () => {
  it("matches every mandatory implementation gate hash", () => {
    const contract = resolve(root, "contracts/pms-console-api/v1");
    const lock = JSON.parse(
      readFileSync(resolve(contract, "contract-lock.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(lock.status).toBe("frozen");
    expect(lock.operationCount).toBe(36);
    expect(hash(resolve(contract, "openapi.yaml"))).toBe(lock.openApiSha256);
    expect(hash(resolve(contract, "dist/openapi.bundle.json"))).toBe(lock.schemaBundleSha256);
    expect(hash(resolve(contract, "ENDPOINT_SOURCE_MAP.json"))).toBe(
      lock.endpointSourceMapSha256,
    );
    expect(hash(resolve(contract, "ERROR_SOURCE_MAP.json"))).toBe(lock.errorSourceMapSha256);
  });
});

function hash(path: string): string {
  const bytes = readFileSync(path);
  const canonical = bytes.includes(13)
    ? Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n"), "utf8")
    : bytes;
  return createHash("sha256").update(canonical).digest("hex");
}
