import { createHash } from "node:crypto";
import type { ControlSettings } from "./model.js";

export type ExchangeStage =
  "connect" | "guard" | "send" | "receive" | "validate" | "complete" | "dispatch";
export interface TransportDiagnostic {
  schemaVersion: "ugv.zmq-command-diagnostic/1";
  stage: ExchangeStage;
  code: string;
  elapsedMs: number;
  sendTimeoutMs: number;
  receiveTimeoutMs: number;
  sendAttempted: boolean | null;
  sendCompleted: boolean | null;
  sendCompletedAfterMs: number | null;
  receiveCompletedAfterMs: number | null;
  nativeErrorCode: string | null;
  validationCode: string | null;
  response: { frameCount: number; bytes: number; frameSha256: string[] } | null;
}

/** Existing explicit shared timeout remains valid. New site configuration can split both bounds. */
export function exchangeTimeouts(settings: ControlSettings) {
  return {
    sendMs:
      settings.transportSendTimeoutMs ??
      settings.transportTimeoutMs ??
      (settings.mode === "site_control" ? 1000 : 250),
    receiveMs:
      settings.transportReceiveTimeoutMs ??
      settings.transportTimeoutMs ??
      (settings.mode === "site_control" ? 2000 : 250),
  };
}

export function responseEvidence(
  frames: readonly Buffer[],
): NonNullable<TransportDiagnostic["response"]> {
  return {
    frameCount: frames.length,
    bytes: frames.reduce((n, f) => n + f.byteLength, 0),
    // Hash only; no arbitrary response text, credentials or unbounded bytes enter diagnostics.
    frameSha256: frames.slice(0, 8).map((f) => createHash("sha256").update(f).digest("hex")),
  };
}

export function safeFailureCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code =
    "code" in error
      ? error.code
      : error instanceof Error && /^ZMQ_[A-Z0-9_]{1,100}$/.test(error.message)
        ? error.message
        : null;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,100}$/.test(code) ? code : null;
}

export function failureDiagnostic(
  stage: ExchangeStage,
  error: unknown,
  initial: Omit<TransportDiagnostic, "stage" | "code" | "nativeErrorCode" | "validationCode">,
): TransportDiagnostic {
  const code = safeFailureCode(error);
  return {
    ...initial,
    stage,
    code:
      stage === "guard"
        ? "ZMQ_DISPATCH_REVOKED"
        : stage === "validate"
          ? "ZMQ_RESPONSE_INVALID"
          : code === "EAGAIN"
            ? stage === "send"
              ? "ZMQ_SEND_TIMEOUT"
              : "ZMQ_RECEIVE_TIMEOUT"
            : stage === "connect"
              ? "ZMQ_CONNECT_FAILED"
              : "ZMQ_TRANSPORT_FAILED",
    nativeErrorCode: stage === "validate" ? null : code,
    validationCode: stage === "validate" ? (code ?? "ZMQ_RESPONSE_SCHEMA_INVALID") : null,
  };
}

/** A wrapper failed without stage evidence. Preserve unknown send status and no error text. */
export function unobservedDispatchFailure(
  settings: ControlSettings,
  error: unknown,
  elapsedMs: number,
): TransportDiagnostic {
  const { sendMs, receiveMs } = exchangeTimeouts(settings);
  return {
    schemaVersion: "ugv.zmq-command-diagnostic/1",
    stage: "dispatch",
    code: "ZMQ_DISPATCH_FAILED",
    elapsedMs: Math.max(0, elapsedMs),
    sendTimeoutMs: sendMs,
    receiveTimeoutMs: receiveMs,
    sendAttempted: null,
    sendCompleted: null,
    sendCompletedAfterMs: null,
    receiveCompletedAfterMs: null,
    nativeErrorCode: safeFailureCode(error),
    validationCode: null,
    response: null,
  };
}
