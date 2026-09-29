import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import {
  TASK_BUSINESS_ARTIFACT_SCHEMA_VERSION,
  TaskArtifactSchema,
} from "../../packages/vehicle-provider-core/src/task-business-artifact.ts";
import {
  RuntimeBusinessCursorSchema,
  TASK_BUSINESS_CONTEXT_SCHEMA_VERSION,
  TASK_BUSINESS_FEEDBACK_SCHEMA_VERSION,
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
  parseTaskBusinessFeedbackBody,
} from "../../packages/vehicle-provider-core/src/task-business-contract.ts";
import {
  BusinessActionSchema,
  RequiredInputResponseCommandSchema,
  RequiredInputSchema,
  RuntimeInterventionCommandSchema,
  RuntimeInterventionSchema,
  TASK_BUSINESS_ACTION_SCHEMA_VERSION,
  TASK_BUSINESS_INPUT_COMMAND_SCHEMA_VERSION,
  TASK_BUSINESS_INPUT_SCHEMA_VERSION,
  TASK_BUSINESS_INTERVENTION_COMMAND_SCHEMA_VERSION,
  TASK_BUSINESS_INTERVENTION_SCHEMA_VERSION,
} from "../../packages/vehicle-provider-core/src/task-business-interaction.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const exampleOutputDir = process.env.TASK_BUSINESS_FIXTURE_OUTPUT_DIR
  ? resolve(process.env.TASK_BUSINESS_FIXTURE_OUTPUT_DIR)
  : resolve(root, "protocol/task-business/v1/examples");
const at = "2026-09-23T00:00:00Z";
const later = "2026-09-23T00:01:00Z";
const identity = {
  taskId: "task-catalog-1",
  executionId: "execution-catalog-1",
  providerId: "provider-catalog-1",
  resourceId: "vehicle:ugv1",
  operationName: "vehicle_area_recon",
};
const refs = {
  route: { kind: "artifact", id: "route-line", revision: 1 },
  lock: { kind: "action", id: "lock-1", revision: 1 },
  input: { kind: "input_request", id: "input-1", revision: 1 },
  intervention: { kind: "intervention", id: "intervention-1", revision: 1 },
};
const context = {
  schemaVersion: TASK_BUSINESS_CONTEXT_SCHEMA_VERSION,
  identity,
  contextRevision: 4,
  effectivePlanRevision: 2,
  phase: { code: "recon.scanning", since: at },
  summary: { status: "in_progress", resultCode: "SCAN_ACTIVE" },
  activeRefs: refs,
  artifactRefs: [refs.route],
  actionRefs: [refs.lock],
  requiredInputRefs: [refs.input],
  interventionRefs: [refs.intervention],
  updatedAt: later,
};
const feedbackCommon = {
  schemaVersion: TASK_BUSINESS_FEEDBACK_SCHEMA_VERSION,
  contextRevision: 4,
  providerRecordedAt: later,
};
const feedback = [
  {
    ...feedbackCommon,
    kind: "BUSINESS_EVENT",
    payload: {
      eventType: "recon.route_adopted",
      severity: "info",
      reasonCode: "ROUTE_ADOPTED",
      description: "Route adopted in catalog fixture",
      subjects: [refs.route],
      contextDelta: { phase: context.phase, activeRefs: refs, effectivePlanRevision: 2 },
    },
  },
  {
    ...feedbackCommon,
    kind: "ARTIFACT_CHANGED",
    payload: { change: "create", artifactRef: refs.route, reasonCode: "ROUTE_AVAILABLE" },
  },
  {
    ...feedbackCommon,
    kind: "ACTION_CHANGED",
    payload: { change: "create", actionRef: refs.lock, reasonCode: "LOCK_REQUESTED" },
  },
  {
    ...feedbackCommon,
    kind: "REQUIRED_INPUT_CHANGED",
    payload: { change: "create", requestRef: refs.input, reasonCode: "DECISION_REQUIRED" },
  },
  {
    ...feedbackCommon,
    kind: "INTERVENTION_CHANGED",
    payload: {
      change: "create",
      interventionRef: refs.intervention,
      reasonCode: "ADJUSTMENT_AVAILABLE",
    },
  },
  {
    ...feedbackCommon,
    kind: "CONTEXT_FINALIZED",
    payload: {
      reasonCode: "CATALOG_FINALIZED",
      finalContextRevision: 5,
      summary: { status: "finalized", resultCode: "COMPLETED" },
      artifactRefs: [refs.route],
      actionRefs: [refs.lock],
      finalizedAt: later,
    },
  },
];
const optionalExtension = {
  ...feedbackCommon,
  kind: "FUTURE_OPTIONAL_OBSERVATION",
  required: false,
  payload: { nested: ["preserved", { value: 2 }], newField: true },
};

