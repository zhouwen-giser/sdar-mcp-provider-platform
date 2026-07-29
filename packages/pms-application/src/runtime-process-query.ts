import {
  evaluateRuntimeObservedHealth,
  type RuntimeObservedHealth,
  type RuntimeObservedHealthEvaluation,
  type RuntimeProcessProjection,
  type RuntimeProcessState,
} from "../../runtime-deployment/src/index.js";

export type RuntimeProcessQueryErrorCode = "RUNTIME_PROCESS_NOT_FOUND";

export class RuntimeProcessQueryError extends Error {
  constructor(
    readonly code: RuntimeProcessQueryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeProcessQueryError";
  }
}

export interface RuntimeProcessQueryRepository {
  get(providerId: string, instanceId: string): Promise<RuntimeProcessProjection | null>;
  listByDeployment(
    providerId: string,
    deploymentId: string,
  ): Promise<readonly RuntimeProcessProjection[]>;
}

export type RuntimeRegistrationFreshness =
  "unregistered" | "registered" | "stale" | "identity_mismatch";

/**
 * Registration expiry is durable state owned by runtime_registration. Keeping it
 * separate from RuntimeProcess avoids a background state mutation just for stale.
 */
export interface RuntimeRegistrationFreshnessRepository {
  get(
    providerId: string,
    deploymentId: string,
    instanceId: string,
  ): Promise<{ readonly expiresAt: Date } | null>;
}

export interface RuntimeProcessListFilter {
  readonly providerId: string;
  readonly deploymentId: string;
  readonly processState?: RuntimeProcessState;
  readonly observedHealth?: RuntimeObservedHealth;
  readonly limit: number;
  readonly cursor?: string;
}

export interface RuntimeProcessLogReference {
  readonly referenceId: string;
  readonly tailEndpoint: string;
  readonly contentIncluded: false;
}

export interface RuntimeProcessView extends Omit<RuntimeProcessProjection, "lastHeartbeatAt"> {
  readonly lastHeartbeatAt: string | null;
  readonly observedHealth: RuntimeObservedHealth;
  readonly readyForActive: boolean;
  readonly healthReasonCode: RuntimeObservedHealthEvaluation["reasonCode"];
  readonly stale: boolean;
  readonly registrationFreshness: RuntimeRegistrationFreshness;
  readonly logReference: RuntimeProcessLogReference;
}

export interface RuntimeProcessListResult {
  readonly items: readonly RuntimeProcessView[];
  readonly nextCursor?: string;
}

export interface RuntimeProcessQueryOptions {
  readonly now?: () => Date;
  readonly heartbeatStaleAfterMs?: number;
  readonly registrations?: RuntimeRegistrationFreshnessRepository;
}

export class RuntimeProcessQueryService {
  readonly #now: () => Date;
  readonly #heartbeatStaleAfterMs: number;
  readonly #registrations: RuntimeRegistrationFreshnessRepository | undefined;

  constructor(
    private readonly repository: RuntimeProcessQueryRepository,
    options: RuntimeProcessQueryOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#heartbeatStaleAfterMs = options.heartbeatStaleAfterMs ?? 30_000;
    this.#registrations = options.registrations;
    if (!Number.isSafeInteger(this.#heartbeatStaleAfterMs) || this.#heartbeatStaleAfterMs < 1) {
      throw new TypeError("heartbeatStaleAfterMs must be a positive integer");
    }
  }

  async get(providerId: string, instanceId: string): Promise<RuntimeProcessView> {
    const projection = await this.repository.get(providerId, instanceId);
    if (projection === null) {
      throw new RuntimeProcessQueryError(
        "RUNTIME_PROCESS_NOT_FOUND",
        "RuntimeProcess does not exist in Provider scope",
      );
    }
    return this.#view(projection, this.#now(), providerId);
  }

  async list(filter: RuntimeProcessListFilter): Promise<RuntimeProcessListResult> {
    assertPage(filter.limit, filter.cursor);
    const now = this.#now();
    const offset = filter.cursor === undefined ? 0 : Number(filter.cursor);
    const views = (
      await Promise.all(
        (await this.repository.listByDeployment(filter.providerId, filter.deploymentId)).map(
          (process) => this.#view(process, now, filter.providerId),
        ),
      )
    ).filter(
      (process) =>
        (filter.processState === undefined || process.processState === filter.processState) &&
        (filter.observedHealth === undefined || process.observedHealth === filter.observedHealth),
    );
    const items = views.slice(offset, offset + filter.limit);
    const nextOffset = offset + items.length;
    return Object.freeze({
      items: Object.freeze(items),
      ...(nextOffset < views.length ? { nextCursor: String(nextOffset) } : {}),
    });
  }

  async #view(
    projection: RuntimeProcessProjection,
    now: Date,
    providerId: string,
  ): Promise<RuntimeProcessView> {
    const evaluation = evaluateRuntimeObservedHealth(projection, {
      now,
      heartbeatStaleAfterMs: this.#heartbeatStaleAfterMs,
    });
    const instanceId = String(projection.instanceId);
    return Object.freeze({
      ...projection,
      lastHeartbeatAt: projection.lastHeartbeatAt?.toISOString() ?? null,
      observedHealth: evaluation.health,
      readyForActive: evaluation.readyForActive,
      healthReasonCode: evaluation.reasonCode,
      stale: evaluation.health === "STALE",
      registrationFreshness: await this.#registrationFreshness(projection, now, providerId),
      logReference: Object.freeze({
        referenceId: `runtime-process:${instanceId}`,
        tailEndpoint: `/api/v1/runtime-processes/${encodeURIComponent(instanceId)}/logs/tail`,
        contentIncluded: false,
      }),
    });
  }

  async #registrationFreshness(
    projection: RuntimeProcessProjection,
    now: Date,
    providerId: string,
  ): Promise<RuntimeRegistrationFreshness> {
    if (projection.registrationState === "unregistered") return "unregistered";
    if (projection.registrationState === "identity_mismatch") return "identity_mismatch";
    if (this.#registrations === undefined) return "registered";
    const registration = await this.#registrations.get(
      providerId,
      String(projection.deploymentId),
      String(projection.instanceId),
    );
    if (registration === null) return "unregistered";
    return now.getTime() >= registration.expiresAt.getTime() ? "stale" : "registered";
  }
}

function assertPage(limit: number, cursor: string | undefined): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new TypeError("limit must be an integer between 1 and 500");
  }
  if (cursor !== undefined && !/^(0|[1-9][0-9]*)$/.test(cursor)) {
    throw new TypeError("cursor must be a non-negative integer");
  }
}
