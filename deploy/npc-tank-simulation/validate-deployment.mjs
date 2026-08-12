import {
  accessSync,
  constants as fsConstants,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const EXPECTED_BRANCH = "codex/goal-11-npc-tank-simulation-real-interface";
const SECRET_FILE_VARIABLES = [
  "NPC_TANK_ADAPTER_DB_PASSWORD_FILE",
  "NPC_TANK_ADAPTER_DATABASE_URL_FILE",
  "NPC_TANK_RUNTIME_DB_PASSWORD_FILE",
  "NPC_TANK_RUNTIME_DATABASE_URL_FILE",
  "NPC_TANK_SIM_DEVICE_MCP_HEADERS_FILE",
  "NPC_TANK_SIM_MQTT_PASSWORD_FILE",
  "NPC_TANK_SIM_MQTT_TLS_CA_FILE",
  "NPC_TANK_SIM_MQTT_TLS_CERT_FILE",
  "NPC_TANK_SIM_MQTT_TLS_KEY_FILE",
];

export class DeploymentValidationError extends Error {
  constructor(code, options = undefined) {
    super(code, options);
    this.name = "DeploymentValidationError";
    this.code = code;
  }
}

export function loadEnvironment(path, inherited = process.env) {
  const result = {};
  const source = readFileSync(path, "utf8");
  for (const [index, original] of source.split(/\r?\n/).entries()) {
    let line = original.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trimStart();
    const separator = line.indexOf("=");
    if (separator < 1) fail(`ENV_FILE_LINE_${String(index + 1)}_INVALID`);
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      fail(`ENV_FILE_LINE_${String(index + 1)}_KEY_INVALID`);
    result[key] = parseEnvValue(line.slice(separator + 1).trim(), index + 1);
  }
  return { ...result, ...inherited };
}

export function validateDeploymentEnvironment(environment, repositoryRoot, options = {}) {
  const root = realpathSync(repositoryRoot);
  const mcp = endpoint(environment, "NPC_TANK_SIM_DEVICE_MCP_URL", ["http:", "https:"]);
  const mqtt = endpoint(environment, "NPC_TANK_SIM_MQTT_URL", ["mqtt:", "mqtts:", "ws:", "wss:"]);
  for (const [name, value] of [
    ["NPC_TANK_SIM_DEVICE_MCP_URL", mcp],
    ["NPC_TANK_SIM_MQTT_URL", mqtt],
  ]) {
    if (value.username || value.password) fail(`${name}_CREDENTIALS_IN_URL_FORBIDDEN`);
    if (isContainerLoopback(value.hostname)) fail(`${name}_CONTAINER_LOOPBACK_FORBIDDEN`);
    if (/mock|simulator-mock/i.test(value.hostname)) fail(`${name}_KNOWN_MOCK_ENDPOINT_FORBIDDEN`);
  }
  if (mcp.pathname !== "/mcp") fail("NPC_TANK_SIM_DEVICE_MCP_URL_PATH_MUST_BE_MCP");

  required(environment, "PMS_CONSOLE_SECRET_ROOT");
  const credentialRoot = required(environment, "NPC_TANK_PMS_CREDENTIAL_ROOT");
  validatePmsCredentialRoot(credentialRoot, root);

  for (const name of SECRET_FILE_VARIABLES) {
    const path = optional(environment, name);
    if (path !== undefined) validateSecretFile(path, name, root);
  }
  for (const name of [
    "NPC_TANK_ADAPTER_DB_PASSWORD_FILE",
    "NPC_TANK_ADAPTER_DATABASE_URL_FILE",
    "NPC_TANK_RUNTIME_DB_PASSWORD_FILE",
    "NPC_TANK_RUNTIME_DATABASE_URL_FILE",
  ])
    required(environment, name);

  validateDatabasePair(environment, root, {
    passwordName: "NPC_TANK_ADAPTER_DB_PASSWORD_FILE",
    urlName: "NPC_TANK_ADAPTER_DATABASE_URL_FILE",
    user: "npc_adapter",
    host: "npc-adapter-postgres",
    database: "npc_adapter",
  });
  validateDatabasePair(environment, root, {
    passwordName: "NPC_TANK_RUNTIME_DB_PASSWORD_FILE",
    urlName: "NPC_TANK_RUNTIME_DATABASE_URL_FILE",
    user: "npc_runtime",
    host: "npc-runtime-postgres",
    database: "npc_runtime",
  });

  const wireMode = required(environment, "NPC_TANK_MQTT_WIRE_MODE");
  if (wireMode !== "ros_bridge_json") fail("NPC_TANK_MQTT_WIRE_MODE_COMPATIBILITY_REQUIRED");
  if (
    explicitBoolean(
      environment.NPC_TANK_DEVICE_MCP_ALLOW_MOCK_CONTRACT,
      "NPC_TANK_DEVICE_MCP_ALLOW_MOCK_CONTRACT",
      false,
    )
  )
    fail("NPC_TANK_DEVICE_MCP_MOCK_CONTRACT_FORBIDDEN");

  const control = explicitBoolean(
    environment.NPC_TANK_ENABLE_REAL_CONTROL,
    "NPC_TANK_ENABLE_REAL_CONTROL",
    false,
  );
  const recon = explicitBoolean(
    environment.NPC_TANK_ENABLE_RECON_TESTS,
    "NPC_TANK_ENABLE_RECON_TESTS",
    false,
  );
  const effector = explicitBoolean(
    environment.NPC_TANK_ENABLE_EFFECTOR_TESTS,
    "NPC_TANK_ENABLE_EFFECTOR_TESTS",
    false,
  );
  explicitBoolean(
    environment.NPC_TANK_REQUIRE_PMS_REGISTRY,
    "NPC_TANK_REQUIRE_PMS_REGISTRY",
    false,
  );

  if (options.runControl === true) {
    if (!control) fail("NPC_TANK_REAL_CONTROL_EXPLICIT_ENABLE_REQUIRED");
    const distance = Number(required(environment, "NPC_TANK_TEST_DISTANCE_M"));
    if (!Number.isFinite(distance) || distance <= 0 || distance > 5)
      fail("NPC_TANK_TEST_DISTANCE_M_MUST_BE_WITHIN_0_TO_5");
    validatePointFixture(
      required(environment, "NPC_TANK_TEST_SAFE_POINT_JSON"),
      "NPC_TANK_TEST_SAFE_POINT_JSON",
    );
    validateWaypointFixture(
      required(environment, "NPC_TANK_TEST_SAFE_WAYPOINTS_JSON"),
      "NPC_TANK_TEST_SAFE_WAYPOINTS_JSON",
    );
  }
  if (options.runRecon === true) {
    if (!recon) fail("NPC_TANK_RECON_EXPLICIT_ENABLE_REQUIRED");
    validateReconFixture(
      required(environment, "NPC_TANK_TEST_RECON_REGION_JSON"),
      "NPC_TANK_TEST_RECON_REGION_JSON",
    );
  }
  if (options.runEffector === true && !effector) fail("NPC_TANK_EFFECTOR_EXPLICIT_ENABLE_REQUIRED");

  return Object.freeze({
    wireMode,
    controlEnabled: control,
    reconEnabled: recon,
    effectorEnabled: effector,
  });
}

export function validateSecretFile(path, name, repositoryRoot) {
  if (!isAbsolute(path)) fail(`${name}_ABSOLUTE_PATH_REQUIRED`);
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch (cause) {
    fail(`${name}_STAT_FAILED`, cause);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`${name}_REGULAR_FILE_REQUIRED`);
  if (metadata.nlink !== 1) fail(`${name}_SINGLE_LINK_REQUIRED`);
  const resolved = realpathSync(path);
  assertExternal(resolved, repositoryRoot, name);
  const permissions = metadata.mode & 0o7777;
  if ((permissions & ~0o600) !== 0 || (permissions & 0o400) === 0)
    fail(`${name}_PERMISSIONS_MUST_NOT_EXCEED_0600`);
  try {
    accessSync(path, fsConstants.R_OK);
  } catch (cause) {
    fail(`${name}_READ_ACCESS_REQUIRED`, cause);
  }
  if (metadata.size === 0) fail(`${name}_EMPTY`);
  if (metadata.size > 1024 * 1024) fail(`${name}_TOO_LARGE`);
  return resolved;
}

export function qualificationSourceState(repositoryRoot) {
  const root = realpathSync(repositoryRoot);
  if (realpathSync(git(root, ["rev-parse", "--show-toplevel"]).trim()) !== root)
    fail("QUALIFICATION_REPOSITORY_ROOT_MISMATCH");
  const branch = git(root, ["branch", "--show-current"]).trim();
  if (branch !== EXPECTED_BRANCH) fail("QUALIFICATION_BRANCH_MISMATCH");
  const gitSha = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  if (!/^[0-9a-f]{40,64}$/.test(gitSha)) fail("QUALIFICATION_GIT_SHA_INVALID");
  const changed = new Set([
    ...gitPaths(root, ["diff", "--cached", "--name-only", "-z"]),
    ...gitPaths(root, ["diff", "--name-only", "-z"]),
    ...gitPaths(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  if ([...changed].some((path) => !path.startsWith("reports/npc-tank-simulation/")))
    fail("QUALIFICATION_SOURCE_TREE_DIRTY");
  return Object.freeze({
    branch,
    gitSha,
    trackedSourceClean: true,
    allowedEvidenceChanges: changed.size,
  });
}

function validatePmsCredentialRoot(path, repositoryRoot) {
  if (!isAbsolute(path)) fail("NPC_TANK_PMS_CREDENTIAL_ROOT_ABSOLUTE_PATH_REQUIRED");
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch (cause) {
    fail("NPC_TANK_PMS_CREDENTIAL_ROOT_STAT_FAILED", cause);
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    fail("NPC_TANK_PMS_CREDENTIAL_ROOT_DIRECTORY_REQUIRED");
  const root = realpathSync(path);
  assertExternal(root, repositoryRoot, "NPC_TANK_PMS_CREDENTIAL_ROOT");
  if ((metadata.mode & 0o077) !== 0)
    fail("NPC_TANK_PMS_CREDENTIAL_ROOT_PERMISSIONS_MUST_NOT_EXCEED_0700");
  validateCredentialTree(root, repositoryRoot);
  const management = parseJsonFile(resolve(root, "management.json"), "PMS_MANAGEMENT_DESCRIPTOR");
  const runtime = parseJsonFile(resolve(root, "runtime.json"), "PMS_RUNTIME_DESCRIPTOR");
  if (!isRecord(management.management)) fail("PMS_MANAGEMENT_DESCRIPTOR_INVALID");
  const readers = arrayOrEmpty(management.management.reader, "PMS_MANAGEMENT_DESCRIPTOR_INVALID");
  const administrators = arrayOrEmpty(
    management.management.administrator,
    "PMS_MANAGEMENT_DESCRIPTOR_INVALID",
  );
  if (administrators.length === 0) fail("PMS_MANAGEMENT_ADMINISTRATOR_REQUIRED");
  validatePrincipalTokenFiles([...readers, ...administrators], root, "PMS_MANAGEMENT_DESCRIPTOR");
  const runtimeConfig = arrayOrEmpty(runtime.runtimeConfig, "PMS_RUNTIME_DESCRIPTOR_INVALID");
  const runtimeRegistration = arrayOrEmpty(
    runtime.runtimeRegistration,
    "PMS_RUNTIME_DESCRIPTOR_INVALID",
  );
  validatePrincipalTokenFiles(
    [...runtimeConfig, ...runtimeRegistration],
    root,
    "PMS_RUNTIME_DESCRIPTOR",
  );
}

function validateCredentialTree(root, repositoryRoot) {
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const metadata = lstatSync(path);
      if (metadata.isSymbolicLink()) fail("NPC_TANK_PMS_CREDENTIAL_ROOT_SYMLINK_FORBIDDEN");
      assertExternal(realpathSync(path), repositoryRoot, "NPC_TANK_PMS_CREDENTIAL_ROOT");
      if (entry.isDirectory()) {
        if ((metadata.mode & 0o077) !== 0)
          fail("NPC_TANK_PMS_CREDENTIAL_DIRECTORY_PERMISSIONS_MUST_NOT_EXCEED_0700");
        pending.push(path);
        continue;
      }
      if (!entry.isFile() || metadata.nlink !== 1)
        fail("NPC_TANK_PMS_CREDENTIAL_FILE_REGULAR_SINGLE_LINK_REQUIRED");
      if ((metadata.mode & ~0o100600) !== 0 || (metadata.mode & 0o400) === 0)
        fail("NPC_TANK_PMS_CREDENTIAL_FILE_PERMISSIONS_MUST_NOT_EXCEED_0600");
      if (metadata.size === 0 || metadata.size > 1024 * 1024)
        fail("NPC_TANK_PMS_CREDENTIAL_FILE_SIZE_INVALID");
    }
  }
}

function validatePrincipalTokenFiles(principals, root, name) {
  for (const principal of principals) {
    if (!isRecord(principal) || typeof principal.subjectId !== "string")
      fail(`${name}_PRINCIPAL_INVALID`);
    if (typeof principal.tokenFile !== "string") fail(`${name}_TOKEN_FILE_INVALID`);
    const prefix = "/run/npc-pms-credentials/";
    if (!principal.tokenFile.startsWith(prefix)) fail(`${name}_TOKEN_SCOPE_INVALID`);
    const relativeToken = principal.tokenFile.slice(prefix.length);
    if (relativeToken.length === 0 || relativeToken.split("/").includes(".."))
      fail(`${name}_TOKEN_SCOPE_INVALID`);
    const hostToken = resolve(root, relativeToken);
    if (!realpathSync(hostToken).startsWith(`${root}/`)) fail(`${name}_TOKEN_SCOPE_INVALID`);
  }
}

function validateDatabasePair(environment, repositoryRoot, profile) {
  const passwordPath = validateSecretFile(
    required(environment, profile.passwordName),
    profile.passwordName,
    repositoryRoot,
  );
  const urlPath = validateSecretFile(
    required(environment, profile.urlName),
    profile.urlName,
    repositoryRoot,
  );
  const password = readFileSync(passwordPath, "utf8").trim();
  if (password.length < 16 || /[\r\n]/.test(password)) fail(`${profile.passwordName}_INVALID`);
  const connection = endpoint(
    { [profile.urlName]: readFileSync(urlPath, "utf8").trim() },
    profile.urlName,
    ["postgresql:", "postgres:"],
  );
  if (
    connection.username !== profile.user ||
    connection.hostname !== profile.host ||
    connection.pathname !== `/${profile.database}` ||
    connection.search.length > 0 ||
    connection.hash.length > 0
  )
    fail(`${profile.urlName}_SCOPE_INVALID`);
  let decodedPassword;
  try {
    decodedPassword = decodeURIComponent(connection.password);
  } catch (cause) {
    fail(`${profile.urlName}_PASSWORD_ENCODING_INVALID`, cause);
  }
  if (decodedPassword !== password) fail(`${profile.urlName}_PASSWORD_MISMATCH`);
}

function validatePointFixture(source, name) {
  const value = parseJson(source, name);
  if (!isRecord(value)) fail(`${name}_OBJECT_REQUIRED`);
  const longitude = value.longitude ?? value.lon;
  const latitude = value.latitude ?? value.lat;
  if (!finite(longitude) || !finite(latitude)) fail(`${name}_COORDINATES_REQUIRED`);
}

function validateWaypointFixture(source, name) {
  const value = parseJson(source, name);
  if (!Array.isArray(value) || value.length < 2) fail(`${name}_TWO_POINTS_REQUIRED`);
  for (const point of value) {
    if (
      !isRecord(point) ||
      !finite(point.longitude ?? point.lon) ||
      !finite(point.latitude ?? point.lat)
    )
      fail(`${name}_COORDINATES_REQUIRED`);
  }
}

function validateReconFixture(source, name) {
  const value = parseJson(source, name);
  const points = Array.isArray(value) ? value : isRecord(value) ? value.region_points : undefined;
  if (!Array.isArray(points) || points.length < 2) fail(`${name}_REGION_POINTS_REQUIRED`);
}

function endpoint(environment, name, protocols) {
  let value;
  try {
    value = new URL(required(environment, name));
  } catch (cause) {
    fail(`${name}_URL_INVALID`, cause);
  }
  if (!protocols.includes(value.protocol)) fail(`${name}_SCHEME_INVALID`);
  return value;
}

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) fail(`${name}_REQUIRED`);
  return value;
}

function optional(environment, name) {
  const value = environment[name]?.trim();
  return value ? value : undefined;
}

function explicitBoolean(value, name, fallback) {
  if (value === undefined || value.trim() === "") return fallback;
  if (["true", "1"].includes(value.trim().toLowerCase())) return true;
  if (["false", "0"].includes(value.trim().toLowerCase())) return false;
  fail(`${name}_BOOLEAN_INVALID`);
}

function parseJsonFile(path, name) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch (cause) {
    fail(`${name}_READ_FAILED`, cause);
  }
  return parseJson(source, name);
}

