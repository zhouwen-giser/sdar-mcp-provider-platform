import type {
  ConfigurationApplyMode,
  ConfigurationTargetType,
} from "@sdar/runtime-configuration-contract";

export interface ConfigurationBusinessKey {
  readonly environment: string;
  readonly targetType: ConfigurationTargetType;
  readonly targetId: string;
  readonly configGroup: string;
  readonly dataId: string;
}

export interface SecretRef {
  readonly secretRef: string;
}

export type ConfigurationValue =
  | null
  | boolean
  | number
  | string
  | SecretRef
  | readonly ConfigurationValue[]
  | ConfigurationContent;

export interface ConfigurationContent {
  readonly [key: string]: ConfigurationValue;
}

export type ConfigurationDraftStatus = "draft" | "validated" | "invalid";

export interface ConfigurationDraft {
  readonly draftId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly key: ConfigurationBusinessKey;
  readonly ancestorTargetIds: Readonly<Partial<Record<ConfigurationTargetType, string>>>;
  readonly content: ConfigurationContent;
  readonly version: number;
  readonly status: ConfigurationDraftStatus;
  readonly applyMode?: ConfigurationApplyMode;
  readonly validationIssues: readonly ConfigurationValidationIssue[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ConfigurationValidationIssue {
  readonly code:
    | "IMMUTABLE_OVERRIDE"
    | "OVERRIDE_NOT_ALLOWED"
    | "PLAINTEXT_SECRET_REJECTED"
    | "SCHEMA_VALIDATION_FAILED";
  readonly path: string;
  readonly message: string;
}

export interface EffectiveConfigurationPreview {
  readonly draftId: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly content: ConfigurationContent;
  readonly sources: Readonly<Record<string, "system_default" | ConfigurationTargetType>>;
  readonly applyMode: ConfigurationApplyMode;
  readonly valid: boolean;
  readonly issues: readonly ConfigurationValidationIssue[];
}

export interface CreateConfigurationDraft {
  readonly draftId: string;
  readonly definitionId: string;
  readonly key: ConfigurationBusinessKey;
  readonly ancestorTargetIds?: Readonly<Partial<Record<ConfigurationTargetType, string>>>;
  readonly content: ConfigurationContent;
  readonly now?: Date;
}

export interface UpdateConfigurationDraft {
  readonly expectedVersion: number;
  readonly content: ConfigurationContent;
  readonly ancestorTargetIds?: Readonly<Partial<Record<ConfigurationTargetType, string>>>;
  readonly now?: Date;
}
