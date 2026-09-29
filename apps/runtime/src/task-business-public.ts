import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  AdapterContractError,
  InvalidParamsError,
  type AuthorizationContext,
} from "../../../packages/domain/src/index.js";
import { FrozenErrorCode, FrozenProtocolError } from "../../../packages/mcp-protocol/src/index.js";
import type {
  BusinessEventGeneration,
  BusinessEventRepository,
} from "../../../packages/persistence-postgres/src/index.js";
import {
  TASK_BUSINESS_OPERATION_PROFILE_SCHEMA_VERSION,
  type BusinessSnapshotPartResponse,
} from "../../../packages/adapter-protocol/src/index.js";
import {
  TASK_BUSINESS_PROFILE_VERSION,
  taskBusinessProtocolError,
} from "./task-business-gateway.js";
import type { TaskBusinessGateway } from "./task-business-gateway.js";
import type {
  PublicArtifactQuery,
  PublicContextQuery,
  PublicInterventionApply,
  PublicSnapshotPartQuery,
} from "../../../packages/mcp-protocol/src/sep2663/task-business.js";
import type { TaskEngine } from "../../../packages/task-engine/src/index.js";
import {
  BusinessObjectRefSchema,
  TaskBusinessContextSchema,
  type BusinessObjectRef,
} from "../../../packages/vehicle-provider-core/src/task-business-contract.js";
import {
  TaskArtifactSchema,
  type TaskArtifact,
} from "../../../packages/vehicle-provider-core/src/task-business-artifact.js";
import {
  BusinessActionSchema,
  RequiredInputSchema,
  RuntimeInterventionSchema,
} from "../../../packages/vehicle-provider-core/src/task-business-interaction.js";
import type { BoundTaskBusinessTask } from "./task-business-gateway.js";

interface SnapshotCursor {
  version: 1;
  taskId: string;
  authorizationHash: string;
  streamId: string;
  afterSequence: string;
  adapterCursor: string;
  contextRevision: number;
  maxPageBytes: number;
}

/** Coordinates public watermarks with the private Adapter snapshot/read RPCs. */
export class TaskBusinessPublicService {
  readonly #cursorKey = randomBytes(32);
  constructor(
    readonly providerId: string,
    readonly business: TaskBusinessGateway,
    readonly events: Pick<BusinessEventRepository, "currentGeneration">,
    readonly engine?: Pick<TaskEngine, "enqueueBusinessIntervention">,
  ) {}

  async applyIntervention(
    request: PublicInterventionApply,
    authorization: AuthorizationContext,
  ): Promise<Record<string, unknown>> {
    try {
      const bound = await this.business.resolve(
        request.command.taskId,
        authorization,
        "intervention",
        request.claimed,
      );
      if (request.command.executionId !== bound.externalExecutionId) {
        throw new InvalidParamsError("BUSINESS_EXECUTION_ID_MISMATCH");
      }
      if (!this.engine) throw new AdapterContractError("BUSINESS_INTERVENTION_RUNTIME_UNAVAILABLE");
      const receipt = await this.engine.enqueueBusinessIntervention(request.command, authorization);
      return { ...receipt, profileVersion: TASK_BUSINESS_PROFILE_VERSION };
    } catch (error) {
      throw taskBusinessProtocolError(error);
    }
  }

