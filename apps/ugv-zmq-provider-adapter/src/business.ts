import { EventEmitter } from "node:events";
import { UgvTaskBusinessContextService } from "../../ugv-provider-adapter/src/task-business-service.js";
import { parseTaskBusinessFeedbackBody } from "../../../packages/vehicle-provider-core/src/task-business-contract.js";
import {
  protoStructToJson,
  type AdapterBusinessEvent,
} from "../../../packages/adapter-protocol/src/index.js";
import {
  isZmqExecution,
  type ZmqExecution,
} from "../../../packages/vehicle-zmq-control/src/model.js";
import { ZMQ_CONTROL_TOOLS } from "../../../packages/vehicle-zmq-control/src/catalog.js";
import type {
  PostgresProviderStore,
  ProviderExecution,
  TaskBusinessStore,
} from "../../../packages/provider-adapter-kit/src/index.js";

/** The ordinary helper finalizes terminal executions while resolving reads. A site reader
 * must retain the stored Context, including unfinished historical projections. */
export class SiteReadonlyBusinessService extends UgvTaskBusinessContextService {
  override supports(operationName: string): boolean {
    return super.supports(operationName) || ZMQ_CONTROL_TOOLS.has(operationName);
  }
  override finalizeForTerminalExecution(execution: ProviderExecution): Promise<void> {
    void execution;
    return Promise.resolve();
  }
}

export function siteReadonlyBusiness(
  store: PostgresProviderStore,
  business: TaskBusinessStore,
  providerId: string,
  resourceId: string,
) {
  return {
    service: new SiteReadonlyBusinessService(store, business, providerId, resourceId, () => {
      throw Error("ZMQ_SITE_READONLY_CONTROL_DISABLED");
    }),
  };
}

/** Separate simulated Provider event lane. The legacy physical/referee sanitizer stays intact. */
export class ZmqBusinessEvents {
  readonly events = new EventEmitter();
  constructor(readonly store: PostgresProviderStore) {}
  notify(event: AdapterBusinessEvent) {
    const source = this.store.businessEventSources().find((s) => s.sourceId === "vehicle.business");
    if (
      event.sourceStreamId !== source?.sourceStreamId ||
      event.scope !== "task" ||
      !event.externalExecutionId ||
      event.eventType !== "vehicle.business.changed"
    )
      throw Error("ZMQ_BUSINESS_EVENT_BINDING_INVALID");
    parseTaskBusinessFeedbackBody(protoStructToJson(event.rawPayload));
    this.events.emit("vehicle.business", event);
  }
  subscribe(sourceId: string, listener: (event: AdapterBusinessEvent) => void) {
    this.events.on(sourceId, listener);
    return () => {
      this.events.off(sourceId, listener);
    };
  }
}
export function zmqBusiness(
  store: PostgresProviderStore,
  business: TaskBusinessStore,
  providerId: string,
  resourceId: string,
  events: ZmqBusinessEvents,
) {
  const service = new UgvTaskBusinessContextService(
    store,
    business,
    providerId,
    resourceId,
    (e) => events.notify(e),
    {
      operations: ZMQ_CONTROL_TOOLS,
      // No footprint/trajectory is invented from requested geometry. Versioned native facts are queried separately.
      requestedArtifacts: () => [],
      terminalProperties: (e) => ({
        schemaVersion: "ugv.zmq-context-summary/1",
        executionResult: e.result ?? null,
        supplementalResultQuery:
          e.operationName === "simulation_apply_effect"
            ? "simulation_get_effect_result"
            : e.operationName === "vehicle_zmq_inspect_area"
              ? "vehicle_get_inspection_result"
              : null,
        completeSpatialEvidence: false,
      }),
    },
  );
  const persisted = async (e: ZmqExecution) => {
    if (!e.zmqAdmission) return;
    if (
      !isZmqExecution(e) ||
      e.executionContext.executionMode !== "simulation" ||
      !e.executionContext.simulationId ||
      e.providerId !== providerId ||
      e.resourceId !== resourceId
    )
      throw Error("ZMQ_BUSINESS_DOMAIN_INVALID");
    await service.ensureForCreatedExecution(e.taskId);
    await service.finalizeForTerminalExecution(e);
  };
  return { service, persisted };
}
