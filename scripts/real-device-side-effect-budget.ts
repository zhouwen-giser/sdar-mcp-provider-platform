import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

interface Reservation {
  readonly reservationId: string;
  readonly scope: string;
  readonly resourceId: string;
  readonly kind: string;
  readonly reservedAt: string;
}

interface RunBudget {
  readonly globalLimit: number;
  readonly reservations: Record<string, Reservation>;
}

interface BudgetDocument {
  readonly version: 1;
  readonly runs: Record<string, RunBudget>;
}

export interface SideEffectBudgetRequest {
  readonly runId: string;
  readonly reservationId: string;
  readonly scope: string;
  readonly resourceId: string;
  readonly kind: string;
  readonly limit: number;
  readonly globalLimit: number;
  readonly now?: () => number;
}

export interface SideEffectBudgetReservation {
  readonly count: number;
  readonly globalCount: number;
  readonly alreadyReserved: boolean;
}

export function reserveSideEffectBudget(
  path: string,
  request: SideEffectBudgetRequest,
): SideEffectBudgetReservation {
  validateRequest(request);
  mkdirSync(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  let lock: number;
  try {
    lock = openSync(lockPath, "wx", 0o600);
  } catch {
    throw new Error("REAL_DEVICE_SIDE_EFFECT_BUDGET_LOCKED");
  }
  try {
    const document = readDocument(path);
    const run = document.runs[request.runId] ?? {
      globalLimit: request.globalLimit,
      reservations: {},
    };
    if (run.globalLimit !== request.globalLimit)
      throw new Error("REAL_DEVICE_GLOBAL_SIDE_EFFECT_BUDGET_CONFLICT");
    const existing = run.reservations[request.reservationId];
    if (existing !== undefined) {
      if (!sameReservation(existing, request))
        throw new Error("REAL_DEVICE_SIDE_EFFECT_RESERVATION_CONFLICT");
      return {
        count: countReservations(run, request),
        globalCount: Object.keys(run.reservations).length,
        alreadyReserved: true,
      };
    }
    const count = countReservations(run, request);
    const globalCount = Object.keys(run.reservations).length;
    if (globalCount >= run.globalLimit)
      throw new Error("REAL_DEVICE_GLOBAL_SIDE_EFFECT_BUDGET_EXCEEDED");
    if (count >= request.limit) throw new Error("REAL_DEVICE_SIDE_EFFECT_BUDGET_EXCEEDED");
    const reservation: Reservation = {
      reservationId: request.reservationId,
      scope: request.scope,
      resourceId: request.resourceId,
      kind: request.kind,
      reservedAt: new Date((request.now ?? Date.now)()).toISOString(),
    };
    const next: BudgetDocument = {
      version: 1,
      runs: {
        ...document.runs,
        [request.runId]: {
          globalLimit: run.globalLimit,
          reservations: { ...run.reservations, [request.reservationId]: reservation },
        },
      },
    };
    writeDocument(path, next);
    return { count: count + 1, globalCount: globalCount + 1, alreadyReserved: false };
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}

function readDocument(path: string): BudgetDocument {
  if (!existsSync(path)) return { version: 1, runs: {} };
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("INVALID_REAL_DEVICE_SIDE_EFFECT_BUDGET_FILE");
  }
  if (!validDocument(value)) throw new Error("INVALID_REAL_DEVICE_SIDE_EFFECT_BUDGET_FILE");
  return value;
}

function writeDocument(path: string, document: BudgetDocument): void {
  const temporary = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, path);
}

function countReservations(run: RunBudget, request: SideEffectBudgetRequest): number {
  return Object.values(run.reservations).filter(
    (reservation) =>
      reservation.scope === request.scope &&
      reservation.resourceId === request.resourceId &&
      reservation.kind === request.kind,
  ).length;
}

function sameReservation(existing: Reservation, request: SideEffectBudgetRequest): boolean {
  return (
    existing.scope === request.scope &&
    existing.resourceId === request.resourceId &&
    existing.kind === request.kind
  );
}

function validateRequest(request: SideEffectBudgetRequest): void {
  if (
    !request.runId ||
    !request.reservationId ||
    !request.scope ||
    !request.resourceId ||
    !request.kind ||
    !Number.isInteger(request.limit) ||
    request.limit < 1 ||
    !Number.isInteger(request.globalLimit) ||
    request.globalLimit < request.limit
  )
    throw new Error("REAL_DEVICE_SIDE_EFFECT_BUDGET_REQUEST_INVALID");
}

function validDocument(value: unknown): value is BudgetDocument {
  if (!record(value) || value.version !== 1 || !record(value.runs)) return false;
  return Object.entries(value.runs).every(
    ([runId, run]) =>
      runId.length > 0 &&
      record(run) &&
      Number.isInteger(run.globalLimit) &&
      Number(run.globalLimit) > 0 &&
      record(run.reservations) &&
      Object.keys(run.reservations).length <= Number(run.globalLimit) &&
      Object.entries(run.reservations).every(
        ([reservationId, reservation]) =>
          reservationId.length > 0 &&
          record(reservation) &&
          reservation.reservationId === reservationId &&
          typeof reservation.scope === "string" &&
          reservation.scope.length > 0 &&
          typeof reservation.resourceId === "string" &&
          reservation.resourceId.length > 0 &&
          typeof reservation.kind === "string" &&
          reservation.kind.length > 0 &&
          typeof reservation.reservedAt === "string" &&
          Number.isFinite(Date.parse(reservation.reservedAt)),
      ),
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
