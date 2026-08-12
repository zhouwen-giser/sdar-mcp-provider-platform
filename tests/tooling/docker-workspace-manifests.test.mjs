import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { verifyDockerWorkspaceManifests } from "../../scripts/verify-docker-workspace-manifests.mjs";

const temporaryDirectories = [];
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Docker workspace manifest verification", () => {
  it("stages every real workspace manifest exactly once", () => {
    const result = verifyDockerWorkspaceManifests({ rootDirectory: repositoryRoot });
    expect([...result.stagedManifests].sort()).toEqual([...result.requiredManifests].sort());
    expect(new Set(result.stagedManifests).size).toBe(result.stagedManifests.length);
  });

  it("fails closed when a required workspace manifest is omitted", () => {
    const rootDirectory = fixtureRoot();
    writeFileSync(
      join(rootDirectory, "Dockerfile"),
      [
        "FROM node:22-bookworm-slim AS build",
        "COPY apps/included/package.json apps/included/package.json",
        "RUN pnpm install --frozen-lockfile",
      ].join("\n"),
    );

    expect(() => verifyDockerWorkspaceManifests({ rootDirectory })).toThrow(
      /apps\/omitted\/package\.json/u,
    );
  });

  it("accepts a complete pre-install manifest stage", () => {
    const rootDirectory = fixtureRoot();
    writeFileSync(
      join(rootDirectory, "Dockerfile"),
      [
        "FROM node:22-bookworm-slim AS build",
        "COPY apps/included/package.json apps/included/package.json",
        "COPY apps/omitted/package.json apps/omitted/package.json",
        "RUN pnpm install --frozen-lockfile",
      ].join("\n"),
    );

    expect(verifyDockerWorkspaceManifests({ rootDirectory }).requiredManifests).toEqual([
      "apps/included/package.json",
      "apps/omitted/package.json",
    ]);
  });

  it("accepts a BuildKit-mounted multiline frozen install", () => {
    const rootDirectory = fixtureRoot();
    writeFileSync(
      join(rootDirectory, "Dockerfile"),
      [
        "FROM node:22-bookworm-slim AS build",
        "COPY apps/included/package.json apps/included/package.json",
        "COPY apps/omitted/package.json apps/omitted/package.json",
        "RUN --mount=type=cache,target=/pnpm/store \\",
        "    pnpm --config.store-dir=/pnpm/store \\",
        "      install --frozen-lockfile --ignore-scripts",
      ].join("\n"),
    );

    expect(verifyDockerWorkspaceManifests({ rootDirectory }).requiredManifests).toHaveLength(2);
  });
});

function fixtureRoot() {
  const rootDirectory = mkdtempSync(join(tmpdir(), "sdar-docker-workspaces-"));
  temporaryDirectories.push(rootDirectory);
  writeFileSync(join(rootDirectory, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
  for (const workspace of ["included", "omitted"]) {
    const directory = join(rootDirectory, "apps", workspace);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "package.json"), `{"name":"${workspace}"}\n`);
  }
  return rootDirectory;
}
