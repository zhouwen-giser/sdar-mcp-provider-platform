import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const [secretRootArgument, repositoryRootArgument] = process.argv.slice(2);

try {
  if (secretRootArgument === undefined || repositoryRootArgument === undefined) {
    throw coded("SECRET_VALIDATOR_ARGUMENTS_REQUIRED");
  }
  const secretRoot = await checkedDirectory(secretRootArgument, "SECRET_ROOT", true);
  const repositoryRoot = await realpath(repositoryRootArgument);
  if (contains(repositoryRoot, secretRoot)) throw coded("SECRET_ROOT_MUST_BE_OUTSIDE_REPOSITORY");

  const apiRoot = await checkedDirectory(resolve(secretRoot, "api"), "API_SECRET_ROOT", true);
  const workerRoot = await checkedDirectory(
    resolve(secretRoot, "worker"),
    "WORKER_SECRET_ROOT",
    true,
  );
  await checkedDirectory(
    resolve(secretRoot, "runtime-control-plane"),
    "RUNTIME_CREDENTIAL_ROOT",
    true,
  );

  const postgresPassword = await checkedSecretFile(
    resolve(secretRoot, "postgres-password"),
    "POSTGRES_PASSWORD",
    false,
  );
  const databaseUrlSource = await checkedSecretFile(
    resolve(secretRoot, "pms-database-url"),
    "PMS_DATABASE_URL",
    true,
  );
  const databaseUrl = checkedPostgresUrl(databaseUrlSource, "PMS_DATABASE_URL_INVALID");
  if (
    databaseUrl.username !== "pms_admin" ||
    decodeURIComponent(databaseUrl.password) !== postgresPassword ||
    databaseUrl.hostname !== "pms-postgres" ||
    (databaseUrl.port !== "" && databaseUrl.port !== "5432") ||
    databaseUrl.pathname !== "/pms" ||
    databaseUrl.search.length > 0 ||
    databaseUrl.hash.length > 0
  ) {
    throw coded("PMS_DATABASE_URL_COMPOSE_MISMATCH");
  }

  const management = await checkedJsonFile(
    resolve(apiRoot, "management.json"),
    "MANAGEMENT_DESCRIPTOR",
  );
  const readers = management?.management?.reader;
  const administrators = management?.management?.administrator;
  if (
    !Array.isArray(readers) ||
    readers.length !== 0 ||
    !Array.isArray(administrators) ||
    administrators.length !== 0
  ) {
    throw coded("MANAGEMENT_DESCRIPTOR_MUST_BE_EMPTY");
  }

  const runtime = await checkedJsonFile(resolve(apiRoot, "runtime.json"), "RUNTIME_DESCRIPTOR");
  if (!Array.isArray(runtime?.runtimeConfig) || !Array.isArray(runtime?.runtimeRegistration)) {
    throw coded("RUNTIME_DESCRIPTOR_INVALID");
  }
  if (runtime.runtimeConfig.length !== 0 || runtime.runtimeRegistration.length !== 0) {
    throw coded("RUNTIME_DESCRIPTOR_MUST_BE_EMPTY");
  }

  const provisioning = await checkedJsonFile(
    resolve(workerRoot, "postgres-provisioning.json"),
    "POSTGRES_PROVISIONING",
  );
  if (
    typeof provisioning?.clusterRef !== "string" ||
    provisioning.clusterRef.length === 0 ||
    typeof provisioning?.adminSecretRef !== "string" ||
    provisioning.adminSecretRef.length === 0 ||
    typeof provisioning?.runtimePassword !== "string" ||
    provisioning.runtimePassword.length < 16
  ) {
    throw coded("POSTGRES_PROVISIONING_INVALID");
  }
  const adminUrl = checkedPostgresUrl(
    provisioning.adminDatabaseUrl,
    "POSTGRES_PROVISIONING_URL_INVALID",
  );
  if (
    adminUrl.username !== "pms_admin" ||
    decodeURIComponent(adminUrl.password) !== postgresPassword ||
    adminUrl.hostname !== "pms-postgres" ||
    (adminUrl.port !== "" && adminUrl.port !== "5432") ||
    adminUrl.pathname !== "/pms" ||
    adminUrl.search.length > 0 ||
    adminUrl.hash.length > 0
  ) {
    throw coded("POSTGRES_PROVISIONING_COMPOSE_MISMATCH");
  }

  await validateCredentialTree(secretRoot);
  process.stdout.write("PMS_CONSOLE_SECRET_PREFLIGHT_PASS\n");
} catch (error) {
  const code = error instanceof ValidationError ? error.code : "SECRET_VALIDATION_FAILED";
  process.stderr.write(`BLOCKED_CONFIGURATION:${code}\n`);
  process.exitCode = 2;
}

