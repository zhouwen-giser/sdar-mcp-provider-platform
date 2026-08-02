/* global console, process */
import fs from "node:fs";
import path from "node:path";
const c = path.join(process.cwd(), "contracts/pms-console-api/v1");
const required = process.argv.includes("--require-complete");
const a = fs.readFileSync(path.join(c, "business-baseline.sha256"), "utf8");
const b = fs.readFileSync(path.join(c, "business-final.sha256"), "utf8");
const pending =
  a.startsWith("# PENDING") ||
  b.startsWith("# PENDING") ||
  a.trim().length === 0 ||
  b.trim().length === 0;
if (pending) {
  if (required) throw new Error("repository-local business manifests are pending");
  console.log("business impact pending: candidate handoff");
  process.exit(0);
}
if (a !== b) throw new Error("business source manifest changed");
const lines = a.trim().split(/\r?\n/);
if (lines.length < 10) throw new Error("business source manifest is not per-file evidence");
console.log(`business impact passed: ${lines.length} files`);