const p1 = [116, 39];
const p2 = [116.001, 39.001];
const p3 = [116.002, 39.002];
const ring = [p1, p2, p3, p1];
const geo = (type, coordinates) => ({
  kind: "geojson",
  crs: "OGC:CRS84",
  geometry: { type, coordinates },
});
const routeProperties = {
  adoption: "adopted",
  purpose: "navigation",
  routeSource: "catalog_fixture",
};
const artifactBase = {
  schemaVersion: TASK_BUSINESS_ARTIFACT_SCHEMA_VERSION,
  revision: 1,
  lifecycle: "active",
  identity,
  source: { producer: "device_planner", sourceRecordRef: "catalog-source-1" },
  createdAt: at,
  updatedAt: later,
};
const artifact = (artifactId, artifactType, semantics, properties, content) => ({
  ...artifactBase,
  artifactId,
  artifactType,
  semantics,
  availability: "available",
  properties,
  content,
});
const artifacts = [
  artifact(
    "destination-point",
    "navigation.destination",
    "requested",
    { intent: "requested" },
    geo("Point", p1),
  ),
  artifact(
    "waypoints-multi-point",
    "navigation.waypoints",
    "planned",
    { ordered: true, waypointCount: 2 },
    geo("MultiPoint", [p1, p2]),
  ),
  artifact(
    "route-line",
    "navigation.route",
    "planned",
    routeProperties,
    geo("LineString", [p1, p2]),
  ),
  artifact(
    "trajectory-multi-line",
    "navigation.trajectory",
    "observed",
    { sampleCount: 4 },
    geo("MultiLineString", [
      [p1, p2],
      [p2, p3],
    ]),
  ),
  artifact("area-polygon", "recon.area", "requested", { areaRevision: 1 }, geo("Polygon", [ring])),
  artifact(
    "covered-multi-polygon",
    "recon.covered_area",
    "derived",
    {
      areaRevision: 1,
      grid: { frameId: "map-1", origin: [0, 0], cellSizeM: 1, denominatorCellCount: 10 },
      numeratorCellCount: 3,
    },
    geo("MultiPolygon", [[ring]]),
  ),
  artifact("route-local", "navigation.route", "planned", routeProperties, {
    kind: "local_geometry",
    frameId: "sim-map-1",
    unit: "m",
    axisConvention: "ENU",
    geometry: {
      type: "LineString",
      coordinates: [
        [300, 400],
        [301, 402],
      ],
    },
  }),
  artifact(
    "target-image",
    "target.object",
    "observed",
    {
      targetId: "target-image",
      visibility: "visible",
      trackingState: "unlocked",
      firstSeen: { clockDomain: "utc", observedAt: at },
      lastSeen: { clockDomain: "utc", observedAt: later },
      sensorId: "camera-1",
      observationSessionId: "session-1",
      lastSeenPositionQuality: "unknown",
    },
    {
      kind: "image_observation",
      frameId: "camera-frame-1",
      bbox: { coordinateMode: "pixel", x: 20, y: 30, width: 15, height: 10 },
    },
  ),
  artifact("route-ref", "navigation.route", "planned", routeProperties, {
    kind: "content_ref",
    artifactId: "route-ref",
    revision: 1,
    readMethod: "business_artifact_content",
    handle: "route-ref_1",
    mediaType: "application/geo+json",
    sizeBytes: 500,
    sha256: "a".repeat(64),
    expiresAt: "2026-09-24T00:00:00Z",
  }),
  {
    ...artifactBase,
    artifactId: "trajectory-empty",
    artifactType: "navigation.trajectory",
    semantics: "observed",
    availability: "empty",
    reasonCode: "NO_SAMPLES",
    readPerformedAt: later,
  },
  {
    ...artifactBase,
    artifactId: "route-unavailable",
    artifactType: "navigation.route",
    semantics: "planned",
    availability: "unavailable",
    reasonCode: "PLANNER_NOT_READY",
  },
];
const action = {
  schemaVersion: TASK_BUSINESS_ACTION_SCHEMA_VERSION,
  actionId: "lock-1",
  actionType: "sensor.visual_lock",
  identity,
  revision: 1,
  state: "requested",
  actor: { type: "device" },
  triggerOrigin: "device_automatic",
  subjectRefs: [{ kind: "artifact", id: "target-image", revision: 1 }],
  reasonCode: "LOCK_REQUESTED",
  requestedAt: at,
};
const requiredInput = {
  schemaVersion: TASK_BUSINESS_INPUT_SCHEMA_VERSION,
  requestId: "input-1",
  requestKey: "input-key-1",
  inputType: "target.disposition_decision",
  identity,
  revision: 1,
  blocking: true,
  state: "pending",
  requiredResponder: "user",
  subjectBinding: {
    kind: "visual_lock",
    targetId: "target-image",
    lockSessionId: "lock-session-1",
    actionRef: refs.lock,
  },
  waitingPolicy: "pause_execution",
  onExpire: "release_and_resume_scan",
  onDismiss: "release_and_resume_scan",
  onDecline: "end_observation",
  title: "Choose target disposition",
  inputSchema: { type: "object", required: ["decision"] },
  reasonCode: "DECISION_REQUIRED",
  requestedAt: at,
  deadlineAt: "2026-09-24T00:00:00Z",
};
const intervention = {
  schemaVersion: TASK_BUSINESS_INTERVENTION_SCHEMA_VERSION,
  interventionId: "intervention-1",
  interventionType: "navigation.adjust_plan",
  identity,
  revision: 1,
  effectivePlanRevision: 2,
  blocking: false,
  state: "available",
  title: "Adjust route",
  inputSchema: { type: "object", properties: { viaPoints: { type: "array" } } },
  appliesTo: [refs.route],
  reasonCode: "ADJUSTMENT_AVAILABLE",
  createdAt: at,
};
const inputCommand = {
  schemaVersion: TASK_BUSINESS_INPUT_COMMAND_SCHEMA_VERSION,
  commandId: "input-command-1",
  taskId: identity.taskId,
  executionId: identity.executionId,
  requestId: requiredInput.requestId,
  requestKey: requiredInput.requestKey,
  guard: { mode: "semantic", expectedRequestRevision: 1 },
  result: { action: "accept", value: { decision: "continue_observation" } },
};
const answeredInput = {
  ...requiredInput,
  revision: 2,
  state: "answered",
  resolvedAt: later,
  responseCommandId: inputCommand.commandId,
  response: inputCommand.result,
};
const interventionCommand = {
  schemaVersion: TASK_BUSINESS_INTERVENTION_COMMAND_SCHEMA_VERSION,
  commandId: "intervention-command-1",
  taskId: identity.taskId,
  executionId: identity.executionId,
  interventionId: intervention.interventionId,
  guard: {
    mode: "semantic",
    expectedInterventionRevision: 1,
    expectedEffectivePlanRevision: 2,
  },
  input: { viaPoints: [[116, 39]] },
};
const cursor = { streamId: "public-stream-1", afterSequence: "7" };
const positive = {
  provenance: "synthetic_contract_fixture_not_simulation",
  context,
  feedback,
  optionalExtension,
  artifacts,
  action,
  requiredInput,
  answeredInput,
  intervention,
  inputCommand,
  interventionCommand,
  cursor,
};
const negative = [
  { id: "missing_identity", schema: "context", value: { ...context, identity: undefined } },
  {
    id: "crossed_feedback_payload",
    schema: "feedback",
    value: { ...feedback[2], kind: "ARTIFACT_CHANGED" },
  },
  {
    id: "missing_feedback_revision",
    schema: "feedback",
    value: { ...feedback[2], contextRevision: undefined },
  },
  {
    id: "available_without_content",
    schema: "artifact",
    value: { ...artifacts[2], content: undefined },
  },
  {
    id: "one_point_line",
    schema: "artifact",
    value: { ...artifacts[2], content: geo("LineString", [p1]) },
  },
  {
    id: "open_polygon",
    schema: "artifact",
    value: { ...artifacts[4], content: geo("Polygon", [[p1, p2, p3, [116.003, 39.003]]]) },
  },
  {
    id: "local_as_geographic",
    schema: "artifact",
    value: {
      ...artifacts[6],
      content: geo("LineString", [
        [300, 400],
        [301, 402],
      ]),
    },
  },
  {
    id: "pixel_box_out_of_bounds",
    schema: "artifact",
    value: {
      ...artifacts[7],
      content: {
        kind: "image_observation",
        frameId: "camera-frame-1",
        bbox: { coordinateMode: "normalized", x: 0.9, y: 0.9, width: 0.2, height: 0.2 },
      },
    },
  },
  {
    id: "content_ref_wrong_revision",
    schema: "artifact",
    value: { ...artifacts[8], content: { ...artifacts[8].content, revision: 2 } },
  },
  {
    id: "source_cursor_as_public",
    schema: "cursor",
    value: { sourceId: "vehicle.business", sourceStreamId: "source-stream-1", sourceSequence: "7" },
  },
  {
    id: "input_command_missing_execution",
    schema: "inputCommand",
    value: { ...inputCommand, executionId: undefined },
  },
  {
    id: "answered_input_missing_command_id",
    schema: "requiredInput",
    value: { ...answeredInput, responseCommandId: undefined },
  },
  {
    id: "intervention_command_claimed_actor",
    schema: "interventionCommand",
    value: { ...interventionCommand, actor: { type: "user", actorId: "self-claimed" } },
  },
  {
    id: "unknown_required_extension",
    schema: "extension",
    value: { ...optionalExtension, required: true },
  },
  {
    id: "known_kind_as_optional",
    schema: "extension",
    value: { ...optionalExtension, kind: "ACTION_CHANGED" },
  },
  {
    id: "unsupported_feedback_version",
    schema: "version",
    value: { ...feedback[2], schemaVersion: "sdar.task-business-feedback/9" },
  },
];

