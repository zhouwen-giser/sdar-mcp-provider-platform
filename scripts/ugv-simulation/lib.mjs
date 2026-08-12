import { createHash } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export class QualificationError extends Error {
  constructor(code, options = undefined) {
    super(code, options);
    this.name = "QualificationError";
    this.code = code;
  }
}

export const DEPLOYMENT_SECRET_FILE_VARIABLES = [
  "UGV_SIM_DEVICE_MCP_HEADERS_FILE",
  "UGV_SIM_MQTT_PASSWORD_FILE",
  "UGV_SIM_MQTT_TLS_CA_FILE",
  "UGV_SIM_MQTT_TLS_CERT_FILE",
  "UGV_SIM_MQTT_TLS_KEY_FILE",
];

export function coded(code, cause = undefined) {
  return new QualificationError(code, cause === undefined ? undefined : { cause });
}

export function validateNodeVersion(version = process.versions.node) {
  const major = Number.parseInt(String(version).split(".")[0] ?? "", 10);
  if (!Number.isSafeInteger(major) || major < 22) throw coded("NODE_22_OR_NEWER_REQUIRED");
  return major;
}

export function validateExactMqttSubscriptionGrants(grants, expectedGrants) {
  if (grants.length !== expectedGrants.length)
    throw coded("MQTT_SUBSCRIPTION_GRANT_COUNT_MISMATCH");
  const grantsByTopic = new Map(grants.map((grant) => [grant.topic, grant.qos]));
  if (grantsByTopic.size !== expectedGrants.length)
    throw coded("MQTT_SUBSCRIPTION_GRANT_SET_MISMATCH");
  for (const expected of expectedGrants) {
    const grantedQos = grantsByTopic.get(expected.topic);
    if (grantedQos === undefined) throw coded("MQTT_SUBSCRIPTION_GRANT_SET_MISMATCH");
    if (grantedQos !== expected.qos) throw coded("MQTT_SUBSCRIPTION_QOS_REJECTED");
  }
  return expectedGrants.map(({ topic }) => ({ topic, qos: grantsByTopic.get(topic) }));
}

export function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw coded("CLI_ARGUMENT_INVALID");
    const separator = argument.indexOf("=");
    if (separator > 2) {
      result[argument.slice(2, separator)] = argument.slice(separator + 1);
      continue;
    }
    const name = argument.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw coded("CLI_ARGUMENT_VALUE_REQUIRED");
    result[name] = value;
    index += 1;
  }
  return result;
}

export function loadEnvironment(envFile) {
  const fromFile = envFile === undefined ? {} : parseEnvFile(envFile);
  return { ...fromFile, ...process.env };
}

export function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw coded(`${name}_REQUIRED`);
  return value;
}

export function optional(environment, name) {
  const value = environment[name]?.trim();
  return value ? value : undefined;
}

export function explicitBoolean(value, name, fallback = undefined) {
  if ((value === undefined || value.trim() === "") && fallback !== undefined) return fallback;
  const normalized = value?.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw coded(`${name}_BOOLEAN_INVALID`);
}

export function boundedInteger(value, name, fallback, minimum, maximum) {
  const normalized = value?.trim() || String(fallback);
  if (!/^\d+$/.test(normalized)) throw coded(`${name}_INTEGER_INVALID`);
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw coded(`${name}_OUT_OF_RANGE`);
  return parsed;
}

export function readBoundedFile(path, name, maximumBytes, encoding = undefined) {
  let value;
  try {
    value = readFileSync(path, encoding);
  } catch (error) {
    throw coded(`${name}_READ_FAILED`, error);
  }
  const bytes = typeof value === "string" ? Buffer.byteLength(value, "utf8") : value.byteLength;
  if (bytes === 0) throw coded(`${name}_EMPTY`);
  if (bytes > maximumBytes) throw coded(`${name}_TOO_LARGE`);
  return value;
}

