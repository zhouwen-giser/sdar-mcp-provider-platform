export interface RuntimeConfigTarget {
  readonly environment: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly configGroup: string;
  readonly dataId: string;
}

export interface RuntimeConfigIdentity {
  readonly environment: string;
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly providerId: string;
}

export interface RuntimeConfigDocument {
  readonly revisionId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly applyMode: "hot_reload" | "reconnect_required" | "restart_required" | "immutable";
  readonly sourceTargetType: "runtime_deployment" | "runtime_instance";
  readonly identity: RuntimeConfigIdentity;
  readonly content: Readonly<Record<string, unknown>>;
}

export interface RuntimeConfigHttpRequest {
  readonly target: RuntimeConfigTarget;
  readonly ifNoneMatch?: string;
  readonly signal: AbortSignal;
}

export type RuntimeConfigHttpResponse =
  | {
      readonly status: 200;
      readonly etag: string;
      readonly body: unknown;
    }
  | {
      readonly status: 304;
      readonly etag: string;
    };

export interface RuntimeConfigHttpPort {
  latest(request: RuntimeConfigHttpRequest): Promise<RuntimeConfigHttpResponse>;
}

export interface RuntimeConfigContentValidator {
  validate(content: Readonly<Record<string, unknown>>): {
    readonly valid: boolean;
    readonly issues?: readonly string[];
  };
}

export interface RuntimeConfigCacheArtifact {
  readonly formatVersion: 1;
  readonly etag: string;
  readonly document: RuntimeConfigDocument;
  readonly artifactChecksum: string;
}

export interface RuntimeConfigCacheStore {
  read(): Promise<unknown>;
  write(artifact: RuntimeConfigCacheArtifact): Promise<void>;
}

export interface RuntimeConfigPullResult {
  readonly source: "remote" | "lkg";
  readonly changed: boolean;
  readonly etag: string;
  readonly document: RuntimeConfigDocument;
  readonly fallbackReason?: RuntimeConfigClientErrorCode;
}

export interface RuntimeConfigWatchHint {
  readonly revisionId: string;
  readonly revision: number;
  readonly checksum: string;
}

export interface RuntimeConfigWatchPort {
  watch(target: RuntimeConfigTarget, signal: AbortSignal): AsyncIterable<RuntimeConfigWatchHint>;
}

export type RuntimeConfigAckStatus =
  "applied" | "rejected" | "restart_required" | "stale" | "unavailable";

export interface RuntimeConfigAcknowledgement {
  readonly revisionId: string;
  readonly status: RuntimeConfigAckStatus;
  readonly appliedChecksum?: string;
  readonly reasonCode?: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface RuntimeConfigAcknowledgementPort {
  acknowledge(
    target: RuntimeConfigTarget,
    acknowledgement: RuntimeConfigAcknowledgement,
  ): Promise<void>;
}

export interface RuntimeConfigApplyHandler {
  apply(document: RuntimeConfigDocument, mode: "hot_reload" | "reconnect_required"): Promise<void>;
}

export interface RuntimeConfigAckOutboxRecord {
  readonly target: RuntimeConfigTarget;
  readonly acknowledgement: RuntimeConfigAcknowledgement;
}

export interface RuntimeConfigAckOutbox {
  list(): Promise<readonly RuntimeConfigAckOutboxRecord[]>;
  put(record: RuntimeConfigAckOutboxRecord): Promise<void>;
  remove(revisionId: string): Promise<void>;
}

export type RuntimeConfigClientErrorCode =
  | "RUNTIME_CONFIG_PULL_TIMEOUT"
  | "RUNTIME_CONFIG_PULL_UNAVAILABLE"
  | "RUNTIME_CONFIG_RESPONSE_INVALID"
  | "RUNTIME_CONFIG_CACHE_INVALID"
  | "RUNTIME_CONFIG_CACHE_WRITE_FAILED";
