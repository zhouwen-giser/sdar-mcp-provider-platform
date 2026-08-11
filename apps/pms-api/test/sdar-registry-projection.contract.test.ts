import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  hashSdarRegistryProjection,
  type SdarRegistryProjectionChecksumInput,
} from "../src/sdar-registry-projection.js";
import { pmsOpenApiDocument } from "../src/openapi.js";

const Ajv2020 = Ajv2020Import.default;
const applyFormats = addFormatsImport.default;

const contractRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../protocol/consumer-projections/sdar-registry/v1",
);

interface ChecksumVector {
  readonly id: string;
  readonly input: SdarRegistryProjectionChecksumInput;
  readonly expectedChecksum?: string;
  readonly expectedErrorCode?: string;
  readonly sameChecksumAs?: string;
  readonly differentChecksumFrom?: string;
  readonly mappingInput?: Readonly<Record<string, unknown>>;
  readonly expectedProjectedCatalogRevision?: string;
  readonly expectedNormalizedEndpoint?: string;
}

describe("frozen SDAR Registry consumer projection contract", () => {
  it("matches all ten SDAR checksum and rejection vector classes", async () => {
    const document = await jsonFile<{ readonly vectors: readonly ChecksumVector[] }>(
      "checksum-vectors.json",
    );
    expect(document.vectors).toHaveLength(10);
    const outcomes = new Map<string, string>();

    for (const vector of document.vectors) {
      if (vector.expectedChecksum !== undefined) {
        const checksum = hashSdarRegistryProjection(vector.input);
        expect(checksum, vector.id).toBe(vector.expectedChecksum);
        outcomes.set(vector.id, checksum);
      } else {
        const error = capture(() => hashSdarRegistryProjection(vector.input));
        expect(error, vector.id).toMatchObject({ code: vector.expectedErrorCode });
      }
    }

    for (const vector of document.vectors) {
      if (vector.sameChecksumAs !== undefined) {
        expect(outcomes.get(vector.id), vector.id).toBe(outcomes.get(vector.sameChecksumAs));
      }
      if (vector.differentChecksumFrom !== undefined) {
        expect(outcomes.get(vector.id), vector.id).not.toBe(
          outcomes.get(vector.differentChecksumFrom),
        );
      }
    }

    const catalogVector = document.vectors.find(
      (vector) => vector.id === "catalog-revision-number-to-string",
    );
    expect(catalogVector?.mappingInput?.catalogRevision).toBe(7);
    expect(catalogVector?.expectedProjectedCatalogRevision).toBe("7");
    const endpointVector = document.vectors.find((vector) => vector.id === "normalized-endpoint");
    expect(endpointVector?.mappingInput?.effectiveEndpoint).toContain("#ignored");
    expect(endpointVector?.expectedNormalizedEndpoint).toBe("https://runtime.example/mcp");
  });

  it("enforces strict top-level, provider, and labels schemas", async () => {
    const schema = await jsonFile<Record<string, unknown>>("projection.schema.json");
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    applyFormats(ajv);
    const validate = ajv.compile(schema);
    const projection = {
      revision: 4,
      checksum: "a".repeat(64),
      generatedAt: "2026-08-04T00:00:00.000Z",
      expiresAt: "2026-09-03T00:00:00.000Z",
      providers: [
        {
          externalProviderId: "ha-light-lab",
          externalServerId: "ha-light-server",
          serverEndpoint: "http://127.0.0.1:18082/mcp",
          catalogRevision: "7",
          labels: { environment: "home-lab", protocolMode: "frozen_v1" },
        },
      ],
    };
    expect(validate(projection), JSON.stringify(validate.errors)).toBe(true);

    for (const mutate of [
      (value: typeof projection) => Object.assign(value, { entityId: "light.main" }),
      (value: typeof projection) => {
        const candidate = value.providers[0];
        if (candidate !== undefined) Object.assign(candidate, { tools: [] });
      },
      (value: typeof projection) => {
        const candidate = value.providers[0];
        if (candidate !== undefined) Object.assign(candidate, { displayName: "Main" });
      },
      (value: typeof projection) => {
        const candidate = value.providers[0];
        if (candidate !== undefined) {
          candidate.serverEndpoint = "https://device-user:device-secret@runtime.example/mcp";
        }
      },
      (value: typeof projection) => {
        const candidate = value.providers[0];
        if (candidate !== undefined) Object.assign(candidate.labels, { taskId: "t-1" });
      },
    ]) {
      const invalid = structuredClone(projection);
      mutate(invalid);
      expect(validate(invalid)).toBe(false);
    }

    const missingCatalogRevision = structuredClone(projection);
    delete (missingCatalogRevision.providers[0] as Partial<{ catalogRevision: string }>)
      .catalogRevision;
    expect(validate(missingCatalogRevision)).toBe(false);
    const missingLabels = structuredClone(projection);
    delete (missingLabels.providers[0] as Partial<{ labels: unknown }>).labels;
    expect(validate(missingLabels)).toBe(false);
  });

  it("publishes the exact paths with PMS management Bearer security", () => {
    const document = pmsOpenApiDocument() as {
      readonly paths: Readonly<
        Record<string, { readonly get?: Readonly<Record<string, unknown>> }>
      >;
    };
    for (const suffix of ["latest", "bootstrap", "watch"]) {
      const path = `/api/v1/registry/{environment}/consumers/sdar/v1/sources/{smppSourceId}/${suffix}`;
      expect(document.paths[path]?.get).toMatchObject({
        security: [{ managementToken: [] }],
        "x-sdar-required-role": "reader_or_administrator",
      });
    }
  });

  it("locks every raw asset byte and the deterministic bundle digest", async () => {
    const manifest = await jsonFile<{
      readonly projectionSchemaSha256: string;
      readonly bundleSha256: string;
      readonly files: readonly { readonly path: string; readonly sha256: string }[];
    }>("MANIFEST.json");
    const records: string[] = [];
    for (const entry of manifest.files) {
      const digest = createHash("sha256")
        .update(await readFile(resolve(contractRoot, entry.path)))
        .digest("hex");
      expect(digest, entry.path).toBe(entry.sha256);
      records.push(`${entry.path}:${digest}\n`);
    }
    records.sort((left, right) => left.localeCompare(right));
    expect(createHash("sha256").update(records.join("")).digest("hex")).toBe(manifest.bundleSha256);
    expect(manifest.projectionSchemaSha256).toBe(
      manifest.files.find((entry) => entry.path === "projection.schema.json")?.sha256,
    );
  });
});

async function jsonFile<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(resolve(contractRoot, name), "utf8")) as T;
}

function capture(action: () => unknown): unknown {
  try {
    action();
    return undefined;
  } catch (error) {
    return error;
  }
}