function parseJson(source, name) {
  try {
    return JSON.parse(source);
  } catch (cause) {
    fail(`${name}_JSON_INVALID`, cause);
  }
}

function parseEnvValue(value, lineNumber) {
  if (value.length === 0) return "";
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) fail(`ENV_FILE_LINE_${String(lineNumber)}_QUOTE_INVALID`);
    return value.slice(1, -1);
  }
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) fail(`ENV_FILE_LINE_${String(lineNumber)}_QUOTE_INVALID`);
    try {
      return JSON.parse(value);
    } catch (cause) {
      fail(`ENV_FILE_LINE_${String(lineNumber)}_QUOTE_INVALID`, cause);
    }
  }
  const comment = value.search(/\s+#/);
  return (comment === -1 ? value : value.slice(0, comment)).trimEnd();
}

function arrayOrEmpty(value, code) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(code);
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isContainerLoopback(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"].includes(hostname.toLowerCase());
}

function assertExternal(path, repositoryRoot, name) {
  const relativePath = relative(repositoryRoot, path);
  if (
    relativePath === "" ||
    (!relativePath.startsWith("../") && relativePath !== ".." && !isAbsolute(relativePath))
  )
    fail(`${name}_OUTSIDE_REPOSITORY_REQUIRED`);
}

function git(repositoryRoot, argumentsValue) {
  const result = spawnSync("git", ["-C", repositoryRoot, ...argumentsValue], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) fail("QUALIFICATION_GIT_INSPECTION_FAILED");
  return result.stdout;
}

