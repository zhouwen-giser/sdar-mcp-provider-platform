import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "../../adapter-protocol/src/index.js";

export const SMPP_DIAGNOSTIC_CONTRACT = "sdar.smpp-diagnostics/v1" as const;
export const SMPP_DIAGNOSTIC_CONTROL_OPERATION = "__sdar_diagnostic_control_v1" as const;
export const SMPP_RESPONSE_LOSS_CAPABILITY = "SMPP-DIAGNOSTIC-RESPONSE-LOSS-V1" as const;
export const SMPP_PROVIDER_BUSINESS_SUCCESS_CAPABILITY =
  "SMPP-DIAGNOSTIC-PROVIDER-BUSINESS-SUCCESS-V1" as const;
export const SMPP_DIAGNOSTIC_ARGUMENT_HASH_ALGORITHM =
  "sha256-json-recursive-object-key-sort-v1" as const;
export const SMPP_DIAGNOSTIC_API_CONTRACT = Object.freeze({
  schemaVersion: "sdar.smpp-diagnostics.contract/v1",
  contract: SMPP_DIAGNOSTIC_CONTRACT,
  authentication: { header: "x-sdar-diagnostic-token", scheme: "scoped-operator-token" },
  routes: Object.freeze({
    responseLoss: Object.freeze({
      capabilityId: SMPP_RESPONSE_LOSS_CAPABILITY,
      control: "POST /v1/diagnostics/response-loss",
      status: "GET /v1/diagnostics/response-loss/:leaseId",
    }),
    providerBusinessSuccess: Object.freeze({
      capabilityId: SMPP_PROVIDER_BUSINESS_SUCCESS_CAPABILITY,
      control: "POST /v1/diagnostics/provider-business-success",
      status: "GET /v1/diagnostics/provider-business-success/:leaseId",
    }),
  }),
  actions: Object.freeze(["arm", "disarm", "status"]),
  selector: Object.freeze({
    operationName: "vehicle_navigate",
    argumentHashAlgorithm: SMPP_DIAGNOSTIC_ARGUMENT_HASH_ALGORITHM,
    input: "exact vehicle_navigate arguments after deterministic materialization",
  }),
  requestSchema: Object.freeze({
    type: "object",
    oneOf: Object.freeze([
      Object.freeze({
        properties: Object.freeze({
          contract: Object.freeze({ const: SMPP_DIAGNOSTIC_CONTRACT }),
          action: Object.freeze({ const: "arm" }),
          idempotencyKey: Object.freeze({ type: "string", minLength: 1, maxLength: 256 }),
          ttlMs: Object.freeze({ type: "integer", minimum: 1_000, maximum: 3_600_000 }),
          scope: Object.freeze({
            type: "object",
            properties: Object.freeze({
              runId: Object.freeze({ type: "string" }),
              caseId: Object.freeze({ enum: Object.freeze(["UGV-MCP-003", "UGV-XCHAIN-003"]) }),
              caseExecutionId: Object.freeze({ type: "string" }),
              repetitionId: Object.freeze({ type: "string" }),
              selector: Object.freeze({
                type: "object",
                properties: Object.freeze({
                  operationName: Object.freeze({ const: "vehicle_navigate" }),
                  argumentHash: Object.freeze({ type: "string", pattern: "^[a-f0-9]{64}$" }),
                }),
                required: Object.freeze(["operationName", "argumentHash"]),
                additionalProperties: false,
              }),
              taskId: Object.freeze({ type: "string" }),
            }),
            required: Object.freeze([
              "runId",
              "caseId",
              "caseExecutionId",
              "repetitionId",
              "selector",
            ]),
            additionalProperties: false,
          }),
        }),
        required: Object.freeze(["contract", "action", "idempotencyKey", "ttlMs", "scope"]),
        additionalProperties: false,
      }),
      Object.freeze({
        properties: Object.freeze({
          contract: Object.freeze({ const: SMPP_DIAGNOSTIC_CONTRACT }),
          action: Object.freeze({ const: "disarm" }),
          idempotencyKey: Object.freeze({ type: "string", minLength: 1, maxLength: 256 }),
          leaseId: Object.freeze({ type: "string", format: "uuid" }),
        }),
        required: Object.freeze(["contract", "action", "idempotencyKey", "leaseId"]),
        additionalProperties: false,
      }),
    ]),
  }),
  responseSchema: Object.freeze({
    type: "object",
    properties: Object.freeze({
      contract: Object.freeze({ const: SMPP_DIAGNOSTIC_CONTRACT }),
      capabilityId: Object.freeze({
        enum: Object.freeze([
          SMPP_RESPONSE_LOSS_CAPABILITY,
          SMPP_PROVIDER_BUSINESS_SUCCESS_CAPABILITY,
        ]),
      }),
      contractHash: Object.freeze({ type: "string", pattern: "^[a-f0-9]{64}$" }),
      lease: Object.freeze({
        type: "object",
        properties: Object.freeze({
          contract: Object.freeze({ const: SMPP_DIAGNOSTIC_CONTRACT }),
          leaseId: Object.freeze({ type: "string", format: "uuid" }),
          capabilityId: Object.freeze({
            enum: Object.freeze([
              SMPP_RESPONSE_LOSS_CAPABILITY,
              SMPP_PROVIDER_BUSINESS_SUCCESS_CAPABILITY,
            ]),
          }),
          faultType: Object.freeze({
            enum: Object.freeze([
              "drop-response-after-durable-side-effect",
              "provider-business-success",
            ]),
          }),
          boundary: Object.freeze({
            enum: Object.freeze([
              "provider-after-durable-mission",
              "provider-terminal-business-semantics",
            ]),
          }),
          injectionCount: Object.freeze({ const: 1 }),
          operationName: Object.freeze({ const: "vehicle_navigate" }),
          stableOperationKey: Object.freeze({ type: "string", pattern: "^[a-f0-9]{64}$" }),
          canonicalRequestHash: Object.freeze({ type: "string", pattern: "^[a-f0-9]{64}$" }),
          idempotencyKey: Object.freeze({ type: "string" }),
          fence: Object.freeze({ type: "string", pattern: "^[1-9][0-9]*$" }),
          state: Object.freeze({
            enum: Object.freeze(["ARMED", "BOUND", "CONSUMED", "DISARMED", "EXPIRED"]),
          }),
          scope: Object.freeze({ type: "object" }),
          armedAt: Object.freeze({ type: "string", format: "date-time" }),
          expiresAt: Object.freeze({ type: "string", format: "date-time" }),
          boundAt: Object.freeze({ type: "string", format: "date-time" }),
          consumedAt: Object.freeze({ type: "string", format: "date-time" }),
          cleanupAt: Object.freeze({ type: "string", format: "date-time" }),
          logicalInvocationId: Object.freeze({ type: "string" }),
          taskId: Object.freeze({ type: "string" }),
          externalExecutionId: Object.freeze({ type: "string" }),
          deviceMissionId: Object.freeze({ type: "string" }),
        }),
        required: Object.freeze([
          "contract",
          "leaseId",
          "capabilityId",
          "faultType",
          "boundary",
          "injectionCount",
          "operationName",
          "stableOperationKey",
          "canonicalRequestHash",
          "idempotencyKey",
          "fence",
          "state",
          "scope",
          "armedAt",
          "expiresAt",
        ]),
        additionalProperties: false,
      }),
      receipt: Object.freeze({
        type: "object",
        properties: Object.freeze({
          contract: Object.freeze({ const: SMPP_DIAGNOSTIC_CONTRACT }),
          receiptId: Object.freeze({ type: "string", format: "uuid" }),
          leaseId: Object.freeze({ type: "string", format: "uuid" }),
          action: Object.freeze({
            enum: Object.freeze(["armed", "bound", "consumed", "disarmed", "expired"]),
          }),
          requestHash: Object.freeze({ type: "string", pattern: "^[a-f0-9]{64}$" }),
          occurredAt: Object.freeze({ type: "string", format: "date-time" }),
          state: Object.freeze({
            enum: Object.freeze(["ARMED", "BOUND", "CONSUMED", "DISARMED", "EXPIRED"]),
          }),
          reasonCode: Object.freeze({ type: "string" }),
          binding: Object.freeze({
            type: "object",
            properties: Object.freeze({
              operationName: Object.freeze({ const: "vehicle_navigate" }),
              argumentHash: Object.freeze({ type: "string", pattern: "^[a-f0-9]{64}$" }),
              logicalInvocationId: Object.freeze({ type: "string" }),
              taskId: Object.freeze({ type: "string" }),
              externalExecutionId: Object.freeze({ type: "string" }),
              deviceMissionId: Object.freeze({ type: "string" }),
            }),
            required: Object.freeze([
              "operationName",
              "argumentHash",
              "logicalInvocationId",
              "taskId",
              "externalExecutionId",
              "deviceMissionId",
            ]),
            additionalProperties: false,
          }),
        }),
        required: Object.freeze([
          "contract",
          "receiptId",
          "leaseId",
          "action",
          "requestHash",
          "occurredAt",
          "state",
          "reasonCode",
        ]),
        additionalProperties: false,
      }),
    }),
    required: Object.freeze(["contract", "capabilityId", "contractHash", "lease", "receipt"]),
    additionalProperties: false,
  }),
});
export const SMPP_DIAGNOSTIC_API_CONTRACT_HASH = createHash("sha256")
  .update(canonicalJson(SMPP_DIAGNOSTIC_API_CONTRACT))
  .digest("hex");

