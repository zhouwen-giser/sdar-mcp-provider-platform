import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface FileSecretRef {
  readonly secretRef: string;
}

export interface SecretWriteInput {
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly name: string;
  readonly content: string | Uint8Array;
}

export interface SecretInspection {
  readonly secretRef: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly name: string;
  readonly status: "present" | "missing";
  readonly accessMode: "0600";
}

export interface SecretCleanupPolicy {
  readonly kind: "explicit-secret-cleanup";
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly name: string;
  readonly reason: string;
}

export interface SecretCleanupResult {
  readonly secretRef: string;
  readonly outcome: "deleted" | "missing";
}

export interface SecretStorePort {
  write(input: SecretWriteInput): Promise<FileSecretRef>;
  read(ref: FileSecretRef): Promise<Uint8Array>;
  inspect(ref: FileSecretRef): Promise<SecretInspection>;
  cleanup(ref: FileSecretRef, policy: SecretCleanupPolicy): Promise<SecretCleanupResult>;
}

export type SecretStoreErrorCode =
  | "SECRET_STORE_INVALID_SCOPE"
  | "SECRET_STORE_INVALID_REF"
  | "SECRET_STORE_PATH_ESCAPE"
  | "SECRET_STORE_SYMLINK_REJECTED"
  | "SECRET_STORE_INVALID_PERMISSIONS"
  | "SECRET_STORE_NOT_FOUND"
  | "SECRET_STORE_CONTENT_INVALID"
  | "SECRET_STORE_CLEANUP_POLICY_REQUIRED"
  | "SECRET_STORE_IO_FAILED";

export class SecretStoreError extends Error {
  constructor(readonly code: SecretStoreErrorCode) {
    super(code);
    this.name = "SecretStoreError";
  }
}

const SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SECRET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REF = /^file\/v1\/([^/]+)\/([^/]+)\/([^/]+)$/;
const MAX_SECRET_BYTES = 1_048_576;

export class FileSecretStore implements SecretStorePort {
  readonly #root: string;

  constructor(root: string) {
    if (!isAbsolute(root)) throw new SecretStoreError("SECRET_STORE_PATH_ESCAPE");
    this.#root = resolve(root);
  }

