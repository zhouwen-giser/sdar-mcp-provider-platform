import type { Pool } from "pg";
import {
  runMigrations,
  type RuntimeMigrationEngineOptions,
  type RuntimeMigrationEngineResult,
} from "../../persistence-postgres/src/index.js";

export interface RuntimeMigrationRequest {
  readonly deploymentId: string;
  readonly providerId: string;
  readonly runtimeVersion: string;
  readonly migrationSet: string;
}

export interface RuntimeMigrationEvidence {
  readonly status: "PASS" | "FAIL";
  readonly deploymentId: string;
  readonly providerId: string;
  readonly runtimeVersion: string;
  readonly migrationSet: "runtime";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly migrations: readonly {
    readonly version: string;
    readonly checksum: string;
    readonly outcome: "applied" | "already_applied" | "present_after_failure";
  }[];
  readonly error?: {
    readonly code: RuntimeMigrationErrorCode;
    readonly retryable: boolean;
  };
}

export type RuntimeMigrationErrorCode =
  | "RUNTIME_MIGRATION_VERSION_UNSUPPORTED"
  | "RUNTIME_MIGRATION_SET_INVALID"
  | "RUNTIME_MIGRATION_TIMEOUT"
  | "RUNTIME_MIGRATION_CHECKSUM_MISMATCH"
  | "RUNTIME_MIGRATION_DATABASE_UNAVAILABLE"
  | "RUNTIME_MIGRATION_EXECUTION_FAILED";

export class RuntimeMigrationRunnerError extends Error {
  readonly code: RuntimeMigrationErrorCode;
  readonly retryable: boolean;
  readonly evidence: RuntimeMigrationEvidence;

  constructor(code: RuntimeMigrationErrorCode, evidence: RuntimeMigrationEvidence) {
    super(code);
    this.name = "RuntimeMigrationRunnerError";
    this.code = code;
    this.retryable = retryable(code);
    this.evidence = evidence;
  }
}

export type RuntimeMigrationEngine = (
  pool: Pool,
  compatibilityDirectory: undefined,
  options: RuntimeMigrationEngineOptions,
) => Promise<RuntimeMigrationEngineResult>;

export interface RuntimeMigrationRunnerOptions {
  readonly supportedRuntimeVersions: readonly string[];
  readonly timeoutMs: number;
  readonly workspaceRoot: string;
  readonly now?: () => Date;
  readonly engine?: RuntimeMigrationEngine;
}

export class RuntimeMigrationRunner {
  readonly #supportedRuntimeVersions: ReadonlySet<string>;
  readonly #timeoutMs: number;
  readonly #now: () => Date;
  readonly #engine: RuntimeMigrationEngine;
  readonly #workspaceRoot: string;

