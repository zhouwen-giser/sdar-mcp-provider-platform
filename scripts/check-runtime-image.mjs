import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import process from "node:process";

const primary = "sdar-runtime:v2-audit-primary";
const repeat = "sdar-runtime:v2-audit-repeat";
// Docker Desktop's containerd store reports a compressed value while the Linux
// Engine reports the expanded layer total. The release ceiling follows the
// authoritative GitHub Linux measurement and still catches material growth.
const maximumBytes = 350_000_000;

build(primary);
build(repeat);

const first = inspect(primary);
const second = inspect(repeat);
const reproducible =
  JSON.stringify(reproducibleShape(first)) === JSON.stringify(reproducibleShape(second));
if (!reproducible) throw new Error("Runtime image filesystem/config is not reproducible");
if (first.Config.User !== "node")
  throw new Error(`Runtime image user is ${first.Config.User || "root"}`);
if (first.Size > maximumBytes) {
  throw new Error(`Runtime image size ${String(first.Size)} exceeds ${String(maximumBytes)}`);
}

execFileSync(
  "docker",
  [
    "run",
    "--rm",
    "--entrypoint",
    "sh",
    primary,
    "-lc",
    [
      "test -f /app/dist/apps/runtime/src/main.js",
      "test -d /app/proto",
      "test -d /app/migrations",
      "test ! -e /app/tests",
      "test ! -e /app/docs",
      "test ! -e /app/references",
      "test ! -d /app/node_modules/typescript",
      "test ! -d /app/node_modules/vitest",
    ].join(" && "),
  ],
  { stdio: "inherit" },
);

const result = {
  status: "pass",
  image: primary,
  sizeBytes: first.Size,
  maximumBytes,
  user: first.Config.User,
  layers: first.RootFS.Layers.length,
  reproducibleFilesystemAndConfig: reproducible,
};
const report = {
  schemaVersion: 1,
  measurementEnvironment: `${process.platform}/${process.arch} Docker Engine`,
  image: primary,
  base: "node:22-bookworm-slim",
  sizeBytes: first.Size,
  maximumBytes,
  user: first.Config.User,
  layers: first.RootFS.Layers.length,
  frozenLockfile: true,
  productionDependenciesOnly: true,
  containsTestsDocsOrReferences: false,
  containsTypescriptOrVitest: false,
  containsProtoAndMigrations: true,
  reproducibleFilesystemAndConfig: reproducible,
};
mkdirSync("reports/image", { recursive: true });
writeFileSync("reports/image/runtime-v2.json", `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);

function build(tag) {
  execFileSync("docker", ["build", "--target", "runtime", "--tag", tag, "."], {
    stdio: "inherit",
  });
}

function inspect(tag) {
  const output = execFileSync("docker", ["image", "inspect", tag], { encoding: "utf8" });
  const values = JSON.parse(output);
  const value = values[0];
  if (value === undefined) throw new Error(`Image ${tag} was not inspectable`);
  return value;
}

function reproducibleShape(image) {
  return {
    size: image.Size,
    layers: image.RootFS.Layers,
    user: image.Config.User,
    workingDir: image.Config.WorkingDir,
    environment: image.Config.Env,
    entrypoint: image.Config.Entrypoint,
    command: image.Config.Cmd,
  };
}
