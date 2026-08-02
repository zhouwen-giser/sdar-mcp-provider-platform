import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ProviderPackageRegistry,
  loadProviderPackageRegistry,
  projectProviderQualification,
  validateProviderPackage,
  type ProviderPackage,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ProviderPackage Registry", () => {
  it("loads all built-in packages in stable order and supports ID/type queries", async () => {
    const workspaceRoot = resolve(import.meta.dirname, "../../..");

    const registry = await loadProviderPackageRegistry(workspaceRoot);

    expect(registry.list().map(({ packageId }) => packageId)).toEqual([
      "builtin.home-assistant.climate",
      "builtin.home-assistant.light",
      "builtin.isr.vehicle.npc-tank",
      "builtin.isr.vehicle.ugv",
    ]);
    expect(registry.get("builtin.isr.vehicle.ugv", "1.0.0")?.providerType).toBe("isr.vehicle.ugv");
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.listByProviderType("home_assistant.climate")).toHaveLength(1);
    expect(registry.listByProviderType("home_assistant.light")).toHaveLength(1);
  });

  it("rejects duplicate packageId and packageVersion pairs", () => {
    const providerPackage = packageFixture();

    expect(() => new ProviderPackageRegistry([providerPackage, providerPackage])).toThrow(
      expect.objectContaining({ code: "DUPLICATE_PACKAGE_VERSION" }),
    );
  });

  it("requires an explicit version when one package ID has multiple versions", () => {
    const first = packageFixture();
    const second = { ...first, packageVersion: "1.1.0" };
    const registry = new ProviderPackageRegistry([second, first]);

    expect(registry.list().map(({ packageVersion }) => packageVersion)).toEqual(["1.0.0", "1.1.0"]);
    expect(() => registry.get(first.packageId)).toThrow(
      expect.objectContaining({ code: "AMBIGUOUS_PACKAGE_ID" }),
    );
    expect(registry.get(first.packageId, "1.1.0")).toEqual(second);
  });

  it("rejects invalid JSON and invalid package schemas", async () => {
    const invalidJsonRoot = await fixtureRoot();
    await writeDescriptor(invalidJsonRoot, "broken-json", "{");
    await expect(loadProviderPackageRegistry(invalidJsonRoot)).rejects.toMatchObject({
      code: "PACKAGE_JSON_INVALID",
    });

    const invalidSchemaRoot = await fixtureRoot();
    await writeDescriptor(
      invalidSchemaRoot,
      "broken-schema",
      JSON.stringify({ ...packageFixture(), hostingModes: ["unknown"] }),
    );
    await expect(loadProviderPackageRegistry(invalidSchemaRoot)).rejects.toMatchObject({
      code: "PACKAGE_SCHEMA_INVALID",
    });
  });

  it("rejects symlinked package entries and descriptors", async () => {
    const entryRoot = await fixtureRoot();
    const outside = await mkdtemp(resolve(tmpdir(), "sdar-provider-package-outside-"));
    roots.push(outside);
    await symlink(outside, resolve(entryRoot, "provider-packages/linked"));
    await expect(loadProviderPackageRegistry(entryRoot)).rejects.toMatchObject({
      code: "PACKAGE_ENTRY_SYMLINK_REJECTED",
    });

    const descriptorRoot = await fixtureRoot();
    await mkdir(resolve(descriptorRoot, "provider-packages/linked"), { recursive: true });
    const descriptor = resolve(outside, "provider-package.json");
    await writeFile(descriptor, JSON.stringify(packageFixture()));
    await symlink(
      descriptor,
      resolve(descriptorRoot, "provider-packages/linked/provider-package.json"),
    );
    await expect(loadProviderPackageRegistry(descriptorRoot)).rejects.toMatchObject({
      code: "PACKAGE_ENTRY_SYMLINK_REJECTED",
    });
  });

  it("exposes strict standalone validation", () => {
    expect(validateProviderPackage(packageFixture()).packageId).toBe("builtin.test.provider");
    expect(() => validateProviderPackage({ ...packageFixture(), unknown: true })).toThrow();
  });

  it("excludes mock fixtures from the controlled production package root", async () => {
    const root = await fixtureRoot();
    await writeDescriptor(
      root,
      "mock-ugv-device",
      JSON.stringify({
        ...packageFixture(),
        packageId: "builtin.mock.ugv-device",
        adapter: {
          ...packageFixture().adapter,
          entry: "apps/mock-ugv-device-mcp/src/main.ts",
        },
      }),
    );

    await expect(loadProviderPackageRegistry(root)).rejects.toMatchObject({
      code: "TEST_FIXTURE_PACKAGE_REJECTED",
    });
  });

  it("projects auditable qualification statuses without certification claims", async () => {
    const workspaceRoot = resolve(import.meta.dirname, "../../..");
    const registry = await loadProviderPackageRegistry(workspaceRoot);
    const projections = registry.list().map(projectProviderQualification);

    expect(projections).toHaveLength(4);
    expect(projections.every(({ realResourceStatus }) => realResourceStatus === "pending")).toBe(
      true,
    );
    expect(projections.every(({ evidenceRefs }) => evidenceRefs.length > 0)).toBe(true);
    expect(JSON.stringify(projections).toLowerCase()).not.toContain("certified");
    expect(JSON.stringify(projections)).not.toContain("systemStatus");
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "sdar-provider-packages-"));
  roots.push(root);
  await mkdir(resolve(root, "provider-packages"), { recursive: true });
  return root;
}

async function writeDescriptor(root: string, directory: string, source: string): Promise<void> {
  const packageDirectory = resolve(root, "provider-packages", directory);
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(resolve(packageDirectory, "provider-package.json"), source);
}

function packageFixture(): ProviderPackage {
  return {
    schemaVersion: "1.0",
    packageId: "builtin.test.provider",
    packageVersion: "1.0.0",
    providerType: "test.provider",
    hostingModes: ["vendor_managed"],
    adapter: {
      entry: "apps/test/src/main.ts",
      configSchemaId: "provider.test",
      migrationSet: null,
    },
    runtime: {
      compatibleRuntimeVersion: "2.0.0-rc.1",
      protocolMode: "frozen_v1",
    },
    qualification: {
      componentStatus: "pending",
      realResourceStatus: "pending",
    },
  };
}
