export interface RuntimeTaskStateCount {
  readonly internal_state: string;
  readonly count: string | number;
}

export interface RuntimeTaskStateSummary {
  readonly active: number;
  readonly uncertain: number;
}

export interface RuntimeAdmissionStateSummary {
  readonly active: string | number;
  readonly uncertain: string | number;
}

const UNCERTAIN_INTERNAL_STATES = new Set(["WAITING_START_CONFIRMATION"]);

export function summarizeRuntimeTaskStates(
  rows: readonly RuntimeTaskStateCount[],
  admission: RuntimeAdmissionStateSummary = { active: 0, uncertain: 0 },
): RuntimeTaskStateSummary {
  let active = parseCount(admission.active);
  let uncertain = parseCount(admission.uncertain);
  for (const row of rows) {
    const count = parseCount(row.count);
    if (!row.internal_state.startsWith("TERMINAL_")) active += count;
    if (UNCERTAIN_INTERNAL_STATES.has(row.internal_state)) uncertain += count;
  }
  if (!Number.isSafeInteger(active) || !Number.isSafeInteger(uncertain)) {
    throw new Error("RUNTIME_TASK_STATE_COUNT_INVALID");
  }
  return Object.freeze({ active, uncertain });
}

function parseCount(value: string | number): number {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("RUNTIME_TASK_STATE_COUNT_INVALID");
  }
  return count;
}
