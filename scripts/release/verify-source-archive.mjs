import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import process from "node:process";
import { SOURCE_ARCHIVE, lines, sha256File } from "./release-metadata-lib.mjs";

const root = process.cwd();
const archive = resolve(root, SOURCE_ARCHIVE);
const manifest = JSON.parse(
  readFileSync(resolve(root, "reports/platform-v0.1/RELEASE_MANIFEST.json"), "utf8"),
);
if (sha256File(archive) !== manifest.sourceArchive?.digest?.value) {
  throw new Error("RELEASE_SOURCE_ARCHIVE_DIGEST_MISMATCH");
}
const entries = lines(
  execFileSync("tar", ["--list", "--gzip", "--file", archive], { encoding: "utf8" }),
);
const prefix = "sdar-mcp-provider-platform-0.1.0/";
if (
  entries.length === 0 ||
  entries.some(
    (entry) =>
      !entry.startsWith(prefix) ||
      /(?:^|\/)(?:\.codex|\.obsidian|node_modules|dist|coverage|reports\/ci|reports\/evidence)(?:\/|$)/.test(
        entry.slice(prefix.length),
      ) ||
      /(?:^|\/)\.env(?:\.|$)/.test(entry),
  )
) {
  throw new Error("RELEASE_SOURCE_ARCHIVE_CONTENT_INVALID");
}
for (const required of [
  "package.json",
  "Dockerfile",
  "CHANGELOG.md",
  "reports/platform-v0.1/KNOWN_LIMITATIONS.md",
]) {
  if (!entries.includes(`${prefix}${required}`)) {
    throw new Error(`RELEASE_SOURCE_ARCHIVE_FILE_MISSING:${required}`);
  }
}

const extraction = mkdtempSync(resolve(tmpdir(), "sdar-release-source-"));
try {
  execFileSync("tar", ["--extract", "--gzip", "--file", archive, "--directory", extraction]);
  for (const path of regularFiles(extraction)) {
    const content = readFileSync(path);
    if (
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}/.test(
        content.toString("utf8"),
      )
    ) {
      throw new Error(`RELEASE_SOURCE_ARCHIVE_SECRET:${relative(extraction, path)}`);
    }
  }
} finally {
  rmSync(extraction, { recursive: true, force: true });
}
process.stdout.write(`SOURCE_ARCHIVE_OK ${entries.length} files\n`);

function regularFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...regularFiles(path));
    else if (entry.isFile() && statSync(path).size <= 16 * 1024 * 1024) files.push(path);
  }
  return files;
}
