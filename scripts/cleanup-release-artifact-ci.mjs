import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import process from "node:process";

const project = process.env.RELEASE_ARTIFACT_PROJECT ?? "sdar-release-artifacts-ci";
if (!/^sdar-release-artifacts-[a-z0-9-]+$/.test(project)) {
  throw new Error("RELEASE_ARTIFACT_PROJECT_INVALID");
}
const fixtureRoot = resolve(
  process.env.RELEASE_ARTIFACT_FIXTURE_ROOT ?? resolve(tmpdir(), project),
);
if (resolve(fixtureRoot, "..") !== resolve(tmpdir()) || basename(fixtureRoot) !== project) {
  throw new Error("RELEASE_ARTIFACT_FIXTURE_ROOT_INVALID");
}

command(
  "docker",
  [
    "compose",
    "-p",
    project,
    "-f",
    "deploy/release-compose.yml",
    "down",
    "--volumes",
    "--remove-orphans",
    "--timeout",
    "10",
  ],
  true,
);
for (const container of lines(
  command("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`], true),
)) {
  command("docker", ["rm", "-f", container], true);
}
for (const network of lines(
  command(
    "docker",
    ["network", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`],
    true,
  ),
)) {
  command("docker", ["network", "rm", network], true);
}
for (const volume of lines(
  command(
    "docker",
    ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`],
    true,
  ),
)) {
  command("docker", ["volume", "rm", "-f", volume], true);
}
command("docker", ["rm", "-f", `${project}-runtime-extract`], true);
if (existsSync(fixtureRoot) && process.getuid !== undefined && process.getgid !== undefined) {
  command(
    "docker",
    [
      "run",
      "--rm",
      "--user",
      "0:0",
      "--volume",
      `${fixtureRoot}:/fixtures`,
      "--entrypoint",
      "chown",
      "sdar/runtime:0.1.0-rc",
      "-R",
      `${String(process.getuid())}:${String(process.getgid())}`,
      "/fixtures",
    ],
    true,
  );
}
await rm(fixtureRoot, { recursive: true, force: true });
process.stdout.write("RELEASE_ARTIFACT_CI_CLEANUP_OK\n");

function command(file, args, ignoreFailure = false) {
  try {
    return execFileSync(file, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", ignoreFailure ? "ignore" : "pipe"],
    });
  } catch (error) {
    if (ignoreFailure) return "";
    throw error;
  }
}

function lines(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