export type SmppDiagnosticCapabilityId =
  typeof SMPP_RESPONSE_LOSS_CAPABILITY | typeof SMPP_PROVIDER_BUSINESS_SUCCESS_CAPABILITY;
export type SmppDiagnosticLeaseState = "ARMED" | "BOUND" | "CONSUMED" | "DISARMED" | "EXPIRED";
export type SmppDiagnosticReceiptAction = "armed" | "bound" | "consumed" | "disarmed" | "expired";

export interface SmppDiagnosticScope {
  runId: string;
  caseId: "UGV-MCP-003" | "UGV-XCHAIN-003";
  caseExecutionId: string;
  repetitionId: string;
  selector: {
    operationName: "vehicle_navigate";
    argumentHash: string;
  };
  taskId?: string;
}

export interface SmppDiagnosticLease {
  contract: typeof SMPP_DIAGNOSTIC_CONTRACT;
  leaseId: string;
  capabilityId: SmppDiagnosticCapabilityId;
  faultType: "drop-response-after-durable-side-effect" | "provider-business-success";
  boundary: "provider-after-durable-mission" | "provider-terminal-business-semantics";
  injectionCount: 1;
  operationName: "vehicle_navigate";
  stableOperationKey: string;
  canonicalRequestHash: string;
  idempotencyKey: string;
  fence: string;
  state: SmppDiagnosticLeaseState;
  scope: SmppDiagnosticScope;
  armedAt: string;
  expiresAt: string;
  boundAt?: string;
  consumedAt?: string;
  cleanupAt?: string;
  logicalInvocationId?: string;
  taskId?: string;
  externalExecutionId?: string;
  deviceMissionId?: string;
}

