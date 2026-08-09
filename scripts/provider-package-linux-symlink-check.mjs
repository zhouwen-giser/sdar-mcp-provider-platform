import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

if (process.platform !== "linux") {
  console.error("LINUX_SYMLINK_CHECK_REQUIRES_LINUX");
  process.exitCode = 2;
} else {
  const { loadProviderPackageRegistry } =
    await import("../dist/packages/provider-package-registry/src/index.js");
  const root = await mkdtemp(resolve(tmpdir(), "sdar-linux-symlink-"));
  const outside = await mkdtemp(resolve(tmpdir(), "sdar-linux-outside-"));
  let actualCode = "NO_ERROR";
  try {
    await mkdir(resolve(root, "provider-packages"));
    await symlink(outside, resolve(root, "provider-packages/linked"), "dir");
    try {
      await loadProviderPackageRegistry(root);
    } catch (error) {
      actualCode = error?.code ?? error?.name ?? "UNKNOWN";
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
  const result = {
    evidenceClass: "contract",
    environment: "linux",
    platform: process.platform,
    symlinkSupported: true,
    expectedCode: "PACKAGE_ENTRY_SYMLINK_REJECTED",
    actualCode,
    status: actualCode === "PACKAGE_ENTRY_SYMLINK_REJECTED" ? "passed" : "failed",
  };
  console.log(JSON.stringify(result));
  if (result.status !== "passed") process.exitCode = 1;
}
