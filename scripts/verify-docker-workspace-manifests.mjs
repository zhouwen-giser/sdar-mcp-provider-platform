import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve, sep } from "node:path";
import process from "node:process";

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
  const installOffset = dockerfile.indexOf("RUN pnpm install --frozen-lockfile");
  if (installOffset === -1) {
    throw new Error("Dockerfile is missing RUN pnpm install --frozen-lockfile");
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
