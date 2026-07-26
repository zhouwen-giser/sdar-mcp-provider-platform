/* global process */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const [interfaceSource, taskSource, profileSource] = process.argv
  .slice(2)
  .map((path) => resolve(path));
if (!interfaceSource || !taskSource || !profileSource)
  throw new Error("USAGE: ugv-prepare-requirements.mjs INTERFACE TASK PROFILE");
const destination = resolve("docs/requirements");
await mkdir(destination, { recursive: true });
const expectedInterface = "a67b7909ec7af7b3757e77cbaf5bae1c600fe348daa7faf239d8715d89fa375c";
let interfaceBytes = await readFile(interfaceSource);
let interfaceHash = sha(interfaceBytes);
let normalization = "none";
if (interfaceHash !== expectedInterface && interfaceBytes.at(-1) === 0x0a) {
  const candidate = interfaceBytes.subarray(0, interfaceBytes.length - 1);
  if (sha(candidate) === expectedInterface) {
    interfaceBytes = candidate;
    interfaceHash = expectedInterface;
    normalization = "removed_single_trailing_lf_from_packaged_copy";
  }
}
if (interfaceHash !== expectedInterface) throw new Error("UGV_INTERFACE_DOCUMENT_HASH_MISMATCH");
const interfaceName = "ISR-Simulation_UGV_NPC_Tank_Interface.md";
await writeFile(resolve(destination, interfaceName), interfaceBytes);
await writeFile(
  resolve(destination, `${interfaceName}.sha256`),
  `${interfaceHash}  ${interfaceName}\n`,
);
for (const source of [taskSource, profileSource])
  await writeFile(resolve(destination, basename(source)), await readFile(source));
await writeFile(
  resolve(destination, "UGV_REQUIREMENTS_COPY_NORMALIZATION.json"),
  `${JSON.stringify({ sourceFile: basename(interfaceSource), expectedSha256: expectedInterface, copiedSha256: interfaceHash, normalization, semanticContentChanged: false }, null, 2)}\n`,
);
function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}
