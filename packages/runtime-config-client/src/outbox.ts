import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalSha256 } from "../../runtime-configuration-contract/src/index.js";
import type { RuntimeConfigAckOutbox, RuntimeConfigAckOutboxRecord } from "./model.js";

interface OutboxArtifact {
  readonly formatVersion: 1;
  readonly records: readonly RuntimeConfigAckOutboxRecord[];
  readonly artifactChecksum: string;
}

export class FileRuntimeConfigAckOutbox implements RuntimeConfigAckOutbox {
  readonly #path: string;

  constructor(path: string) {
    this.#path = resolve(path);
  }

  async list(): Promise<readonly RuntimeConfigAckOutboxRecord[]> {
    const artifact = await this.#read();
    return structuredClone(artifact?.records ?? []);
  }

  async put(record: RuntimeConfigAckOutboxRecord): Promise<void> {
    const records = [...(await this.list())];
    const index = records.findIndex(
      ({ acknowledgement }) => acknowledgement.revisionId === record.acknowledgement.revisionId,
    );
    if (index >= 0) {
      if (canonicalSha256(records[index]) !== canonicalSha256(record)) {
        throw new Error("RUNTIME_CONFIG_ACK_OUTBOX_CONFLICT");
      }
      return;
    }
    records.push(structuredClone(record));
    await this.#write(records);
  }

  async remove(revisionId: string): Promise<void> {
    const records = (await this.list()).filter(
      ({ acknowledgement }) => acknowledgement.revisionId !== revisionId,
    );
    await this.#write(records);
  }

  async #read(): Promise<OutboxArtifact | null> {
    try {
      const file = await stat(this.#path);
      const insecureUnixMode = process.platform !== "win32" && (file.mode & 0o077) !== 0;
      if (!file.isFile() || insecureUnixMode) {
        throw new Error("RUNTIME_CONFIG_ACK_OUTBOX_MODE_INVALID");
      }
      const input = JSON.parse(await readFile(this.#path, "utf8")) as unknown;
      if (
        !isRecord(input) ||
        input.formatVersion !== 1 ||
        !Array.isArray(input.records) ||
        typeof input.artifactChecksum !== "string"
      ) {
        throw new Error("RUNTIME_CONFIG_ACK_OUTBOX_INVALID");
      }
      const payload = { formatVersion: 1 as const, records: input.records };
      if (canonicalSha256(payload) !== input.artifactChecksum) {
        throw new Error("RUNTIME_CONFIG_ACK_OUTBOX_CHECKSUM_INVALID");
      }
      return structuredClone(input) as unknown as OutboxArtifact;
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null;
      throw error;
    }
  }

  async #write(records: readonly RuntimeConfigAckOutboxRecord[]): Promise<void> {
    const payload = { formatVersion: 1 as const, records };
    const artifact: OutboxArtifact = {
      ...payload,
      artifactChecksum: canonicalSha256(payload),
    };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
