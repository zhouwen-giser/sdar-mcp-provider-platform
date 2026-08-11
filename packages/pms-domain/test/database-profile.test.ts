import { describe, expect, it } from "vitest";
import {
  createDatabaseProfile,
  environmentId,
  providerDatabaseNames,
  providerId,
  secretRef,
} from "../src/index.js";

describe("DatabaseProfile and SecretRef", () => {
  it("creates a structured profile with safe defaults and separated secret authorities", () => {
    const profile = createDatabaseProfile({
      profileId: "database-profile-1",
      providerId: providerId("Provider:North/1".replace("/", ":")),
      environment: environmentId("production"),
      clusterRef: "postgres-primary",
      host: "Postgres.Internal",
      adminSecretRef: secretRef("vault/postgres/provisioner"),
      runtimeSecretRef: secretRef("vault/runtime/provider-north-1"),
    });

    expect(profile).toMatchObject({
      profileId: "database-profile-1",
      providerId: "Provider:North:1",
      environment: "production",
      clusterRef: "postgres-primary",
      host: "postgres.internal",
      port: 5432,
      databaseMode: "provisioned",
      sslMode: "verify-full",
      adminSecretRef: { secretRef: "vault/postgres/provisioner" },
      runtimeSecretRef: { secretRef: "vault/runtime/provider-north-1" },
    });
    expect(profile.databaseName).toMatch(/^sdar_rt_provider_north_1_[0-9a-f]{12}$/);
    expect(profile.runtimeRoleName).toBe(`${profile.databaseName}_app`);
    expect(Object.keys(profile)).not.toContain("connectionString");
    expect(Object.keys(profile)).not.toContain("password");
  });

  it("derives predictable injection-safe names while separating normalized collisions", () => {
    const colon = providerDatabaseNames(providerId("provider:a"));
    const dash = providerDatabaseNames(providerId("provider-a"));

    expect(providerDatabaseNames(providerId("provider:a"))).toEqual(colon);
    expect(colon.databaseName).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
    expect(colon.runtimeRoleName).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
    expect(colon).not.toEqual(dash);
  });

  it("accepts an exact safe database override only for preexisting databases", () => {
    const create = (databaseName: string, databaseMode: "preexisting" | "provisioned") =>
      createDatabaseProfile({
        profileId: "database-profile-1",
        providerId: providerId("provider-1"),
        environment: environmentId("home-lab"),
        clusterRef: "postgres-integration",
        host: "127.0.0.1",
        databaseMode,
        databaseName,
        adminSecretRef: secretRef("vault/postgres/provisioner"),
        runtimeSecretRef: secretRef("vault/runtime/provider-1"),
      });

    const climate = create("smpp_climate_runtime_integration", "preexisting");
    expect(climate.databaseName).toBe("smpp_climate_runtime_integration");
    expect(climate.runtimeRoleName).toBe("smpp_climate_runtime_integration_app");
    expect(create("smpp_climate_runtime_integration", "preexisting")).toEqual(climate);
    expect(() => create("smpp_climate_runtime_integration", "provisioned")).toThrow(
      expect.objectContaining({ code: "INVALID_DOMAIN_VALUE" }),
    );
  });

  it.each([
    "Smpp_climate_runtime_integration",
    "smpp-climate-runtime-integration",
    "1_smpp_climate_runtime_integration",
    "smpp_climate_runtime_integration;drop_database",
    "a".repeat(64),
  ])("rejects an unsafe preexisting database identifier: %s", (databaseName) => {
    expect(() =>
      createDatabaseProfile({
        profileId: "database-profile-1",
        providerId: providerId("provider-1"),
        environment: environmentId("home-lab"),
        clusterRef: "postgres-integration",
        host: "127.0.0.1",
        databaseMode: "preexisting",
        databaseName,
        adminSecretRef: secretRef("vault/postgres/provisioner"),
        runtimeSecretRef: secretRef("vault/runtime/provider-1"),
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_DOMAIN_VALUE" }));
  });

  it("derives a deterministic safe runtime role for a maximum-length database name", () => {
    const databaseName = `a${"b".repeat(62)}`;
    const profile = createDatabaseProfile({
      profileId: "database-profile-1",
      providerId: providerId("provider-1"),
      environment: environmentId("home-lab"),
      clusterRef: "postgres-integration",
      host: "127.0.0.1",
      databaseMode: "preexisting",
      databaseName,
      adminSecretRef: secretRef("vault/postgres/provisioner"),
      runtimeSecretRef: secretRef("vault/runtime/provider-1"),
    });

    expect(profile.databaseName).toBe(databaseName);
    expect(profile.runtimeRoleName).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
    expect(profile.runtimeRoleName).toHaveLength(63);
  });

  it.each([
    { host: "postgresql://db.internal/runtime" },
    { host: "user@db.internal" },
    { host: "db.internal/runtime" },
    { host: "db..internal" },
    { host: "db internal" },
  ])("rejects connection-string or unsafe host input: $host", ({ host }) => {
    expect(() =>
      createDatabaseProfile({
        profileId: "database-profile-1",
        providerId: providerId("provider-1"),
        environment: environmentId("production"),
        clusterRef: "postgres-primary",
        host,
        adminSecretRef: secretRef("vault/postgres/provisioner"),
        runtimeSecretRef: secretRef("vault/runtime/provider-1"),
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_DOMAIN_VALUE" }));
  });

  it("rejects reused secret authority, invalid references, and invalid ports", () => {
    const shared = secretRef("vault/shared");
    expect(() =>
      createDatabaseProfile({
        profileId: "database-profile-1",
        providerId: providerId("provider-1"),
        environment: environmentId("production"),
        clusterRef: "postgres-primary",
        host: "db.internal",
        port: 0,
        adminSecretRef: shared,
        runtimeSecretRef: shared,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_DOMAIN_VALUE" }));
    expect(() => secretRef("postgresql://user:credential@db/runtime")).toThrow(
      expect.objectContaining({ code: "INVALID_DOMAIN_VALUE" }),
    );
  });

  it("freezes the profile and nested SecretRefs", () => {
    const profile = createDatabaseProfile({
      profileId: "database-profile-1",
      providerId: providerId("provider-1"),
      environment: environmentId("production"),
      clusterRef: "postgres-primary",
      host: "db.internal",
      databaseMode: "preexisting",
      sslMode: "require",
      adminSecretRef: secretRef("vault/postgres/provisioner"),
      runtimeSecretRef: secretRef("vault/runtime/provider-1"),
    });

    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.adminSecretRef)).toBe(true);
    expect(Object.isFrozen(profile.runtimeSecretRef)).toBe(true);
  });
});