export function loadHeaderFile(path) {
  const raw = readBoundedFile(path, "UGV_SIM_DEVICE_MCP_HEADERS_FILE", 16_384, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw coded("UGV_SIM_DEVICE_MCP_HEADERS_FILE_JSON_INVALID", error);
  }
  if (!isRecord(parsed)) throw coded("UGV_SIM_DEVICE_MCP_HEADERS_FILE_OBJECT_REQUIRED");
  const headers = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || typeof value !== "string")
      throw coded("UGV_SIM_DEVICE_MCP_HEADERS_FILE_ENTRY_INVALID");
    if (/^(host|content-length)$/i.test(key))
      throw coded("UGV_SIM_DEVICE_MCP_HEADERS_FILE_HEADER_FORBIDDEN");
    headers[key] = value;
  }
  return { headers, raw };
}

export function parseEndpoint(value, name, protocols) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw coded(`${name}_URL_INVALID`, error);
  }
  if (!protocols.includes(url.protocol)) throw coded(`${name}_SCHEME_INVALID`);
  if (url.username || url.password) throw coded(`${name}_URL_CREDENTIALS_FORBIDDEN`);
  return url;
}

export function redactEndpoint(url) {
  const hostKind =
    url.hostname === "host.docker.internal"
      ? "docker-host-alias"
      : url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "localhost"
        ? "loopback"
        : "lan-or-dns";
  return {
    scheme: url.protocol.slice(0, -1),
    hostKind,
    hostHash: sha256(url.hostname).slice(0, 16),
    port: url.port || defaultPort(url.protocol),
    path: url.pathname === "/" || url.pathname === "/mcp" ? url.pathname : "[redacted-nonstandard]",
    pathHash: sha256(url.pathname || "/").slice(0, 16),
  };
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value))
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function gitSha(repositoryRoot) {
  const result = spawnSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return "unknown";
  const value = result.stdout.trim();
  return /^[0-9a-f]{40}$/.test(value) ? value : "unknown";
}

