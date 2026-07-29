import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { SOURCE_ARCHIVE, assertQualifiedCommit, sha256File } from "./release-metadata-lib.mjs";

const root = process.cwd();
const manifestPath = resolve(root, "reports/platform-v0.1/RELEASE_MANIFEST.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
assertQualifiedCommit(root, manifest.qualifiedSourceCommit);
const output = resolve(root, SOURCE_ARCHIVE);
const prefix = "sdar-mcp-provider-platform-0.1.0/";
const files = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  },
)
  .split("\0")
  .filter(Boolean)
  .filter(inSourceArchive)
  .sort();
if (files.length === 0) throw new Error("RELEASE_SOURCE_ARCHIVE_EMPTY");
mkdirSync(dirname(output), { recursive: true });
const timestamp = execFileSync(
  "git",
  ["show", "-s", "--format=%ct", manifest.qualifiedSourceCommit],
  { cwd: root, encoding: "utf8" },
).trim();
execFileSync(
  "tar",
  [
    "--create",
    "--gzip",
    "--file",
    output,
    "--directory",
    root,
    "--no-recursion",
    "--sort=name",
    `--mtime=@${timestamp}`,
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    `--transform=s,^,${prefix},`,
    "--files-from=-",
  ],
  { input: `${files.join("\n")}\n`, stdio: ["pipe", "pipe", "pipe"] },
);
manifest.sourceArchive = {
  path: SOURCE_ARCHIVE,
  digest: { algorithm: "sha256", value: sha256File(output), status: "generated" },
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
writeChecksums(manifest);
process.stdout.write(`SOURCE_ARCHIVE_BUILT ${manifest.sourceArchive.digest.value}\n`);

function inSourceArchive(path) {
  if (
    path.startsWith(".codex/") ||
    path.startsWith(".obsidian/") ||
    path.startsWith("node_modules/") ||
    path.startsWith("dist/") ||
    path.startsWith("coverage/") ||
    path.startsWith("reports/ci/") ||
    path.startsWith("reports/evidence/") ||
    path.endsWith(".tmp") ||
    path.endsWith(".log") ||
    path.endsWith(".tar.gz") ||
    path === "reports/platform-v0.1/RELEASE_MANIFEST.json" ||
    path === "reports/platform-v0.1/CHECKSUMS.sha256" ||
    /^\.env(?:\.|$)/.test(path)
  ) {
    return false;
  }
  if (path.startsWith("reports/")) {
    return path.startsWith("reports/platform-v0.1/") || path === "reports/sbom/runtime-v1.cdx.json";
  }
  return true;
}

function writeChecksums(currentManifest) {
  const paths = [
    ...currentManifest.releaseFiles.filter(
      (path) => path !== "reports/platform-v0.1/CHECKSUMS.sha256",
    ),
    "reports/platform-v0.1/RELEASE_MANIFEST.json",
    SOURCE_ARCHIVE,
  ];
  const entries = [...new Set(paths)]
    .sort()
    .map((path) => `${sha256File(resolve(root, path))}  ${path}`);
  writeFileSync(resolve(root, "reports/platform-v0.1/CHECKSUMS.sha256"), `${entries.join("\n")}\n`);
}
