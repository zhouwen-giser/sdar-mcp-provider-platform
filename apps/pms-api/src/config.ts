import * as crypto from "node:crypto";
import { lstat, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import type { PmsApiRole } from "./authorization.js";
import { SDAR_REGISTRY_PROJECTION_TTL_SECONDS_DEFAULT } from "./sdar-registry-projection.js";

export const PMS_API_FROZEN_PROTOCOL_VERSION = "2026-07-28";

const PMS_API_PORT_DEFAULT = 8090;
const PMS_API_RUNTIME_HEARTBEAT_TTL_MS_DEFAULT = 30_000;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ENVIRONMENT = /^[a-z][a-z0-9-]{0,62}$/;
const RUNTIME_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const MAX_TOKEN_LENGTH = 8_192;
const DIGEST_HEX = /^[0-9a-f]{64}$/i;

export const runtimeConfigScopes = [
  "runtime:config:read",
  "runtime:config:watch",
  "runtime:config:ack",
] as const;

export const runtimeRegistrationScopes = ["runtime:register", "runtime:heartbeat"] as const;

export type RuntimeConfigScope = (typeof runtimeConfigScopes)[number];
export type RuntimeRegistrationScope = (typeof runtimeRegistrationScopes)[number];

const RUNTIME_CONFIG_SCOPE_SET = new Set(runtimeConfigScopes);
const RUNTIME_REGISTRATION_SCOPE_SET = new Set(runtimeRegistrationScopes);

const DISALLOWED_INLINE_SECRET_VARIABLES = [
  "PMS_DATABASE_URL",
  "DATABASE_URL",
  "PMS_ADMIN_TOKEN",
  "PMS_MANAGEMENT_TOKEN",
  "PMS_RUNTIME_TOKEN",
  "PMS_RUNTIME_CONFIG_TOKEN",
  "PMS_RUNTIME_REGISTRATION_TOKEN",
] as const;

export type PmsApiBootstrapErrorCode =
  | "PMS_API_INLINE_SECRET_REJECTED"
  | "PMS_API_HOST_INVALID"
  | "PMS_API_PORT_INVALID"
  | "PMS_API_DATABASE_URL_FILE_REQUIRED"
  | "PMS_API_DATABASE_URL_FILE_EMPTY"
  | "PMS_API_MANAGEMENT_CREDENTIAL_FILE_NOT_CONFIGURED"
  | "PMS_API_MANAGEMENT_CREDENTIAL_FILE_INVALID"
  | "PMS_API_RUNTIME_CREDENTIAL_FILE_NOT_CONFIGURED"
  | "PMS_API_RUNTIME_CREDENTIAL_FILE_INVALID"
  | "PMS_API_RUNTIME_HEARTBEAT_TTL_MS_INVALID"
  | "PMS_API_SDAR_REGISTRY_PROJECTION_TTL_SECONDS_INVALID"
  | "PMS_API_CREDENTIAL_PATH_NOT_ABSOLUTE"
  | "PMS_API_CREDENTIAL_PATH_NOT_FILE"
  | "PMS_API_CREDENTIAL_PATH_IS_SYMLINK"
  | "PMS_API_CREDENTIAL_PATH_PERMISSIONS_VIOLATION"
  | "PMS_API_CREDENTIAL_EMPTY"
  | "PMS_API_CREDENTIAL_READ_ERROR"
  | "PMS_API_CREDENTIAL_DESCRIPTOR_PLAINTEXT_TOKEN"
  | "PMS_API_CREDENTIAL_TOKEN_INVALID"
  | "PMS_API_CREDENTIAL_IDENTITY_INVALID"
  | "PMS_API_CREDENTIAL_SCOPE_INVALID"
  | "PMS_API_CREDENTIAL_PROTOCOL_VERSION_UNSUPPORTED"
  | "PMS_API_CREDENTIAL_FORMAT_INVALID";

export class PmsApiBootstrapError extends Error {
  readonly code: PmsApiBootstrapErrorCode;

  constructor(code: PmsApiBootstrapErrorCode) {
    super(code);
    this.name = "PmsApiBootstrapError";
    this.code = code;
  }
}

export interface FileBackedManagementPrincipal {
  readonly subjectId: string;
  readonly roles: readonly PmsApiRole[];
  readonly tokenDigest: string;
  readonly tokenFile: string;
}

export interface FileBackedRuntimeConfigPrincipal {
  readonly subjectId: string;
  readonly providerId: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly environment: string;
  readonly runtimeVersion: string;
  readonly protocolVersion: string;
  readonly scopes: readonly RuntimeConfigScope[];
  readonly tokenDigest: string;
  readonly tokenFile: string;
}

export interface FileBackedRuntimeRegistrationPrincipal {
  readonly subjectId: string;
  readonly providerId: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly runtimeVersion: string;
  readonly protocolVersion: string;
  readonly scopes: readonly RuntimeRegistrationScope[];
  readonly tokenDigest: string;
  readonly tokenFile: string;
}

export interface PmsManagementCredentials {
  readonly readers: readonly FileBackedManagementPrincipal[];
  readonly administrators: readonly FileBackedManagementPrincipal[];
}

export interface PmsRuntimeCredentials {
  readonly config: readonly FileBackedRuntimeConfigPrincipal[];
  readonly registration: readonly FileBackedRuntimeRegistrationPrincipal[];
}

export interface PmsApiBootstrapConfig {
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly runtimeHeartbeatTtlMs: number;
  readonly sdarRegistryProjectionTtlSeconds: number;
  readonly managementCredentialFile: string;
  readonly runtimeCredentialFile: string;
  readonly management: PmsManagementCredentials;
  readonly runtime: PmsRuntimeCredentials;
}

export interface ManagementCredentialSection {
  readonly reader?: readonly Record<string, unknown>[];
  readonly administrator?: readonly Record<string, unknown>[];
}

interface CredentialFileDescriptor {
  readonly management?: ManagementCredentialSection;
  readonly runtimeConfig?: readonly Record<string, unknown>[];
  readonly runtimeRegistration?: readonly Record<string, unknown>[];
}

export async function loadPmsApiBootstrapConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PmsApiBootstrapConfig> {
  rejectInlineSecrets(environment);

  const host = parseHost(environment.PMS_API_HOST);
  const port = parsePort(environment.PMS_API_PORT);
  const runtimeHeartbeatTtlMs = parseHeartbeatTtl(environment.PMS_API_RUNTIME_HEARTBEAT_TTL_MS);
  const sdarRegistryProjectionTtlSeconds = parseSdarRegistryProjectionTtl(
    environment.SDAR_REGISTRY_PROJECTION_TTL_SECONDS,
  );

  const databaseUrlFile = readRequiredAbsolutePath(
    environment.PMS_DATABASE_URL_FILE,
    "PMS_API_DATABASE_URL_FILE_REQUIRED",
  );
  const databaseUrl = await readCredentialText(databaseUrlFile, "PMS_API_DATABASE_URL_FILE_EMPTY");

  const managementCredentialFile = readRequiredAbsolutePath(
    environment.PMS_MANAGEMENT_CREDENTIAL_FILE,
    "PMS_API_MANAGEMENT_CREDENTIAL_FILE_NOT_CONFIGURED",
  );
  const runtimeCredentialFile = readRequiredAbsolutePath(
    environment.PMS_RUNTIME_CREDENTIAL_FILE,
    "PMS_API_RUNTIME_CREDENTIAL_FILE_NOT_CONFIGURED",
  );

  const { management, runtime } = await parseCredentialFiles(
    managementCredentialFile,
    runtimeCredentialFile,
  );

  return {
    host,
    port,
    databaseUrl,
    runtimeHeartbeatTtlMs,
    sdarRegistryProjectionTtlSeconds,
    managementCredentialFile,
    runtimeCredentialFile,
    management,
    runtime,
  };
}

function parseHost(value: string | undefined): string {
  const host = value === undefined || value.trim().length === 0 ? "127.0.0.1" : value.trim();
  if (host.length === 0) {
    throw new PmsApiBootstrapError("PMS_API_HOST_INVALID");
  }
  return host;
}

function parsePort(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? String(PMS_API_PORT_DEFAULT), 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new PmsApiBootstrapError("PMS_API_PORT_INVALID");
  }
  return value;
}

