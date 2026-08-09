import { chmod, link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeControlPlaneCredentialResolver } from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await chmod(directory, 0o700).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

describe("RuntimeControlPlaneCredentialResolver", () => {
  it("resolves two instances to distinct absolute credential files", async () => {
    const fixture = await credentialFixture();
    const first = await fixture.add("provider-a", "deployment-a", "instance-a", "first-value");
    const second = await fixture.add("provider-a", "deployment-a", "instance-b", "second-value");
    const resolver = await RuntimeControlPlaneCredentialResolver.create(fixture.root);

    await expect(
      resolver.resolve({
        providerId: "provider-a",
        deploymentId: "deployment-a",
        instanceId: "instance-a",
      }),
    ).resolves.toBe(first);
    await expect(
      resolver.resolve({
        providerId: "provider-a",
        deploymentId: "deployment-a",
        instanceId: "instance-b",
      }),
    ).resolves.toBe(second);
    expect(first).not.toBe(second);
  });

  it.each([
    ["provider-b", "deployment-a", "instance-a"],
    ["provider-a", "deployment-b", "instance-a"],
    ["provider-a", "deployment-a", "instance-b"],
  ])(
    "fails closed when any identity segment changes",
    async (providerId, deploymentId, instanceId) => {
      const fixture = await credentialFixture();
      await fixture.add("provider-a", "deployment-a", "instance-a", "only-value");
      const resolver = await RuntimeControlPlaneCredentialResolver.create(fixture.root);

      await expect(resolver.resolve({ providerId, deploymentId, instanceId })).rejects.toThrow(
        /^PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_(PARENT_UNSAFE|TOKEN_INVALID)$/,
      );
    },
  );

  it.each(["../provider", "provider/child", ".", "..", "provider..other"])(
    "rejects unsafe identity segment %s",
    async (segment) => {
      const fixture = await credentialFixture();
      const resolver = await RuntimeControlPlaneCredentialResolver.create(fixture.root);
      await expect(
        resolver.resolve({
          providerId: segment,
          deploymentId: "deployment-a",
          instanceId: "instance-a",
        }),
      ).rejects.toThrow("PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_IDENTITY_INVALID");
    },
  );

  it("rejects symlink, broad-permission, empty and multiply-linked token files", async () => {
    const fixture = await credentialFixture();
    const token = await fixture.add("provider-a", "deployment-a", "instance-a", "safe-value");
    const resolver = await RuntimeControlPlaneCredentialResolver.create(fixture.root);

    if (process.platform !== "win32") {
      await chmod(token, 0o644);
      await expect(resolveDefault(resolver)).rejects.toThrow(
        "PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_TOKEN_PERMISSIONS",
      );
      await chmod(token, 0o600);
    }

    await writeFile(token, "", { mode: 0o600 });
    await expect(resolveDefault(resolver)).rejects.toThrow(
      "PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_TOKEN_INVALID",
    );
    await writeFile(token, "safe-value", { mode: 0o600 });

    const duplicate = join(fixture.directory, "duplicate-token");
    await link(token, duplicate);
    await expect(resolveDefault(resolver)).rejects.toThrow(
      "PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_TOKEN_DUPLICATE_MAPPING",
    );
    await rm(duplicate);

    await rm(token);
    const target = join(fixture.directory, "target-token");
    if (process.platform === "win32") {
      await mkdir(target);
      await symlink(target, token, "junction");
    } else {
      await writeFile(target, "safe-value", { mode: 0o600 });
      await symlink(target, token);
    }
    await expect(resolveDefault(resolver)).rejects.toThrow(
      "PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_TOKEN_INVALID",
    );
  });

  it("rejects unsafe parent and unsafe or symlinked roots", async () => {
    const fixture = await credentialFixture();
    const token = await fixture.add("provider-a", "deployment-a", "instance-a", "safe-value");
    const instanceParent = join(token, "..");
    const resolver = await RuntimeControlPlaneCredentialResolver.create(fixture.root);
    if (process.platform !== "win32") {
      await chmod(instanceParent, 0o770);
      await expect(resolveDefault(resolver)).rejects.toThrow(
        "PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_PARENT_UNSAFE",
      );
      await chmod(instanceParent, 0o700);

      await chmod(fixture.root, 0o750);
      await expect(RuntimeControlPlaneCredentialResolver.create(fixture.root)).rejects.toThrow(
        "PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_ROOT_PERMISSIONS",
      );
      await chmod(fixture.root, 0o700);
    }

    const linkRoot = join(fixture.directory, "credential-root-link");
    await symlink(fixture.root, linkRoot, process.platform === "win32" ? "junction" : "dir");
    await expect(RuntimeControlPlaneCredentialResolver.create(linkRoot)).rejects.toThrow(
      "PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_ROOT_INVALID",
    );
  });

  it("never includes credential contents in errors", async () => {
    const fixture = await credentialFixture();
    const secretValue = "do-not-disclose-this-value";
    const token = await fixture.add("provider-a", "deployment-a", "instance-a", secretValue);
    if (process.platform === "win32") {
      await writeFile(token, "", { mode: 0o600 });
    } else {
      await chmod(token, 0o644);
    }
    const resolver = await RuntimeControlPlaneCredentialResolver.create(fixture.root);

    const error = await resolveDefault(resolver).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(secretValue);
    expect((error as Error).message).not.toContain(fixture.directory);
  });
});

async function credentialFixture() {
  const directory = await mkdtemp(join(tmpdir(), "runtime-control-plane-credentials-"));
  temporaryDirectories.push(directory);
  const root = join(directory, "credential-root");
  await mkdir(root, { mode: 0o700 });
  return {
    directory,
    root,
    async add(providerId: string, deploymentId: string, instanceId: string, value: string) {
      const parents = [
        join(root, "providers"),
        join(root, "providers", providerId),
        join(root, "providers", providerId, "deployments"),
        join(root, "providers", providerId, "deployments", deploymentId),
        join(root, "providers", providerId, "deployments", deploymentId, "instances"),
        join(root, "providers", providerId, "deployments", deploymentId, "instances", instanceId),
      ];
      for (const parent of parents) {
        await mkdir(parent, { mode: 0o700 }).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        });
        await chmod(parent, 0o700);
      }
      const token = join(parents.at(-1) ?? "", "control-plane.token");
      await writeFile(token, value, { mode: 0o600 });
      await chmod(token, 0o600);
      return token;
    },
  };
}

function resolveDefault(resolver: RuntimeControlPlaneCredentialResolver) {
  return resolver.resolve({
    providerId: "provider-a",
    deploymentId: "deployment-a",
    instanceId: "instance-a",
  });
}