export interface SmppDiagnosticReceipt {
  contract: typeof SMPP_DIAGNOSTIC_CONTRACT;
  receiptId: string;
  leaseId: string;
  action: SmppDiagnosticReceiptAction;
  requestHash: string;
  occurredAt: string;
  state: SmppDiagnosticLeaseState;
  reasonCode: string;
  binding?: {
    operationName: "vehicle_navigate";
    argumentHash: string;
    logicalInvocationId: string;
    taskId: string;
    externalExecutionId: string;
    deviceMissionId: string;
  };
}

export interface SmppDiagnosticControlResult {
  lease: SmppDiagnosticLease;
  receipt: SmppDiagnosticReceipt;
}

export type SmppDiagnosticControlRequest =
  | {
      contract: typeof SMPP_DIAGNOSTIC_CONTRACT;
      action: "arm";
      idempotencyKey: string;
      ttlMs: number;
      scope: SmppDiagnosticScope;
    }
  | {
      contract: typeof SMPP_DIAGNOSTIC_CONTRACT;
      action: "disarm";
      idempotencyKey: string;
      leaseId: string;
    }
  | {
      contract: typeof SMPP_DIAGNOSTIC_CONTRACT;
      action: "status";
      leaseId: string;
    };

export interface SmppDiagnosticBinding {
  capabilityId: SmppDiagnosticCapabilityId;
  operationName: "vehicle_navigate";
  argumentHash: string;
  logicalInvocationId: string;
  taskId: string;
  externalExecutionId: string;
  deviceMissionId: string;
  observedAt: string;
}

