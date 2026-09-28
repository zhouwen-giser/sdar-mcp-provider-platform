import { readFileSync } from "node:fs";
import { runUgvManualInputProbe, UgvManualInputProbeManifestSchema } from "./manual-input-probe.js";
import {
  runUgvInterventionProbe,
  UgvInterventionProbeManifestSchema,
} from "./intervention-probe.js";
import { runReadOnlyTaskBusinessProbe } from "./read-only-probe.js";

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

const mode = argument("--mode") ?? "read-only";
const inputManifest = argument("--input-manifest");
const interventionManifest = argument("--intervention-manifest");
const mcpUrl = argument("--mcp-url");
const taskId = argument("--task-id");
if (mode === "intervention" && interventionManifest && !inputManifest && !mcpUrl && !taskId) {
  try {
    const parsed: unknown = JSON.parse(readFileSync(interventionManifest, "utf8"));
    const manifest = UgvInterventionProbeManifestSchema.parse(parsed);
    void runUgvInterventionProbe({
      manifest,
      bearerToken: process.env.SMPP_TASK_BUSINESS_PROBE_TOKEN ?? "",
      emit: (line) => {
        process.stdout.write(`${JSON.stringify(line)}\n`);
      },
    }).catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "UGV_INTERVENTION_PROBE_FAILED"}\n`,
      );
      process.exitCode = 1;
    });
  } catch {
    process.stderr.write("UGV_INTERVENTION_PROBE_MANIFEST_INVALID\n");
    process.exitCode = 2;
  }
} else if (mode === "input" && inputManifest && !interventionManifest && !mcpUrl && !taskId) {
  try {
    const parsed: unknown = JSON.parse(readFileSync(inputManifest, "utf8"));
    const manifest = UgvManualInputProbeManifestSchema.parse(parsed);
    void runUgvManualInputProbe({
      manifest,
      bearerToken: process.env.SMPP_TASK_BUSINESS_PROBE_TOKEN ?? "",
      emit: (line) => {
        process.stdout.write(`${JSON.stringify(line)}\n`);
      },
    }).catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "UGV_INPUT_PROBE_FAILED"}\n`,
      );
      process.exitCode = 1;
    });
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "UGV_INPUT_PROBE_MANIFEST_INVALID"}\n`,
    );
    process.exitCode = 2;
  }
} else if (mode !== "read-only" || inputManifest || interventionManifest || !mcpUrl || !taskId) {
  process.stderr.write(
    "Usage: pnpm task-business:probe --mcp-url URL --task-id UUID [--max-events N] [--duration-ms N] [--max-page-bytes N] [--artifact-id ID [--artifact-revision N] [--artifact-chunk-bytes N]]\n       pnpm task-business:probe --mode input --input-manifest MANIFEST.json (requires SMPP_TASK_BUSINESS_PROBE_TOKEN)\n       pnpm task-business:probe --mode intervention --intervention-manifest MANIFEST.json (requires SMPP_TASK_BUSINESS_PROBE_TOKEN)\n",
  );
  process.exitCode = 2;
} else {
  const numeric = (name: string): number | undefined => {
    const value = argument(name);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error("BUSINESS_PROBE_OPTIONS_INVALID");
    return parsed;
  };
  const maxEvents = numeric("--max-events");
  const durationMs = numeric("--duration-ms");
  const maxPageBytes = numeric("--max-page-bytes");
  const artifactId = argument("--artifact-id");
  const artifactRevision = numeric("--artifact-revision");
  const artifactChunkBytes = numeric("--artifact-chunk-bytes");
  void runReadOnlyTaskBusinessProbe({
    mcpUrl,
    taskId,
    ...(process.env.SMPP_TASK_BUSINESS_PROBE_TOKEN
      ? { bearerToken: process.env.SMPP_TASK_BUSINESS_PROBE_TOKEN }
      : {}),
    ...(maxEvents === undefined ? {} : { maxEvents }),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(maxPageBytes === undefined ? {} : { maxPageBytes }),
    ...(artifactId === undefined ? {} : { artifactId }),
    ...(artifactRevision === undefined ? {} : { artifactRevision }),
    ...(artifactChunkBytes === undefined ? {} : { artifactChunkBytes }),
    emit: (line) => {
      process.stdout.write(`${JSON.stringify(line)}\n`);
    },
  }).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : "BUSINESS_PROBE_FAILED";
    process.stderr.write(`${reason}\n`);
    process.exitCode = 1;
  });
}
