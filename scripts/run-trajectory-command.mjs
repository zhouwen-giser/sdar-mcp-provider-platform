import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [name, separator, command, ...args] = process.argv.slice(2);
if (!name || !/^[a-z0-9_-]+$/.test(name) || separator !== "--" || !command)
  throw Error("Usage: node scripts/run-trajectory-command.mjs NAME -- COMMAND [ARGUMENTS]");
const folder = path.join(root, "reports/trajectory-time-history-v1/raw");
fs.mkdirSync(folder, { recursive: true });
const log = path.join(folder, name + ".log");
const receipt = path.join(folder, name + ".json");
if (fs.existsSync(log) || fs.existsSync(receipt)) throw Error("EVIDENCE_RUN_NAME_ALREADY_EXISTS");
const digest = (data) => createHash("sha256").update(data).digest("hex");
const captureSource = () => {
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  )
    .split("\0")
    .filter((file) => file && !/^(reports|artifacts|node_modules|dist|\.codex)\//.test(file));
  const source = [...new Set(files)].sort().flatMap((file) => {
    const target = path.join(root, file);
    return fs.existsSync(target) && fs.lstatSync(target).isFile()
      ? [{ file, sha256: digest(fs.readFileSync(target)) }]
      : [];
  });
  return source;
};
const source = captureSource();
const output = fs.createWriteStream(log, { flags: "wx" });
const startedAt = new Date().toISOString();
const child = spawn(command, args, {
  cwd: root,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (chunk) => {
    output.write(chunk);
    process.stdout.write(chunk);
  });
let spawnError;
child.on("error", (error) => {
  spawnError = error.code ?? "SPAWN_FAILED";
});
child.on("close", (code, signal) =>
  output.end(() => {
    const sourceAfter = captureSource();
    const result = {
      command: [command, ...args],
      cwd: root,
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: code,
      signal,
      spawnError: spawnError ?? null,
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      sourceInputsSha256: digest(JSON.stringify(source)),
      sourceInputsAfterSha256: digest(JSON.stringify(sourceAfter)),
      sourceChangedDuringRun: JSON.stringify(source) !== JSON.stringify(sourceAfter),
      sourceInputs: source,
      rawLog: path.relative(root, log),
      rawLogSha256: digest(fs.readFileSync(log)),
      evidenceClass: "LOCAL_IMPLEMENTATION_TEST",
      siteOperations: "NOT_RUN",
      realDeviceQualification: "NOT_RUN",
      deployment: "NOT_RUN",
    };
    fs.writeFileSync(receipt, JSON.stringify(result, null, 2) + "\n");
    process.exitCode = spawnError || signal ? 1 : (code ?? 1);
  }),
);