export class SmppDiagnosticResponseLossError extends Error {
  readonly code = "DIAGNOSTIC_ADAPTER_RESPONSE_LOST_AFTER_SUCCESS" as const;

  constructor(
    readonly leaseId: string,
    readonly taskId: string,
    readonly externalExecutionId: string,
    readonly deviceMissionId: string,
  ) {
    super("DIAGNOSTIC_ADAPTER_RESPONSE_LOST_AFTER_SUCCESS");
    this.name = "SmppDiagnosticResponseLossError";
  }
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseSmppDiagnosticControlRequest(
  value: unknown,
  capabilityId: SmppDiagnosticCapabilityId,
  maximumTtlMs: number,
): SmppDiagnosticControlRequest {
  if (!record(value) || value.contract !== SMPP_DIAGNOSTIC_CONTRACT) {
    throw new Error("SMPP_DIAGNOSTIC_CONTRACT_INVALID");
  }
  if (value.action === "arm") {
    assertKeys(value, ["contract", "action", "idempotencyKey", "ttlMs", "scope"]);
    if (!identifier(value.idempotencyKey)) throw new Error("SMPP_DIAGNOSTIC_IDEMPOTENCY_INVALID");
    if (
      !Number.isSafeInteger(value.ttlMs) ||
      Number(value.ttlMs) < 1_000 ||
      Number(value.ttlMs) > maximumTtlMs
    )
      throw new Error("SMPP_DIAGNOSTIC_TTL_INVALID");
    const scope = parseScope(value.scope, capabilityId);
    return {
      contract: SMPP_DIAGNOSTIC_CONTRACT,
      action: "arm",
      idempotencyKey: value.idempotencyKey,
      ttlMs: Number(value.ttlMs),
      scope,
    };
  }
  if (value.action === "disarm") {
    assertKeys(value, ["contract", "action", "idempotencyKey", "leaseId"]);
    if (!identifier(value.idempotencyKey)) throw new Error("SMPP_DIAGNOSTIC_IDEMPOTENCY_INVALID");
    if (typeof value.leaseId !== "string" || !UUID.test(value.leaseId))
      throw new Error("SMPP_DIAGNOSTIC_LEASE_ID_INVALID");
    return {
      contract: SMPP_DIAGNOSTIC_CONTRACT,
      action: "disarm",
      idempotencyKey: value.idempotencyKey,
      leaseId: value.leaseId,
    };
  }
  if (value.action === "status") {
    assertKeys(value, ["contract", "action", "leaseId"]);
    if (typeof value.leaseId !== "string" || !UUID.test(value.leaseId))
      throw new Error("SMPP_DIAGNOSTIC_LEASE_ID_INVALID");
    return { contract: SMPP_DIAGNOSTIC_CONTRACT, action: "status", leaseId: value.leaseId };
  }
  throw new Error("SMPP_DIAGNOSTIC_ACTION_INVALID");
}

export function diagnosticStableOperationKey(
  capabilityId: SmppDiagnosticCapabilityId,
  scope: SmppDiagnosticScope,
): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        contract: SMPP_DIAGNOSTIC_CONTRACT,
        capabilityId,
        operationName: "vehicle_navigate",
        runId: scope.runId,
        caseId: scope.caseId,
        caseExecutionId: scope.caseExecutionId,
        repetitionId: scope.repetitionId,
        selector: scope.selector,
        taskId: scope.taskId ?? null,
      }),
    )
    .digest("hex");
}

