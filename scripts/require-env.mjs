import process from "node:process";

const missing = process.argv.slice(2).filter((name) => !process.env[name]);
if (missing.length > 0) {
  process.stderr.write(`Missing required integration environment: ${missing.join(", ")}\n`);
  process.exit(2);
}
