import pino from "pino";

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "authorization",
  "token",
  "password",
  "arguments",
  "*.arguments",
];

export function createLogger(level = "info", destination?: pino.DestinationStream) {
  return pino(
    {
      level,
      base: { service: "sdar-mcp-tasks-runtime" },
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    },
    destination,
  );
}

export type RuntimeLogger = ReturnType<typeof createLogger>;