function parseHeartbeatTtl(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? String(PMS_API_RUNTIME_HEARTBEAT_TTL_MS_DEFAULT), 10);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 300_000) {
    throw new PmsApiBootstrapError("PMS_API_RUNTIME_HEARTBEAT_TTL_MS_INVALID");
  }
  return value;
}

function parseSdarRegistryProjectionTtl(raw: string | undefined): number {
  const normalized = raw?.trim();
  if (normalized !== undefined && !/^[1-9][0-9]*$/.test(normalized)) {
    throw new PmsApiBootstrapError("PMS_API_SDAR_REGISTRY_PROJECTION_TTL_SECONDS_INVALID");
  }
  const value =
    normalized === undefined ? SDAR_REGISTRY_PROJECTION_TTL_SECONDS_DEFAULT : Number(normalized);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new PmsApiBootstrapError("PMS_API_SDAR_REGISTRY_PROJECTION_TTL_SECONDS_INVALID");
  }
  return value;
}

function rejectInlineSecrets(environment: NodeJS.ProcessEnv): void {
  for (const variable of DISALLOWED_INLINE_SECRET_VARIABLES) {
    if (environment[variable] !== undefined) {
      throw new PmsApiBootstrapError("PMS_API_INLINE_SECRET_REJECTED");
    }
  }
}

