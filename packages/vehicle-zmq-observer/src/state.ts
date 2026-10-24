import { z } from "zod";
import { ZMQ_OPERATIONS } from "../../vehicle-zmq-contract/src/index.js";
import {
  COMPONENTS,
  type Component,
  type ObserverIdentity,
  type ObserverSettings,
} from "./config.js";
import { NormalizedObservation, type ObservationEvent, type Reception } from "./model.js";

const channel = z
  .object({
    state: z.enum(["connecting", "connected", "disconnected", "closed"]),
    lastReceptionAt: z.iso.datetime().nullable(),
    lastValidCommittedAt: z.iso.datetime().nullable(),
    receiptFresh: z.boolean(),
    sourceFreshness: z.literal("unverified"),
    diagnostics: z.array(z.string()),
  })
  .strict();
const latest = z
  .object({
    component: z.enum(COMPONENTS),
    receivedAt: z.iso.datetime(),
    ageMs: z.number().nonnegative(),
    receiptFresh: z.boolean(),
    sourceFreshness: z.literal("unverified"),
    receptionId: z.uuid(),
    diagnostics: z.array(z.string()),
    observation: NormalizedObservation,
  })
  .strict();
export const VehicleObservationStateV2 = z
  .object({
    schemaVersion: z.literal("ugv.vehicle-observation-state/2.0"),
    generatedAt: z.iso.datetime(),
    partitionHash: z.string().regex(/^[a-f0-9]{64}$/),
    sessionId: z.uuid().nullable(),
    runtimeAdmission: z.literal("not_published"),
    readOnly: z.literal(true),
    deploymentBinding: z.literal("unqualified_diagnostic"),
    sourceProducerEpoch: z.null(),
    channels: z.object({ chassis: channel, eo: channel, simulationEffect: channel }).strict(),
    observations: z.array(latest),
    diagnostics: z.array(z.string()),
    archive: z
      .object({
        status: z.enum(["starting", "running", "stopping", "stopped", "failed"]),
        pendingRecords: z.number().int().nonnegative(),
        pendingBytes: z.number().int().nonnegative(),
        committedEvents: z.number().int().nonnegative(),
        receivedMessages: z.number().int().nonnegative(),
        committedReceptions: z.number().int().nonnegative(),
        unconfirmedReceptions: z.number().int().nonnegative(),
        locallyDiscardedMessages: z.number().int().nonnegative(),
        failureCode: z.string().nullable(),
        failureRecorded: z.boolean().nullable(),
      })
      .strict(),
    continuity: z.literal("upstream_loss_and_producer_epoch_unverified"),
    completeEvidence: z.literal(false),
  })
  .strict();
export const VehicleObservationCapabilitiesV2 = z
  .object({
    schemaVersion: z.literal("ugv.vehicle-observation-capabilities/2.0"),
    source: z.literal("zmq_contract"),
    readOnly: z.literal(true),
    runtimeAdmission: z.literal("not_published"),
    controlAvailable: z.literal(false),
    deploymentBinding: z.literal("unqualified_diagnostic"),
    observationEndpoints: z
      .array(z.object({ component: z.enum(COMPONENTS), endpoint: z.url() }).strict())
      .length(3),
    intendedOperations: z.array(
      z
        .object({
          operation: z.enum(ZMQ_OPERATIONS),
          qualified: z.literal(false),
          reason: z.literal("CONTROL_AND_SOURCE_QUALIFICATION_PENDING"),
        })
        .strict(),
    ),
  })
  .strict();

export interface ArchiveHealth {
  status: "starting" | "running" | "stopping" | "stopped" | "failed";
  pendingRecords: number;
  pendingBytes: number;
  committedEvents: number;
  receivedMessages: number;
  committedReceptions: number;
  unconfirmedReceptions: number;
  locallyDiscardedMessages: number;
  failureCode: string | null;
  failureRecorded: boolean | null;
}