export function diagnosticRequestHash(
  capabilityId: SmppDiagnosticCapabilityId,
  request: SmppDiagnosticControlRequest,
): string {
  return createHash("sha256")
    .update(canonicalJson({ capabilityId, ...request }))
    .digest("hex");
}

export function diagnosticControlSignature(
  token: string,
  capabilityId: SmppDiagnosticCapabilityId,
  request: SmppDiagnosticControlRequest,
): string {
  return createHmac("sha256", token)
    .update(canonicalJson({ operation: SMPP_DIAGNOSTIC_CONTROL_OPERATION, capabilityId, request }))
    .digest("hex");
}

export function assertDiagnosticControlSignature(
  token: string,
  signature: string,
  capabilityId: SmppDiagnosticCapabilityId,
  request: SmppDiagnosticControlRequest,
): void {
  const expected = diagnosticControlSignature(token, capabilityId, request);
  if (
    !HASH.test(signature) ||
    !timingSafeEqual(Buffer.from(signature, "ascii"), Buffer.from(expected, "ascii"))
  )
    throw new Error("SMPP_DIAGNOSTIC_CONTROL_AUTH_INVALID");
}

export function diagnosticCapabilityContract(capabilityId: SmppDiagnosticCapabilityId) {
  return capabilityId === SMPP_RESPONSE_LOSS_CAPABILITY
    ? {
        capabilityId,
        faultType: "drop-response-after-durable-side-effect" as const,
        boundary: "provider-after-durable-mission" as const,
        caseId: "UGV-MCP-003" as const,
      }
    : {
        capabilityId,
        faultType: "provider-business-success" as const,
        boundary: "provider-terminal-business-semantics" as const,
        caseId: "UGV-XCHAIN-003" as const,
      };
}

function parseScope(value: unknown, capabilityId: SmppDiagnosticCapabilityId): SmppDiagnosticScope {
  if (!record(value)) throw new Error("SMPP_DIAGNOSTIC_SCOPE_INVALID");
  assertKeys(value, ["runId", "caseId", "caseExecutionId", "repetitionId", "selector", "taskId"]);
  const contract = diagnosticCapabilityContract(capabilityId);
  if (value.caseId !== contract.caseId) throw new Error("SMPP_DIAGNOSTIC_CASE_SCOPE_INVALID");
  for (const key of ["runId", "caseExecutionId", "repetitionId"] as const)
    if (!identifier(value[key])) throw new Error("SMPP_DIAGNOSTIC_SCOPE_INVALID");
  if (!record(value.selector)) throw new Error("SMPP_DIAGNOSTIC_SELECTOR_INVALID");
  assertKeys(value.selector, ["operationName", "argumentHash"]);
  if (
    value.selector.operationName !== "vehicle_navigate" ||
    typeof value.selector.argumentHash !== "string" ||
    !HASH.test(value.selector.argumentHash)
  )
    throw new Error("SMPP_DIAGNOSTIC_SELECTOR_INVALID");
  if (value.taskId !== undefined && !identifier(value.taskId))
    throw new Error("SMPP_DIAGNOSTIC_SCOPE_INVALID");
  return {
    runId: String(value.runId),
    caseId: value.caseId as SmppDiagnosticScope["caseId"],
    caseExecutionId: String(value.caseExecutionId),
    repetitionId: String(value.repetitionId),
    selector: {
      operationName: "vehicle_navigate",
      argumentHash: value.selector.argumentHash,
    },
    ...(value.taskId === undefined ? {} : { taskId: value.taskId }),
  };
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error("SMPP_DIAGNOSTIC_REQUEST_UNKNOWN_FIELD");
  }
}
