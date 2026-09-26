import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  TaskArtifactSchema,
  prepareArtifactContentRead,
} from "../../packages/vehicle-provider-core/src/task-business-artifact.js";
import {
  OptionalTaskBusinessExtensionSchema,
  RuntimeBusinessCursorSchema,
  TaskBusinessContextSchema,
  TaskBusinessFeedbackBodySchema,
  parseTaskBusinessFeedbackBody,
} from "../../packages/vehicle-provider-core/src/task-business-contract.js";
import {
  BusinessActionSchema,
  RequiredInputResponseCommandSchema,
  RequiredInputSchema,
  RuntimeInterventionCommandSchema,
  RuntimeInterventionSchema,
  assertInterventionCommand,
  assessRequiredInputResponse,
} from "../../packages/vehicle-provider-core/src/task-business-interaction.js";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}
const positive = z
  .object({
    provenance: z.literal("synthetic_contract_fixture_not_simulation"),
    context: TaskBusinessContextSchema,
    feedback: z.array(TaskBusinessFeedbackBodySchema),
    optionalExtension: OptionalTaskBusinessExtensionSchema,
    artifacts: z.array(TaskArtifactSchema),
    action: BusinessActionSchema,
    requiredInput: RequiredInputSchema,
    answeredInput: RequiredInputSchema,
    intervention: RuntimeInterventionSchema,
    inputCommand: RequiredInputResponseCommandSchema,
    interventionCommand: RuntimeInterventionCommandSchema,
    cursor: RuntimeBusinessCursorSchema,
  })
  .parse(readJson("protocol/task-business/v1/examples/positive-catalog.json"));
const negative = z
  .array(z.object({ id: z.string(), schema: z.string(), value: z.unknown() }))
  .parse(readJson("protocol/task-business/v1/examples/negative-catalog.json"));
const core = z
  .object({
    schemas: z.object({
      identity: z.record(z.string(), z.unknown()),
      sourceCursor: z.record(z.string(), z.unknown()),
      runtimeCursor: z.record(z.string(), z.unknown()),
      context: z.record(z.string(), z.unknown()),
      feedbackBody: z.record(z.string(), z.unknown()),
      optionalExtension: z.record(z.string(), z.unknown()),
    }),
  })
  .parse(readJson("protocol/task-business/v1/core.schema.json"));
const artifact = z
  .object({ schema: z.record(z.string(), z.unknown()) })
  .parse(readJson("protocol/task-business/v1/artifact.schema.json"));
const interaction = z
  .object({
    schemas: z.object({
      action: z.record(z.string(), z.unknown()),
      requiredInput: z.record(z.string(), z.unknown()),
      intervention: z.record(z.string(), z.unknown()),
      inputCommand: z.record(z.string(), z.unknown()),
      interventionCommand: z.record(z.string(), z.unknown()),
    }),
  })
  .parse(readJson("protocol/task-business/v1/interaction.schema.json"));
const ajv = new Ajv2020({ strict: true });
addFormatsImport.default(ajv);
const jsonValidators = {
  cursor: ajv.compile(core.schemas.runtimeCursor),
  context: ajv.compile(core.schemas.context),
  feedback: ajv.compile(core.schemas.feedbackBody),
  extension: ajv.compile(core.schemas.optionalExtension),
  artifact: ajv.compile(artifact.schema),
  action: ajv.compile(interaction.schemas.action),
  requiredInput: ajv.compile(interaction.schemas.requiredInput),
  intervention: ajv.compile(interaction.schemas.intervention),
  inputCommand: ajv.compile(interaction.schemas.inputCommand),
  interventionCommand: ajv.compile(interaction.schemas.interventionCommand),
};

