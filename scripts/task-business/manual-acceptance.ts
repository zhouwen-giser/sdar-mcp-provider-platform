import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  UgvInterventionProbeManifestSchema,
  runUgvInterventionProbe,
} from "./intervention-probe.js";
import { UgvManualInputProbeManifestSchema, runUgvManualInputProbe } from "./manual-input-probe.js";
import { runReadOnlyTaskBusinessProbe } from "./read-only-probe.js";
import {
  isProbeRecord as record,
  simulationProbeFetch,
  type ProbeRecord,
} from "./write-probe-client.js";

const id = z.string().min(1).max(512);
const write = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("input"), manifest: UgvManualInputProbeManifestSchema }).strict(),
  z
    .object({ kind: z.literal("intervention"), manifest: UgvInterventionProbeManifestSchema })
    .strict(),
]);

export const UgvManualAcceptanceManifestSchema = z
  .object({
    schema: z.literal("sdar.ugv-manual-acceptance/v1"),
    mcpUrl: z.url(),
    taskId: id,
    sceneInstanceId: id.optional(),
    expectedTools: z.array(id).max(100).default([]),
    expectations: z
      .array(
        z
          .object({
            kind: z.enum(["artifact", "action", "input_request", "intervention"]),
            type: id,
            id: id.optional(),
            revision: z.number().int().positive().optional(),
            active: z.boolean().optional(),
            /** Recursive subset of the current object; arrays compare exactly. */
            match: z.record(id, z.unknown()).default({}),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    durationMs: z.number().int().min(100).max(60_000).default(10_000),
    maxEvents: z.number().int().min(1).max(1_000).default(20),
    maxPageBytes: z.number().int().min(1_024).max(1_048_576).default(65_536),
    snapshotOnly: z.boolean().default(false),
    write: write.optional(),
  })
  .strict();

export type UgvManualAcceptanceManifest = z.input<typeof UgvManualAcceptanceManifestSchema>;

const objectFields = {
  artifact: ["artifactId", "artifactType"],
  action: ["actionId", "actionType"],
  input_request: ["requestId", "inputType"],
  intervention: ["interventionId", "interventionType"],
} as const;

function matches(actual: unknown, expected: unknown): boolean {
  if (!record(expected)) return isDeepStrictEqual(actual, expected);
  return (
    record(actual) &&
    Object.entries(expected).every(
      ([key, value]) => Object.hasOwn(actual, key) && matches(actual[key], value),
    )
  );
}

/** Discover first, then reuse public snapshot/SSE and the bounded write probes. */
export async function runUgvManualAcceptance(options: {
  manifest: UgvManualAcceptanceManifest;
  bearerToken?: string;
  allowWrites?: boolean;
  emit: (line: ProbeRecord) => void | Promise<void>;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const manifest = UgvManualAcceptanceManifestSchema.parse(options.manifest);
  const url = new URL(manifest.mcpUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error("UGV_ACCEPTANCE_URL_INVALID");
  if (manifest.write) {
    if (options.allowWrites !== true) throw new Error("UGV_ACCEPTANCE_WRITES_DISABLED");
    if (!options.bearerToken?.trim()) throw new Error("UGV_ACCEPTANCE_BEARER_REQUIRED");
    if (
      manifest.write.manifest.taskId !== manifest.taskId ||
      new URL(manifest.write.manifest.mcpUrl).href !== url.href
    )
      throw new Error("UGV_ACCEPTANCE_WRITE_BINDING_MISMATCH");
  }
  if (
    manifest.sceneInstanceId &&
    manifest.write &&
    manifest.sceneInstanceId !== manifest.write.manifest.sceneInstanceId
  )
    throw new Error("UGV_ACCEPTANCE_SCENE_MISMATCH");
  const scene = manifest.sceneInstanceId ?? manifest.write?.manifest.sceneInstanceId;
  const fetchImpl = scene
    ? simulationProbeFetch(options.fetchImpl ?? fetch, scene)
    : (options.fetchImpl ?? fetch);
  const emit = async (line: ProbeRecord) =>
    options.emit({
      schema: "sdar.ugv-manual-acceptance-result/v1",
      ...line,
    });
  const tools = new Map<string, unknown>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; ; page += 1) {
    if (page >= 100) throw new Error("UGV_ACCEPTANCE_DISCOVERY_LIMIT");
    const requestId = `ugv-acceptance-discovery-${page}`;
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/list",
        ...(options.bearerToken ? { authorization: `Bearer ${options.bearerToken}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/list",
        params: {
          ...(cursor ? { cursor } : {}),
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "sdar-ugv-manual-acceptance",
              version: "1.0.0",
            },
            "io.modelcontextprotocol/clientCapabilities": {
              extensions: {
                "io.modelcontextprotocol/tasks": {},
                "io.sdar/taskBusiness": { profileVersion: "1.0-rc2" },
                "io.sdar/businessEvents": { profileVersion: "1.0" },
              },
            },
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const envelope: unknown = await response.json();
    if (
      !response.ok ||
      !record(envelope) ||
      envelope.jsonrpc !== "2.0" ||
      envelope.id !== requestId ||
      envelope.error !== undefined ||
      !record(envelope.result) ||
      !Array.isArray(envelope.result.tools)
    )
      throw new Error("UGV_ACCEPTANCE_DISCOVERY_INVALID");
    for (const tool of envelope.result.tools) {
      if (
        !record(tool) ||
        typeof tool.name !== "string" ||
        !tool.name ||
        !record(tool.inputSchema) ||
        tools.has(tool.name)
      )
        throw new Error("UGV_ACCEPTANCE_DISCOVERY_INVALID");
      tools.set(tool.name, tool.inputSchema);
    }
    const next: unknown = envelope.result.nextCursor;
    if (next === undefined) break;
    if (typeof next !== "string" || !next || cursors.has(next))
      throw new Error("UGV_ACCEPTANCE_DISCOVERY_CURSOR_INVALID");
    cursors.add(next);
    cursor = next;
  }
  for (const name of manifest.expectedTools) {
    if (!tools.has(name)) throw new Error("UGV_ACCEPTANCE_EXPECTED_TOOL_MISSING");
  }
  await emit({
    type: "discovery",
    tools: [...tools].map(([name, schema]) => ({
      name,
      inputSchemaSha256: createHash("sha256").update(JSON.stringify(schema)).digest("hex"),
    })),
    mode: manifest.write?.kind ?? "read-only",
  });

  if (manifest.write) {
    const input = {
      bearerToken: options.bearerToken ?? "",
      emit: options.emit,
      fetchImpl,
    };
    if (manifest.write.kind === "input")
      await runUgvManualInputProbe({ ...input, manifest: manifest.write.manifest });
    else await runUgvInterventionProbe({ ...input, manifest: manifest.write.manifest });
  }

  const readerOptions = {
    mcpUrl: manifest.mcpUrl,
    taskId: manifest.taskId,
    ...(options.bearerToken ? { bearerToken: options.bearerToken } : {}),
    fetchImpl,
    durationMs: manifest.durationMs,
    maxEvents: manifest.maxEvents,
  };
  if (!manifest.snapshotOnly)
    await runReadOnlyTaskBusinessProbe({
      maxPageBytes: manifest.maxPageBytes,
      ...readerOptions,
      emit: options.emit,
    });
  // Always assert a fresh complete snapshot after the event window/write. Older
  // object revisions seen earlier must never satisfy a current-state assertion.
  let snapshot: ProbeRecord | undefined;
  const latest = new Map<string, ProbeRecord>();
  await runReadOnlyTaskBusinessProbe({
    maxPageBytes: manifest.maxPageBytes,
    ...readerOptions,
    durationMs: 15_000,
    snapshotOnly: true,
    emit: async (line) => {
      if (line.type === "snapshot") {
        snapshot = line;
        latest.clear();
      }
      if (line.type === "businessObject" && record(line.object) && record(line.object.value)) {
        const { kind, value } = line.object;
        if (typeof kind !== "string" || !Object.hasOwn(objectFields, kind))
          throw new Error("UGV_ACCEPTANCE_OBJECT_INVALID");
        const [idField] = objectFields[kind as keyof typeof objectFields];
        const key = `${kind}:${String(value[idField])}`;
        const prior = latest.get(key);
        if (!prior || Number(value.revision) > Number(prior.revision)) latest.set(key, value);
      }
      await options.emit(line);
    },
  });
  const finalSnapshot = snapshot;
  if (
    !finalSnapshot ||
    !record(finalSnapshot.identity) ||
    finalSnapshot.identity.taskId !== manifest.taskId ||
    !record(finalSnapshot.activeRefs)
  )
    throw new Error("UGV_ACCEPTANCE_SNAPSHOT_MISSING");
  const activeRefs = Object.values(finalSnapshot.activeRefs);
  const results = manifest.expectations.map((expected) => {
    const [idField, typeField] = objectFields[expected.kind];
    const found = [...latest.entries()].some(([key, value]) => {
      if (
        !key.startsWith(`${expected.kind}:`) ||
        value[typeField] !== expected.type ||
        (expected.id !== undefined && value[idField] !== expected.id) ||
        (expected.revision !== undefined && value.revision !== expected.revision) ||
        !matches(value, expected.match)
      )
        return false;
      const active = activeRefs.some(
        (ref) =>
          record(ref) &&
          ref.kind === expected.kind &&
          ref.id === value[idField] &&
          ref.revision === value.revision,
      );
      return expected.active === undefined || active === expected.active;
    });
    return { expected, passed: found };
  });
  const passed = results.every((result) => result.passed);
  await emit({
    type: "assertions",
    status: passed ? "ASSERTIONS_PASSED" : "ASSERTIONS_FAILED",
    taskId: manifest.taskId,
    contextRevision: finalSnapshot.contextRevision,
    results,
    qualificationComplete: false,
    qualificationNote:
      "Public observations only; correlate independent device/source evidence and selected storage for workflow qualification.",
  });
  if (!passed) throw new Error("UGV_ACCEPTANCE_EXPECTATION_FAILED");
}
