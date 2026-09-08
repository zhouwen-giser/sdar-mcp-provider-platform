import { spawnSync } from "node:child_process";
const mode = process.argv[2];
if (process.argv.includes("--help")) {
  console.log(
    "Usage: pnpm gowm-storage:test:postgres | pnpm gowm-storage:smoke\nRequires SMPP_GOWM_TEST_ENABLE=true and SMPP_GOWM_TEST_DATABASE_URL naming an isolated test database. Uses an existing GOWM installation; never installs schemas or targets physical devices.",
  );
  process.exit(0);
}
if (!["postgres", "smoke"].includes(mode)) throw Error("Unknown test mode");
let valid;
try {
  valid =
    process.env.SMPP_GOWM_TEST_ENABLE === "true" &&
    new URL(process.env.SMPP_GOWM_TEST_DATABASE_URL).pathname.includes("test");
} catch {
  valid = false;
}
if (!valid) {
  console.error(
    "NOT_RUN: explicit isolated SMPP_GOWM_TEST_DATABASE_URL and SMPP_GOWM_TEST_ENABLE=true required",
  );
  process.exit(2);
}
const file = mode === "postgres" ? "postgres.test.ts" : "source-smoke.test.ts";
const result = spawnSync(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    `tests/gowm-storage/${file}`,
    "--reporter=default",
    "--reporter=json",
    `--outputFile=reports/smpp-gowm-shared-storage-v0.1/${mode}-results.json`,
  ],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
