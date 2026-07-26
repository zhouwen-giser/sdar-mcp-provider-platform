import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { frozenConformanceTitles, protocolSchemas } from "./schema-definitions.mjs";

execFileSync(process.execPath, [resolve("scripts/protocol/check-frozen-contract.mjs")], {
  stdio: "inherit",
});
execFileSync(
  process.execPath,
  [resolve("scripts/protocol/fetch-pinned-mcp-schema.mjs"), "--check"],
  {
    stdio: "inherit",
  },
);

for (const [filename, document] of Object.entries(protocolSchemas())) {
  writeJson(resolve("protocol", filename), document);
}

const cases = frozenConformanceTitles.map((title, index) => ({
  caseId: `C-${String(index + 1).padStart(3, "0")}`,
  title,
  status: "required",
  components: componentScope(index + 1),
}));
if (cases.length !== 74) throw new Error(`Expected 74 frozen cases, received ${cases.length}`);
writeJson(resolve("protocol/conformance-cases/cases.json"), { schemaVersion: 1, cases });

process.stdout.write(
  `Generated ${Object.keys(protocolSchemas()).length} schemas and ${cases.length} cases\n`,
);

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
}

function componentScope(caseNumber) {
  if ([37, 71].includes(caseNumber)) return ["runtime", "pms"];
  if ([32, 33, 34, 35, 40, 52, 71, 72, 74].includes(caseNumber)) {
    return ["runtime", "adapter-typescript", "adapter-python"];
  }
  return ["runtime"];
}
