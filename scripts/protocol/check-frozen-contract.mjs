import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const CONTRACT_FILENAME = "SDAR_MCP_Tasks_Unified_Protocol_Profile_V1.0.md";
const CONTRACT_PATH = resolve("protocol/frozen", CONTRACT_FILENAME);
const CHECKSUM_PATH = `${CONTRACT_PATH}.sha256`;
const EXPECTED_SHA256 = "d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845";
const EXPECTED_SIDECAR = `${EXPECTED_SHA256}  ${CONTRACT_FILENAME}\n`;

let contract;
try {
  contract = readFileSync(CONTRACT_PATH);
} catch (error) {
  throw new Error(
    `Frozen contract is missing at ${CONTRACT_PATH}; provide the exact user-supplied source bytes`,
    { cause: error },
  );
}

const actualSha256 = createHash("sha256").update(contract).digest("hex");
if (actualSha256 !== EXPECTED_SHA256) {
  throw new Error(
    `Frozen contract SHA-256 mismatch: expected ${EXPECTED_SHA256}, received ${actualSha256}`,
  );
}

const sidecar = readFileSync(CHECKSUM_PATH, "utf8");
if (sidecar !== EXPECTED_SIDECAR) {
  throw new Error("Frozen contract checksum sidecar is not the exact required content");
}

process.stdout.write(`Frozen contract verified: ${actualSha256}\n`);
