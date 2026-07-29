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