  async getContext(
    query: PublicContextQuery,
    authorization: AuthorizationContext,
  ): Promise<Record<string, unknown>> {
    try {
      const bound = await this.business.resolve(
        query.taskId,
        authorization,
        "context",
        query.claimed,
      );
      const cursor = query.pageCursor ? decodeCursor(query.pageCursor, this.#cursorKey) : undefined;
      if (
        cursor &&
        (cursor.taskId !== query.taskId ||
          cursor.authorizationHash !== authorization.hash ||
          cursor.maxPageBytes !== query.maxPageBytes)
      ) {
        throw snapshotError("BUSINESS_SNAPSHOT_CURSOR_INVALID");
      }
      const before = await this.currentGeneration();
      const resumeFrom = cursor
        ? { streamId: cursor.streamId, afterSequence: cursor.afterSequence }
        : { streamId: before.streamId, afterSequence: before.currentSequence };
      assertGeneration(before, resumeFrom);
      const page = await this.business.getContext(
        query.taskId,
        authorization,
        query.maxPageBytes,
        cursor?.adapterCursor ?? "",
        query.claimed,
      );
      const revision = page.contextRevision;
      if (
        typeof revision !== "number" ||
        !Number.isSafeInteger(revision) ||
        revision < 0 ||
        (cursor && cursor.contextRevision !== revision)
      ) {
        throw snapshotError("BUSINESS_SNAPSHOT_REVISION_CHANGED");
      }
      if (!Array.isArray(page.objects) || !Array.isArray(page.objectDescriptors))
        throw new AdapterContractError("BUSINESS_SNAPSHOT_PAGE_INVALID");
      if (
        !bound.profile.methods.snapshotPartGet &&
        (page.contextDescriptor !== undefined || page.objectDescriptors.length > 0)
      )
        throw snapshotError("BUSINESS_SNAPSHOT_DESCRIPTOR_UNSUPPORTED");
      const descriptor = page.contextDescriptor;
      const context =
        descriptor === undefined
          ? page.context
          : await this.readDescriptorContext(bound, descriptor, revision);
      const parsedContext = TaskBusinessContextSchema.safeParse(context);
      if (
        !parsedContext.success ||
        parsedContext.data.contextRevision !== revision ||
        !sameBoundIdentity(parsedContext.data.identity, bound)
      ) {
        throw new AdapterContractError("BUSINESS_SNAPSHOT_PAGE_INVALID");
      }
      const inlineRefs = assertPageObjects(page.objects, parsedContext.data, bound);
      assertPageDescriptors(page.objectDescriptors, parsedContext.data, inlineRefs);
      const after = await this.currentGeneration();
      assertGeneration(after, resumeFrom);
      const { nextCursor: adapterNext, ...snapshot } = page;
      if (adapterNext !== undefined && typeof adapterNext !== "string") {
        throw snapshotError("BUSINESS_SNAPSHOT_CURSOR_INVALID");
      }
      const nextCursor = adapterNext
        ? encodeCursor(
            {
              version: 1,
              taskId: query.taskId,
              authorizationHash: authorization.hash,
              streamId: resumeFrom.streamId,
              afterSequence: resumeFrom.afterSequence,
              adapterCursor: adapterNext,
              contextRevision: revision,
              maxPageBytes: query.maxPageBytes,
            },
            this.#cursorKey,
          )
        : undefined;
      const snapshotToken = encodeCursor(
        {
          version: 1,
          taskId: query.taskId,
          authorizationHash: authorization.hash,
          streamId: resumeFrom.streamId,
          afterSequence: resumeFrom.afterSequence,
          adapterCursor: "",
          contextRevision: revision,
          maxPageBytes: query.maxPageBytes,
        },
        this.#cursorKey,
      );
      return {
        resultType: "complete",
        profileVersion: TASK_BUSINESS_PROFILE_VERSION,
        snapshotToken,
        snapshot: { ...snapshot, ...(nextCursor === undefined ? {} : { nextCursor }) },
        resumeFrom,
      };
    } catch (error) {
      throw taskBusinessProtocolError(error);
    }
  }

  async getSnapshotPart(
    query: PublicSnapshotPartQuery,
    authorization: AuthorizationContext,
  ): Promise<Record<string, unknown>> {
    try {
      const bound = await this.business.resolve(
        query.taskId,
        authorization,
        "context",
        query.claimed,
      );
      const token = decodeCursor(query.snapshotToken, this.#cursorKey);
      if (token.taskId !== query.taskId || token.authorizationHash !== authorization.hash)
        throw snapshotError("BUSINESS_SNAPSHOT_CURSOR_INVALID");
      const resumeFrom = { streamId: token.streamId, afterSequence: token.afterSequence };
      assertGeneration(await this.currentGeneration(), resumeFrom);
      const response = await this.business.getSnapshotPartForBound(bound, {
        contextRevision: token.contextRevision,
        ...(query.objectRef === undefined ? {} : { objectRef: query.objectRef }),
        offset: query.offset,
        maxBytes: query.maxBytes,
      });
      const part = validateSnapshotPart(response, query.offset, query.maxBytes);
      assertGeneration(await this.currentGeneration(), resumeFrom);
      if (query.offset === 0 && part.end === part.totalBytes) {
        const value = parseJsonBytes(response.jsonBytes);
        assertCompleteSnapshotValue(value, token.contextRevision, query.objectRef, bound);
      }
      return {
        resultType: "complete",
        profileVersion: TASK_BUSINESS_PROFILE_VERSION,
        part: {
          encoding: "base64",
          bytes: Buffer.from(response.jsonBytes).toString("base64"),
          totalBytes: response.totalBytes,
          sha256: response.sha256,
          offset: query.offset,
          ...(response.nextOffset === undefined ? {} : { nextOffset: response.nextOffset }),
        },
      };
    } catch (error) {
      throw taskBusinessProtocolError(error);
    }
  }

  private async readDescriptorContext(
    bound: BoundTaskBusinessTask,
    descriptor: unknown,
    revision: number,
  ): Promise<unknown> {
    if (
      !isRecord(descriptor) ||
      descriptor.revision !== revision ||
      !Number.isSafeInteger(descriptor.sizeBytes) ||
      typeof descriptor.sizeBytes !== "number" ||
      descriptor.sizeBytes < 1 ||
      descriptor.readMethod !== "getContext"
    )
      throw new AdapterContractError("BUSINESS_SNAPSHOT_DESCRIPTOR_INVALID");
    const chunks: Uint8Array[] = [];
    const digest = createHash("sha256");
    let offset = 0;
    let expectedSha: string | undefined;
    for (;;) {
      const response = await this.business.getSnapshotPartForBound(bound, {
        contextRevision: revision,
        offset,
        maxBytes: 1_048_576,
      });
      const part = validateSnapshotPart(response, offset, 1_048_576);
      if (
        part.totalBytes !== descriptor.sizeBytes ||
        (expectedSha && response.sha256 !== expectedSha)
      )
        throw new AdapterContractError("BUSINESS_SNAPSHOT_DESCRIPTOR_INVALID");
      expectedSha = response.sha256;
      chunks.push(response.jsonBytes);
      digest.update(response.jsonBytes);
      if (part.end === part.totalBytes) break;
      offset = part.end;
    }
    if (digest.digest("hex") !== expectedSha)
      throw new AdapterContractError("BUSINESS_SNAPSHOT_DESCRIPTOR_INVALID");
    return parseJsonBytes(Buffer.concat(chunks));
  }

  async getArtifact(
    query: PublicArtifactQuery,
    authorization: AuthorizationContext,
  ): Promise<Record<string, unknown>> {
    try {
      const bound = await this.business.resolve(
        query.taskId,
        authorization,
        "artifact",
        query.claimed,
      );
      const response = await this.business.getArtifactForBound(
        bound,
        query.artifactId,
        query.revision,
        query.representationName,
        query.includeContent,
        {
          ...(query.contentOffset === undefined ? {} : { contentOffset: query.contentOffset }),
          ...(query.maxContentBytes === undefined
            ? {}
            : { maxContentBytes: query.maxContentBytes }),
        },
      );
      const artifact = TaskArtifactSchema.safeParse(response.artifact);
      if (
        !artifact.success ||
        artifact.data.artifactId !== query.artifactId ||
        (query.revision !== undefined && artifact.data.revision !== query.revision) ||
        !sameBoundIdentity(artifact.data.identity, bound)
      ) {
        throw new AdapterContractError("BUSINESS_ARTIFACT_RESPONSE_INVALID");
      }
      assertArtifactContentResponse(query, artifact.data, response);
      return {
        resultType: "complete",
        profileVersion: TASK_BUSINESS_PROFILE_VERSION,
        artifact: response.artifact,
        ...(response.contentBytes === undefined
          ? {}
          : {
              content: {
                encoding: "base64",
                bytes: Buffer.from(response.contentBytes).toString("base64"),
                mediaType: response.mediaType,
                sha256: response.sha256,
                totalBytes: response.contentTotalBytes,
                offset: query.contentOffset ?? 0,
                ...(response.nextContentOffset === undefined
                  ? {}
                  : { nextOffset: response.nextContentOffset }),
              },
            }),
      };
    } catch (error) {
      throw taskBusinessProtocolError(error);
    }
  }

  private async currentGeneration(): Promise<BusinessEventGeneration> {
    const generation = await this.events.currentGeneration(this.providerId);
    if (generation?.status !== "current") {
      throw snapshotError("BUSINESS_EVENT_STREAM_RESET");
    }
    return generation;
  }
}

function assertArtifactContentResponse(
  query: PublicArtifactQuery,
  artifact: TaskArtifact,
  response: {
    contentBytes?: Uint8Array;
    mediaType: string;
    sha256: string;
    contentTotalBytes: string;
    nextContentOffset?: string;
  },
): void {
  const invalid = () => new AdapterContractError("BUSINESS_ARTIFACT_CONTENT_INVALID");
  const selected =
    artifact.availability === "available"
      ? query.representationName
        ? artifact.representations?.[query.representationName]
        : artifact.content
      : undefined;
  if (query.representationName && selected === undefined) throw invalid();
  const bytes = response.contentBytes;
  if (bytes === undefined) {
    if (query.includeContent && selected?.kind === "content_ref") throw invalid();
    if (response.nextContentOffset !== undefined) throw invalid();
    return;
  }
  if (
    !query.includeContent ||
    !(bytes instanceof Uint8Array) ||
    selected?.kind !== "content_ref" ||
    response.mediaType !== selected.mediaType ||
    response.sha256 !== selected.sha256 ||
    response.contentTotalBytes !== String(selected.sizeBytes)
  )
    throw invalid();
  const offset = query.contentOffset ?? 0;
  const end = offset + bytes.length;
  if (
    bytes.length > (query.maxContentBytes ?? 1_048_576) ||
    end > selected.sizeBytes ||
    (end < selected.sizeBytes && bytes.length === 0) ||
    (end < selected.sizeBytes && response.nextContentOffset !== String(end)) ||
    (end === selected.sizeBytes && response.nextContentOffset !== undefined)
  )
    throw invalid();
  if (
    offset === 0 &&
    end === selected.sizeBytes &&
    createHash("sha256").update(bytes).digest("hex") !== selected.sha256
  )
    throw invalid();
}

function sameBoundIdentity(
  identity: {
    taskId: string;
    executionId: string;
    providerId: string;
    resourceId: string;
    operationName: string;
    simulationId?: string | undefined;
  },
  bound: BoundTaskBusinessTask,
): boolean {
  return (
    identity.taskId === bound.task.taskId &&
    identity.executionId === bound.externalExecutionId &&
    identity.providerId === bound.task.providerId &&
    identity.resourceId === bound.resourceId &&
    identity.operationName === bound.task.operationName &&
    (identity.simulationId === undefined || identity.simulationId === bound.task.simulationId)
  );
}

function assertPageObjects(
  objects: unknown[],
  context: ReturnType<typeof TaskBusinessContextSchema.parse>,
  bound: BoundTaskBusinessTask,
): Set<string> {
  const refs = new Set(
    [
      ...context.artifactRefs,
      ...context.actionRefs,
      ...context.requiredInputRefs,
      ...context.interventionRefs,
      ...Object.values(context.activeRefs),
    ].map(refKey),
  );
  const seen = new Set<string>();
  for (const object of objects) {
    if (!isRecord(object)) throw new AdapterContractError("BUSINESS_SNAPSHOT_OBJECT_INVALID");
    const kind = object.kind;
    const parsed =
      kind === "artifact"
        ? TaskArtifactSchema.safeParse(object.value)
        : kind === "action"
          ? BusinessActionSchema.safeParse(object.value)
          : kind === "input_request"
            ? RequiredInputSchema.safeParse(object.value)
            : kind === "intervention"
              ? RuntimeInterventionSchema.safeParse(object.value)
              : undefined;
    if (
      parsed === undefined ||
      !parsed.success ||
      !sameBoundIdentity(parsed.data.identity, bound)
    ) {
      throw new AdapterContractError("BUSINESS_SNAPSHOT_OBJECT_INVALID");
    }
    const id =
      kind === "artifact"
        ? "artifactId" in parsed.data
          ? parsed.data.artifactId
          : undefined
        : kind === "action"
          ? "actionId" in parsed.data
            ? parsed.data.actionId
            : undefined
          : kind === "input_request"
            ? "requestId" in parsed.data
              ? parsed.data.requestId
              : undefined
            : "interventionId" in parsed.data
              ? parsed.data.interventionId
              : undefined;
    if (typeof id !== "string") throw new AdapterContractError("BUSINESS_SNAPSHOT_OBJECT_INVALID");
    const key = refKey({
      kind: kind as BusinessObjectRef["kind"],
      id,
      revision: parsed.data.revision,
    });
    if (!refs.has(key) || seen.has(key)) {
      throw new AdapterContractError("BUSINESS_SNAPSHOT_OBJECT_INVALID");
    }
    seen.add(key);
  }
  return seen;
}

function assertPageDescriptors(
  descriptors: unknown[],
  context: ReturnType<typeof TaskBusinessContextSchema.parse>,
  inlineRefs: ReadonlySet<string>,
): void {
  const refs = new Set(
    [
      ...context.artifactRefs,
      ...context.actionRefs,
      ...context.requiredInputRefs,
      ...context.interventionRefs,
      ...Object.values(context.activeRefs),
    ].map(refKey),
  );
  const seen = new Set<string>();
  for (const descriptor of descriptors) {
    if (!isRecord(descriptor))
      throw new AdapterContractError("BUSINESS_SNAPSHOT_DESCRIPTOR_INVALID");
    const ref = BusinessObjectRefSchema.safeParse(descriptor.ref);
    if (
      !ref.success ||
      !Number.isSafeInteger(descriptor.sizeBytes) ||
      typeof descriptor.sizeBytes !== "number" ||
      descriptor.sizeBytes < 1 ||
      descriptor.readMethod !== "getObjectVersion" ||
      !refs.has(refKey(ref.data)) ||
      inlineRefs.has(refKey(ref.data)) ||
      seen.has(refKey(ref.data))
    )
      throw new AdapterContractError("BUSINESS_SNAPSHOT_DESCRIPTOR_INVALID");
    seen.add(refKey(ref.data));
  }
}

function validateSnapshotPart(
  response: BusinessSnapshotPartResponse,
  offset: number,
  maxBytes: number,
): { totalBytes: number; end: number } {
  const invalid = () => new AdapterContractError("BUSINESS_SNAPSHOT_PART_INVALID");
  if (
    !(response.jsonBytes instanceof Uint8Array) ||
    response.jsonBytes.length > maxBytes ||
    !/^[1-9][0-9]*$/.test(response.totalBytes) ||
    !/^[0-9a-f]{64}$/.test(response.sha256)
  )
    throw invalid();
  const totalBytes = Number(response.totalBytes);
  const end = offset + response.jsonBytes.length;
  if (
    !Number.isSafeInteger(totalBytes) ||
    !Number.isSafeInteger(end) ||
    end > totalBytes ||
    (end < totalBytes &&
      (response.jsonBytes.length === 0 || response.nextOffset !== String(end))) ||
    (end === totalBytes && response.nextOffset !== undefined)
  )
    throw invalid();
  if (
    offset === 0 &&
    end === totalBytes &&
    createHash("sha256").update(response.jsonBytes).digest("hex") !== response.sha256
  )
    throw invalid();
  return { totalBytes, end };
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new AdapterContractError("BUSINESS_SNAPSHOT_PART_INVALID");
  }
}

function assertCompleteSnapshotValue(
  value: unknown,
  contextRevision: number,
  ref: BusinessObjectRef | undefined,
  bound: BoundTaskBusinessTask,
): void {
  if (ref === undefined) {
    const parsed = TaskBusinessContextSchema.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.contextRevision !== contextRevision ||
      !sameBoundIdentity(parsed.data.identity, bound)
    )
      throw new AdapterContractError("BUSINESS_SNAPSHOT_PART_INVALID");
    return;
  }
  if (!isRecord(value) || value.kind !== ref.kind)
    throw new AdapterContractError("BUSINESS_SNAPSHOT_PART_INVALID");
  const parsed =
    ref.kind === "artifact"
      ? TaskArtifactSchema.safeParse(value.value)
      : ref.kind === "action"
        ? BusinessActionSchema.safeParse(value.value)
        : ref.kind === "input_request"
          ? RequiredInputSchema.safeParse(value.value)
          : RuntimeInterventionSchema.safeParse(value.value);
  if (!parsed.success || !sameBoundIdentity(parsed.data.identity, bound))
    throw new AdapterContractError("BUSINESS_SNAPSHOT_PART_INVALID");
  const id =
    ref.kind === "artifact"
      ? "artifactId" in parsed.data
        ? parsed.data.artifactId
        : undefined
      : ref.kind === "action"
        ? "actionId" in parsed.data
          ? parsed.data.actionId
          : undefined
        : ref.kind === "input_request"
          ? "requestId" in parsed.data
            ? parsed.data.requestId
            : undefined
          : "interventionId" in parsed.data
            ? parsed.data.interventionId
            : undefined;
  if (id !== ref.id || parsed.data.revision !== ref.revision)
    throw new AdapterContractError("BUSINESS_SNAPSHOT_PART_INVALID");
}

