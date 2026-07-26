import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";

const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
const schemaFiles = [
  "sdar-business-events-v1.schema.json",
  "sdar-business-events-continuity-v1.schema.json",
  "sdar-business-events-relation-v1.schema.json",
];
const validators = new Map();
for (const filename of schemaFiles) {
  const schema = JSON.parse(readFileSync(resolve("protocol", filename), "utf8"));
  ajv.addSchema(schema, filename);
}

for (const directory of ["valid", "invalid"]) {
  const root = resolve("protocol/fixtures/business-events", directory);
  for (const filename of readdirSync(root)
    .filter((entry) => entry.endsWith(".json"))
    .sort()) {
    const fixture = JSON.parse(readFileSync(resolve(root, filename), "utf8"));
    const key = `${fixture.schema}#${fixture.definition ?? ""}`;
    let validate = validators.get(key);
    if (!validate) {
      validate = ajv.compile(
        fixture.definition
          ? { $ref: `${fixture.schema}#/$defs/${fixture.definition}` }
          : { $ref: fixture.schema },
      );
      validators.set(key, validate);
    }
    const accepted = validate(fixture.instance);
    if ((directory === "valid") !== accepted) {
      throw new Error(
        `${directory}/${basename(filename)} produced ${String(accepted)}: ${ajv.errorsText(validate.errors)}`,
      );
    }
  }
}

process.stdout.write(
  `Validated ${schemaFiles.length} Business Events schemas and ${[...validators.keys()].length} fixture shapes\n`,
);
