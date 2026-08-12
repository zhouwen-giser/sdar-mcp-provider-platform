import { createHmac } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { RuntimeDeploymentSnapshot } from "../../../packages/runtime-deployment/src/index.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface ExternalRuntimeCatalogAuthorizationPort {
  authorization(
    deployment: RuntimeDeploymentSnapshot,
    instanceId: string,
  ): Promise<string | undefined>;
}

interface ExternalRuntimeCatalogCredential {
  readonly providerId: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly secretFile: string;
  readonly issuer: string;
  readonly audience: string;
  readonly subjectId: string;
  readonly tenantId: string;
}

/**
 * Resolves deployment-bound Runtime catalog credentials without persisting secret material in PMS.
 * The descriptor is loaded once, while the HS256 secret is re-read for every discovery so an
 * atomic secret-file rotation takes effect without restarting the Worker.
 */
export class ExternalRuntimeCatalogCredentialResolver implements ExternalRuntimeCatalogAuthorizationPort {
  readonly #credentials: ReadonlyMap<string, ExternalRuntimeCatalogCredential>;

  private constructor(
    credentials: readonly ExternalRuntimeCatalogCredential[],
    private readonly now: () => Date,
  ) {
    this.#credentials = new Map(
      credentials.map((credential) => [credentialKey(credential), credential] as const),
    );
  }

  static async create(
    descriptorFile: string,
    options: { readonly now?: () => Date } = {},
  ): Promise<ExternalRuntimeCatalogCredentialResolver> {
    const source = await readPrivateFile(
      descriptorFile,
      "PMS_EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_FILE_INVALID",
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      throw new Error("PMS_EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_FILE_INVALID", { cause: error });
    }
    const credentials = parseDescriptor(parsed);
    return new ExternalRuntimeCatalogCredentialResolver(
      credentials,
      options.now ?? (() => new Date()),
    );
  }

  async authorization(
    deployment: RuntimeDeploymentSnapshot,
    instanceId: string,
  ): Promise<string | undefined> {
    if (deployment.runtimeAuthority !== "direct_container") return undefined;
    const credential = this.#credentials.get(
      credentialKey({
        providerId: String(deployment.providerId),
        deploymentId: String(deployment.deploymentId),
        instanceId,
      }),
    );
    if (credential === undefined) {
      throw new Error("EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_NOT_FOUND");
    }
    const secret = await readPrivateFile(
      credential.secretFile,
      "EXTERNAL_RUNTIME_CATALOG_SECRET_FILE_INVALID",
    );
    if (secret.length < 32 || secret.trim() !== secret || /[\0\s]/.test(secret)) {
      throw new Error("EXTERNAL_RUNTIME_CATALOG_SECRET_FILE_INVALID");
    }
    return `Bearer ${signJwt(credential, secret, this.now())}`;
  }
}

export class NoExternalRuntimeCatalogCredentialResolver implements ExternalRuntimeCatalogAuthorizationPort {
  readonly #allowUnauthenticatedDirect: boolean;

  constructor(options: { readonly allowUnauthenticatedDirect?: boolean } = {}) {
    this.#allowUnauthenticatedDirect = options.allowUnauthenticatedDirect === true;
  }

  authorization(deployment: RuntimeDeploymentSnapshot): Promise<string | undefined> {
    if (deployment.runtimeAuthority === "direct_container") {
      if (this.#allowUnauthenticatedDirect) return Promise.resolve(undefined);
      return Promise.reject(new Error("EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_NOT_CONFIGURED"));
    }
    return Promise.resolve(undefined);
  }
}

function parseDescriptor(source: unknown): readonly ExternalRuntimeCatalogCredential[] {
  if (
    !isRecord(source) ||
    Object.keys(source).some((key) => key !== "credentials") ||
    !Array.isArray(source.credentials)
  ) {
    throw new Error("PMS_EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_FILE_INVALID");
  }
  const credentials = source.credentials.map(parseCredential);
  const identities = new Set<string>();
  for (const credential of credentials) {
    const key = credentialKey(credential);
    if (identities.has(key)) {
      throw new Error("PMS_EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_DUPLICATE");
    }
    identities.add(key);
  }
  return Object.freeze(credentials);
}

function parseCredential(source: unknown): ExternalRuntimeCatalogCredential {
  if (!isRecord(source) || Object.keys(source).some((key) => !CREDENTIAL_FIELDS.has(key))) {
    throw new Error("PMS_EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_FILE_INVALID");
  }
  const providerId = identifier(source.providerId);
  const deploymentId = identifier(source.deploymentId);
  const instanceId = identifier(source.instanceId);
  const secretFile = privateFilePath(source.secretFile);
  const issuer = boundedString(source.issuer);
  const audience = boundedString(source.audience);
  const subjectId = boundedString(source.subjectId);
  const tenantId = boundedString(source.tenantId);
  return Object.freeze({
    providerId,
    deploymentId,
    instanceId,
    secretFile,
    issuer,
    audience,
    subjectId,
    tenantId,
  });
}

const CREDENTIAL_FIELDS = new Set([
  "providerId",
  "deploymentId",
  "instanceId",
  "secretFile",
  "issuer",
  "audience",
  "subjectId",
  "tenantId",
]);

function signJwt(
  credential: ExternalRuntimeCatalogCredential,
  secret: string,
  current: Date,
): string {
  const epochSeconds = Math.floor(current.getTime() / 1_000);
  if (!Number.isSafeInteger(epochSeconds)) {
    throw new Error("EXTERNAL_RUNTIME_CATALOG_CLOCK_INVALID");
  }
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: credential.issuer,
    aud: credential.audience,
    sub: credential.subjectId,
    tenant: credential.tenantId,
    iat: epochSeconds,
    nbf: epochSeconds - 5,
    exp: epochSeconds + 60,
  });
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

function encode(value: Readonly<Record<string, string | number>>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

async function readPrivateFile(path: string, code: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error(code);
  const expected = resolve(path);
  let status;
  let canonical;
  try {
    [status, canonical] = await Promise.all([lstat(expected), realpath(expected)]);
  } catch {
    throw new Error(code);
  }
  const permissions = status.mode & 0o777;
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    canonical !== expected ||
    status.size === 0 ||
    status.nlink !== 1 ||
    (process.platform !== "win32" && ((permissions & ~0o600) !== 0 || (permissions & 0o400) === 0))
  ) {
    throw new Error(code);
  }
  let parentStatus;
  const parent = dirname(expected);
  try {
    parentStatus = await lstat(parent);
    if (
      parentStatus.isSymbolicLink() ||
      !parentStatus.isDirectory() ||
      (await realpath(parent)) !== resolve(parent) ||
      (process.platform !== "win32" && (parentStatus.mode & 0o022) !== 0)
    ) {
      throw new Error(code);
    }
  } catch (error) {
    if (error instanceof Error && error.message === code) throw error;
    throw new Error(code, { cause: error });
  }
  return readFile(expected, "utf8");
}

function credentialKey(input: {
  readonly providerId: string;
  readonly deploymentId: string;
  readonly instanceId: string;
}) {
  return `${input.providerId}\u0000${input.deploymentId}\u0000${input.instanceId}`;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new Error("PMS_EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_FILE_INVALID");
  }
  return value;
}

function privateFilePath(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new Error("PMS_EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_FILE_INVALID");
  }
  return resolve(value);
}

function boundedString(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    value.trim() !== value ||
    /[\0\r\n]/.test(value)
  ) {
    throw new Error("PMS_EXTERNAL_RUNTIME_CATALOG_CREDENTIAL_FILE_INVALID");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
