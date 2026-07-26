import { randomUUID } from "node:crypto";
import {
  auditEventId,
  configRevisionId,
  createAuditEvent,
  environmentId,
  PmsRepositoryError,
  type ConfigRevision,
  type ConfigurationDefinition as PersistedConfigurationDefinition,
  type ConfigurationTarget,
  type JsonObject,
  type PmsRepositories,
  type PmsUnitOfWork,
} from "@sdar/pms-domain";
import { canonicalSha256 } from "@sdar/runtime-configuration-contract";
import type { ConfigurationCenter } from "./center.js";
import { ConfigurationCenterError } from "./errors.js";
import type { ConfigurationBusinessKey, ConfigurationPublicationSnapshot } from "./model.js";

export interface ConfigurationPublicationContext {
  readonly actorId: string;
  readonly correlationId: string;
}

export interface PublishConfigurationDraft {
  readonly draftId: string;
  readonly expectedDraftVersion: number;
  readonly expectedPublishedRevision: number | null;
}

export interface RollbackConfiguration {
  readonly draftId: string;
  readonly expectedDraftVersion: number;
  readonly sourceRevisionId: string;
  readonly expectedPublishedRevision: number | null;
}

export interface ConfigurationPublicationResult {
  readonly outcome: "published" | "no_change";
  readonly revision: ConfigRevision;
}

export interface ConfigurationPublicationOptions {
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export class ConfigurationPublicationService {
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(
    private readonly center: ConfigurationCenter,
    private readonly unitOfWork: PmsUnitOfWork,
    options: ConfigurationPublicationOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? randomUUID;
  }

  async publish(
    input: PublishConfigurationDraft,
    context: ConfigurationPublicationContext,
  ): Promise<ConfigurationPublicationResult> {
    validContext(context);
    validExpectedRevision(input.expectedPublishedRevision);
    const snapshot = this.center.publicationSnapshot(input.draftId, input.expectedDraftVersion);
    const checksum = canonicalSha256(snapshot.effectiveContent);
    return this.#withConcurrencyRetry((repositories) =>
      this.#publishSnapshot(
        repositories,
        snapshot,
        checksum,
        input.expectedPublishedRevision,
        context,
      ),
    );
  }

  async rollback(
    input: RollbackConfiguration,
    context: ConfigurationPublicationContext,
  ): Promise<ConfigurationPublicationResult> {
    validContext(context);
    validExpectedRevision(input.expectedPublishedRevision);
    const draft = this.center.getDraft(input.draftId);
    if (draft.version !== input.expectedDraftVersion) {
      throw new ConfigurationCenterError(
        "CONFIGURATION_DRAFT_VERSION_CONFLICT",
        "The configuration draft changed; reload and retry",
      );
    }
    const sourceRevisionId = configRevisionId(input.sourceRevisionId);
    return this.#withConcurrencyRetry(async (repositories) => {
      const source = await repositories.configuration.getRevision(sourceRevisionId);
      if (source === null || !["published", "superseded"].includes(source.status)) {
        throw new ConfigurationCenterError(
          "CONFIGURATION_REVISION_NOT_FOUND",
          "The rollback source revision does not exist",
        );
      }
      const target = targetFromKey(draft.key);
      if (!sameTarget(source.target, target)) {
        throw new ConfigurationCenterError(
          "CONFIGURATION_ROLLBACK_TARGET_MISMATCH",
          "The rollback source belongs to a different configuration target",
        );
      }
      const current = await repositories.configuration.getPublishedRevision(target);
      if (current?.checksum === source.checksum) {
        return { outcome: "no_change", revision: current };
      }
      assertPublishedRevision(current, input.expectedPublishedRevision);
      await this.#ensureDefinition(repositories, {
        draft,
        definition: this.center.definitionForDraft(input.draftId),
        effectiveContent: source.content,
        applyMode: "restart_required",
      });
      return this.#createPublishedRevision(
        repositories,
        target,
        source.content,
        source.checksum,
        "restart_required",
        current,
        context,
        source.revisionId,
      );
    });
  }

  async #publishSnapshot(
    repositories: PmsRepositories,
    snapshot: ConfigurationPublicationSnapshot,
    checksum: string,
    expectedPublishedRevision: number | null,
    context: ConfigurationPublicationContext,
  ): Promise<ConfigurationPublicationResult> {
    const target = targetFromKey(snapshot.draft.key);
    await this.#ensureDefinition(repositories, snapshot);
    const current = await repositories.configuration.getPublishedRevision(target);
    if (current?.checksum === checksum) return { outcome: "no_change", revision: current };
    assertPublishedRevision(current, expectedPublishedRevision);
    return this.#createPublishedRevision(
      repositories,
      target,
      snapshot.effectiveContent as JsonObject,
      checksum,
      snapshot.applyMode,
      current,
      context,
    );
  }

  async #createPublishedRevision(
    repositories: PmsRepositories,
    target: ConfigurationTarget,
    content: JsonObject,
    checksum: string,
    applyMode: ConfigRevision["applyMode"],
    current: ConfigRevision | null,
    context: ConfigurationPublicationContext,
    rollbackSourceRevisionId?: ConfigRevision["revisionId"],
  ): Promise<ConfigurationPublicationResult> {
    const latest = (await repositories.configuration.listRevisions(target, { limit: 1 })).items[0];
    const created = await repositories.configuration.createRevision(
      {
        revisionId: configRevisionId(this.#newId()),
        target,
        checksum,
        applyMode,
        content,
        createdBy: context.actorId,
        createdAt: this.#now(),
      },
      { expectedRevision: latest?.revision ?? null },
    );
    const validated = await repositories.configuration.transitionRevision(
      created.revisionId,
      "validated",
      "draft",
    );
    if (current !== null) {
      await repositories.configuration.transitionRevision(
        current.revisionId,
        "superseded",
        "published",
      );
    }
    const published = await repositories.configuration.transitionRevision(
      validated.revisionId,
      "published",
      "validated",
    );
    await repositories.audit.append(
      createAuditEvent({
        auditEventId: auditEventId(this.#newId()),
        action:
          rollbackSourceRevisionId === undefined
            ? "configuration.published"
            : "configuration.rolled_back",
        actorId: context.actorId,
        correlationId: context.correlationId,
        subjectType: "configuration_revision",
        subjectId: published.revisionId,
        occurredAt: this.#now(),
        metadata: {
          revision: published.revision,
          checksum: published.checksum,
          ...(rollbackSourceRevisionId === undefined ? {} : { rollbackSourceRevisionId }),
        },
      }),
    );
    return { outcome: "published", revision: published };
  }

  async #ensureDefinition(
    repositories: PmsRepositories,
    snapshot: ConfigurationPublicationSnapshot,
  ): Promise<void> {
    const target = targetFromKey(snapshot.draft.key);
    const existing = await repositories.configuration.getDefinition(target);
    if (existing !== null) {
      const logicalId = existing.fieldMetadata.logicalDefinitionId;
      if (logicalId !== snapshot.definition.definitionId) {
        throw new ConfigurationCenterError(
          "CONFIGURATION_TARGET_NOT_ALLOWED",
          "The target is registered to a different configuration definition",
        );
      }
      return;
    }
    const definition: PersistedConfigurationDefinition = {
      definitionId: this.#newId(),
      target,
      schema: snapshot.definition.schema as JsonObject,
      defaultContent: snapshot.definition.defaults as JsonObject,
      secretPaths: snapshot.definition.secretPaths,
      fieldMetadata: {
        logicalDefinitionId: snapshot.definition.definitionId,
        definitionVersion: snapshot.definition.definitionVersion,
        inheritance: snapshot.definition.inheritance,
        fields: snapshot.definition.fields as unknown as readonly JsonObject[],
      },
      status: "active",
    };
    await repositories.configuration.saveDefinition(definition, { mode: "insert" });
  }

  async #withConcurrencyRetry(
    work: (repositories: PmsRepositories) => Promise<ConfigurationPublicationResult>,
  ): Promise<ConfigurationPublicationResult> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.unitOfWork.transaction(work);
      } catch (error) {
        if (
          attempt === 0 &&
          error instanceof PmsRepositoryError &&
          (error.code === "ENTITY_ALREADY_EXISTS" ||
            error.code === "OPTIMISTIC_CONCURRENCY_CONFLICT")
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new ConfigurationCenterError(
      "CONFIGURATION_PUBLISH_CONFLICT",
      "The configuration publication conflicted with another writer",
    );
  }
}

