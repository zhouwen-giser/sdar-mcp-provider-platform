import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  lstatSync,
  createWriteStream,
} from "node:fs";
import { resolve } from "node:path";

const [name, command, ...args] = process.argv.slice(2);
if (!name || !/^[a-z0-9-]+$/.test(name) || !command)
  throw Error("Usage: run.mjs unique-run-name command [args]");
const root = process.cwd();
const report = resolve(root, "reports/inspection-area-v1/raw");
mkdirSync(report, { recursive: true });
const log = resolve(report, name + ".log"),
  receipt = resolve(report, name + ".json");
if (existsSync(log) || existsSync(receipt)) throw Error("RUN_NAME_ALREADY_EXISTS");
function source() {
  const hash = createHash("sha256");
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const file of [...new Set(files)]) {
    if (
      /(^|\/)(reports|artifacts|node_modules|dist|\.codex|\.git|__pycache__)(\/|$)/.test(file) &&
      !file.startsWith("schemas/config/")
    )
      continue;
    if (
      file.startsWith("deploy/development/server/state/") ||
      file.startsWith("deploy/development/server/config/")
    )
      continue;
    if (!existsSync(file) || !lstatSync(file).isFile()) continue;
    hash.update(file + "\0").update(readFileSync(file));
  }
  return hash.digest("hex");
}
const before = source(),
  startedAt = new Date().toISOString();
const stream = createWriteStream(log, { flags: "wx" });
const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
child.stdout.pipe(stream, { end: false });
child.stderr.pipe(stream, { end: false });
child.on("error", (error) => {
  stream.write(error.message + "\n");
});
const [exitCode, signal] = await new Promise((resolve) =>
  child.on("close", (code, signal) => resolve([code, signal])),
);
await new Promise((resolve) => stream.end(resolve));
const after = source();
const result = {
  name,
  command,
  args,
  startedAt,
  completedAt: new Date().toISOString(),
  exitCode,
  signal,
  status: exitCode === 0 && before === after ? "PASS" : "FAIL",
  sourceBefore: before,
  sourceAfter: after,
  sourceUnchanged: before === after,
  log,
  logSha256: createHash("sha256").update(readFileSync(log)).digest("hex"),
};
writeFileSync(receipt, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
process.exitCode = result.status === "PASS" ? 0 : 1;