async function parseCredentialFiles(
  managementCredentialFile: string,
  runtimeCredentialFile: string,
): Promise<{
  readonly management: PmsManagementCredentials;
  readonly runtime: PmsRuntimeCredentials;
}> {
  const managementSource = await readCredentialText(
    managementCredentialFile,
    "PMS_API_MANAGEMENT_CREDENTIAL_FILE_INVALID",
  );
  const runtimeSource = await readCredentialText(
    runtimeCredentialFile,
    "PMS_API_RUNTIME_CREDENTIAL_FILE_INVALID",
  );

  const managementDescriptor = parseDescriptor(
    managementSource,
    "PMS_API_MANAGEMENT_CREDENTIAL_FILE_INVALID",
  );
  const runtimeDescriptor = parseDescriptor(
    runtimeSource,
    "PMS_API_RUNTIME_CREDENTIAL_FILE_INVALID",
  );

  if (containsPlainToken(managementDescriptor) || containsPlainToken(runtimeDescriptor)) {
    throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_DESCRIPTOR_PLAINTEXT_TOKEN");
  }

  const management = await parseManagementCredentials(managementDescriptor);
  const runtime = await parseRuntimeCredentials(runtimeDescriptor);
  return { management, runtime };
}

function parseDescriptor(
  source: string,
  invalidCode: PmsApiBootstrapErrorCode,
): CredentialFileDescriptor {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new PmsApiBootstrapError(invalidCode);
  }
  if (!isRecord(value)) {
    throw new PmsApiBootstrapError(invalidCode);
  }
  return value;
}

async function parseManagementCredentials(
  descriptor: CredentialFileDescriptor,
): Promise<PmsManagementCredentials> {
  if (descriptor.management === undefined) {
    throw new PmsApiBootstrapError("PMS_API_MANAGEMENT_CREDENTIAL_FILE_INVALID");
  }
  return {
    readers: await parseManagementPrincipalList(descriptor.management.reader, "reader"),
    administrators: await parseManagementPrincipalList(
      descriptor.management.administrator,
      "administrator",
    ),
  };
}

async function parseManagementPrincipalList(
  entries: unknown,
  role: "reader" | "administrator",
): Promise<FileBackedManagementPrincipal[]> {
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) {
    throw new PmsApiBootstrapError("PMS_API_MANAGEMENT_CREDENTIAL_FILE_INVALID");
  }
  return Promise.all(entries.map((entry) => parseManagementPrincipal(entry, role)));
}

async function parseManagementPrincipal(
  raw: unknown,
  role: "reader" | "administrator",
): Promise<FileBackedManagementPrincipal> {
  const entry = asRecord(raw, "PMS_API_MANAGEMENT_CREDENTIAL_FILE_INVALID");
  const subjectId = readIdentifier(entry, "subjectId");
  const tokenFile = readAbsolutePath(entry, "tokenFile");
  const tokenDigest = await tokenDigestFromFile(
    tokenFile,
    "PMS_API_MANAGEMENT_CREDENTIAL_FILE_INVALID",
  );
  return {
    subjectId,
    roles: [role],
    tokenDigest,
    tokenFile,
  };
}

async function parseRuntimeCredentials(
  descriptor: CredentialFileDescriptor,
): Promise<PmsRuntimeCredentials> {
  if (descriptor.runtimeConfig === undefined && descriptor.runtimeRegistration === undefined) {
    throw new PmsApiBootstrapError("PMS_API_RUNTIME_CREDENTIAL_FILE_INVALID");
  }
  return {
    config: await parseRuntimeConfigPrincipals(descriptor.runtimeConfig),
    registration: await parseRuntimeRegistrationPrincipals(descriptor.runtimeRegistration),
  };
}

