import { randomUUID } from "node:crypto";
import { open, mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { RuntimeConfigCacheArtifact, RuntimeConfigCacheStore } from "./model.js";

export class FileRuntimeConfigCacheStore implements RuntimeConfigCacheStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = resolve(path);
  }

  async read(): Promise<unknown> {
    try {
      const file = await stat(this.#path);
      const insecureUnixMode = process.platform !== "win32" && (file.mode & 0o077) !== 0;
      if (!file.isFile() || insecureUnixMode) throw new Error("CACHE_MODE_INVALID");
      return JSON.parse(await readFile(this.#path, "utf8")) as unknown;
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
  }

  async write(artifact: RuntimeConfigCacheArtifact): Promise<void> {
    const directory = dirname(this.#path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stagingPath = `${this.#path}.staging-${String(process.pid)}-${randomUUID()}`;
    let stagingCreated = false;
    try {
      const staging = await open(stagingPath, "wx", 0o600);
      stagingCreated = true;
      try {
        await staging.writeFile(`${JSON.stringify(artifact)}\n`, "utf8");
        await staging.sync();
      } finally {
        await staging.close();
      }
      await rename(stagingPath, this.#path);
      stagingCreated = false;
      const directoryHandle = await open(directory, "r");
      try {
        try {
          await directoryHandle.sync();
        } catch (error) {
          // Windows does not support fsync on directory handles. The staging
          // file itself was synced before the atomic rename, so tolerate only
          // the platform's documented unsupported-operation errors here.
          if (!isUnsupportedWindowsDirectorySync(error)) throw error;
        }
      } finally {
        await directoryHandle.close();
      }
    } finally {
      if (stagingCreated) await unlink(stagingPath).catch(() => undefined);
    }
  }
}

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === code
  );
}

function isUnsupportedWindowsDirectorySync(error: unknown): boolean {
  return (
    process.platform === "win32" &&
    ["EPERM", "EINVAL", "ENOTSUP"].some((code) => hasCode(error, code))
  );
}
