/* global console, process */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const roots = [
  "apps/pms-api/src",
  "apps/pms-worker/src",
  "apps/runtime",
  "apps/pms-web/src/features",
  "apps/pms-web/src/gateways",
  "packages/pms-domain",
  "packages/pms-application",
  "packages/pms-persistence-postgres",
  "packages/runtime-deployment",
  "packages/runtime-registration",
  "packages/configuration-center",
  "packages/catalog-manager",
  "packages/registry-snapshot",
  "packages/pm2-runtime-adapter",
  "migrations",
  "protocol",
  "provider-packages",
];

const listed = spawnSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...roots],
  { encoding: "utf8" },
);
if (listed.status !== 0) {
  process.stderr.write(listed.stderr);
  process.exit(listed.status ?? 1);
}
const lines = listed.stdout
  .split(/\r?\n/)
  .filter((file) => file.length > 0 && fs.existsSync(file) && fs.statSync(file).isFile())
  .sort()
  .map((file) => {
    const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    return `${hash}  ${file.replaceAll("\\", "/")}`;
  });
const output = process.argv[2];
if (!output) throw new Error("output path required");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${lines.join("\n")}\n`);
console.log(`captured ${lines.length} protected business files`);
