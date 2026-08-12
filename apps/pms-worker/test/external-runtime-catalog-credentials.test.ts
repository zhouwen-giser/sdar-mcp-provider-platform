import { createHmac } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeDeploymentSnapshot } from "../../../packages/runtime-deployment/src/index.js";
import {
  ExternalRuntimeCatalogCredentialResolver,
  NoExternalRuntimeCatalogCredentialResolver,
} from "../src/external-runtime-catalog-credentials.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await chmod(directory, 0o700).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

describe("external Runtime catalog credentials", () => {
  it("binds a short-lived HS256 token to provider, deployment and instance", async () => {
    const fixture = await credentialFixture();
    const now = new Date("2026-08-11T00:00:00.000Z");
    const resolver = await ExternalRuntimeCatalogCredentialResolver.create(fixture.descriptor, {
      now: () => now,
    });

    const authorization = await resolver.authorization(
      deployment("direct_container"),
      "instance-a",
    );

    expect(authorization).toMatch(/^Bearer [^.]+\.[^.]+\.[^.]+$/);
    const token = authorization?.replace(/^Bearer /, "") ?? "";
    const [header, payload, signature] = token.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString("utf8"))).toEqual({
      alg: "HS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))).toEqual({
      iss: "sdar-test",
      aud: "sdar-runtime",
      sub: "pms-worker",
      tenant: "pms-control",
      iat: 1_786_406_400,
      nbf: 1_786_406_395,
      exp: 1_786_406_460,
    });
    expect(signature).toBe(
      createHmac("sha256", fixture.secret).update(`${header}.${payload}`).digest("base64url"),
    );
    await expect(
      resolver.authorization(deployment("direct_container"), "wrong-instance"),
    ).rejects.toThrow("EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_NOT_FOUND");
  });

  it("does not attach external credentials to platform-managed discovery", async () => {
    const fixture = await credentialFixture();
    const resolver = await ExternalRuntimeCatalogCredentialResolver.create(fixture.descriptor);
    await expect(
      resolver.authorization(deployment("platform_managed"), "instance-a"),
    ).resolves.toBeUndefined();
  });

  it("fails closed when direct-container credentials are not configured", async () => {
    const resolver = new NoExternalRuntimeCatalogCredentialResolver();
    await expect(resolver.authorization(deployment("direct_container"))).rejects.toThrow(
      "EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_NOT_CONFIGURED",
    );
    const explicitlyClosed = new NoExternalRuntimeCatalogCredentialResolver({
      allowUnauthenticatedDirect: false,
    });
    await expect(explicitlyClosed.authorization(deployment("direct_container"))).rejects.toThrow(
      "EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_NOT_CONFIGURED",
    );
  });

  it("omits direct-container authorization only for the explicit internal opt-in", async () => {
    const resolver = new NoExternalRuntimeCatalogCredentialResolver({
      allowUnauthenticatedDirect: true,
    });

    await expect(resolver.authorization(deployment("direct_container"))).resolves.toBeUndefined();
    await expect(resolver.authorization(deployment("platform_managed"))).resolves.toBeUndefined();
  });

  it("rejects whitespace in the raw HS256 secret instead of normalizing it", async () => {
    const fixture = await credentialFixture();
    const resolver = await ExternalRuntimeCatalogCredentialResolver.create(fixture.descriptor);
    await writeFile(fixture.secretFile, `${fixture.secret}\n`, { mode: 0o600 });
    await expect(
      resolver.authorization(deployment("direct_container"), "instance-a"),
    ).rejects.toThrow("EXTERNAL_RUNTIME_CATALOG_SECRET_FILE_INVALID");
  });

  it.each([
    { credentials: [], unexpected: true },
    {
      credentials: [
        {
          providerId: "provider-a",
          deploymentId: "deployment-a",
          instanceId: "instance-a",
          secretFile: "/run/secrets/runtime",
          issuer: " sdar-test",
          audience: "sdar-runtime",
          subjectId: "pms-worker",
          tenantId: "pms-control",
        },
      ],
    },
  ])("rejects ambiguous descriptor data", async (document) => {
    const fixture = await credentialFixture();
    await writeFile(fixture.descriptor, JSON.stringify(document), { mode: 0o600 });
    await expect(
      ExternalRuntimeCatalogCredentialResolver.create(fixture.descriptor),
    ).rejects.toThrow("PMS_EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_FILE_INVALID");
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlinked or broadly readable secret files at resolution time",
    async () => {
      const fixture = await credentialFixture();
      const resolver = await ExternalRuntimeCatalogCredentialResolver.create(fixture.descriptor);
      await chmod(fixture.secretFile, 0o644);
      await expect(
        resolver.authorization(deployment("direct_container"), "instance-a"),
      ).rejects.toThrow("EXTERNAL_RUNTIME_CATALOG_SECRET_FILE_INVALID");

      await chmod(fixture.secretFile, 0o600);
      const symbolicLink = join(fixture.directory, "secret-link");
      await symlink(fixture.secretFile, symbolicLink);
      const descriptor = join(fixture.directory, "symlink-descriptor.json");
      await writeFile(descriptor, JSON.stringify(descriptorDocument(symbolicLink)), {
        mode: 0o600,
      });
      const linked = await ExternalRuntimeCatalogCredentialResolver.create(descriptor);
      await expect(
        linked.authorization(deployment("direct_container"), "instance-a"),
      ).rejects.toThrow("EXTERNAL_RUNTIME_CATALOG_SECRET_FILE_INVALID");

      const hardlink = join(fixture.directory, "secret-hardlink");
      await link(fixture.secretFile, hardlink);
      await expect(
        resolver.authorization(deployment("direct_container"), "instance-a"),
      ).rejects.toThrow("EXTERNAL_RUNTIME_CATALOG_SECRET_FILE_INVALID");
    },
  );
});

async function credentialFixture() {
  const directory = await mkdtemp(join(tmpdir(), "external-runtime-catalog-"));
  temporaryDirectories.push(directory);
  const secretFile = join(directory, "runtime-jwt.secret");
  const descriptor = join(directory, "credentials.json");
  const secret = "0123456789abcdef0123456789abcdef";
  await mkdir(join(directory, "unused"), { mode: 0o700 });
  await writeFile(secretFile, secret, { mode: 0o600 });
  await writeFile(descriptor, JSON.stringify(descriptorDocument(secretFile)), { mode: 0o600 });
  return { directory, secretFile, descriptor, secret };
}

function descriptorDocument(secretFile: string) {
  return {
    credentials: [
      {
        providerId: "provider-a",
        deploymentId: "deployment-a",
        instanceId: "instance-a",
        secretFile,
        issuer: "sdar-test",
        audience: "sdar-runtime",
        subjectId: "pms-worker",
        tenantId: "pms-control",
      },
    ],
  };
}

function deployment(
  runtimeAuthority: "platform_managed" | "direct_container",
): RuntimeDeploymentSnapshot {
  return {
    providerId: "provider-a",
    deploymentId: "deployment-a",
    runtimeAuthority,
  } as RuntimeDeploymentSnapshot;
}
