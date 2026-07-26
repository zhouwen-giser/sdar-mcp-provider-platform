import type {
  BusinessEventRepository,
  BusinessEventSourceDefinition,
  RotationResult,
} from "../../../../packages/persistence-postgres/src/index.js";

export interface BusinessEventRotationRequest {
  providerId: string;
  reasonCode: string;
  requestId: string;
  affectedSourceIds?: string[];
  replacementRoster?: BusinessEventSourceDefinition[];
}

export class BusinessEventRotationService {
  constructor(
    readonly repository: BusinessEventRepository,
    readonly generationRetentionMs = 604_800_000,
  ) {}

  rotate(request: BusinessEventRotationRequest): Promise<RotationResult> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(request.providerId)) {
      throw new Error("INVALID_PROVIDER_ID");
    }
    if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(request.reasonCode)) {
      throw new Error("INVALID_ROTATION_REASON");
    }
    if (request.requestId.length < 1 || request.requestId.length > 256) {
      throw new Error("INVALID_ROTATION_REQUEST_ID");
    }
    return this.repository.rotateStream(
      request.providerId,
      request.reasonCode,
      request.affectedSourceIds ?? [],
      `operator:${request.requestId}`,
      this.generationRetentionMs,
      request.replacementRoster,
    );
  }
}
