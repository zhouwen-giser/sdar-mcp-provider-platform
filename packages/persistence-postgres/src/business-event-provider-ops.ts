import type { PoolClient } from "pg";
import {
  createBusinessEventProviderOpsEnvelope,
  type BusinessEventProviderOpsContext,
  type BusinessEventProviderOpsRecordType,
} from "../../observability/src/index.js";
import type { CanonicalJsonValue } from "../../observability/src/hash.js";
import { captureProviderOpsDelivery } from "./provider-ops-delivery.js";

export interface CaptureBusinessEventAuditInput {
  client: PoolClient;
  providerId: string;
  recordType: BusinessEventProviderOpsRecordType;
  aggregateId: string;
  stableAggregateIdentity: string;
  eventIdentity: string;
  revision?: string | number;
  occurredAt: Date | string;
  payload: Record<string, CanonicalJsonValue>;
}

export interface BusinessEventProviderOpsRecorderLike {
  capture(input: CaptureBusinessEventAuditInput): Promise<boolean>;
}

export class BusinessEventProviderOpsRecorder implements BusinessEventProviderOpsRecorderLike {
  constructor(readonly context: BusinessEventProviderOpsContext) {}

  async capture(input: CaptureBusinessEventAuditInput): Promise<boolean> {
    const envelope = createBusinessEventProviderOpsEnvelope(this.context, input);
    return captureProviderOpsDelivery(input.client, {
      envelope,
      eventKey: `business-event:${envelope.recordId}`,
      aggregateType: "provider",
      aggregateId: input.aggregateId,
    });
  }
}
