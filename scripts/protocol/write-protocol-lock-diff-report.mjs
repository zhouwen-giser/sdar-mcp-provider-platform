import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const protocolRoot = resolve(root, "protocol");
const lockPath = resolve(protocolRoot, "protocol-baseline.lock.json");
const outputArgumentIndex = process.argv.indexOf("--output");
const outputRelativePath =
  outputArgumentIndex >= 0
    ? process.argv[outputArgumentIndex + 1]
    : "reports/real-device-preparation-continuation/protocol-lock-diff.json";
const outputPath = resolve(root, outputRelativePath);
const externalFiles = [
  "proto/io/sdar/mcp/tasks/adapter/v1/adapter.proto",
  "packages/adapter-protocol/generated/io/sdar/mcp/tasks/adapter/v1/adapter_pb.js",
  "packages/adapter-protocol/generated/io/sdar/mcp/tasks/adapter/v1/adapter_pb.d.ts",
  "packages/adapter-protocol/generated/io/sdar/mcp/tasks/adapter/v1/adapter_grpc_pb.js",
  "packages/adapter-protocol/generated/io/sdar/mcp/tasks/adapter/v1/adapter_grpc_pb.d.ts",
];
const tracked = [
  ...collect(protocolRoot)
    .filter((path) => path !== lockPath)
    .map((source) => ({ source, path: relative(protocolRoot, source).split(sep).join("/") })),
  ...externalFiles.map((path) => ({ source: resolve(root, path), path: `../${path}` })),
];
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const lockedByPath = new Map(lock.files.map((entry) => [entry.path, entry]));
const files = tracked
  .map(({ source, path }) => {
    const bytes = readFileSync(source);
    const text = bytes.toString("utf8");
    const normalized = Buffer.from(text.replaceAll("\r\n", "\n").replaceAll("\r", "\n"));
    const actualSha256 = sha256(bytes);
    const normalizedLfSha256 = sha256(normalized);
    const expected = lockedByPath.get(path) ?? null;
    const hashMatches = expected?.sha256 === actualSha256;
    const normalizedHashMatches = expected?.sha256 === normalizedLfSha256;
    return {
      path,
      actualSha256,
      actualSizeBytes: bytes.length,
      actualLineEnding: lineEnding(text),
      normalizedLfSha256,
      lockedSha256: expected?.sha256 ?? null,
      lockedSizeBytes: expected?.sizeBytes ?? null,
      hashMatches,
      normalizedHashMatches,
      status: hashMatches
        ? "passed"
        : normalizedHashMatches
          ? "line-ending-drift"
          : "content-drift",
    };
  })
  .sort((left, right) => left.path.localeCompare(right.path));
const report = {
  evidenceClass: "static",
  checkedAt: new Date().toISOString(),
  coreAutocrlf: gitConfig("core.autocrlf"),
  coreEol: gitConfig("core.eol"),
  lockPath: "protocol/protocol-baseline.lock.json",
  lockModified: false,
  files,
  summary: {
    total: files.length,
    passed: files.filter((file) => file.status === "passed").length,
    lineEndingDrift: files.filter((file) => file.status === "line-ending-drift").length,
    contentDrift: files.filter((file) => file.status === "content-drift").length,
  },
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report.summary)}\n`);

function collect(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? collect(path) : [path];
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function lineEnding(text) {
  const hasCrLf = text.includes("\r\n");
  const withoutCrLf = text.replaceAll("\r\n", "");
  const hasLf = withoutCrLf.includes("\n");
  const hasBareCr = withoutCrLf.includes("\r");
  if (hasCrLf && (hasLf || hasBareCr)) return "mixed";
  if (hasCrLf) return "crlf";
  if (hasLf) return "lf";
  if (hasBareCr) return "cr";
  return "none";
}

function gitConfig(key) {
  try {
    return (
      execFileSync("git", ["config", "--get", key], { cwd: root, encoding: "utf8" }).trim() || null
    );
  } catch {
    return null;
  }
}
