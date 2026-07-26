import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";

const protocolRoot = resolve("protocol");
const schemaFiles = readdirSync(protocolRoot)
  .filter((filename) => filename.endsWith(".schema.json"))
  .sort();
if (schemaFiles.length !== 11) {
  throw new Error(
    `Expected 11 protocol schemas including Business Events, received ${schemaFiles.length}`,
  );
}

const ajv = new Ajv2020({ strict: false, validateFormats: false });
for (const filename of schemaFiles) {
  const document = JSON.parse(readFileSync(resolve(protocolRoot, filename), "utf8"));
  ajv.compile(document);
}

const caseDocument = JSON.parse(
  readFileSync(resolve(protocolRoot, "conformance-cases/cases.json"), "utf8"),
);
if (!Array.isArray(caseDocument.cases) || caseDocument.cases.length !== 74) {
  throw new Error("Frozen conformance catalog must contain exactly 74 cases");
}
const caseIds = new Set(caseDocument.cases.map((entry) => entry.caseId));
if (
  caseIds.size !== 74 ||
  !caseDocument.cases.every((entry) => /^C-0[0-7][0-9]$/.test(entry.caseId))
) {
  throw new Error("Frozen conformance case IDs must be unique C-001 through C-074 values");
}
for (let index = 1; index <= 74; index += 1) {
  const expected = `C-${String(index).padStart(3, "0")}`;
  if (!caseIds.has(expected)) throw new Error(`Frozen conformance catalog is missing ${expected}`);
}

process.stdout.write(
  `Validated ${schemaFiles.length} protocol schemas and 74 frozen conformance cases\n`,
);
