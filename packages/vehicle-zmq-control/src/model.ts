import { z } from "zod";
import { DeploymentProfile, EoRequest } from "../../vehicle-zmq-contract/src/index.js";
import { canonical, sha256 } from "../../vehicle-zmq-observer/src/config.js";
import type {
  ProviderExecution,
  ExecutionContextRecord,
} from "../../provider-adapter-kit/src/types.js";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
const point = z
  .object({ longitude: z.number().gte(-180).lt(180), latitude: z.number().min(-90).max(90) })
  .strict();
const navigation = { speedLimitMps: z.number().positive().max(30), obstacleAvoidance: z.boolean() };
const eoParams = (method: "AreaSearch" | "CircularSearch" | "TeleControl", value: unknown) =>
  EoRequest.parse({
    protocol: "2.2",
    kind: "request",
    device_id: "SIMULATED",
    request_id: "validate",
    method,
    params: value,
  }).params;
export const Operation = z.discriminatedUnion("name", [
  z
    .object({
      name: z.literal("navigation.point"),
      params: z.object({ destination: point, ...navigation }).strict(),
    })
    .strict(),
  z
    .object({
      name: z.literal("navigation.route"),
      params: z.object({ waypoints: z.array(point).min(1).max(2000), ...navigation }).strict(),
    })
    .strict(),
  z
    .object({
      name: z.literal("navigation.returnHome"),
      params: z
        .object({
          returnType: z.union([z.literal(0), z.literal(1)]),
          waypoints: z.array(point).max(2000),
          ...navigation,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      name: z.literal("recon.area"),
      params: z.unknown().transform((v, ctx) => {
        try {
          return eoParams("AreaSearch", v);
        } catch {
          ctx.addIssue({ code: "custom", message: "ZMQ_AREA_PARAMETERS_INVALID" });
          return z.NEVER;
        }
      }),
    })
    .strict(),
  z
    .object({
      name: z.literal("recon.circular"),
      params: z.unknown().transform((v, ctx) => {
        try {
          return eoParams("CircularSearch", v);
        } catch {
          ctx.addIssue({ code: "custom", message: "ZMQ_SCAN_PARAMETERS_INVALID" });
          return z.NEVER;
        }
      }),
    })
    .strict(),
  z
    .object({
      name: z.literal("camera.position"),
      params: z
        .object({
          yaw_rad: z.number().gte(-Math.PI).lt(Math.PI),
          pitch_rad: z
            .number()
            .min(-Math.PI / 2)
            .max(Math.PI / 2),
          move_timeout_ms: z.number().int().min(100).max(10000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      name: z.literal("camera.zoom"),
      params: z
        .object({
          zoom_ratio: z.number().positive(),
          zoom_timeout_ms: z.number().int().min(100).max(10000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      name: z.literal("camera.velocity"),
      params: z
        .object({
          yaw_rate_rad_s: z.number(),
          pitch_rate_rad_s: z.number(),
          hold_ms: z.number().int().min(100).max(1000),
        })
        .strict(),
    })
    .strict(),
]);
export type Operation = z.infer<typeof Operation>;
export const StartControl = z
  .object({
    taskId: id,
    commandId: id,
    resourceId: id,
    operation: Operation,
    executionContext: z
      .object({
        authorizationContextHash: z.string().regex(/^[a-f0-9]{64}$/),
        executionMode: z.literal("simulation"),
        simulationId: id,
        correlationId: id,
      })
      .strict(),
    timing: z
      .object({
        startAt: z.iso.datetime(),
        startToleranceMs: z.number().int().min(0).max(60000),
        maxElapsedMs: z.number().int().min(100).max(300000),
        parentDeadlineAt: z.iso.datetime().nullable(),
      })
      .strict(),
  })
  .strict();
export type StartControl = z.infer<typeof StartControl>;
export const ControlSettings = z
  .object({
    mode: z.literal("isolated_simulator"),
    contractSha256: z.string().regex(/^[a-f0-9]{64}$/),
    observerPartitionHash: z.string().regex(/^[a-f0-9]{64}$/),
    observerSessionId: z.uuid(),
    transportTimeoutMs: z.number().int().min(25).max(1000).default(250),
    databaseTimeoutMs: z.number().int().min(100).max(2000).default(500),
    stateFreshForMs: z.number().int().min(100).max(3000).default(3000),
    clockSkewMs: z.number().int().min(10).max(5000).default(1000),
    commandLimit: z.number().int().min(8).max(256).default(128),
    maxSpeedMps: z.number().positive().max(30),
    maxYawRateRadS: z.number().positive(),
    maxPitchRateRadS: z.number().positive(),
    minYawRad: z.number().gte(-Math.PI).lt(Math.PI),
    maxYawRad: z.number().gte(-Math.PI).lt(Math.PI),
    minPitchRad: z
      .number()
      .min(-Math.PI / 2)
      .max(Math.PI / 2),
    maxPitchRad: z
      .number()
      .min(-Math.PI / 2)
      .max(Math.PI / 2),
    minZoom: z.number().positive(),
    maxZoom: z.number().positive(),
    positionToleranceRad: z.number().positive().max(0.1).default(0.01),
    zoomTolerance: z.number().positive().max(1).default(0.01),
    stationarySpeedMps: z.number().min(0).max(0.1).default(0.01),
  })
  .strict()
  .refine(
    (s) => s.minZoom <= s.maxZoom && s.minYawRad <= s.maxYawRad && s.minPitchRad <= s.maxPitchRad,
  );
export type ControlSettings = z.infer<typeof ControlSettings>;
export type ControlComponent = "chassis" | "eo";
export const componentFor = (operation: Operation["name"]): ControlComponent =>
  operation.startsWith("navigation.") ? "chassis" : "eo";
export interface ControlScope {
  hash: string;
  writerKey: string;
  writerKeys: string[];
  profile: DeploymentProfile;
  settings: ControlSettings;
}
export function controlScope(profileInput: unknown, settingsInput: unknown): ControlScope {
  const profile = DeploymentProfile.parse(profileInput),
    settings = ControlSettings.parse(settingsInput);
  for (const component of Object.values(profile.components)) {
    for (const endpoint of [component.commandEndpoint, component.publicationEndpoint]) {
      // Numeric loopback only: no DNS, forwarding URL or externally routable command target.
      if (new URL(endpoint).hostname !== "127.0.0.1") throw Error("ZMQ_CONTROL_ISOLATION_REQUIRED");
    }
  }
  if (
    !profile.providerBinding.providerId ||
    !profile.providerBinding.resourceId ||
    !profile.providerBinding.sourceSessionKey ||
    !profile.executionDomain.simulationId
  )
    throw Error("ZMQ_CONTROL_BINDING_REQUIRED");
  const stableSettings = { ...settings, observerSessionId: null };
  const hash = sha256(canonical({ profile, settings: stableSettings }));
  // Endpoints, independent of requested identity, prevent two identities controlling one simulator.
  const writerKey = sha256(
    canonical(
      Object.values(profile.components)
        .map((c) => c.commandEndpoint)
        .sort(),
    ),
  );
  const writerKeys = Object.values(profile.components)
    .map((c) => sha256(c.commandEndpoint))
    .sort();
  return { hash, writerKey, writerKeys, profile, settings };
}
export type Stage =
  | "scheduled"
  | "mode_send"
  | "mode_wait"
  | "configure"
  | "planning_wait"
  | "ready_wait"
  | "start_send"
  | "active_wait"
  | "running"
  | "pause_wait"
  | "paused"
  | "resume_wait"
  | "stopping"
  | "uncertain"
  | "terminal";
export interface WireCommand {
  stepId: string;
  generation: number;
  component: ControlComponent;
  action:
    "mode" | "speed" | "obstacle" | "configure" | "start" | "pause" | "resume" | "stop" | "camera";
  requestId: string | null;
  method: string;
  frames: string[];
  status:
    | "intent"
    | "dispatching"
    | "accepted"
    | "sent_unconfirmed"
    | "rejected"
    | "uncertain"
    | "superseded";
  createdAt: string;
  dispatchAt: string | null;
  completedAt: string | null;
  response: Record<string, unknown> | null;
}
export interface SourceRef {
  partitionHash: string;
  sessionId: string;
  ordinal: string;
  entryHash: string;
}
export interface ZmqControlState {
  version: 1;
  scopeHash: string;
  writerKeys: string[];
  commandId: string;
  requestHash: string;
  component: ControlComponent;
  stage: Stage;
  generation: number;
  occupancy: "held" | "released";
  timing: StartControl["timing"];
  startedAt: string | null;
  deadlineAt: string | null;
  nativeTaskId: string | null;
  modeAttempt: number;
  modeSentAt: string | null;
  baseline: number;
  modeBaseline: number;
  taskBaseline: number;
  stopBaseline: number;
  lastCommand: string | null;
  commands: WireCommand[];
  /** Armed before movement; recovery conservatively assumes this stop may have been used. */
  fallbackStop: WireCommand | null;
  controls: { commandId: string; action: "pause" | "resume" | "cancel"; hash: string }[];
  stopRequestedAt: string | null;
  stopSentAt: string | null;
  stopDeadlineAt: string | null;
  stopReason: string | null;
  stopConfirmed: boolean;
  nativeOutcome: string | null;
  nativeReason: string | null;
  latestEvidence: SourceRef[];
  missingEvidence: string[];
}
export interface ZmqExecution extends ProviderExecution {
  zmqControl: ZmqControlState;
}
export const isZmqExecution = (e: ProviderExecution | undefined): e is ZmqExecution =>
  !!e && "zmqControl" in e;
export const terminal = (e: ZmqExecution) => e.zmqControl.stage === "terminal";
export function assertIdentity(execution: ZmqExecution, context: ExecutionContextRecord) {
  const a = execution.executionContext;
  if (
    a.authorizationContextHash !== context.authorizationContextHash ||
    a.executionMode !== context.executionMode ||
    a.simulationId !== context.simulationId
  )
    throw Error("ZMQ_EXECUTION_IDENTITY_MISMATCH");
}