function refKey(ref: BusinessObjectRef): string {
  return JSON.stringify([ref.kind, ref.id, ref.revision]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertGeneration(
  generation: BusinessEventGeneration,
  resumeFrom: { streamId: string; afterSequence: string },
): void {
  if (generation.streamId !== resumeFrom.streamId || generation.status !== "current") {
    throw snapshotError("BUSINESS_EVENT_STREAM_RESET");
  }
  const after = BigInt(resumeFrom.afterSequence);
  if (after > BigInt(generation.currentSequence)) {
    throw snapshotError("BUSINESS_EVENT_CURSOR_AHEAD");
  }
  if (after + 1n < BigInt(generation.earliestAvailableSequence)) {
    throw snapshotError("BUSINESS_EVENT_CURSOR_EXPIRED");
  }
}

function encodeCursor(cursor: SnapshotCursor, key: Buffer): string {
  const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function decodeCursor(value: string, key: Buffer): SnapshotCursor {
  if (value.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    throw snapshotError("BUSINESS_SNAPSHOT_CURSOR_INVALID");
  }
  const [payload, signature] = value.split(".");
  if (!payload || !signature) throw snapshotError("BUSINESS_SNAPSHOT_CURSOR_INVALID");
  const expected = createHmac("sha256", key).update(payload).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw snapshotError("BUSINESS_SNAPSHOT_CURSOR_INVALID");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
  } catch {
    throw snapshotError("BUSINESS_SNAPSHOT_CURSOR_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw snapshotError("BUSINESS_SNAPSHOT_CURSOR_INVALID");
  }
  const fields = parsed as Record<string, unknown>;
  if (
    fields.version !== 1 ||
    typeof fields.taskId !== "string" ||
    typeof fields.authorizationHash !== "string" ||
    typeof fields.streamId !== "string" ||
    typeof fields.afterSequence !== "string" ||
    !/^(0|[1-9][0-9]{0,18})$/.test(fields.afterSequence) ||
    typeof fields.adapterCursor !== "string" ||
    typeof fields.contextRevision !== "number" ||
    !Number.isSafeInteger(fields.contextRevision) ||
    typeof fields.maxPageBytes !== "number" ||
    !Number.isSafeInteger(fields.maxPageBytes)
  ) {
    throw snapshotError("BUSINESS_SNAPSHOT_CURSOR_INVALID");
  }
  return fields as unknown as SnapshotCursor;
}

function snapshotError(reasonCode: string): FrozenProtocolError {
  return new FrozenProtocolError(
    FrozenErrorCode.InvalidParams,
    "Business snapshot requires refresh.",
    409,
    {
      reasonCode,
      profileVersion: TASK_BUSINESS_PROFILE_VERSION,
      schemaVersion: TASK_BUSINESS_OPERATION_PROFILE_SCHEMA_VERSION,
    },
  );
}
