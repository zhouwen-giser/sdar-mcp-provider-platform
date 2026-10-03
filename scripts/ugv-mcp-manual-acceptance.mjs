import { readFile } from "node:fs/promises";
import { runUgvManualAcceptance } from "./task-business/manual-acceptance.ts";

if (process.argv.length !== 4 || process.argv[2] !== "--manifest") {
  process.stderr.write(
    "Usage: node --import tsx scripts/ugv-mcp-manual-acceptance.mjs --manifest FILE.json\n",
  );
  process.exitCode = 2;
} else {
  try {
    await runUgvManualAcceptance({
      manifest: JSON.parse(await readFile(process.argv[3], "utf8")),
      bearerToken: process.env.SMPP_TASK_BUSINESS_PROBE_TOKEN,
      allowWrites: process.env.SMPP_UGV_MANUAL_ACCEPTANCE_ALLOW_WRITES === "true",
      emit: (line) => {
        process.stdout.write(`${JSON.stringify(line)}\n`);
      },
    });
  } catch (error) {
    // Do not echo arbitrary HTTP/Zod errors or an operator manifest containing credentials.
    const reason =
      error instanceof Error && /^(UGV_|BUSINESS_)[A-Z0-9_:]+$/.test(error.message)
        ? error.message
        : "UGV_ACCEPTANCE_FAILED";
    process.stderr.write(`${reason}\n`);
    process.exitCode = 1;
  }
}