  async write(input: SecretWriteInput): Promise<FileSecretRef> {
    validateScope(input.deploymentId, input.instanceId, input.name);
    const content =
      typeof input.content === "string"
        ? Buffer.from(input.content, "utf8")
        : Buffer.from(input.content);
    if (content.length === 0 || content.length > MAX_SECRET_BYTES) {
      throw new SecretStoreError("SECRET_STORE_CONTENT_INVALID");
    }
    const directory = this.#directory(input.deploymentId, input.instanceId);
    const target = this.#target(input.deploymentId, input.instanceId, input.name);
    const staging = resolve(directory, `.${input.name}.${randomUUID()}.tmp`);
    await this.#prepareDirectory(directory);
    await this.#safeFileStatus(target);
    assertContained(directory, staging);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(staging, "wx", 0o600);
      await handle.writeFile(content);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await chmod(staging, 0o600);
      await rename(staging, target);
      await chmod(target, 0o600);
      return Object.freeze({
        secretRef: secretRef(input.deploymentId, input.instanceId, input.name),
      });
    } catch (error) {
      if (handle !== undefined) await handle.close().catch(() => undefined);
      await unlink(staging).catch(() => undefined);
      if (error instanceof SecretStoreError) throw error;
      throw new SecretStoreError("SECRET_STORE_IO_FAILED");
    } finally {
      content.fill(0);
    }
  }

  async read(ref: FileSecretRef): Promise<Uint8Array> {
    const scope = parseRef(ref);
    const target = this.#target(scope.deploymentId, scope.instanceId, scope.name);
    const status = await this.#safeFileStatus(target);
    if (status === null) throw new SecretStoreError("SECRET_STORE_NOT_FOUND");
    if (process.platform !== "win32" && (status.mode & 0o077) !== 0) {
      throw new SecretStoreError("SECRET_STORE_INVALID_PERMISSIONS");
    }
    try {
      const content = await readFile(target);
      if (content.length === 0 || content.length > MAX_SECRET_BYTES) {
        content.fill(0);
        throw new SecretStoreError("SECRET_STORE_CONTENT_INVALID");
      }
      return content;
    } catch (error) {
      if (error instanceof SecretStoreError) throw error;
      throw new SecretStoreError("SECRET_STORE_IO_FAILED");
    }
  }

  async inspect(ref: FileSecretRef): Promise<SecretInspection> {
    const scope = parseRef(ref);
    const target = this.#target(scope.deploymentId, scope.instanceId, scope.name);
    const status = await this.#safeFileStatus(target);
    if (status !== null && process.platform !== "win32" && (status.mode & 0o077) !== 0) {
      throw new SecretStoreError("SECRET_STORE_INVALID_PERMISSIONS");
    }
    return Object.freeze({
      secretRef: ref.secretRef,
      ...scope,
      status: status === null ? "missing" : "present",
      accessMode: "0600",
    });
  }

  async cleanup(ref: FileSecretRef, policy: SecretCleanupPolicy): Promise<SecretCleanupResult> {
    const scope = parseRef(ref);
    if (!isExactCleanupPolicy(policy, scope)) {
      throw new SecretStoreError("SECRET_STORE_CLEANUP_POLICY_REQUIRED");
    }
    const target = this.#target(scope.deploymentId, scope.instanceId, scope.name);
    const status = await this.#safeFileStatus(target);
    if (status === null) {
      return Object.freeze({ secretRef: ref.secretRef, outcome: "missing" });
    }
    try {
      await unlink(target);
      return Object.freeze({ secretRef: ref.secretRef, outcome: "deleted" });
    } catch {
      throw new SecretStoreError("SECRET_STORE_IO_FAILED");
    }
  }

  #directory(deploymentId: string, instanceId: string): string {
    const directory = resolve(this.#root, "deployments", deploymentId, "instances", instanceId);
    assertContained(this.#root, directory);
    return directory;
  }

  #target(deploymentId: string, instanceId: string, name: string): string {
    validateScope(deploymentId, instanceId, name);
    const directory = this.#directory(deploymentId, instanceId);
    const target = resolve(directory, `${name}.secret`);
    assertContained(directory, target);
    return target;
  }

  async #prepareDirectory(directory: string): Promise<void> {
    const segments = relative(this.#root, directory).split(sep);
    let current = this.#root;
    await mkdir(current, { recursive: true, mode: 0o700 });
    await requireSafeDirectory(current);
    await chmod(current, 0o700);
    for (const segment of segments) {
      current = resolve(current, segment);
      assertContained(this.#root, current);
      await mkdir(current, { mode: 0o700 }).catch((error: unknown) => {
        if (!isAlreadyExists(error)) throw error;
      });
      await requireSafeDirectory(current);
      await chmod(current, 0o700);
    }
  }

  async #safeFileStatus(target: string) {
    assertContained(this.#root, target);
    if (!(await this.#isExistingSafeDirectory(dirname(target)))) return null;
    try {
      const status = await lstat(target);
      if (status.isSymbolicLink()) {
        throw new SecretStoreError("SECRET_STORE_SYMLINK_REJECTED");
      }
      if (!status.isFile()) throw new SecretStoreError("SECRET_STORE_INVALID_REF");
      return status;
    } catch (error) {
      if (isNotFound(error)) return null;
      if (error instanceof SecretStoreError) throw error;
      throw new SecretStoreError("SECRET_STORE_IO_FAILED");
    }
  }

  async #isExistingSafeDirectory(directory: string): Promise<boolean> {
    const segments = relative(this.#root, directory).split(sep);
    let current = this.#root;
    for (const segment of ["", ...segments]) {
      if (segment !== "") {
        current = resolve(current, segment);
        assertContained(this.#root, current);
      }
      try {
        const status = await lstat(current);
        if (status.isSymbolicLink()) {
          throw new SecretStoreError("SECRET_STORE_SYMLINK_REJECTED");
        }
        if (!status.isDirectory()) throw new SecretStoreError("SECRET_STORE_PATH_ESCAPE");
      } catch (error) {
        if (isNotFound(error)) return false;
        if (error instanceof SecretStoreError) throw error;
        throw new SecretStoreError("SECRET_STORE_IO_FAILED");
      }
    }
    return true;
  }
}

function parseRef(ref: unknown): {
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly name: string;
} {
  if (
    typeof ref !== "object" ||
    ref === null ||
    !("secretRef" in ref) ||
    typeof ref.secretRef !== "string"
  ) {
    throw new SecretStoreError("SECRET_STORE_INVALID_REF");
  }
  const match = REF.exec(ref.secretRef);
  const deploymentId = match?.[1];
  const instanceId = match?.[2];
  const name = match?.[3];
  if (deploymentId === undefined || instanceId === undefined || name === undefined) {
    throw new SecretStoreError("SECRET_STORE_INVALID_REF");
  }
  validateScope(deploymentId, instanceId, name);
  return Object.freeze({ deploymentId, instanceId, name });
}

function isExactCleanupPolicy(
  policy: unknown,
  scope: {
    readonly deploymentId: string;
    readonly instanceId: string;
    readonly name: string;
  },
): boolean {
  return (
    typeof policy === "object" &&
    policy !== null &&
    "kind" in policy &&
    policy.kind === "explicit-secret-cleanup" &&
    "deploymentId" in policy &&
    policy.deploymentId === scope.deploymentId &&
    "instanceId" in policy &&
    policy.instanceId === scope.instanceId &&
    "name" in policy &&
    policy.name === scope.name &&
    "reason" in policy &&
    typeof policy.reason === "string" &&
    policy.reason.trim().length >= 8
  );
}

function secretRef(deploymentId: string, instanceId: string, name: string): string {
  return `file/v1/${deploymentId}/${instanceId}/${name}`;
}

function validateScope(deploymentId: string, instanceId: string, name: string): void {
  if (!SCOPE_ID.test(deploymentId) || !SCOPE_ID.test(instanceId) || !SECRET_NAME.test(name)) {
    throw new SecretStoreError("SECRET_STORE_INVALID_SCOPE");
  }
}

function assertContained(parent: string, candidate: string): void {
  const path = relative(parent, candidate);
  if (path === "" || path.startsWith(`..${sep}`) || path === ".." || isAbsolute(path)) {
    throw new SecretStoreError("SECRET_STORE_PATH_ESCAPE");
  }
}

async function requireSafeDirectory(path: string): Promise<void> {
  const status = await lstat(path);
  if (status.isSymbolicLink()) throw new SecretStoreError("SECRET_STORE_SYMLINK_REJECTED");
  if (!status.isDirectory()) throw new SecretStoreError("SECRET_STORE_PATH_ESCAPE");
}

function isAlreadyExists(error: unknown): boolean {
  return errorCode(error) === "EEXIST";
}

function isNotFound(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
