import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
const args = process.argv.slice(2),
  options = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (!["--config", "--out"].includes(args[i]) || !args[i + 1] || options.has(args[i]))
    throw Error("SITE_VERIFY_ARGUMENTS_INVALID");
  options.set(args[i], args[i + 1]);
}
const configPath = resolve(options.get("--config") ?? ""),
  out = resolve(options.get("--out") ?? "");
if (!options.has("--config") || !options.has("--out") || existsSync(out))
  throw Error("SITE_VERIFY_FRESH_OUTPUT_REQUIRED");
const config = JSON.parse(readFileSync(configPath, "utf8"));
if (
  config.owner !== "inspection-area-v1" ||
  new URL(config.databaseUrl).hostname !== "127.0.0.1" ||
  !config.brokerUrl?.startsWith("mqtt://127.0.0.1:")
)
  throw Error("SITE_VERIFY_OWNED_INFRASTRUCTURE_REQUIRED");
mkdirSync(out, { recursive: true });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function source() {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(
      (p) => p && !p.startsWith("reports/") && !p.startsWith("docs/") && !p.startsWith(".git/"),
    );
  const rows = [...new Set(files)]
    .sort()
    .map((path) => ({ path, sha256: sha(readFileSync(path)) }));
  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    sha256: sha(JSON.stringify(rows)),
    files: rows,
  };
}
const baseline = source();
writeFileSync(resolve(out, "source.json"), JSON.stringify(baseline, null, 2) + "\n");
const env = {
  ...process.env,
  TEST_DATABASE_URL: config.databaseUrl,
  SMPP_ZMQ_TEST_CONFIG_FILE: configPath,
  SMPP_INSPECTION_TEST_CONFIG_FILE: configPath,
  SMPP_ZMQ_SITE_CONTROL_WIRE_EVIDENCE_FILE: resolve(out, "native-wire.json"),
};
const changed = execFileSync("git", ["diff", "--name-only", "863dbd0"], { encoding: "utf8" })
  .trim()
  .split("\n");
const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .trim()
  .split("\n");
const formatFiles = [...new Set([...changed, ...untracked])].filter(
  (p) => p && !p.startsWith("reports/") && /\.(?:[cm]?[jt]sx?|json|md|ya?ml)$/.test(p),
);
const commands = [
  ["typecheck", ["pnpm", "typecheck"]],
  ["console-typecheck", ["pnpm", "--filter", "@sdar/ugv-control-console", "typecheck"]],
  ["lint-source", ["pnpm", "exec", "eslint", "apps", "packages", "scripts", "tests", "examples"]],
  ["format-changed", ["pnpm", "exec", "prettier", "--check", ...formatFiles]],
  ["protocol", ["pnpm", "protocol:check"]],
  ["contract-lock", ["pnpm", "zmq:contract:check"]],
  ["catalog", ["node", "--import", "tsx", "scripts/ugv-zmq/site-catalog.ts", "--check"]],
  [
    "site-control-catalog",
    ["node", "--import", "tsx", "scripts/ugv-zmq/site-control-catalog.ts", "--check"],
  ],
  ["build", ["pnpm", "build"]],
  ["console-build", ["pnpm", "--filter", "@sdar/ugv-control-console", "build"]],
  [
    "native-and-lifecycle",
    [
      "pnpm",
      "exec",
      "vitest",
      "run",
      "tests/integration/task-lifecycle-postgres.test.ts",
      "tests/ugv-zmq/",
      "tests/ugv-zmq-observer/",
      "tests/ugv-zmq-control/",
      "tests/ugv-zmq-provider/contract.test.ts",
      "tests/ugv-zmq-provider/site-contract.test.ts",
      "tests/ugv-zmq-provider/formal.postgres.test.ts",
      "tests/ugv-zmq-provider/owner-route.postgres.test.ts",
      "tests/ugv-zmq-provider/site-control-contract.test.ts",
      "tests/ugv-zmq-provider/site-control.postgres.test.ts",
      "tests/ugv-zmq-provider/site-handoff.postgres.test.ts",
      "tests/ugv-zmq-control-postgres/",
      "tests/contract/ugv-navigation-planner.test.ts",
    ],
  ],
  ["frozen-74", ["pnpm", "test:frozen-74"]],
  ["unit-and-contract", ["pnpm", "exec", "vitest", "run", "tests/unit/", "tests/contract/"]],
  ["console", ["pnpm", "--filter", "@sdar/ugv-control-console", "test"]],
  [
    "browser-site-control",
    [
      "pnpm",
      "--filter",
      "@sdar/ugv-control-console",
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.site-control.config.ts",
    ],
  ],
  [
    "browser-site",
    [
      "pnpm",
      "--filter",
      "@sdar/ugv-control-console",
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.site.config.ts",
    ],
  ],
  [
    "browser-legacy",
    [
      "pnpm",
      "--filter",
      "@sdar/ugv-control-console",
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.config.ts",
    ],
  ],
];
const results = [];
for (const [id, argv] of commands) {
  const startedAt = new Date().toISOString();
  const chunks = [];
  const exitCode = await new Promise((done, reject) => {
    const child = spawn(argv[0], argv.slice(1), { env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (b) => chunks.push(b));
    child.stderr.on("data", (b) => chunks.push(b));
    child.once("error", reject);
    child.once("exit", (code) => done(code ?? 1));
  });
  const log = Buffer.concat(chunks);
  writeFileSync(resolve(out, id + ".log"), log);
  const after = source();
  const result = {
    id,
    cwd: process.cwd(),
    argv,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    log: id + ".log",
    logSha256: sha(log),
    sourceUnchanged: after.sha256 === baseline.sha256,
  };
  results.push(result);
  writeFileSync(
    resolve(out, "verification.json"),
    JSON.stringify(
      {
        schemaVersion: "ugv.zmq-site-control-verification/1",
        source: baseline.sha256,
        commands: results,
        passed: results.every((r) => r.exitCode === 0 && r.sourceUnchanged),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ id, exitCode, sourceUnchanged: result.sourceUnchanged }));
  if (!result.sourceUnchanged) throw Error("SITE_VERIFY_SOURCE_CHANGED");
}
if (results.some((r) => r.exitCode !== 0)) process.exitCode = 1;
