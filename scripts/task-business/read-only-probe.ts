import { createHash } from "node:crypto";
import {
  bootstrapTaskBusinessReducer,
  normalizeTaskBusinessSseNotification,
  reduceTaskBusinessFeedback,
  unresolvedTaskBusinessRefs,
  type TaskBusinessReducerState,
  type TaskBusinessSnapshotPage,
} from "../../packages/mcp-protocol/src/index.js";
import {
  BusinessObjectRefSchema,
  RuntimeBusinessCursorSchema,
  type BusinessObjectRef,
  type RuntimeBusinessCursor,
} from "../../packages/vehicle-provider-core/src/task-business-contract.js";
import { TaskArtifactSchema } from "../../packages/vehicle-provider-core/src/task-business-artifact.js";

const CONTEXT_GET = "io.sdar/taskBusiness/context/get";
const SNAPSHOT_PART_GET = "io.sdar/taskBusiness/snapshotParts/get";
const ARTIFACT_GET = "io.sdar/taskBusiness/artifacts/get";
const EVENTS_LISTEN = "io.sdar/businessEvents/listen";
const NOTIFICATION = "notifications/io.sdar/businessEvents";

export interface ReadOnlyProbeOptions {
  mcpUrl: string;
  taskId: string;
  bearerToken?: string;
  maxPageBytes?: number;
  maxEvents?: number;
  durationMs?: number;
  artifactId?: string;
  artifactRevision?: number;
  artifactChunkBytes?: number;
  /** Fetch one complete public snapshot without opening the event listener. */
  snapshotOnly?: boolean;
  /** Include validated full Context and selected parsed SSE notification payloads. */
  capturePublicPayloads?: boolean;
  emit: (line: Record<string, unknown>) => void | Promise<void>;
  fetchImpl?: typeof fetch;
}

