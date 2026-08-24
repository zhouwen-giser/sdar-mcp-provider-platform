import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve, sep } from "node:path";
import process from "node:process";

export const REQUIRED_NODE_BASE_IMAGE =
  "node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436";

const REQUIRED_NODE_BASE_STAGES = Object.freeze([
  "build",
  "ugv-real-base",
  "npc-real-base",
  "runtime",
  "pms-base",
  "pms-web",
]);

export function verifyDockerBaseImageContract(dockerfile) {
  const declarations = dockerfile.match(/^ARG NODE_BASE_IMAGE(?:=.*)?$/gmu) ?? [];
  if (declarations.length !== 1) {
    throw new Error(
      `Dockerfile must declare ARG NODE_BASE_IMAGE exactly once; found ${String(declarations.length)}`,
    );
  }

  const requiredDeclaration = `ARG NODE_BASE_IMAGE=${REQUIRED_NODE_BASE_IMAGE}`;
  if (declarations[0] !== requiredDeclaration) {
    throw new Error(`Dockerfile NODE_BASE_IMAGE default must be exactly ${REQUIRED_NODE_BASE_IMAGE}`);
  }

  const stages = Array.from(
    dockerfile.matchAll(/^FROM \$\{NODE_BASE_IMAGE\} AS ([a-z0-9][a-z0-9._-]*)$/gmu),
    (match) => match[1],
  );
  if (
    stages.length !== REQUIRED_NODE_BASE_STAGES.length ||
    stages.some((stage, index) => stage !== REQUIRED_NODE_BASE_STAGES[index])
  ) {
    throw new Error(
      `Dockerfile NODE_BASE_IMAGE consumers must be exactly: ${REQUIRED_NODE_BASE_STAGES.join(", ")}`,
    );
  }

  return {
    declaration: declarations[0],
    stages,
  };
}

export function verifyDockerWorkspaceManifests({
  rootDirectory = process.cwd(),
  dockerfilePath = join(rootDirectory, "Dockerfile"),
  workspacePath = join(rootDirectory, "pnpm-workspace.yaml"),
} = {}) {
  const workspacePatterns = readWorkspacePatterns(workspacePath);
  const requiredManifests = workspacePatterns.flatMap((pattern) =>
    manifestsForPattern(rootDirectory, pattern),
  );
  const dockerfile = readFileSync(dockerfilePath, "utf8");
  const baseImageContract = verifyDockerBaseImageContract(dockerfile);
  const installOffset = dockerfile.indexOf("install --frozen-lockfile");
  if (installOffset === -1) {
    throw new Error("Dockerfile is missing a frozen pnpm install");
  }

  const stagedManifests = dockerfile
    .slice(0, installOffset)
    .split(/\r?\n/u)
    .flatMap(parseCopySources)
    .filter((source) => source.endsWith("/package.json"));
  const staged = new Set(stagedManifests);
  const missing = requiredManifests.filter((manifest) => !staged.has(manifest));

  if (missing.length > 0) {
    throw new Error(
      `Dockerfile does not stage workspace manifests before frozen install:\n${missing
        .map((manifest) => `- ${manifest}`)
        .join("\n")}`,
    );
  }

  const stale = stagedManifests.filter(
    (manifest) => !existsSync(join(rootDirectory, ...manifest.split("/"))),
  );
  if (stale.length > 0) {
    throw new Error(
      `Dockerfile stages workspace manifests that do not exist:\n${stale
        .map((manifest) => `- ${manifest}`)
        .join("\n")}`,
    );
  }

  return {
    baseImageContract,
    workspacePatterns,
    requiredManifests,
    stagedManifests,
  };
}

function readWorkspacePatterns(workspacePath) {
  const lines = readFileSync(workspacePath, "utf8").split(/\r?\n/u);
  const patterns = [];
  let inPackages = false;

  for (const line of lines) {
    if (/^packages:\s*$/u.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/u.test(line)) break;
    if (!inPackages) continue;
    const match = /^\s+-\s+(.+?)\s*$/u.exec(line);
    if (match?.[1] !== undefined) {
      patterns.push(match[1].replace(/^['"]|['"]$/gu, ""));
    }
  }

  if (patterns.length === 0) {
    throw new Error("pnpm-workspace.yaml does not declare package patterns");
  }
  return patterns;
}

function manifestsForPattern(rootDirectory, pattern) {
  const match = /^([^*[\]{}]+)\/\*$/u.exec(pattern);
  if (match?.[1] === undefined) {
    throw new Error(`Unsupported workspace pattern: ${pattern}`);
  }

  const parent = join(rootDirectory, ...match[1].split("/"));
  if (!existsSync(parent)) return [];

  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name, "package.json"))
    .filter(existsSync)
    .map((manifest) => relative(rootDirectory, manifest).split(sep).join("/"))
    .sort();
}

function parseCopySources(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("COPY ")) return [];
  const tokens = trimmed.slice("COPY ".length).trim().split(/\s+/u);
  return tokens.length > 1 ? tokens.slice(0, -1) : [];
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = verifyDockerWorkspaceManifests();
  process.stdout.write(
    `Docker workspace manifests verified: ${String(result.requiredManifests.length)} required, ${String(result.stagedManifests.length)} staged\n`,
  );
}
