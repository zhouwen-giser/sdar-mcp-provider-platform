import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

export type JsonSchema = Readonly<Record<string, unknown>>;

export interface OpenApiParameter {
  readonly name?: string;
  readonly in?: "path" | "query" | "header";
  readonly required?: boolean;
  readonly schema?: JsonSchema;
  readonly $ref?: string;
}

interface OpenApiResponse {
  readonly content?: Readonly<Record<string, { readonly schema?: JsonSchema }>>;
  readonly $ref?: string;
}

export interface OpenApiOperation {
  readonly operationId: string;
  readonly parameters?: readonly OpenApiParameter[];
  readonly requestBody?: {
    readonly required?: boolean;
    readonly content?: Readonly<Record<string, { readonly schema?: JsonSchema }>>;
  };
  readonly responses: Readonly<Record<string, OpenApiResponse>>;
}

interface OpenApiDocument {
  readonly paths: Readonly<Record<string, Readonly<Record<string, OpenApiOperation>>>>;
  readonly components: {
    readonly schemas: Readonly<Record<string, JsonSchema>>;
    readonly parameters?: Readonly<Record<string, OpenApiParameter>>;
    readonly responses?: Readonly<Record<string, OpenApiResponse>>;
  };
}

export interface FrozenConsoleOperation {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly operation: OpenApiOperation;
}

const SCHEMA_PREFIX = "urn:sdar:pms-console-api:v1:schema:";
const CONTRACT_RELATIVE_PATH = "packages/pms-console-api-contract/schema/openapi.bundle.json";
const document = loadDocument();
const operations = collectOperations(document);

export function frozenConsoleOperations(): readonly FrozenConsoleOperation[] {
  return operations;
}

export function frozenConsoleOperation(operationId: string): FrozenConsoleOperation {
  const operation = operations.find((candidate) => candidate.operationId === operationId);
  if (operation === undefined) {
    throw new Error(`PMS_CONSOLE_OPERATION_NOT_FOUND:${operationId}`);
  }
  return operation;
}

export function registerFrozenConsoleSchemas(app: FastifyInstance): void {
  for (const [name, schema] of Object.entries(document.components.schemas)) {
    app.addSchema({
      ...rewriteSchemaReferences(schema),
      $id: schemaId(name),
    });
  }
}

export function resolveParameter(parameter: OpenApiParameter): OpenApiParameter {
  if (parameter.$ref === undefined) return parameter;
  const name = localComponentName(parameter.$ref, "parameters");
  const resolved = document.components.parameters?.[name];
  if (resolved === undefined) {
    throw new Error(`PMS_CONSOLE_PARAMETER_REF_NOT_FOUND:${parameter.$ref}`);
  }
  return resolved;
}

export function resolveResponse(response: OpenApiResponse): OpenApiResponse {
  if (response.$ref === undefined) return response;
  const name = localComponentName(response.$ref, "responses");
  const resolved = document.components.responses?.[name];
  if (resolved === undefined) {
    throw new Error(`PMS_CONSOLE_RESPONSE_REF_NOT_FOUND:${response.$ref}`);
  }
  return resolved;
}

export function rewriteSchemaReferences<T>(value: T): T {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.map((item) => rewriteSchemaReferences(item)) as T;
  }
  if (value === null || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "$ref" && typeof item === "string" && item.startsWith("#/components/schemas/")) {
      output[key] = schemaId(localComponentName(item, "schemas"));
    } else {
      output[key] = rewriteSchemaReferences(item);
    }
  }
  return output as T;
}

export function schemaId(name: string): string {
  return `${SCHEMA_PREFIX}${name}`;
}

function loadDocument(): OpenApiDocument {
  const parsed: unknown = JSON.parse(readFileSync(resolveContractPath(), "utf8"));
  if (parsed === null || typeof parsed !== "object" || !("paths" in parsed)) {
    throw new Error("PMS_CONSOLE_CONTRACT_INVALID");
  }
  return parsed as OpenApiDocument;
}

function resolveContractPath(): string {
  for (const start of [process.cwd(), dirname(fileURLToPath(import.meta.url))]) {
    let candidate = resolve(start);
    for (;;) {
      const path = resolve(candidate, CONTRACT_RELATIVE_PATH);
      if (existsSync(path)) return path;
      const parent = dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
  }
  throw new Error("PMS_CONSOLE_CONTRACT_PACKAGE_NOT_FOUND");
}

function collectOperations(openApi: OpenApiDocument): readonly FrozenConsoleOperation[] {
  const result: FrozenConsoleOperation[] = [];
  for (const [path, item] of Object.entries(openApi.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (!["get", "post", "patch", "delete"].includes(method)) continue;
      result.push(
        Object.freeze({
          operationId: operation.operationId,
          method: method.toUpperCase(),
          path,
          operation,
        }),
      );
    }
  }
  return Object.freeze(result);
}

function localComponentName(reference: string, kind: string): string {
  const prefix = `#/components/${kind}/`;
  if (!reference.startsWith(prefix) || reference.length === prefix.length) {
    throw new Error(`PMS_CONSOLE_UNSUPPORTED_REF:${reference}`);
  }
  return reference.slice(prefix.length);
}