/** Uses only public /mcp JSON-RPC and SSE. It has no command/write method. */
export async function runReadOnlyTaskBusinessProbe(options: ReadOnlyProbeOptions): Promise<void> {
  const maxEvents = options.maxEvents ?? 10;
  const durationMs = options.durationMs ?? 10_000;
  const maxPageBytes = options.maxPageBytes ?? 65_536;
  const artifactChunkBytes = options.artifactChunkBytes ?? 262_144;
  if (
    !Number.isSafeInteger(maxEvents) ||
    maxEvents < 1 ||
    maxEvents > 100_000 ||
    !Number.isSafeInteger(durationMs) ||
    durationMs < 100 ||
    durationMs > 3_600_000 ||
    !Number.isSafeInteger(maxPageBytes) ||
    maxPageBytes < 1_024 ||
    maxPageBytes > 1_048_576 ||
    !Number.isSafeInteger(artifactChunkBytes) ||
    artifactChunkBytes < 1 ||
    artifactChunkBytes > 1_048_576 ||
    (options.artifactId !== undefined &&
      (options.artifactId.length < 1 || options.artifactId.length > 256)) ||
    (options.artifactRevision !== undefined &&
      (!Number.isSafeInteger(options.artifactRevision) || options.artifactRevision < 1)) ||
    (options.artifactRevision !== undefined && options.artifactId === undefined) ||
    (options.artifactChunkBytes !== undefined && options.artifactId === undefined)
  ) {
    throw new Error("BUSINESS_PROBE_OPTIONS_INVALID");
  }
  const url = new URL(options.mcpUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("BUSINESS_PROBE_URL_INVALID");
  if (!options.taskId) throw new Error("BUSINESS_PROBE_TASK_ID_REQUIRED");
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), durationMs);
  let applied = 0;
  let failed = false;
  let refreshes = 0;
  let cursor: RuntimeBusinessCursor | undefined;
  let state: TaskBusinessReducerState | undefined;
  let serial = 0;
  const emit = async (line: Record<string, unknown>): Promise<void> => {
    await options.emit({ schema: "sdar.task-business-probe-ndjson/v1", ...line });
  };
  const request = async (
    method: string,
    params: Record<string, unknown>,
    signal = controller.signal,
  ): Promise<Response> => {
    serial += 1;
    return fetchImpl(url, {
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        ...(method === CONTEXT_GET || method === SNAPSHOT_PART_GET || method === ARTIFACT_GET
          ? { "mcp-name": options.taskId }
          : {}),
        ...(options.bearerToken ? { authorization: `Bearer ${options.bearerToken}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `business-probe-${serial}`,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "sdar-read-only-business-probe",
              version: "1.0.0",
            },
            "io.modelcontextprotocol/clientCapabilities": {
              extensions: {
                ...(method === CONTEXT_GET ||
                method === SNAPSHOT_PART_GET ||
                method === ARTIFACT_GET
                  ? {
                      "io.modelcontextprotocol/tasks": {},
                      "io.sdar/taskBusiness": { profileVersion: "1.0-rc2" },
                    }
                  : { "io.sdar/businessEvents": { profileVersion: "1.0" } }),
              },
            },
          },
        },
      }),
      signal,
    });
  };
  const readSnapshotDescriptor = async (
    snapshotToken: string,
    expectedSize: number,
    objectRef?: BusinessObjectRef,
  ): Promise<unknown> => {
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 1)
      throw new Error("BUSINESS_PROBE_SNAPSHOT_DESCRIPTOR_INVALID");
    const chunks: Uint8Array[] = [];
    const digest = createHash("sha256");
    let offset = 0;
    let expectedSha: string | undefined;
    while (offset < expectedSize) {
      const response = await request(SNAPSHOT_PART_GET, {
        taskId: options.taskId,
        snapshotToken,
        ...(objectRef === undefined ? {} : { objectRef }),
        offset,
        maxBytes: 65_536,
      });
      const result = successfulResult(response, await response.json());
      if (!isRecord(result.part)) throw new Error("BUSINESS_PROBE_SNAPSHOT_PART_INVALID");
      const part = result.part;
      if (
        part.encoding !== "base64" ||
        typeof part.bytes !== "string" ||
        part.totalBytes !== String(expectedSize) ||
        typeof part.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(part.sha256) ||
        part.offset !== offset ||
        (expectedSha !== undefined && part.sha256 !== expectedSha)
      )
        throw new Error("BUSINESS_PROBE_SNAPSHOT_PART_INVALID");
      const bytes = Buffer.from(part.bytes, "base64");
      const end = offset + bytes.length;
      if (
        bytes.toString("base64") !== part.bytes ||
        bytes.length < 1 ||
        bytes.length > 65_536 ||
        end > expectedSize ||
        (end < expectedSize && part.nextOffset !== String(end)) ||
        (end === expectedSize && part.nextOffset !== undefined)
      )
        throw new Error("BUSINESS_PROBE_SNAPSHOT_PART_INVALID");
      expectedSha = part.sha256;
      chunks.push(bytes);
      digest.update(bytes);
      offset = end;
    }
    if (digest.digest("hex") !== expectedSha)
      throw new Error("BUSINESS_PROBE_SNAPSHOT_DIGEST_MISMATCH");
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      throw new Error("BUSINESS_PROBE_SNAPSHOT_JSON_INVALID");
    }
  };
  const bootstrap = async (
    minimumContextRevision?: number,
    minimumPublicCursor?: RuntimeBusinessCursor,
  ): Promise<void> => {
    const pages: TaskBusinessSnapshotPage[] = [];
    let nextCursor: string | undefined;
    let resumeFrom: unknown;
    for (let pageIndex = 0; pageIndex < 1_024; pageIndex += 1) {
      const response = await request(CONTEXT_GET, {
        taskId: options.taskId,
        maxPageBytes,
        ...(nextCursor === undefined ? {} : { pageCursor: nextCursor }),
      });
      const envelope: unknown = await response.json();
      const result = successfulResult(response, envelope);
      if (!isRecord(result.snapshot)) throw new Error("BUSINESS_SNAPSHOT_INVALID");
      const page = result.snapshot;
      if (
        !Number.isSafeInteger(page.contextRevision) ||
        !Array.isArray(page.objects) ||
        !Array.isArray(page.objectDescriptors) ||
        (page.nextCursor !== undefined && typeof page.nextCursor !== "string")
      ) {
        throw new Error("BUSINESS_SNAPSHOT_INVALID");
      }
      if (page.contextDescriptor !== undefined || page.objectDescriptors.length > 0) {
        if (typeof result.snapshotToken !== "string")
          throw new Error("BUSINESS_PROBE_SNAPSHOT_TOKEN_MISSING");
        if (page.contextDescriptor !== undefined) {
          const descriptor = page.contextDescriptor;
          if (
            !isRecord(descriptor) ||
            descriptor.revision !== page.contextRevision ||
            typeof descriptor.sizeBytes !== "number" ||
            descriptor.readMethod !== "getContext" ||
            page.context !== undefined
          )
            throw new Error("BUSINESS_PROBE_SNAPSHOT_DESCRIPTOR_INVALID");
          page.context = await readSnapshotDescriptor(result.snapshotToken, descriptor.sizeBytes);
          delete page.contextDescriptor;
        }
        for (const descriptor of page.objectDescriptors) {
          if (!isRecord(descriptor)) throw new Error("BUSINESS_PROBE_SNAPSHOT_DESCRIPTOR_INVALID");
          const ref = BusinessObjectRefSchema.safeParse(descriptor.ref);
          if (
            !ref.success ||
            typeof descriptor.sizeBytes !== "number" ||
            descriptor.readMethod !== "getObjectVersion"
          )
            throw new Error("BUSINESS_PROBE_SNAPSHOT_DESCRIPTOR_INVALID");
          page.objects.push(
            await readSnapshotDescriptor(result.snapshotToken, descriptor.sizeBytes, ref.data),
          );
        }
        page.objectDescriptors = [];
      }
      const pageResume = RuntimeBusinessCursorSchema.parse(result.resumeFrom);
      const firstResume =
        resumeFrom === undefined ? undefined : RuntimeBusinessCursorSchema.parse(resumeFrom);
      if (
        firstResume &&
        (firstResume.streamId !== pageResume.streamId ||
          firstResume.afterSequence !== pageResume.afterSequence)
      ) {
        throw new Error("BUSINESS_SNAPSHOT_CURSOR_CHANGED");
      }
      resumeFrom = pageResume;
      pages.push(page as unknown as TaskBusinessSnapshotPage);
      nextCursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
      if (nextCursor === undefined) break;
    }
    const refreshed = bootstrapTaskBusinessReducer(pages, resumeFrom);
    if (
      (minimumContextRevision !== undefined &&
        refreshed.context.contextRevision < minimumContextRevision) ||
      (minimumPublicCursor?.streamId === refreshed.resumeFrom.streamId &&
        BigInt(refreshed.resumeFrom.afterSequence) < BigInt(minimumPublicCursor.afterSequence))
    ) {
      throw new Error("BUSINESS_SNAPSHOT_BEHIND_STREAM");
    }
    state = refreshed;
    cursor = refreshed.resumeFrom;
    await emit({
      type: "snapshot",
      taskId: options.taskId,
      identity: refreshed.context.identity,
      contextRevision: refreshed.context.contextRevision,
      effectivePlanRevision: refreshed.context.effectivePlanRevision,
      resumeFrom: cursor,
      pages: pages.length,
      objectCount: refreshed.objectVersions.size,
      phase: refreshed.context.phase,
      summary: refreshed.context.summary,
      activeRefs: refreshed.context.activeRefs,
      unresolvedRefs: unresolvedTaskBusinessRefs(refreshed),
      ...(options.capturePublicPayloads ? { context: refreshed.context } : {}),
    });
    for (const object of refreshed.objectVersions.values()) {
      await emit({
        type: "businessObject",
        taskId: options.taskId,
        contextRevision: refreshed.context.contextRevision,
        resumeFrom: cursor,
        object,
      });
    }
  };
  const bootstrapWithRetry = async (
    minimumContextRevision?: number,
    minimumPublicCursor?: RuntimeBusinessCursor,
  ): Promise<void> => {
    let consecutiveFailures = 0;
    for (;;) {
      try {
        await bootstrap(minimumContextRevision, minimumPublicCursor);
        return;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "";
        const refreshable = [
          "BUSINESS_EVENT_STREAM_RESET",
          "BUSINESS_EVENT_CURSOR_EXPIRED",
          "BUSINESS_SNAPSHOT_REVISION_CHANGED",
          "BUSINESS_SNAPSHOT_CURSOR_INVALID",
        ].find((code) => reason.endsWith(`:${code}`) || reason === code);
        if (!refreshable) throw error;
        if (++consecutiveFailures > 3)
          throw new Error("BUSINESS_PROBE_REFRESH_LIMIT", { cause: error });
        await emit({ type: "refresh", reasonCode: refreshable });
      }
    }
  };
  const readArtifact = async (): Promise<void> => {
    if (!options.artifactId || !state) return;
    let revision = options.artifactRevision;
    let offset = 0;
    let expected:
      | {
          sizeBytes: number;
          sha256: string;
          mediaType: string;
          handle: string;
          expiresAt?: string;
        }
      | undefined;
    let chunks = 0;
    const digest = createHash("sha256");
    for (;;) {
      const response = await request(ARTIFACT_GET, {
        taskId: options.taskId,
        artifactId: options.artifactId,
        ...(revision === undefined ? {} : { revision }),
        includeContent: true,
        contentOffset: offset,
        maxContentBytes: artifactChunkBytes,
      });
      const result = successfulResult(response, await response.json());
      const parsed = TaskArtifactSchema.safeParse(result.artifact);
      if (!parsed.success) throw new Error("BUSINESS_PROBE_ARTIFACT_INVALID");
      const artifact = parsed.data;
      const identity = state.context.identity;
      if (
        artifact.artifactId !== options.artifactId ||
        (revision !== undefined && artifact.revision !== revision) ||
        artifact.identity.taskId !== identity.taskId ||
        artifact.identity.executionId !== identity.executionId ||
        artifact.identity.providerId !== identity.providerId ||
        artifact.identity.resourceId !== identity.resourceId ||
        artifact.identity.operationName !== identity.operationName ||
        artifact.identity.simulationId !== identity.simulationId
      ) {
        throw new Error("BUSINESS_PROBE_ARTIFACT_IDENTITY_MISMATCH");
      }
      revision = artifact.revision;
      if (artifact.availability !== "available" || artifact.content.kind !== "content_ref") {
        if (result.content !== undefined || chunks > 0)
          throw new Error("BUSINESS_PROBE_ARTIFACT_CONTENT_INVALID");
        await emit({
          type: "artifact",
          taskId: options.taskId,
          artifactId: artifact.artifactId,
          revision,
          availability: artifact.availability,
          contentKind: artifact.availability === "available" ? artifact.content.kind : undefined,
        });
        return;
      }
      const ref = artifact.content;
      if (
        expected !== undefined &&
        (ref.sizeBytes !== expected.sizeBytes ||
          ref.sha256 !== expected.sha256 ||
          ref.mediaType !== expected.mediaType ||
          ref.handle !== expected.handle ||
          ref.expiresAt !== expected.expiresAt)
      )
        throw new Error("BUSINESS_PROBE_ARTIFACT_REF_CHANGED");
      expected ??= {
        sizeBytes: ref.sizeBytes,
        sha256: ref.sha256,
        mediaType: ref.mediaType,
        handle: ref.handle,
        ...(ref.expiresAt === undefined ? {} : { expiresAt: ref.expiresAt }),
      };
      if (!isRecord(result.content)) throw new Error("BUSINESS_PROBE_ARTIFACT_CONTENT_MISSING");
      const content = result.content;
      if (
        content.encoding !== "base64" ||
        typeof content.bytes !== "string" ||
        content.mediaType !== ref.mediaType ||
        content.sha256 !== ref.sha256 ||
        content.totalBytes !== String(ref.sizeBytes) ||
        content.offset !== offset
      )
        throw new Error("BUSINESS_PROBE_ARTIFACT_CONTENT_INVALID");
      const bytes = Buffer.from(content.bytes, "base64");
      const next = offset + bytes.length;
      if (
        bytes.toString("base64") !== content.bytes ||
        bytes.length > artifactChunkBytes ||
        next > ref.sizeBytes ||
        (next < ref.sizeBytes && (bytes.length === 0 || content.nextOffset !== String(next))) ||
        (next === ref.sizeBytes && content.nextOffset !== undefined)
      )
        throw new Error("BUSINESS_PROBE_ARTIFACT_CONTENT_INVALID");
      digest.update(bytes);
      chunks += 1;
      if (next === ref.sizeBytes) {
        if (digest.digest("hex") !== ref.sha256)
          throw new Error("BUSINESS_PROBE_ARTIFACT_DIGEST_MISMATCH");
        await emit({
          type: "artifactContent",
          taskId: options.taskId,
          artifactId: artifact.artifactId,
          revision,
          sizeBytes: ref.sizeBytes,
          sha256: ref.sha256,
          chunks,
        });
        return;
      }
      offset = next;
    }
  };
  try {
    await bootstrapWithRetry();
    await readArtifact();
    if (options.snapshotOnly) return;
    while (!controller.signal.aborted && applied < maxEvents) {
      if (!cursor || !state) throw new Error("BUSINESS_PROBE_STATE_MISSING");
      const requested = cursor;
      const listener = new AbortController();
      const response = await request(
        EVENTS_LISTEN,
        { cursor: requested },
        AbortSignal.any([controller.signal, listener.signal]),
      );
      if (!response.ok) {
        const envelope: unknown = await response.json();
        const reasonCode = errorReason(envelope);
        if (
          reasonCode === "BUSINESS_EVENT_STREAM_RESET" ||
          reasonCode === "BUSINESS_EVENT_CURSOR_EXPIRED"
        ) {
          if (++refreshes > 3) throw new Error("BUSINESS_PROBE_REFRESH_LIMIT");
          await emit({ type: "refresh", reasonCode });
          await bootstrapWithRetry();
          continue;
        }
        throw new Error(`BUSINESS_PROBE_LISTEN_FAILED:${reasonCode ?? response.status}`);
      }
      if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
        throw new Error("BUSINESS_PROBE_SSE_INVALID");
      }
      let refresh: "continuity" | "unresolved_refs" | undefined;
      let minimumContextRevision: number | undefined;
      let minimumPublicCursor: RuntimeBusinessCursor | undefined;
      for await (const message of sseMessages(response.body, () => listener.abort())) {
        if (isRecord(message) && isRecord(message.error)) {
          throw new Error(`BUSINESS_PROBE_SSE_ERROR:${errorReason(message) ?? "UNKNOWN"}`);
        }
        if (!isRecord(message) || typeof message.method !== "string") continue;
        if (message.method === "notifications/io.sdar/businessEvents/acknowledged") {
          const params = message.params;
          if (
            !isRecord(params) ||
            params.streamId !== requested.streamId ||
            params.acceptedAfterSequence !== requested.afterSequence
          ) {
            throw new Error("BUSINESS_PROBE_ACK_CURSOR_MISMATCH");
          }
          continue;
        }
        if (message.method === "notifications/io.sdar/businessEvents/continuity") {
          refresh = "continuity";
          await emit({ type: "refresh", reasonCode: "BUSINESS_EVENT_STREAM_RESET" });
          break;
        }
        if (message.method !== NOTIFICATION) continue;
        const params = message.params;
        if (!isRecord(params)) throw new Error("BUSINESS_PROBE_SSE_INVALID");
        const next = RuntimeBusinessCursorSchema.parse({
          streamId: params.streamId,
          afterSequence: params.sequence,
        });
        if (next.streamId !== cursor.streamId) throw new Error("BUSINESS_EVENT_STREAM_RESET");
        if (BigInt(next.afterSequence) <= BigInt(cursor.afterSequence)) continue;
        let needsHydration = false;
        if (params.sourceId === "vehicle.business" && params.taskId === options.taskId) {
          const feedback = normalizeTaskBusinessSseNotification(message, state.context.identity);
          const updated = reduceTaskBusinessFeedback(state, feedback);
          if (updated !== state) {
            state = updated;
            applied += 1;
            const unresolvedRefs = unresolvedTaskBusinessRefs(state);
            needsHydration = unresolvedRefs.length > 0;
            await emit({
              type: "businessEvent",
              taskId: options.taskId,
              messageId: feedback.messageId,
              kind: feedback.kind,
              contextRevision: feedback.contextRevision,
              publicCursor: feedback.resumeFrom,
              sourceCursor: feedback.sourceCursor,
              phase: state.context.phase,
              summary: state.context.summary,
              activeRefs: state.context.activeRefs,
              unresolvedRefs,
              ...(options.capturePublicPayloads ? { notification: message } : {}),
              ...(state.opaqueDiagnostics.at(-1)?.messageId === feedback.messageId
                ? { opaqueDiagnostic: state.opaqueDiagnostics.at(-1) }
                : {}),
            });
          }
        }
        cursor = next;
        await emit({ type: "cursor", cursor });
        if (needsHydration) {
          refresh = "unresolved_refs";
          minimumContextRevision = state.context.contextRevision;
          minimumPublicCursor = cursor;
          await emit({ type: "refresh", reasonCode: "BUSINESS_OBJECT_REFS_UNRESOLVED" });
          break;
        }
        if (applied >= maxEvents) break;
      }
      if (refresh) {
        if (refresh === "continuity" && ++refreshes > 3)
          throw new Error("BUSINESS_PROBE_REFRESH_LIMIT");
        await bootstrapWithRetry(minimumContextRevision, minimumPublicCursor);
      } else if (applied < maxEvents) {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      failed = true;
      await emit({
        type: "error",
        reasonCode: error instanceof Error ? error.message : "BUSINESS_PROBE_FAILED",
      });
      throw error;
    }
  } finally {
    clearTimeout(timer);
    await emit({
      type: "stopped",
      reason: failed
        ? "failed"
        : options.snapshotOnly
          ? "snapshot_only"
          : applied >= maxEvents
            ? "max_events"
            : "duration_elapsed",
      taskId: options.taskId,
      appliedEvents: applied,
      ...(cursor ? { cursor } : {}),
    });
  }
}

function successfulResult(response: Response, envelope: unknown): Record<string, unknown> {
  if (!response.ok || !isRecord(envelope) || !isRecord(envelope.result)) {
    throw new Error(`BUSINESS_PROBE_QUERY_FAILED:${errorReason(envelope) ?? response.status}`);
  }
  return envelope.result;
}

function errorReason(envelope: unknown): string | undefined {
  if (!isRecord(envelope) || !isRecord(envelope.error) || !isRecord(envelope.error.data))
    return undefined;
  return typeof envelope.error.data.reasonCode === "string"
    ? envelope.error.data.reasonCode
    : undefined;
}

async function* sseMessages(body: ReadableStream<Uint8Array>, abort: () => void): AsyncGenerator {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffered += decoder.decode(value, { stream: true });
      buffered = buffered.replaceAll("\r\n", "\n");
      let end: number;
      while ((end = buffered.indexOf("\n\n")) >= 0) {
        const frame = buffered.slice(0, end);
        if (frame.length > 2_097_152) throw new Error("BUSINESS_PROBE_SSE_FRAME_TOO_LARGE");
        buffered = buffered.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) yield JSON.parse(data) as unknown;
      }
      if (buffered.length > 2_097_152) throw new Error("BUSINESS_PROBE_SSE_FRAME_TOO_LARGE");
    }
  } finally {
    // Abort the HTTP request before awaiting cancellation: an open SSE peer can
    // otherwise keep the reader cancellation pending after a continuity refresh.
    abort();
    try {
      await reader.cancel();
    } catch {
      /* Closed by peer or abort. */
    }
    reader.releaseLock();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