const validators = {
  context: TaskBusinessContextSchema,
  feedback: TaskBusinessFeedbackBodySchema,
  artifact: TaskArtifactSchema,
  requiredInput: RequiredInputSchema,
  cursor: RuntimeBusinessCursorSchema,
  inputCommand: RequiredInputResponseCommandSchema,
  interventionCommand: RuntimeInterventionCommandSchema,
};
TaskBusinessContextSchema.parse(context);
feedback.forEach((value) => TaskBusinessFeedbackBodySchema.parse(value));
parseTaskBusinessFeedbackBody(optionalExtension);
artifacts.forEach((value) => TaskArtifactSchema.parse(value));
BusinessActionSchema.parse(action);
RequiredInputSchema.parse(requiredInput);
RequiredInputSchema.parse(answeredInput);
RuntimeInterventionSchema.parse(intervention);
RequiredInputResponseCommandSchema.parse(inputCommand);
RuntimeInterventionCommandSchema.parse(interventionCommand);
RuntimeBusinessCursorSchema.parse(cursor);
for (const sample of negative) {
  if (sample.schema === "version") {
    try {
      parseTaskBusinessFeedbackBody(sample.value);
      throw new Error(`NEGATIVE_FIXTURE_ACCEPTED:${sample.id}`);
    } catch (error) {
      if (error.message !== "UNSUPPORTED_BUSINESS_SCHEMA_VERSION") throw error;
    }
  } else if (sample.schema === "extension") {
    try {
      parseTaskBusinessFeedbackBody(sample.value);
      throw new Error(`NEGATIVE_FIXTURE_ACCEPTED:${sample.id}`);
    } catch (error) {
      if (error.message !== "BUSINESS_PAYLOAD_INVALID") throw error;
    }
  } else if (validators[sample.schema].safeParse(sample.value).success) {
    throw new Error(`NEGATIVE_FIXTURE_ACCEPTED:${sample.id}`);
  }
}

for (const [name, data] of Object.entries({ positive, negative })) {
  const output = resolve(exampleOutputDir, `${name}-catalog.json`);
  const expected = await prettier.format(JSON.stringify(data), {
    ...(await prettier.resolveConfig(output)),
    parser: "json",
  });
  if (process.argv.includes("--check")) {
    if (readFileSync(output, "utf8") !== expected) {
      throw new Error(`TASK_BUSINESS_${name.toUpperCase()}_CATALOG_OUT_OF_DATE`);
    }
  } else {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, expected);
  }
}