  constructor(
    private readonly pool: Pool,
    options: RuntimeMigrationRunnerOptions,
  ) {
    this.#supportedRuntimeVersions = new Set(options.supportedRuntimeVersions);
    if (this.#supportedRuntimeVersions.size === 0) {
      throw new TypeError("supportedRuntimeVersions must not be empty");
    }
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
      throw new TypeError("timeoutMs must be a positive integer");
    }
    this.#timeoutMs = options.timeoutMs;
    this.#workspaceRoot = options.workspaceRoot;
    this.#now = options.now ?? (() => new Date());
    this.#engine = options.engine ?? runMigrations;
  }

  async run(request: RuntimeMigrationRequest): Promise<RuntimeMigrationEvidence> {
    validateRequest(request);
    const started = this.#now();
    if (request.migrationSet !== "runtime") {
      throw await this.#failure(request, started, "RUNTIME_MIGRATION_SET_INVALID");
    }
    if (!this.#supportedRuntimeVersions.has(request.runtimeVersion)) {
      throw await this.#failure(request, started, "RUNTIME_MIGRATION_VERSION_UNSUPPORTED");
    }
    try {
      const result = await this.#engine(this.pool, undefined, {
        timeoutMs: this.#timeoutMs,
        workspaceRoot: this.#workspaceRoot,
      });
      const completed = this.#now();
      return freezeEvidence({
        status: "PASS",
        deploymentId: request.deploymentId,
        providerId: request.providerId,
        runtimeVersion: request.runtimeVersion,
        migrationSet: "runtime",
        startedAt: started.toISOString(),
        completedAt: completed.toISOString(),
        durationMs: Math.max(0, completed.getTime() - started.getTime()),
        migrations: result.migrations,
      });
    } catch (error) {
      if (error instanceof RuntimeMigrationRunnerError) throw error;
      throw await this.#failure(request, started, classify(error));
    }
  }

  async #failure(
    request: RuntimeMigrationRequest,
    started: Date,
    code: RuntimeMigrationErrorCode,
  ): Promise<RuntimeMigrationRunnerError> {
    const completed = this.#now();
    const migrations = await inspectHistory(this.pool);
    const evidence = freezeEvidence({
      status: "FAIL",
      deploymentId: request.deploymentId,
      providerId: request.providerId,
      runtimeVersion: request.runtimeVersion,
      migrationSet: "runtime",
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      durationMs: Math.max(0, completed.getTime() - started.getTime()),
      migrations,
      error: { code, retryable: retryable(code) },
    });
    return new RuntimeMigrationRunnerError(code, evidence);
  }
}

async function inspectHistory(pool: Pool): Promise<RuntimeMigrationEvidence["migrations"]> {
  try {
    const exists = await pool.query<{ present: boolean }>(
      "SELECT to_regclass('runtime_schema_migration') IS NOT NULL AS present",
    );
    if (exists.rows[0]?.present !== true) return Object.freeze([]);
    const result = await pool.query<{ version: string; checksum: string }>(
      "SELECT version,checksum FROM runtime_schema_migration ORDER BY version",
    );
    return Object.freeze(
      result.rows.map(({ version, checksum }) =>
        Object.freeze({
          version,
          checksum,
          outcome: "present_after_failure" as const,
        }),
      ),
    );
  } catch {
    return Object.freeze([]);
  }
}

function validateRequest(request: RuntimeMigrationRequest): void {
  for (const value of [request.deploymentId, request.providerId]) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
      throw new TypeError("Runtime migration request identifier is invalid");
    }
  }
  if (request.runtimeVersion.trim().length === 0) {
    throw new TypeError("Runtime migration version is invalid");
  }
}

function classify(error: unknown): RuntimeMigrationErrorCode {
  const message = error instanceof Error ? error.message : "";
  const code = databaseErrorCode(error);
  if (message.startsWith("MIGRATION_CHECKSUM_MISMATCH:")) {
    return "RUNTIME_MIGRATION_CHECKSUM_MISMATCH";
  }
  if (code === "57014" || /statement timeout/i.test(message)) {
    return "RUNTIME_MIGRATION_TIMEOUT";
  }
  if (
    code === "57P03" ||
    code === "08000" ||
    code === "08001" ||
    code === "08003" ||
    code === "08006"
  ) {
    return "RUNTIME_MIGRATION_DATABASE_UNAVAILABLE";
  }
  return "RUNTIME_MIGRATION_EXECUTION_FAILED";
}

function retryable(code: RuntimeMigrationErrorCode): boolean {
  return code === "RUNTIME_MIGRATION_TIMEOUT" || code === "RUNTIME_MIGRATION_DATABASE_UNAVAILABLE";
}

function databaseErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function freezeEvidence(evidence: RuntimeMigrationEvidence): RuntimeMigrationEvidence {
  return Object.freeze({
    ...evidence,
    migrations: Object.freeze(
      evidence.migrations.map((migration) => Object.freeze({ ...migration })),
    ),
    ...(evidence.error === undefined ? {} : { error: Object.freeze({ ...evidence.error }) }),
  });
}
