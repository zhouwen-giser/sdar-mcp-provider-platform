import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  ConfigurationBusinessKey,
  ConfigurationCenter,
  ConfigurationContent,
  ConfigurationPublicationService,
} from "../../../packages/configuration-center/src/index.js";
import { PmsDomainError } from "../../../packages/pms-domain/src/index.js";
import type { ConfigurationTargetType } from "../../../packages/runtime-configuration-contract/src/index.js";
import { requestContext } from "./context.js";

interface DraftBody {
  readonly draftId: string;
  readonly definitionId: string;
  readonly environment: string;
  readonly targetType: ConfigurationTargetType;
  readonly targetId: string;
  readonly configGroup: string;
  readonly dataId: string;
  readonly ancestorTargetIds?: Readonly<Partial<Record<ConfigurationTargetType, string>>>;
  readonly content: ConfigurationContent;
}

interface DraftParameters {
  readonly draftId: string;
}

interface UpdateDraftBody {
  readonly expectedVersion: number;
  readonly ancestorTargetIds?: Readonly<Partial<Record<ConfigurationTargetType, string>>>;
  readonly content: ConfigurationContent;
}

interface PublishBody {
  readonly expectedDraftVersion: number;
  readonly expectedPublishedRevision: number | null;
}

interface RollbackBody extends PublishBody {
  readonly sourceRevisionId: string;
}

const identifier = { type: "string", minLength: 1, maxLength: 128 } as const;
const targetTypes = [
  "environment",
  "provider_type",
  "provider",
  "runtime_deployment",
  "runtime_instance",
  "collector",
] as const;
const targetIdMap = {
  type: "object",
  propertyNames: { enum: targetTypes },
  additionalProperties: identifier,
} as const;
const content = { type: "object", additionalProperties: true } as const;

export function registerConfigurationRoutes(
  app: FastifyInstance,
  center: ConfigurationCenter,
  publication?: ConfigurationPublicationService,
): void {
  app.post<{ Body: DraftBody }>(
    "/api/v1/config-drafts",
    {
      schema: {
        body: {
          type: "object",
          required: [
            "draftId",
            "definitionId",
            "environment",
            "targetType",
            "targetId",
            "configGroup",
            "dataId",
            "content",
          ],
          properties: {
            draftId: identifier,
            definitionId: identifier,
            environment: identifier,
            targetType: { enum: targetTypes },
            targetId: identifier,
            configGroup: identifier,
            dataId: identifier,
            ancestorTargetIds: targetIdMap,
            content,
          },
          additionalProperties: false,
        },
      },
    },
    (request, reply) => {
      requireActor(request);
      const key: ConfigurationBusinessKey = {
        environment: request.body.environment,
        targetType: request.body.targetType,
        targetId: request.body.targetId,
        configGroup: request.body.configGroup,
        dataId: request.body.dataId,
      };
      const draft = center.createDraft({
        draftId: request.body.draftId,
        definitionId: request.body.definitionId,
        key,
        ...(request.body.ancestorTargetIds === undefined
          ? {}
          : { ancestorTargetIds: request.body.ancestorTargetIds }),
        content: request.body.content,
      });
      void reply.status(201);
      return draft;
    },
  );

  app.get<{ Params: DraftParameters }>(
    "/api/v1/config-drafts/:draftId",
    { schema: { params: draftParams() } },
    (request) => center.getDraft(request.params.draftId),
  );

  app.patch<{ Params: DraftParameters; Body: UpdateDraftBody }>(
    "/api/v1/config-drafts/:draftId",
    {
      schema: {
        params: draftParams(),
        body: {
          type: "object",
          required: ["expectedVersion", "content"],
          properties: {
            expectedVersion: { type: "integer", minimum: 1 },
            ancestorTargetIds: targetIdMap,
            content,
          },
          additionalProperties: false,
        },
      },
    },
    (request) => {
      requireActor(request);
      return center.updateDraft(request.params.draftId, {
        expectedVersion: request.body.expectedVersion,
        content: request.body.content,
        ...(request.body.ancestorTargetIds === undefined
          ? {}
          : { ancestorTargetIds: request.body.ancestorTargetIds }),
      });
    },
  );

  app.post<{ Params: DraftParameters }>(
    "/api/v1/config-drafts/:draftId/validate",
    { schema: { params: draftParams() } },
    (request) => {
      requireActor(request);
      return center.validateDraft(request.params.draftId);
    },
  );

  app.get<{ Params: DraftParameters }>(
    "/api/v1/config-drafts/:draftId/effective",
    { schema: { params: draftParams() } },
    (request) => center.effectivePreview(request.params.draftId),
  );

  if (publication !== undefined) registerPublicationRoutes(app, publication);
}

function registerPublicationRoutes(
  app: FastifyInstance,
  publication: ConfigurationPublicationService,
): void {
  app.post<{ Params: DraftParameters; Body: PublishBody }>(
    "/api/v1/config-drafts/:draftId/publish",
    {
      schema: {
        params: draftParams(),
        body: publicationBody(),
      },
    },
    (request) =>
      publication.publish(
        { draftId: request.params.draftId, ...request.body },
        publicationContext(request),
      ),
  );
  app.post<{ Params: DraftParameters; Body: RollbackBody }>(
    "/api/v1/config-drafts/:draftId/rollback",
    {
      schema: {
        params: draftParams(),
        body: {
          ...publicationBody(),
          required: ["expectedDraftVersion", "expectedPublishedRevision", "sourceRevisionId"],
          properties: {
            ...publicationBody().properties,
            sourceRevisionId: {
              type: "string",
              pattern:
                "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
            },
          },
        },
      },
    },
    (request) =>
      publication.rollback(
        { draftId: request.params.draftId, ...request.body },
        publicationContext(request),
      ),
  );
}

function draftParams() {
  return {
    type: "object",
    required: ["draftId"],
    properties: { draftId: identifier },
    additionalProperties: false,
  } as const;
}

function publicationBody() {
  return {
    type: "object",
    required: ["expectedDraftVersion", "expectedPublishedRevision"],
    properties: {
      expectedDraftVersion: { type: "integer", minimum: 1 },
      expectedPublishedRevision: {
        anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
      },
    },
    additionalProperties: false,
  } as const;
}

function publicationContext(request: FastifyRequest) {
  const context = requestContext(request);
  if (context.actorId === undefined) {
    throw new PmsDomainError("INVALID_DOMAIN_VALUE", "Actor header is required", {
      field: "x-actor-id",
    });
  }
  return { actorId: context.actorId, correlationId: context.correlationId };
}

function requireActor(request: FastifyRequest): void {
  if (requestContext(request).actorId === undefined) {
    throw new PmsDomainError("INVALID_DOMAIN_VALUE", "Actor header is required", {
      field: "x-actor-id",
    });
  }
}
