import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import process from "node:process";

const filename = "SDAR_v1.2.2_Business_Events_Provider_Runtime_Requirements_V0.5.2.md";
const expected = "a17ee1552bc5b516dabdcc24db2fe9fd2d3deaf74688eae51e2fdc0c6a24cc0f";
const path = resolve("docs/requirements", filename);
const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
if (actual !== expected) throw new Error(`BUSINESS_EVENTS_REQUIREMENTS_HASH_MISMATCH: ${actual}`);

const lock = readFileSync(`${path}.sha256`, "utf8").trim();
if (lock !== `${expected}  ${basename(path)}`)
  throw new Error("Business Events requirements lock is malformed");

const frozenTasks = createHash("sha256")
  .update(readFileSync(resolve("protocol/frozen/SDAR_MCP_Tasks_Unified_Protocol_Profile_V1.0.md")))
  .digest("hex");
if (frozenTasks !== "d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845") {
  throw new Error("Frozen Tasks Profile V1.0 changed");
}

process.stdout.write(`Verified Business Events requirements ${expected}\n`);