export class ObservationState {
  #latest = new Map<string, Reception>();
  #channels = new Map<
    Component,
    {
      state: "connecting" | "connected" | "disconnected" | "closed";
      barrier: bigint;
      lastReceptionAt: string | null;
      lastValid: Reception | null;
      diagnostics: string[];
    }
  >();
  constructor(
    readonly scope: ObserverIdentity,
    readonly settings: ObserverSettings,
  ) {
    for (const component of COMPONENTS)
      this.#channels.set(component, {
        state: "connecting",
        barrier: 0n,
        lastReceptionAt: null,
        lastValid: null,
        diagnostics: ["NOT_OBSERVED"],
      });
  }
  apply(event: ObservationEvent): void {
    const c = event.component ? this.#channels.get(event.component) : undefined;
    if (!c) return;
    if (event.type === "transport") {
      c.state = event.state;
      if (event.state !== "connected") c.barrier = BigInt(event.monotonicNs);
    } else if (event.type === "gap") {
      c.barrier = BigInt(event.monotonicNs);
      c.diagnostics = [event.code];
    } else {
      c.lastReceptionAt = event.receivedAt;
      c.diagnostics = event.valid
        ? event.diagnostics
        : [event.validationCode ?? "INVALID_PUBLICATION"];
      if (event.projectable && event.observation) {
        c.lastValid = event;
        this.#latest.set(`${event.component}/${event.observation.key}`, event);
      }
    }
  }
  snapshot(sessionId: string | null, archive: ArchiveHealth, nowNs = process.hrtime.bigint()) {
    const age = (r: Reception) => Math.max(0, Number(nowNs - BigInt(r.monotonicNs)) / 1e6);
    const fresh = (r: Reception, limit: number) => {
      const c = this.#channels.get(r.component);
      return (
        archive.status === "running" &&
        c?.state === "connected" &&
        BigInt(r.monotonicNs) > c.barrier &&
        nowNs >= BigInt(r.monotonicNs) &&
        age(r) <= limit
      );
    };
    const channels = Object.fromEntries(
      COMPONENTS.map((component) => {
        const c = this.#channels.get(component);
        if (!c) throw Error("ZMQ_COMPONENT_STATE_MISSING");
        return [
          component,
          {
            state: c.state,
            lastReceptionAt: c.lastReceptionAt,
            lastValidCommittedAt: c.lastValid?.receivedAt ?? null,
            receiptFresh: !!c.lastValid && fresh(c.lastValid, this.settings.stateFreshForMs),
            sourceFreshness: "unverified" as const,
            diagnostics: c.diagnostics,
          },
        ];
      }),
    );
    const position = this.#latest.get("chassis/localization"),
      targets = this.#latest.get("eo/targetlist");
    const diagnostics = ["READ_ONLY_UNQUALIFIED_OBSERVER", "SOURCE_CONTINUITY_UNVERIFIED"];
    if (!position) diagnostics.push("POSITION_NOT_OBSERVED");
    else if (!fresh(position, this.settings.positionFreshForMs))
      diagnostics.push("POSITION_RECEPTION_STALE");
    if (!targets) diagnostics.push("TARGET_REPORT_NOT_OBSERVED");
    else if (!fresh(targets, this.settings.stateFreshForMs))
      diagnostics.push("TARGET_REPORT_RECEPTION_STALE");
    return VehicleObservationStateV2.parse({
      schemaVersion: "ugv.vehicle-observation-state/2.0",
      generatedAt: new Date().toISOString(),
      partitionHash: this.scope.partitionHash,
      sessionId,
      runtimeAdmission: "not_published",
      readOnly: true,
      deploymentBinding: "unqualified_diagnostic",
      sourceProducerEpoch: null,
      channels,
      observations: [...this.#latest.values()].map((r) => ({
        component: r.component,
        receivedAt: r.receivedAt,
        ageMs: age(r),
        receiptFresh: fresh(
          r,
          r.observation?.key === "localization"
            ? this.settings.positionFreshForMs
            : this.settings.stateFreshForMs,
        ),
        sourceFreshness: "unverified",
        receptionId: r.eventId,
        diagnostics: r.diagnostics,
        observation: r.observation,
      })),
      diagnostics,
      archive,
      continuity: "upstream_loss_and_producer_epoch_unverified",
      completeEvidence: false,
    });
  }
  capabilities() {
    return VehicleObservationCapabilitiesV2.parse({
      schemaVersion: "ugv.vehicle-observation-capabilities/2.0",
      source: "zmq_contract",
      readOnly: true,
      runtimeAdmission: "not_published",
      controlAvailable: false,
      deploymentBinding: "unqualified_diagnostic",
      observationEndpoints: COMPONENTS.map((component) => ({
        component,
        endpoint: this.scope.identity.components[component].publicationEndpoint,
      })),
      intendedOperations: ZMQ_OPERATIONS.map((operation) => ({
        operation,
        qualified: false,
        reason: "CONTROL_AND_SOURCE_QUALIFICATION_PENDING",
      })),
    });
  }
}
