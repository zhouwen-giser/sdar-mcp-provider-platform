import { randomUUID } from "node:crypto";
import {
  configRevisionId,
  PmsRepositoryError,
  type ConfigAck,
  type ConfigRevision,
  type JsonObject,
  type PmsRepositories,
  type PmsUnitOfWork,
} from "@sdar/pms-domain";
import { canonicalJson } from "@sdar/runtime-configuration-contract";
import { ConfigurationCenterError } from "./errors.js";
import type { RuntimeConfigClientIdentity, RuntimeConfigClientRequest } from "./runtime-query.js";

export interface RuntimeConfigAcknowledgementInput {
  readonly revisionId: string;
  readonly status: ConfigAck["status"];
  readonly appliedChecksum?: string;
  readonly reasonCode?: string;
  readonly details?: JsonObject;
}

export interface RuntimeConfigAcknowledgementOptions {
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export class RuntimeConfigAcknowledgementService {
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(
    private readonly unitOfWork: PmsUnitOfWork,
    options: RuntimeConfigAcknowledgementOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#newId = options.newId ?? randomUUID;
  }

  async acknowledge(
    request: RuntimeConfigClientRequest,
    identity: RuntimeConfigClientIdentity,
    input: RuntimeConfigAcknowledgementInput,
  ): Promise<ConfigAck> {
    assertIdentity(request, identity);
    assertSafeDetails(input.details ?? {});
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.unitOfWork.transaction(async (repositories) => {
          const revision = await repositories.configuration.getRevision(
            configRevisionId(input.revisionId),
          );
          assertRevision(revision, request);
          validateAck(input, revision);
          const existing = await findInstanceAck(
            repositories,
            revision.revisionId,
            identity.instanceId,
          );
          if (existing !== null) return identicalAck(existing, input);
          const ack: ConfigAck = {
            ackId: this.#newId(),
            revisionId: revision.revisionId,
            runtimeInstanceId: identity.instanceId,
            status: input.status,
            ...(input.appliedChecksum === undefined
              ? {}
              : { appliedChecksum: input.appliedChecksum }),
            ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
            details: input.details ?? {},
            acknowledgedAt: this.#now(),
          };
          await repositories.configuration.appendAck(ack);
          return ack;
        });
      } catch (error) {
        if (
          attempt === 0 &&
          error instanceof PmsRepositoryError &&
          error.code === "ENTITY_ALREADY_EXISTS"
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new ConfigurationCenterError(
      "RUNTIME_CONFIG_ACK_CONFLICT",
      "The Runtime acknowledgement conflicts with an existing acknowledgement",
    );
  }
}

async function findInstanceAck(
  repositories: PmsRepositories,
  revisionId: ConfigRevision["revisionId"],
  instanceId: string,
): Promise<ConfigAck | null> {
  let cursor: string | undefined;
  do {
    const page = await repositories.configuration.listAcks(revisionId, {
      limit: 500,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const found = page.items.find(({ runtimeInstanceId }) => runtimeInstanceId === instanceId);
    if (found !== undefined) return found;
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return null;
}

function assertRevision(
  revision: ConfigRevision | null,
  request: RuntimeConfigClientRequest,
): asserts revision is ConfigRevision {
  if (revision === null || !["published", "superseded"].includes(revision.status)) {
    throw new ConfigurationCenterError(
      "RUNTIME_CONFIG_ACK_REVISION_NOT_FOUND",
      "The acknowledged Runtime configuration revision does not exist",
    );
  }
  const targetMatches =
    revision.target.environment === request.environment &&
    revision.target.configGroup === request.configGroup &&
    revision.target.dataId === request.dataId &&
    ((revision.target.targetType === "runtime_instance" &&
      revision.target.targetId === request.instanceId) ||
      (revision.target.targetType === "runtime_deployment" &&
        revision.target.targetId === request.deploymentId));
  if (!targetMatches) {
    throw new ConfigurationCenterError(
      "RUNTIME_CONFIG_IDENTITY_MISMATCH",
      "The Runtime Config client cannot acknowledge this revision",
    );
  }
}

function validateAck(input: RuntimeConfigAcknowledgementInput, revision: ConfigRevision): void {
  if (input.status === "applied" && input.appliedChecksum !== revision.checksum) invalidAck();
  if (input.appliedChecksum !== undefined && !/^[0-9a-f]{64}$/.test(input.appliedChecksum)) {
    invalidAck();
  }
  if (
    ["rejected", "unavailable"].includes(input.status) &&
    (input.reasonCode === undefined || !/^[A-Z][A-Z0-9_]{0,127}$/.test(input.reasonCode))
  ) {
    invalidAck();
  }
  if (input.reasonCode !== undefined && !/^[A-Z][A-Z0-9_]{0,127}$/.test(input.reasonCode)) {
    invalidAck();
  }
}

function identicalAck(existing: ConfigAck, input: RuntimeConfigAcknowledgementInput): ConfigAck {
  if (
    existing.status !== input.status ||
    existing.appliedChecksum !== input.appliedChecksum ||
    existing.reasonCode !== input.reasonCode ||
    canonicalJson(existing.details) !== canonicalJson(input.details ?? {})
  ) {
    throw new ConfigurationCenterError(
      "RUNTIME_CONFIG_ACK_CONFLICT",
      "The Runtime instance already acknowledged this revision differently",
    );
  }
  return existing;
}

function assertIdentity(
  request: RuntimeConfigClientRequest,
  identity: RuntimeConfigClientIdentity,
): void {
  if (
    request.environment !== identity.environment ||
    request.deploymentId !== identity.deploymentId ||
    request.instanceId !== identity.instanceId
  ) {
    throw new ConfigurationCenterError(
      "RUNTIME_CONFIG_IDENTITY_MISMATCH",
      "The Runtime Config client is not authorized for this acknowledgement",
    );
  }
}

function assertSafeDetails(value: JsonObject): void {
  const serialized = canonicalJson(value);
  if (
    serialized.length > 16_384 ||
    /"(?:password|passwd|secret|token|authorization|cookie|headers?)"\s*:/i.test(serialized)
  ) {
    throw new ConfigurationCenterError(
      "RUNTIME_CONFIG_ACK_INVALID",
      "Runtime acknowledgement details are invalid",
    );
  }
}

function invalidAck(): never {
  throw new ConfigurationCenterError(
    "RUNTIME_CONFIG_ACK_INVALID",
    "Runtime acknowledgement is invalid",
  );
}
