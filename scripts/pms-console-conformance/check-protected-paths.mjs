import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const baseline = process.env.PMS_CONSOLE_VALIDATION_START_HEAD ?? "HEAD";
const protectedPrefixes = [
  "packages/pms-domain/",
  "packages/pms-application/",
  "packages/pms-persistence-postgres/",
  "packages/configuration-center/",
  "packages/runtime-deployment/",
  "packages/runtime-registration/",
  "packages/catalog-manager/",
  "packages/registry-snapshot/",
  "packages/provider-package-registry/",
  "apps/pms-worker/",
  "apps/runtime/",
  "migrations/",
  "protocol/",
  "provider-packages/",
];
const diff = spawnSync("git", ["diff", "--name-only", baseline, "--"], {
  cwd: root,
  encoding: "utf8",
});
if (diff.status !== 0) {
  process.stderr.write(diff.stderr);
  process.exit(1);
}
const changedPaths = diff.stdout.split(/\r?\n/u).filter(Boolean);
const status = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8",
});
if (status.status !== 0) {
  process.stderr.write(status.stderr);
  process.exit(1);
}
for (const line of status.stdout.split(/\r?\n/u).filter(Boolean)) {
  const path = line.replace(/^"|"$/g, "");
  if (path.length > 0 && !changedPaths.includes(path)) changedPaths.push(path);
}
const protectedChanges = changedPaths.filter((path) =>
  protectedPrefixes.some((prefix) => path.startsWith(prefix)),
);
const result = {
  validationStartHead: baseline,
  changedPathCount: changedPaths.length,
  protectedChanges,
  businessSourceUnchanged: protectedChanges.length === 0,
  migrationsUnchanged: !protectedChanges.some((path) => path.startsWith("migrations/")),
  protocolUnchanged: !protectedChanges.some((path) => path.startsWith("protocol/")),
  pmsWebUnchanged: !changedPaths.some((path) => path.startsWith("apps/pms-web/")),
  passed: protectedChanges.length === 0,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.passed) process.exitCode = 1;
