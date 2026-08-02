import type { FastifySchema } from "fastify";
import {
  frozenConsoleOperation,
  resolveParameter,
  rewriteSchemaReferences,
  type JsonSchema,
  type OpenApiParameter,
} from "./contract-loader.js";

export function consoleRequestSchema(operationId: string): FastifySchema {
  const { operation } = frozenConsoleOperation(operationId);
  const path = parameterObject(operation.parameters, "path", false);
  const querystring = parameterObject(operation.parameters, "query", false) ?? {
    type: "object",
    properties: {},
    additionalProperties: false,
  };
  const headers = parameterObject(operation.parameters, "header", true);
  const body = requestBodySchema(operation.requestBody);
  return {
    ...(path === undefined ? {} : { params: path }),
    querystring,
    ...(headers === undefined ? {} : { headers }),
    ...(body === undefined ? {} : { body }),
  };
}

function parameterObject(
  parameters: readonly OpenApiParameter[] | undefined,
  location: "path" | "query" | "header",
  allowAdditional: boolean,
): JsonSchema | undefined {
  const selected = (parameters ?? [])
    .map(resolveParameter)
    .filter((parameter) => parameter.in === location);
  if (selected.length === 0) return undefined;
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const parameter of selected) {
    if (parameter.name === undefined || parameter.schema === undefined) {
      throw new Error(`PMS_CONSOLE_PARAMETER_INVALID:${location}`);
    }
    const name = location === "header" ? parameter.name.toLowerCase() : parameter.name;
    properties[name] = rewriteSchemaReferences(parameter.schema);
    if (parameter.required === true) required.push(name);
  }
  return {
    type: "object",
    properties,
    ...(required.length === 0 ? {} : { required }),
    additionalProperties: allowAdditional,
  };
}

function requestBodySchema(
  requestBody: ReturnType<typeof frozenConsoleOperation>["operation"]["requestBody"],
): JsonSchema | undefined {
  if (requestBody === undefined) return undefined;
  const schema = requestBody.content?.["application/json"]?.schema;
  if (schema === undefined) throw new Error("PMS_CONSOLE_JSON_REQUEST_SCHEMA_MISSING");
  return rewriteSchemaReferences(schema);
}
