/* global process */

import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveMigrationSet } from "../packages/database-migration-runner/src/index.js";
import {
  loadProviderPackageRegistry,
  projectProviderQualification,
} from "../packages/provider-package-registry/src/index.js";

const CURRENT_CONFIG_SOURCES = {
  "provider.ugv": "apps/ugv-provider-adapter/src/config.ts",
  "provider.npcTank": "apps/npc-tank-provider-adapter/src/config.ts",
  "provider.climate": "apps/home-assistant-climate-provider/src/config.ts",
  "provider.homeAssistantLight": "apps/home-assistant-light-provider/src/config.ts",
};

const EXPECTED_BUILTIN_PACKAGE_IDS = [
  "builtin.home-assistant.climate",
  "builtin.home-assistant.light",
  "builtin.isr.vehicle.npc-tank",
  "builtin.isr.vehicle.ugv",
];

class SelfCheckError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SelfCheckError";
    this.code = code;
    this.details = details;
  }
}

export async function runProviderPackageSelfCheck(workspaceRoot = process.cwd()) {
  let canonicalWorkspaceRoot;
  try {
    canonicalWorkspaceRoot = await realpath(workspaceRoot);
  } catch (error) {
    throw new SelfCheckError("WORKSPACE_ROOT_UNAVAILABLE", "Workspace root is unavailable", {
      cause: error instanceof Error ? error.message : "unknown",
    });
  }
  const registry = await loadProviderPackageRegistry(canonicalWorkspaceRoot);
  const packages = registry.list();
  for (const packageId of EXPECTED_BUILTIN_PACKAGE_IDS) {
    if (registry.get(packageId) === undefined) {
      throw new SelfCheckError(
        "EXPECTED_PACKAGE_MISSING",
        `Built-in package is missing: ${packageId}`,
        {
          packageId,
        },
      );
    }
  }

  const checks = [];
  for (const providerPackage of packages) {
    checks.push(await checkPackage(canonicalWorkspaceRoot, providerPackage));
  }
  return {
    schemaVersion: 1,
    status: "PASS",
    packageCount: checks.length,
    packages: checks,
  };
}

async function checkPackage(workspaceRoot, providerPackage) {
  await assertControlledFile(workspaceRoot, providerPackage.adapter.entry, "ADAPTER_ENTRY_INVALID");

  const configSource =
    CURRENT_CONFIG_SOURCES[providerPackage.adapter.configSchemaId] ??
    `schemas/config/${providerPackage.adapter.configSchemaId}.schema.json`;
  await assertControlledFile(workspaceRoot, configSource, "CONFIG_SCHEMA_UNRESOLVED");

  let migrationFiles = 0;
  const migrationSet = providerPackage.adapter.migrationSet ?? null;
  if (migrationSet !== null) {
    if (!migrationSet.startsWith("provider:")) {
      throw new SelfCheckError(
        "PROVIDER_MIGRATION_SET_INVALID",
        `Provider Package cannot bind a non-Provider Migration set: ${providerPackage.packageId}`,
        { packageId: providerPackage.packageId, migrationSet },
      );
    }
    migrationFiles = (await resolveMigrationSet(workspaceRoot, migrationSet)).length;
    if (migrationFiles === 0) {
      throw new SelfCheckError(
        "PROVIDER_MIGRATION_SET_EMPTY",
        `Provider Migration set is empty: ${providerPackage.packageId}`,
        { packageId: providerPackage.packageId, migrationSet },
      );
    }
  }

  const evidenceRefs = providerPackage.qualification.evidenceRefs ?? [];
  if (evidenceRefs.length === 0) {
    throw new SelfCheckError(
      "QUALIFICATION_EVIDENCE_REQUIRED",
      `Provider Package qualification has no evidence: ${providerPackage.packageId}`,
      { packageId: providerPackage.packageId },
    );
  }
  for (const evidenceRef of evidenceRefs) {
    await assertControlledFile(workspaceRoot, evidenceRef, "EVIDENCE_REF_INVALID");
  }

  return {
    packageId: providerPackage.packageId,
    packageVersion: providerPackage.packageVersion,
    providerType: providerPackage.providerType,
    entry: providerPackage.adapter.entry,
    configSchemaId: providerPackage.adapter.configSchemaId,
    configSource,
    migrationSet,
    migrationFiles,
    evidenceRefs: evidenceRefs.length,
    qualification: projectProviderQualification(providerPackage),
  };
}

async function assertControlledFile(workspaceRoot, relativePath, errorCode) {
  const candidate = resolve(workspaceRoot, relativePath);
  if (isAbsolute(relativePath) || !isContained(workspaceRoot, candidate)) {
    throw new SelfCheckError(errorCode, `Reference escapes workspace: ${relativePath}`, {
      relativePath,
    });
  }
  let stats;
  let canonicalCandidate;
  try {
    [stats, canonicalCandidate] = await Promise.all([lstat(candidate), realpath(candidate)]);
  } catch (error) {
    throw new SelfCheckError(errorCode, `Referenced file is unavailable: ${relativePath}`, {
      relativePath,
      cause: error instanceof Error ? error.message : "unknown",
    });
  }
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    !isContained(workspaceRoot, canonicalCandidate)
  ) {
    throw new SelfCheckError(
      errorCode,
      `Reference is not a controlled regular file: ${relativePath}`,
      {
        relativePath,
      },
    );
  }
}

function isContained(root, candidate) {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot !== "" &&
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}

function parseWorkspaceRoot(arguments_) {
  if (arguments_.length === 0) return process.cwd();
  if (
    arguments_.length === 2 &&
    arguments_[0] === "--workspace-root" &&
    arguments_[1] !== undefined
  ) {
    return resolve(arguments_[1]);
  }
  throw new SelfCheckError(
    "INVALID_ARGUMENTS",
    "Usage: provider-package-self-check [--workspace-root <path>]",
  );
}

async function main() {
  try {
    const report = await runProviderPackageSelfCheck(parseWorkspaceRoot(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    const failure =
      error instanceof SelfCheckError
        ? { code: error.code, message: error.message, details: error.details }
        : error instanceof Error && "code" in error
          ? { code: String(error.code), message: error.message }
          : {
              code: "PROVIDER_PACKAGE_SELF_CHECK_FAILED",
              message: error instanceof Error ? error.message : "Unknown self-check failure",
            };
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: 1, status: "FAIL", error: failure })}\n`,
    );
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  await main();
}