async function checkedDirectory(path, code, requireNodeOwner) {
  if (!isAbsolute(path)) throw coded(`${code}_ABSOLUTE_PATH_REQUIRED`);
  const metadata = await safeLstat(path, `${code}_INVALID`);
  const canonical = await safeRealpath(path, `${code}_INVALID`);
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || canonical !== resolve(path)) {
    throw coded(`${code}_INVALID`);
  }
  if ((metadata.mode & 0o077) !== 0 || (metadata.mode & 0o500) !== 0o500) {
    throw coded(`${code}_PERMISSIONS`);
  }
  if (requireNodeOwner && metadata.uid !== 1_000) throw coded(`${code}_OWNER_MUST_BE_1000`);
  return canonical;
}

async function checkedSecretFile(path, code, requireNodeOwner) {
  const metadata = await safeLstat(path, `${code}_INVALID`);
  const canonical = await safeRealpath(path, `${code}_INVALID`);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.nlink !== 1 ||
    canonical !== resolve(path) ||
    metadata.size === 0 ||
    metadata.size > 65_536
  ) {
    throw coded(`${code}_INVALID`);
  }
  const permissions = metadata.mode & 0o777;
  if ((permissions & ~0o600) !== 0 || (permissions & 0o400) === 0) {
    throw coded(`${code}_PERMISSIONS`);
  }
  if (requireNodeOwner && metadata.uid !== 1_000) throw coded(`${code}_OWNER_MUST_BE_1000`);
  return (await readFile(canonical, "utf8")).trim();
}

async function checkedJsonFile(path, code) {
  const source = await checkedSecretFile(path, code, true);
  try {
    const value = JSON.parse(source);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw coded(`${code}_INVALID`);
    }
    return value;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw coded(`${code}_INVALID`);
  }
}

function checkedPostgresUrl(source, code) {
  if (typeof source !== "string") throw coded(code);
  let url;
  try {
    url = new URL(source);
  } catch {
    throw coded(code);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.password.length === 0) {
    throw coded(code);
  }
  return url;
}

async function validateCredentialTree(secretRoot) {
  const pending = [resolve(secretRoot, "runtime-control-plane")];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) continue;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw coded("RUNTIME_CREDENTIAL_SYMLINK_FORBIDDEN");
      if (entry.isDirectory()) {
        await checkedDirectory(path, "RUNTIME_CREDENTIAL_DIRECTORY", true);
        pending.push(path);
      } else if (entry.isFile()) {
        await checkedSecretFile(path, "RUNTIME_CREDENTIAL_FILE", true);
      } else {
        throw coded("RUNTIME_CREDENTIAL_ENTRY_INVALID");
      }
    }
  }
}

async function safeLstat(path, code) {
  try {
    return await lstat(path);
  } catch {
    throw coded(code);
  }
}

async function safeRealpath(path, code) {
  try {
    return await realpath(path);
  } catch {
    throw coded(code);
  }
}

function contains(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function coded(code) {
  return new ValidationError(code);
}

class ValidationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
