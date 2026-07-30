import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const SEGMENT_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,127})$/;
const TOKEN_FILE_NAME = "control-plane.token";

export interface RuntimeControlPlaneCredentialIdentity {
  readonly providerId: string;
  readonly deploymentId: string;
  readonly instanceId: string;
}

export interface RuntimeControlPlaneCredentialResolverContract {
  resolve(identity: RuntimeControlPlaneCredentialIdentity): Promise<string>;
}

export class RuntimeControlPlaneCredentialResolver implements RuntimeControlPlaneCredentialResolverContract {
  private constructor(private readonly credentialRoot: string) {}

  static async create(root: string): Promise<RuntimeControlPlaneCredentialResolver> {
    const canonicalRoot = await validateCredentialRoot(root);
    return new RuntimeControlPlaneCredentialResolver(canonicalRoot);
  }

  async resolve(identity: RuntimeControlPlaneCredentialIdentity): Promise<string> {
    const providerId = validateSegment(identity.providerId);
    const deploymentId = validateSegment(identity.deploymentId);
    const instanceId = validateSegment(identity.instanceId);
    await assertRootUnchanged(this.credentialRoot);
    const parents = [
      resolve(this.credentialRoot, "providers"),
      resolve(this.credentialRoot, "providers", providerId),
      resolve(this.credentialRoot, "providers", providerId, "deployments"),
      resolve(this.credentialRoot, "providers", providerId, "deployments", deploymentId),
      resolve(
        this.credentialRoot,
        "providers",
        providerId,
        "deployments",
        deploymentId,
        "instances",
      ),
      resolve(
        this.credentialRoot,
        "providers",
        providerId,
        "deployments",
        deploymentId,
        "instances",
        instanceId,
      ),
    ];
    for (const parent of parents) {
      assertContained(this.credentialRoot, parent);
      await validateCredentialParent(parent);
    }
    const tokenFile = resolve(parents.at(-1) ?? "", TOKEN_FILE_NAME);
    assertContained(this.credentialRoot, tokenFile);
    await validateCredentialFile(tokenFile);
    return tokenFile;
  }
}

async function validateCredentialRoot(source: string): Promise<string> {
  if (!isAbsolute(source)) throw credentialError("ROOT_INVALID");
  const expected = resolve(source);
  let status;
  let canonical;
  try {
    [status, canonical] = await Promise.all([lstat(expected), realpath(expected)]);
  } catch {
    throw credentialError("ROOT_INVALID");
  }
  if (status.isSymbolicLink() || !status.isDirectory() || canonical !== expected) {
    throw credentialError("ROOT_INVALID");
  }
  if ((status.mode & 0o077) !== 0) throw credentialError("ROOT_PERMISSIONS");
  return canonical;
}

async function assertRootUnchanged(root: string): Promise<void> {
  let status;
  let canonical;
  try {
    [status, canonical] = await Promise.all([lstat(root), realpath(root)]);
  } catch {
    throw credentialError("ROOT_INVALID");
  }
  if (
    status.isSymbolicLink() ||
    !status.isDirectory() ||
    canonical !== root ||
    (status.mode & 0o077) !== 0
  ) {
    throw credentialError("ROOT_INVALID");
  }
}

async function validateCredentialParent(path: string): Promise<void> {
  let status;
  let canonical;
  try {
    [status, canonical] = await Promise.all([lstat(path), realpath(path)]);
  } catch {
    throw credentialError("PARENT_UNSAFE");
  }
  if (
    status.isSymbolicLink() ||
    !status.isDirectory() ||
    canonical !== path ||
    (status.mode & 0o022) !== 0
  ) {
    throw credentialError("PARENT_UNSAFE");
  }
}

async function validateCredentialFile(path: string): Promise<void> {
  let status;
  let canonical;
  try {
    [status, canonical] = await Promise.all([lstat(path), realpath(path)]);
  } catch {
    throw credentialError("TOKEN_INVALID");
  }
  if (status.isSymbolicLink() || !status.isFile() || canonical !== path || status.size === 0) {
    throw credentialError("TOKEN_INVALID");
  }
  if (status.nlink !== 1) throw credentialError("TOKEN_DUPLICATE_MAPPING");
  const permissions = status.mode & 0o777;
  if ((permissions & ~0o600) !== 0 || (permissions & 0o400) === 0) {
    throw credentialError("TOKEN_PERMISSIONS");
  }
  if ((await readFile(path, "utf8")).trim().length === 0) {
    throw credentialError("TOKEN_INVALID");
  }
}

function validateSegment(segment: string): string {
  if (
    !SEGMENT_PATTERN.test(segment) ||
    segment === "." ||
    segment === ".." ||
    segment.includes("..")
  ) {
    throw credentialError("IDENTITY_INVALID");
  }
  return segment;
}

function assertContained(root: string, candidate: string): void {
  const path = relative(root, candidate);
  if (path === "" || path.startsWith("..") || isAbsolute(path)) {
    throw credentialError("ROOT_ESCAPE");
  }
}

function credentialError(code: string): Error {
  return new Error(`PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_${code}`);
}