async function parseRuntimeConfigPrincipals(
  entries: unknown,
): Promise<readonly FileBackedRuntimeConfigPrincipal[]> {
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) {
    throw new PmsApiBootstrapError("PMS_API_RUNTIME_CREDENTIAL_FILE_INVALID");
  }
  return Promise.all(entries.map((entry) => parseRuntimeConfigPrincipal(entry)));
}

async function parseRuntimeConfigPrincipal(
  raw: unknown,
): Promise<FileBackedRuntimeConfigPrincipal> {
  const entry = asRecord(raw, "PMS_API_RUNTIME_CREDENTIAL_FILE_INVALID");
  const subjectId = readIdentifier(entry, "subjectId");
  const providerId = readIdentifier(entry, "providerId");
  const deploymentId = readIdentifier(entry, "deploymentId");
  const instanceId = readIdentifier(entry, "instanceId");
  const environment = readEnvironment(entry, "environment");
  const runtimeVersion = readRuntimeVersion(entry, "runtimeVersion");
  const protocolVersion = readFrozenProtocolVersion(entry);
  const scopes = readScopeArray(entry, "scopes", RUNTIME_CONFIG_SCOPE_SET);
  const tokenFile = readAbsolutePath(entry, "tokenFile");
  const tokenDigest = await tokenDigestFromFile(
    tokenFile,
    "PMS_API_RUNTIME_CREDENTIAL_FILE_INVALID",
  );
  return {
    subjectId,
    providerId,
    deploymentId,
    instanceId,
    environment,
    runtimeVersion,
    protocolVersion,
    scopes,
    tokenDigest,
    tokenFile,
  };
}

async function parseRuntimeRegistrationPrincipals(
  entries: unknown,
): Promise<readonly FileBackedRuntimeRegistrationPrincipal[]> {
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) {
    throw new PmsApiBootstrapError("PMS_API_RUNTIME_CREDENTIAL_FILE_INVALID");
  }
  return Promise.all(entries.map((entry) => parseRuntimeRegistrationPrincipal(entry)));
}

async function parseRuntimeRegistrationPrincipal(
  raw: unknown,
): Promise<FileBackedRuntimeRegistrationPrincipal> {
  const entry = asRecord(raw, "PMS_API_RUNTIME_CREDENTIAL_FILE_INVALID");
  const subjectId = readIdentifier(entry, "subjectId");
  const providerId = readIdentifier(entry, "providerId");
  const deploymentId = readIdentifier(entry, "deploymentId");
  const instanceId = readIdentifier(entry, "instanceId");
  const runtimeVersion = readRuntimeVersion(entry, "runtimeVersion");
  const protocolVersion = readFrozenProtocolVersion(entry);
  const scopes = readScopeArray(entry, "scopes", RUNTIME_REGISTRATION_SCOPE_SET);
  const tokenFile = readAbsolutePath(entry, "tokenFile");
  const tokenDigest = await tokenDigestFromFile(
    tokenFile,
    "PMS_API_RUNTIME_CREDENTIAL_FILE_INVALID",
  );
  return {
    subjectId,
    providerId,
    deploymentId,
    instanceId,
    runtimeVersion,
    protocolVersion,
    scopes,
    tokenDigest,
    tokenFile,
  };
}

function readFrozenProtocolVersion(entry: Record<string, unknown>): string {
  if ("protocolVersion" in entry) {
    const protocolVersion = readString(entry, "protocolVersion");
    if (protocolVersion !== PMS_API_FROZEN_PROTOCOL_VERSION) {
      throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_PROTOCOL_VERSION_UNSUPPORTED");
    }
    return protocolVersion;
  }
  return PMS_API_FROZEN_PROTOCOL_VERSION;
}

function readIdentifier(entry: Record<string, unknown>, field: string): string {
  const value = readString(entry, field);
  if (!IDENTIFIER.test(value)) {
    throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_IDENTITY_INVALID");
  }
  return value;
}

function readEnvironment(entry: Record<string, unknown>, field: string): string {
  const value = readString(entry, field);
  if (!ENVIRONMENT.test(value)) {
    throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_IDENTITY_INVALID");
  }
  return value;
}

function readRuntimeVersion(entry: Record<string, unknown>, field: string): string {
  const value = readString(entry, field);
  if (!RUNTIME_VERSION.test(value)) {
    throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_IDENTITY_INVALID");
  }
  return value;
}

function readAbsolutePath(entry: Record<string, unknown>, field: string): string {
  const path = readString(entry, field);
  if (!isAbsolute(path)) {
    throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_PATH_NOT_ABSOLUTE");
  }
  return path;
}