describe("task business generated contract catalog", () => {
  it("validates full examples through canonical parsers and generated JSON Schema", () => {
    expect(positive.provenance).toBe("synthetic_contract_fixture_not_simulation");
    expect(TaskBusinessContextSchema.safeParse(positive.context).success).toBe(true);
    expect(jsonValidators.context(positive.context)).toBe(true);
    const kinds = new Set<string>();
    for (const body of positive.feedback) {
      expect(TaskBusinessFeedbackBodySchema.safeParse(body).success).toBe(true);
      expect(jsonValidators.feedback(body)).toBe(true);
      kinds.add(body.kind);
    }
    expect(kinds).toEqual(
      new Set([
        "BUSINESS_EVENT",
        "ARTIFACT_CHANGED",
        "ACTION_CHANGED",
        "REQUIRED_INPUT_CHANGED",
        "INTERVENTION_CHANGED",
        "CONTEXT_FINALIZED",
      ]),
    );
    expect(OptionalTaskBusinessExtensionSchema.safeParse(positive.optionalExtension).success).toBe(
      true,
    );
    expect(jsonValidators.extension(positive.optionalExtension)).toBe(true);
    expect(parseTaskBusinessFeedbackBody(positive.optionalExtension)).toEqual(
      positive.optionalExtension,
    );

    const geometryTypes = new Set<string>();
    const contentKinds = new Set<string>();
    for (const record of positive.artifacts) {
      expect(TaskArtifactSchema.safeParse(record).success).toBe(true);
      expect(jsonValidators.artifact(record)).toBe(true);
      if (record.availability === "available") {
        contentKinds.add(record.content.kind);
        if ("geometry" in record.content) geometryTypes.add(record.content.geometry.type);
      }
    }
    expect(geometryTypes).toEqual(
      new Set(["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"]),
    );
    expect(contentKinds).toEqual(
      new Set(["geojson", "local_geometry", "image_observation", "content_ref"]),
    );
    for (const [schema, value, parser] of [
      ["action", positive.action, BusinessActionSchema],
      ["requiredInput", positive.requiredInput, RequiredInputSchema],
      ["requiredInput", positive.answeredInput, RequiredInputSchema],
      ["intervention", positive.intervention, RuntimeInterventionSchema],
      ["inputCommand", positive.inputCommand, RequiredInputResponseCommandSchema],
      ["interventionCommand", positive.interventionCommand, RuntimeInterventionCommandSchema],
    ] as const) {
      expect(parser.safeParse(value).success).toBe(true);
      expect(jsonValidators[schema](value)).toBe(true);
    }
    expect(RuntimeBusinessCursorSchema.safeParse(positive.cursor).success).toBe(true);
    expect(jsonValidators.cursor(positive.cursor)).toBe(true);
  });

  it("rejects every generated invalid example and rejects structural ones in JSON Schema", () => {
    const expected = new Set([
      "missing_identity",
      "crossed_feedback_payload",
      "missing_feedback_revision",
      "available_without_content",
      "one_point_line",
      "open_polygon",
      "local_as_geographic",
      "pixel_box_out_of_bounds",
      "content_ref_wrong_revision",
      "source_cursor_as_public",
      "input_command_missing_execution",
      "answered_input_missing_command_id",
      "intervention_command_claimed_actor",
      "unknown_required_extension",
      "known_kind_as_optional",
      "unsupported_feedback_version",
    ]);
    expect(new Set(negative.map((sample) => sample.id))).toEqual(expected);
    for (const sample of negative) {
      switch (sample.schema) {
        case "context":
          expect(TaskBusinessContextSchema.safeParse(sample.value).success, sample.id).toBe(false);
          break;
        case "feedback":
          expect(TaskBusinessFeedbackBodySchema.safeParse(sample.value).success, sample.id).toBe(
            false,
          );
          break;
        case "artifact":
          expect(TaskArtifactSchema.safeParse(sample.value).success, sample.id).toBe(false);
          break;
        case "requiredInput":
          expect(RequiredInputSchema.safeParse(sample.value).success, sample.id).toBe(false);
          break;
        case "cursor":
          expect(RuntimeBusinessCursorSchema.safeParse(sample.value).success, sample.id).toBe(
            false,
          );
          break;
        case "inputCommand":
          expect(
            RequiredInputResponseCommandSchema.safeParse(sample.value).success,
            sample.id,
          ).toBe(false);
          break;
        case "interventionCommand":
          expect(RuntimeInterventionCommandSchema.safeParse(sample.value).success, sample.id).toBe(
            false,
          );
          break;
        case "extension":
          expect(() => parseTaskBusinessFeedbackBody(sample.value), sample.id).toThrow(
            "BUSINESS_PAYLOAD_INVALID",
          );
          break;
        case "version":
          expect(() => parseTaskBusinessFeedbackBody(sample.value), sample.id).toThrow(
            "UNSUPPORTED_BUSINESS_SCHEMA_VERSION",
          );
          break;
        default:
          throw new Error(`UNREGISTERED_NEGATIVE_SAMPLE:${sample.id}`);
      }
      if (sample.schema in jsonValidators) {
        // Semantic refinements such as closed rings and exact ref matching live in
        // the canonical parser; the JSON Schema covers structural constraints.
        if (
          ![
            "open_polygon",
            "pixel_box_out_of_bounds",
            "content_ref_wrong_revision",
            "answered_input_missing_command_id",
          ].includes(sample.id)
        ) {
          expect(
            jsonValidators[sample.schema as keyof typeof jsonValidators](sample.value),
            sample.id,
          ).toBe(false);
        }
      }
    }
    expect(
      jsonValidators.extension(negative.find((s) => s.id === "known_kind_as_optional")?.value),
    ).toBe(false);
  });

  it("rejects nonfinite coordinates before JSON serialization", () => {
    const route = positive.artifacts.find(
      (record: { artifactId: string }) => record.artifactId === "route-line",
    );
    if (route?.availability !== "available" || route.content.kind !== "geojson") {
      throw new Error("CATALOG_ROUTE_GEOJSON_MISSING");
    }
    for (const coordinate of [NaN, Infinity, -Infinity]) {
      expect(
        TaskArtifactSchema.safeParse({
          ...route,
          content: {
            ...route.content,
            geometry: {
              type: "LineString",
              coordinates: [
                [coordinate, 39],
                [116, 39],
              ],
            },
          },
        }).success,
      ).toBe(false);
    }
  });

  it("keeps optional extensions opaque and applies only explicit command/read preflights", () => {
    const extension = parseTaskBusinessFeedbackBody(positive.optionalExtension);
    expect(extension).toEqual(positive.optionalExtension);
    const request = RequiredInputSchema.parse(positive.requiredInput);
    const command = RequiredInputResponseCommandSchema.parse(positive.inputCommand);
    expect(
      assessRequiredInputResponse(
        request,
        { ...command, result: { action: "cancel" } },
        { source: "runtime_authorization_context", actorType: "user", verified: true },
        99,
        request.subjectBinding,
        new Date(request.requestedAt),
      ),
    ).toEqual({ outcome: "cancel", nextDisposition: "release_and_resume_scan" });
    expect(() =>
      assessRequiredInputResponse(
        request,
        command,
        { source: "runtime_authorization_context", actorType: "user", verified: false },
        4,
        request.subjectBinding,
        new Date(request.requestedAt),
      ),
    ).toThrow("RESPONDER_NOT_AUTHORIZED");
    const intervention = RuntimeInterventionSchema.parse(positive.intervention);
    const interventionCommand = RuntimeInterventionCommandSchema.parse(
      positive.interventionCommand,
    );
    expect(() =>
      assertInterventionCommand(
        intervention,
        interventionCommand,
        99,
        2,
        new Date(intervention.createdAt),
      ),
    ).not.toThrow();
    expect(() =>
      assertInterventionCommand(
        intervention,
        interventionCommand,
        99,
        3,
        new Date(intervention.createdAt),
      ),
    ).toThrow("PLAN_REVISION_CONFLICT");

    const ref = TaskArtifactSchema.parse(
      positive.artifacts.find(
        (record: { artifactId: string }) => record.artifactId === "route-ref",
      ),
    );
    expect(
      prepareArtifactContentRead(
        ref,
        {
          identity: ref.identity,
          artifactId: ref.artifactId,
          revision: ref.revision,
        },
        new Date("2026-09-23T00:00:00Z"),
      ),
    ).toMatchObject({ kind: "stored", handle: "route-ref_1" });
    expect(() =>
      prepareArtifactContentRead(
        ref,
        {
          identity: ref.identity,
          artifactId: ref.artifactId,
          revision: ref.revision,
        },
        new Date("2026-09-24T00:00:00Z"),
      ),
    ).toThrow("ARTIFACT_CONTENT_EXPIRED");
  });
});