function gitPaths(repositoryRoot, argumentsValue) {
  return git(repositoryRoot, argumentsValue).split("\0").filter(Boolean);
}

function fail(code, cause = undefined) {
  throw new DeploymentValidationError(code, cause === undefined ? undefined : { cause });
}

function parseCli(argv) {
  const values = { runControl: false, runRecon: false, runEffector: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--control") values.runControl = true;
    else if (value === "--recon") values.runRecon = true;
    else if (value === "--effector") values.runEffector = true;
    else if (value === "--repo-root" || value === "--env-file") {
      const next = argv[index + 1];
      if (next === undefined) fail("CLI_ARGUMENT_VALUE_REQUIRED");
      values[value.slice(2).replace("-", "_")] = next;
      index += 1;
    } else fail("CLI_ARGUMENT_INVALID");
  }
  return values;
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  realpathSync(entrypoint) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    if (Number.parseInt(process.versions.node.split(".")[0] ?? "", 10) < 22)
      fail("NODE_22_OR_NEWER_REQUIRED");
    const input = parseCli(process.argv.slice(2));
    if (input.repo_root === undefined || input.env_file === undefined)
      fail("CLI_REPOSITORY_AND_ENV_REQUIRED");
    const environment = loadEnvironment(input.env_file);
    validateDeploymentEnvironment(environment, input.repo_root, input);
    process.stdout.write(`${qualificationSourceState(input.repo_root).gitSha}\n`);
  } catch (error) {
    const code =
      error instanceof DeploymentValidationError ? error.code : "DEPLOYMENT_VALIDATION_FAILED";
    process.stderr.write(`BLOCKED_CONFIGURATION: ${code}\n`);
    process.exitCode = 2;
  }
}