function readScopeArray<T extends string>(
  entry: Record<string, unknown>,
  field: string,
  allowed: ReadonlySet<T>,
): readonly T[] {
  const raw = entry[field];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_SCOPE_INVALID");
  }
  const normalized = new Set<T>();
  for (const scope of raw) {
    if (typeof scope !== "string" || !allowed.has(scope as T)) {
      throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_SCOPE_INVALID");
    }
    normalized.add(scope as T);
  }
  return [...normalized];
}

function readString(entry: Record<string, unknown>, field: string): string {
  const value = entry[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_FORMAT_INVALID");
  }
  return value;
}

function asRecord(value: unknown, code: PmsApiBootstrapErrorCode): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new PmsApiBootstrapError(code);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordOrArray(value: unknown): value is Record<string, unknown> | readonly unknown[] {
  return typeof value === "object" && value !== null;
}

function containsPlainToken(value: unknown): boolean {
  if (!isRecordOrArray(value)) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(containsPlainToken);
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "token") {
      return true;
    }
    if (containsPlainToken(child)) {
      return true;
    }
  }
  return false;
}

function isUnix(): boolean {
  return process.platform !== "win32";
}

function validateFileMode(mode: number): void {
  if (!isUnix()) return;
  if ((mode & 0o777) > 0o600) {
    throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_PATH_PERMISSIONS_VIOLATION");
  }
}

function validateDirectoryMode(mode: number): void {
  if (!isUnix()) return;
  if ((mode & 0o022) !== 0) {
    throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_PATH_PERMISSIONS_VIOLATION");
  }
}

export async function assertCredentialFile(
  path: string,
  code: PmsApiBootstrapErrorCode = "PMS_API_CREDENTIAL_READ_ERROR",
): Promise<string> {
  if (!isAbsolute(path)) {
    throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_PATH_NOT_ABSOLUTE");
  }
  try {
    const candidate = await lstat(path);
    if (candidate.isSymbolicLink()) {
      throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_PATH_IS_SYMLINK");
    }
    if (!candidate.isFile()) {
      throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_PATH_NOT_FILE");
    }
    validateFileMode(candidate.mode);
  } catch (error) {
    if (error instanceof PmsApiBootstrapError) {
      throw error;
    }
    throw new PmsApiBootstrapError(code);
  }

  if (isUnix()) {
    try {
      const parent = await stat(dirname(path));
      validateDirectoryMode(parent.mode);
    } catch (error) {
      if (error instanceof PmsApiBootstrapError) {
        throw error;
      }
      throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_PATH_PERMISSIONS_VIOLATION");
    }
  }

  return path;
}

function readRequiredAbsolutePath(
  value: string | undefined,
  missingCode: PmsApiBootstrapErrorCode,
): string {
  if (value === undefined || value.trim().length === 0) {
    throw new PmsApiBootstrapError(missingCode);
  }
  if (!isAbsolute(value)) {
    throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_PATH_NOT_ABSOLUTE");
  }
  return value;
}

export async function tokenDigestFromFile(
  path: string,
  invalidCode: PmsApiBootstrapErrorCode,
): Promise<string> {
  const validatedPath = await assertCredentialFile(path, invalidCode);
  let token: string;
  try {
    token = (await readFile(validatedPath, "utf8")).trim();
  } catch {
    throw new PmsApiBootstrapError(invalidCode);
  }
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) {
    throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_TOKEN_INVALID");
  }
  return hashSecretToken(token);
}

export async function readCredentialText(
  path: string,
  emptyCode: PmsApiBootstrapErrorCode,
): Promise<string> {
  const validatedPath = await assertCredentialFile(path, "PMS_API_CREDENTIAL_READ_ERROR");
  let value: string;
  try {
    value = (await readFile(validatedPath, "utf8")).trim();
  } catch {
    throw new PmsApiBootstrapError("PMS_API_CREDENTIAL_READ_ERROR");
  }
  if (value.length === 0) {
    throw new PmsApiBootstrapError(emptyCode);
  }
  return value;
}

export function hashSecretToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function hashEquals(left: string, right: string): boolean {
  if (!DIGEST_HEX.test(left) || !DIGEST_HEX.test(right)) {
    return false;
  }
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBytes, rightBytes);
}

export function tokenMatches(actual: string, expectedDigest: string): boolean {
  return hashEquals(hashSecretToken(actual), expectedDigest);
}
