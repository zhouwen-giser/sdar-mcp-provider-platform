import { createHash } from "node:crypto";
import { array, record, text, type Json } from "../shared/model.js";
import type { Mcp } from "./mcp.js";
export interface BusinessSnapshot {
  context: Json;
  objects: Json[];
  resumeFrom: Json;
  complete: boolean;
  missingRefs: Json[];
}
function identityMatches(a: Json, b: Json) {
  return [
    "taskId",
    "executionId",
    "providerId",
    "resourceId",
    "operationName",
    "simulationId",
  ].every((k) => a[k] === b[k]);
}
function refOf(object: Json) {
  const v = record(object.value);
  return {
    kind: object.kind,
    id: v.artifactId ?? v.actionId ?? v.requestId ?? v.interventionId,
    revision: v.revision,
  };
}
const refKey = (v: Json) => `${text(v.kind)}:${text(v.id)}:${text(v.revision)}`;
export async function readChunks(
  get: (offset: number) => Promise<Json>,
  expectedSize?: number,
  expectedSha?: string,
): Promise<Buffer> {
  let offset = 0,
    total = expectedSize,
    sha = expectedSha;
  const chunks: Buffer[] = [];
  const digest = createHash("sha256");
  for (let i = 0; i < 4096; i++) {
    const part = await get(offset),
      bytes = Buffer.from(text(part.bytes), "base64");
    const size = Number(part.totalBytes);
    if (
      part.encoding !== "base64" ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > 64 * 1024 * 1024 ||
      part.offset !== offset ||
      bytes.length === 0 ||
      bytes.length > 1048576 ||
      bytes.toString("base64") !== part.bytes ||
      !/^([a-f0-9]{64})$/.test(text(part.sha256)) ||
      (total !== undefined && total !== size) ||
      (sha !== undefined && sha !== part.sha256)
    )
      throw Error("BUSINESS_CHUNK_INVALID");
    total = size;
    sha = text(part.sha256);
    offset += bytes.length;
    if (
      offset > total ||
      (offset < total && part.nextOffset !== String(offset)) ||
      (offset === total && part.nextOffset !== undefined)
    )
      throw Error("BUSINESS_CHUNK_OFFSET_INVALID");
    digest.update(bytes);
    chunks.push(bytes);
    if (offset === total) {
      if (digest.digest("hex") !== sha) throw Error("BUSINESS_DIGEST_MISMATCH");
      return Buffer.concat(chunks);
    }
  }
  throw Error("BUSINESS_CONTENT_TOO_LARGE");
}
export async function businessSnapshot(mcp: Mcp, taskId: string): Promise<BusinessSnapshot> {
  for (let attempt = 0; attempt < 3; attempt++)
    try {
      return await snapshotOnce(mcp, taskId);
    } catch (e) {
      if (
        attempt === 2 ||
        !/REVISION_CHANGED|CURSOR_CHANGED|CURSOR_INVALID/.test(e instanceof Error ? e.message : "")
      )
        throw e;
    }
  throw Error("BUSINESS_SNAPSHOT_INCOMPLETE");
}
async function snapshotOnce(mcp: Mcp, taskId: string): Promise<BusinessSnapshot> {
  let context: Json | undefined,
    cursor: Json | undefined,
    next: string | undefined,
    revision: unknown;
  const objects = new Map<string, Json>();
  const seenPages = new Set<string>();
  for (let page = 0; page < 1024; page++) {
    const result = await mcp.rpc("io.sdar/taskBusiness/context/get", {
        taskId,
        maxPageBytes: 65536,
        ...(next ? { pageCursor: next } : {}),
      }),
      snapshot = record(result.snapshot);
    const resume = record(result.resumeFrom);
    if (
      !Number.isSafeInteger(snapshot.contextRevision) ||
      !Array.isArray(snapshot.objects) ||
      !Array.isArray(snapshot.objectDescriptors) ||
      !text(resume.streamId) ||
      !/^\d+$/.test(text(resume.afterSequence))
    )
      throw Error("BUSINESS_SNAPSHOT_INVALID");
    if (
      page > 0 &&
      (revision !== snapshot.contextRevision || JSON.stringify(cursor) !== JSON.stringify(resume))
    )
      throw Error("BUSINESS_SNAPSHOT_REVISION_CHANGED");
    revision = snapshot.contextRevision;
    cursor = resume;
    const readDescriptor = async (descriptor: Json, objectRef?: Json) => {
      if (
        typeof result.snapshotToken !== "string" ||
        !Number.isSafeInteger(descriptor.sizeBytes) ||
        Number(descriptor.sizeBytes) < 1
      )
        throw Error("BUSINESS_DESCRIPTOR_INVALID");
      const bytes = await readChunks(
        async (offset) =>
          record(
            (
              await mcp.rpc("io.sdar/taskBusiness/snapshotParts/get", {
                taskId,
                snapshotToken: result.snapshotToken,
                ...(objectRef ? { objectRef } : {}),
                offset,
                maxBytes: 65536,
              })
            ).part,
          ),
        Number(descriptor.sizeBytes),
      );
      return record(JSON.parse(bytes.toString("utf8")));
    };
    let pageContext = record(snapshot.context);
    if (snapshot.contextDescriptor) {
      const d = record(snapshot.contextDescriptor);
      if (
        d.readMethod !== "getContext" ||
        d.revision !== revision ||
        snapshot.context !== undefined
      )
        throw Error("BUSINESS_DESCRIPTOR_INVALID");
      pageContext = await readDescriptor(d);
    }
    if (record(pageContext.identity).taskId !== taskId || pageContext.contextRevision !== revision)
      throw Error("BUSINESS_IDENTITY_MISMATCH");
    if (context && JSON.stringify(context) !== JSON.stringify(pageContext))
      throw Error("BUSINESS_SNAPSHOT_REVISION_CHANGED");
    context = pageContext;
    const pageObjects = array(snapshot.objects).map(record);
    for (const descriptorValue of array(snapshot.objectDescriptors)) {
      const descriptor = record(descriptorValue),
        ref = record(descriptor.ref);
      if (
        descriptor.readMethod !== "getObjectVersion" ||
        !text(ref.kind) ||
        !text(ref.id) ||
        !Number.isInteger(ref.revision)
      )
        throw Error("BUSINESS_DESCRIPTOR_INVALID");
      const object = await readDescriptor(descriptor, ref);
      if (refKey(refOf(object)) !== refKey(ref)) throw Error("BUSINESS_OBJECT_REF_MISMATCH");
      pageObjects.push(object);
    }
    for (const object of pageObjects) {
      const ref = refOf(object);
      if (
        !["artifact", "action", "input_request", "intervention"].includes(text(ref.kind)) ||
        !ref.id ||
        !Number.isInteger(ref.revision) ||
        !identityMatches(record(record(object.value).identity), record(context.identity))
      )
        throw Error("BUSINESS_OBJECT_IDENTITY_MISMATCH");
      const key = refKey(ref);
      const previous = objects.get(key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(object))
        throw Error("BUSINESS_OBJECT_CONFLICT");
      objects.set(key, object);
    }
    next = typeof snapshot.nextCursor === "string" ? snapshot.nextCursor : undefined;
    if (!next) {
      const refs = [
        ...array(context.artifactRefs),
        ...array(context.actionRefs),
        ...array(context.requiredInputRefs),
        ...array(context.interventionRefs),
        ...Object.values(record(context.activeRefs)),
      ].map(record);
      const missingRefs = refs.filter((ref) => !objects.has(refKey(ref)));
      return {
        context,
        objects: [...objects.values()],
        resumeFrom: cursor,
        complete: missingRefs.length === 0,
        missingRefs,
      };
    }
    if (seenPages.has(next)) throw Error("BUSINESS_SNAPSHOT_CURSOR_INVALID");
    seenPages.add(next);
  }
  throw Error("BUSINESS_SNAPSHOT_INCOMPLETE");
}
export async function readArtifact(
  mcp: Mcp,
  taskId: string,
  artifactId: string,
  revision: number,
  identity: Json,
) {
  const metadata = await mcp.rpc("io.sdar/taskBusiness/artifacts/get", {
    taskId,
    artifactId,
    revision,
    includeContent: false,
  });
  const artifact = record(metadata.artifact);
  if (
    artifact.artifactId !== artifactId ||
    artifact.revision !== revision ||
    !identityMatches(record(artifact.identity), identity)
  )
    throw Error("BUSINESS_ARTIFACT_IDENTITY_MISMATCH");
  const ref = record(artifact.content);
  if (artifact.availability !== "available" || ref.kind !== "content_ref")
    return { artifact, content: artifact.availability === "available" ? artifact.content : null };
  const bytes = await readChunks(
    async (offset) => {
      const result = await mcp.rpc("io.sdar/taskBusiness/artifacts/get", {
        taskId,
        artifactId,
        revision,
        includeContent: true,
        contentOffset: offset,
        maxContentBytes: 262144,
      });
      if (JSON.stringify(record(result.artifact)) !== JSON.stringify(artifact))
        throw Error("BUSINESS_ARTIFACT_VERSION_CONFLICT");
      const content = record(result.content);
      if (
        content.totalBytes !== String(ref.sizeBytes) ||
        content.sha256 !== ref.sha256 ||
        content.mediaType !== ref.mediaType
      )
        throw Error("BUSINESS_ARTIFACT_CONTENT_INVALID");
      return content;
    },
    Number(ref.sizeBytes),
    text(ref.sha256),
  );
  const media = text(ref.mediaType);
  let content: unknown = bytes.toString("utf8");
  if (media.includes("json")) content = JSON.parse(bytes.toString("utf8"));
  return { artifact, content, sha256: ref.sha256 };
}
