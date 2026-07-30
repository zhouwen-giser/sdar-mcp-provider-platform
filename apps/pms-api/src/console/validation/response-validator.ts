import type { FastifySchema } from "fastify";
import { consoleRequestSchema } from "./request-validator.js";
import {
  frozenConsoleOperation,
  resolveResponse,
  rewriteSchemaReferences,
  schemaId,
  type JsonSchema,
} from "./contract-loader.js";

export function consoleRouteSchema(operationId: string): FastifySchema {
  const request = consoleRequestSchema(operationId);
  return { ...request, response: consoleResponseSchemas(operationId) };
}

export function consoleResponseSchemas(operationId: string): Readonly<Record<string, JsonSchema>> {
  const { operation } = frozenConsoleOperation(operationId);
  const response: Record<string, JsonSchema> = {};
  for (const [status, source] of Object.entries(operation.responses)) {
    const resolved = resolveResponse(source);
    const schema = resolved.content?.["application/json"]?.schema;
    const problemSchema = resolved.content?.["application/problem+json"]?.schema;
    if (schema !== undefined) response[status] = rewriteSchemaReferences(schema);
    if (problemSchema !== undefined) response[status] = rewriteSchemaReferences(problemSchema);
    if (schema === undefined && problemSchema === undefined && status !== "default") {
      response[status] = { type: "null" };
    }
  }
  if (response.default === undefined) {
    response.default = { $ref: schemaId("ProblemDetails") };
  }
  return response;
}