function targetFromKey(key: ConfigurationBusinessKey): ConfigurationTarget {
  return {
    environment: environmentId(key.environment),
    targetType: key.targetType,
    targetId: key.targetId,
    configGroup: key.configGroup,
    dataId: key.dataId,
  };
}

function assertPublishedRevision(current: ConfigRevision | null, expected: number | null): void {
  if ((current?.revision ?? null) !== expected) {
    throw new ConfigurationCenterError(
      "CONFIGURATION_PUBLISH_CONFLICT",
      "The published configuration changed; reload and retry",
    );
  }
}

function sameTarget(left: ConfigurationTarget, right: ConfigurationTarget): boolean {
  return (
    left.environment === right.environment &&
    left.targetType === right.targetType &&
    left.targetId === right.targetId &&
    left.configGroup === right.configGroup &&
    left.dataId === right.dataId
  );
}

function validExpectedRevision(value: number | null): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 1)) {
    throw new ConfigurationCenterError(
      "CONFIGURATION_INPUT_INVALID",
      "The expected published revision is invalid",
    );
  }
}

function validContext(context: ConfigurationPublicationContext): void {
  if (context.actorId.trim().length === 0 || context.correlationId.trim().length === 0) {
    throw new ConfigurationCenterError(
      "CONFIGURATION_INPUT_INVALID",
      "Publication actor and correlation context are required",
    );
  }
}
