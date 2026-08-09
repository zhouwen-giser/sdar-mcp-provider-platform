import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileSecretStore } from "../src/index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("FileSecretStore", () => {
  it("atomically writes and replaces mode-0600 files below mode-0700 scope directories", async () => {
    const root = await temporaryRoot();
    const store = new FileSecretStore(root);
    const ref = await store.write(input("first-secret"));
    await store.write(input("rotated-secret"));

    expect(ref).toEqual({
      secretRef: "file/v1/deployment-1/instance-1/DATABASE_URL",
    });
    const target = join(
      root,
      "deployments",
      "deployment-1",
      "instances",
      "instance-1",
      "DATABASE_URL.secret",
    );
    if (process.platform !== "win32") {
      expect((await lstat(target)).mode & 0o777).toBe(0o600);
      expect(
        (await lstat(join(root, "deployments", "deployment-1", "instances", "instance-1"))).mode &
          0o777,
      ).toBe(0o700);
    }
    expect(await readFile(target, "utf8")).toBe("rotated-secret");
    expect(Buffer.from(await store.read(ref)).toString("utf8")).toBe("rotated-secret");
    expect(
      await readdir(join(root, "deployments", "deployment-1", "instances", "instance-1")),
    ).toEqual(["DATABASE_URL.secret"]);
  });

  it("returns redacted inspection and emits no secret-bearing logs", async () => {
    const root = await temporaryRoot();
    const store = new FileSecretStore(root);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ref = await store.write(input("do-not-log-this-value"));
    const inspected = await store.inspect(ref);

    expect(inspected).toEqual({
      secretRef: "file/v1/deployment-1/instance-1/DATABASE_URL",
      deploymentId: "deployment-1",
      instanceId: "instance-1",
      name: "DATABASE_URL",
      status: "present",
      accessMode: "0600",
    });
    expect(JSON.stringify(inspected)).not.toContain(root);
    expect(JSON.stringify(inspected)).not.toContain("do-not-log-this-value");
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });

  it.each([
    { deploymentId: "../outside", instanceId: "instance-1", name: "DATABASE_URL" },
    { deploymentId: "deployment-1", instanceId: "../../outside", name: "DATABASE_URL" },
    { deploymentId: "deployment-1", instanceId: "instance-1", name: "../DATABASE_URL" },
    { deploymentId: "/absolute", instanceId: "instance-1", name: "DATABASE_URL" },
  ])("rejects path traversal before filesystem access", async (unsafe) => {
    const store = new FileSecretStore(await temporaryRoot());
    await expect(store.write({ ...unsafe, content: "secret" })).rejects.toMatchObject({
      code: "SECRET_STORE_INVALID_SCOPE",
    });
  });

  it("rejects forged references, symlinks, and relaxed file permissions", async () => {
    const root = await temporaryRoot();
    const store = new FileSecretStore(root);
    await expect(
      store.read({ secretRef: "file/v1/deployment-1/../../outside" }),
    ).rejects.toMatchObject({ code: "SECRET_STORE_INVALID_REF" });

    const ref = await store.write(input("secret"));
    const target = join(
      root,
      "deployments",
      "deployment-1",
      "instances",
      "instance-1",
      "DATABASE_URL.secret",
    );
    await rm(target);
    await createSecurityLink("/etc/passwd", target);
    await expect(store.read(ref)).rejects.toMatchObject({
      code: "SECRET_STORE_SYMLINK_REJECTED",
    });
    await rm(target);
    await store.write(input("secret"));
    if (process.platform !== "win32") {
      await chmod(target, 0o644);
      await expect(store.read(ref)).rejects.toMatchObject({
        code: "SECRET_STORE_INVALID_PERMISSIONS",
      });
    }
  });

  it("requires an exact explicit cleanup policy and is idempotent after deletion", async () => {
    const store = new FileSecretStore(await temporaryRoot());
    const ref = await store.write(input("secret"));
    const policy = {
      kind: "explicit-secret-cleanup" as const,
      deploymentId: "deployment-1",
      instanceId: "instance-1",
      name: "DATABASE_URL",
      reason: "deployment retired",
    };

    await expect(
      store.cleanup(ref, { ...policy, instanceId: "another-instance" }),
    ).rejects.toMatchObject({ code: "SECRET_STORE_CLEANUP_POLICY_REQUIRED" });
    expect(await store.cleanup(ref, policy)).toEqual({
      secretRef: ref.secretRef,
      outcome: "deleted",
    });
    expect(await store.cleanup(ref, policy)).toEqual({
      secretRef: ref.secretRef,
      outcome: "missing",
    });
  });

  it("rejects a symlink in the deployment/instance directory chain", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    await mkdir(join(root, "deployments"), { mode: 0o700 });
    await createSecurityLink(outside, join(root, "deployments", "deployment-1"));
    const store = new FileSecretStore(root);

    await expect(store.write(input("secret"))).rejects.toMatchObject({
      code: "SECRET_STORE_SYMLINK_REJECTED",
    });
    await expect(
      store.inspect({ secretRef: "file/v1/deployment-1/instance-1/DATABASE_URL" }),
    ).rejects.toMatchObject({ code: "SECRET_STORE_SYMLINK_REJECTED" });
    expect(await pathExists(join(outside, "instances"))).toBe(false);
  });
});

function input(content: string) {
  return {
    deploymentId: "deployment-1",
    instanceId: "instance-1",
    name: "DATABASE_URL",
    content,
  };
}

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sdar-secret-store-"));
  directories.push(directory);
  return directory;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function createSecurityLink(target: string, link: string): Promise<void> {
  try {
    await symlink(target, link);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
    if (process.platform !== "win32" || !["EACCES", "EPERM", "EPROTO"].includes(code ?? "")) {
      throw error;
    }
    const junctionTarget = await mkdtemp(join(tmpdir(), "sdar-secret-store-junction-"));
    directories.push(junctionTarget);
    await symlink(junctionTarget, link, "junction");
  }
}