export function qualificationSourceState(repositoryRoot) {
  const repositoryPath = checkedRealpath(repositoryRoot, "QUALIFICATION_REPOSITORY_ROOT");
  const topLevel = runGit(repositoryPath, ["rev-parse", "--show-toplevel"]);
  if (checkedRealpath(topLevel.trim(), "QUALIFICATION_GIT_TOP_LEVEL") !== repositoryPath)
    throw coded("QUALIFICATION_REPOSITORY_ROOT_MISMATCH");

  const sha = runGit(repositoryPath, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw coded("QUALIFICATION_GIT_SHA_INVALID");

  const staged = nulSeparatedGitPaths(repositoryPath, ["diff", "--cached", "--name-only", "-z"]);
  const unstaged = nulSeparatedGitPaths(repositoryPath, ["diff", "--name-only", "-z"]);
  const untracked = nulSeparatedGitPaths(repositoryPath, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  if ([...staged, ...unstaged, ...untracked].some((path) => !isQualificationEvidencePath(path)))
    throw coded("QUALIFICATION_SOURCE_TREE_DIRTY");

  return {
    gitSha: sha,
    trackedSourceClean: true,
    allowedEvidenceChanges: new Set([...staged, ...unstaged, ...untracked]).size,
    allowedEvidencePath: "reports/ugv-simulation/**",
  };
}

export function validateDeploymentSecretFiles(environment, repositoryRoot) {
  const repositoryPath = checkedRealpath(repositoryRoot, "QUALIFICATION_REPOSITORY_ROOT");
  const configured = {};
  for (const name of DEPLOYMENT_SECRET_FILE_VARIABLES) {
    const path = optional(environment, name);
    configured[name] = path !== undefined;
    if (path === undefined) continue;
    if (!isAbsolute(path)) throw coded(`${name}_ABSOLUTE_PATH_REQUIRED`);

    let metadata;
    try {
      metadata = lstatSync(path);
    } catch (error) {
      throw coded(`${name}_STAT_FAILED`, error);
    }
    if (!metadata.isFile()) throw coded(`${name}_REGULAR_FILE_REQUIRED`);

    const resolvedPath = checkedRealpath(path, name);
    const relativePath = relative(repositoryPath, resolvedPath);
    if (
      relativePath === "" ||
      (!relativePath.startsWith("../") && relativePath !== ".." && !isAbsolute(relativePath))
    )
      throw coded(`${name}_OUTSIDE_REPOSITORY_REQUIRED`);

    const permissions = metadata.mode & 0o7777;
    if ((permissions & ~0o600) !== 0 || (permissions & 0o400) === 0)
      throw coded(`${name}_PERMISSIONS_MUST_NOT_EXCEED_0600`);
    try {
      accessSync(path, fsConstants.R_OK);
    } catch (error) {
      throw coded(`${name}_READ_ACCESS_REQUIRED`, error);
    }
  }
  return configured;
}

export function repositoryRoot(importMetaUrl) {
  return resolve(dirname(fileURLToPath(importMetaUrl)), "../..");
}

export function writeEvidence(path, value, forbiddenValues = []) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  for (const forbidden of forbiddenValues) {
    if (typeof forbidden !== "string" || forbidden.length < 4) continue;
    if (serialized.includes(forbidden)) throw coded("EVIDENCE_REDACTION_CHECK_FAILED");
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serialized, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

export function safeFailure(error, fallback) {
  if (error instanceof QualificationError)
    return { reasonCode: error.code, errorClass: error.name };
  if (isRecord(error) && typeof error.code === "string") {
    const code = error.code.toUpperCase().replaceAll(/[^A-Z0-9_]/g, "_");
    if (code.length > 0 && code.length <= 80)
      return { reasonCode: `${fallback}_${code}`, errorClass: safeClass(error) };
  }
  if (error instanceof Error && error.name === "AbortError")
    return { reasonCode: `${fallback}_TIMEOUT`, errorClass: "AbortError" };
  return { reasonCode: fallback, errorClass: safeClass(error) };
}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function topLevelKeys(value) {
  return isRecord(value) ? Object.keys(value).sort() : [];
}

function parseEnvFile(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw coded("ENV_FILE_READ_FAILED", error);
  }
  const result = {};
  for (const [index, original] of raw.split(/\r?\n/).entries()) {
    let line = original.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trimStart();
    const separator = line.indexOf("=");
    if (separator < 1) throw coded(`ENV_FILE_LINE_${String(index + 1)}_INVALID`);
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      throw coded(`ENV_FILE_LINE_${String(index + 1)}_KEY_INVALID`);
    result[key] = parseEnvValue(line.slice(separator + 1).trim(), index + 1);
  }
  return result;
}

function parseEnvValue(value, lineNumber) {
  if (!value) return "";
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2)
      throw coded(`ENV_FILE_LINE_${String(lineNumber)}_QUOTE_INVALID`);
    return value.slice(1, -1);
  }
  if (value.startsWith('"')) {
    if (!value.endsWith('"') || value.length < 2)
      throw coded(`ENV_FILE_LINE_${String(lineNumber)}_QUOTE_INVALID`);
    try {
      return JSON.parse(value);
    } catch (error) {
      throw coded(`ENV_FILE_LINE_${String(lineNumber)}_QUOTE_INVALID`, error);
    }
  }
  const comment = value.search(/\s+#/);
  return (comment === -1 ? value : value.slice(0, comment)).trimEnd();
}

function safeClass(error) {
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name)) return error.name;
  return "Error";
}

function checkedRealpath(path, name) {
  try {
    return realpathSync(path);
  } catch (error) {
    throw coded(`${name}_REALPATH_FAILED`, error);
  }
}

function runGit(repositoryRoot, argumentsValue) {
  const result = spawnSync("git", ["-C", repositoryRoot, ...argumentsValue], {
    encoding: "utf8",
    maxBuffer: 4 * 1_024 * 1_024,
  });
  if (result.status !== 0) throw coded("QUALIFICATION_GIT_INSPECTION_FAILED");
  return result.stdout;
}

function nulSeparatedGitPaths(repositoryRoot, argumentsValue) {
  const output = runGit(repositoryRoot, argumentsValue);
  return output.split("\0").filter((path) => path.length > 0);
}

function isQualificationEvidencePath(path) {
  return path.startsWith("reports/ugv-simulation/");
}

function defaultPort(protocol) {
  if (protocol === "http:" || protocol === "ws:") return "80";
  if (protocol === "https:" || protocol === "wss:") return "443";
  if (protocol === "mqtt:") return "1883";
  if (protocol === "mqtts:") return "8883";
  return "unknown";
}
