import type { QueryResultRow } from "pg";
import {
  createDatabaseProfile,
  databaseProfileId,
  environmentId,
  providerId,
  secretRef,
  type DatabaseProfile,
} from "../../pms-domain/src/index.js";
import { concurrencyConflict, mapWriteError, type PmsSqlClient } from "./shared.js";

export type DatabaseProvisionStatus = "pending" | "provisioning" | "ready" | "failed";

export interface DatabaseProfileRecord {
  readonly profile: DatabaseProfile;
  readonly provisionStatus: DatabaseProvisionStatus;
  readonly lastErrorCode?: string;
  readonly provisionedAt?: Date;
  readonly createdAuditEventId: string;
  readonly lastAuditEventId: string;
  readonly revision: number;
}

export interface DatabaseProvisionResultUpdate {
  readonly profileId: string;
  readonly providerId: string;
  readonly environment: string;
  readonly status: DatabaseProvisionStatus;
  readonly lastErrorCode?: string;
  readonly provisionedAt?: Date;
  readonly auditEventId: string;
  readonly expectedRevision: number;
}

interface DatabaseProfileRow extends QueryResultRow {
  profile_id: string;
  provider_id: string;
  environment: string;
  cluster_ref: string;
  host: string;
  port: number;
  database_mode: DatabaseProfile["databaseMode"];
  database_name: string;
  runtime_role_name: string;
  ssl_mode: DatabaseProfile["sslMode"];
  admin_secret_ref: string;
  runtime_secret_ref: string;
  provision_status: DatabaseProvisionStatus;
  last_error_code: string | null;
  provisioned_at: Date | null;
  created_audit_event_id: string;
  last_audit_event_id: string;
  revision: string;
}

export class PostgresDatabaseProfileRepository {
  constructor(private readonly db: PmsSqlClient) {}

  async get(
    providerScope: string,
    environmentScope: string,
  ): Promise<DatabaseProfileRecord | null> {
    const result = await this.db.query<DatabaseProfileRow>(
      `${profileSelect()}
        WHERE provider_id=$1 AND environment=$2`,
      [providerScope, environmentScope],
    );
    return result.rows[0] === undefined ? null : profileFromRow(result.rows[0]);
  }

  async insert(profile: DatabaseProfile, auditEventId: string): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO database_profile(
           profile_id,provider_id,environment,cluster_ref,host,port,database_mode,
           database_name,runtime_role_name,ssl_mode,admin_secret_ref,runtime_secret_ref,
           created_audit_event_id,last_audit_event_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
        [
          profile.profileId,
          profile.providerId,
          profile.environment,
          profile.clusterRef,
          profile.host,
          profile.port,
          profile.databaseMode,
          profile.databaseName,
          profile.runtimeRoleName,
          profile.sslMode,
          profile.adminSecretRef.secretRef,
          profile.runtimeSecretRef.secretRef,
          auditEventId,
        ],
      );
    } catch (error) {
      mapWriteError(error, "DatabaseProfile");
    }
  }

  async updateProvisionResult(
    update: DatabaseProvisionResultUpdate,
  ): Promise<DatabaseProfileRecord> {
    const result = await this.db.query(
      `UPDATE database_profile
          SET provision_status=$4,last_error_code=$5,provisioned_at=$6,
              last_audit_event_id=$7,revision=revision+1,
              updated_at=GREATEST(
                clock_timestamp(),date_trunc('milliseconds',updated_at)+interval '1 millisecond'
              )
        WHERE profile_id=$1 AND provider_id=$2 AND environment=$3 AND revision=$8`,
      [
        update.profileId,
        update.providerId,
        update.environment,
        update.status,
        update.lastErrorCode ?? null,
        update.provisionedAt ?? null,
        update.auditEventId,
        update.expectedRevision,
      ],
    );
    if (result.rowCount !== 1) throw concurrencyConflict("DatabaseProfile");
    const current = await this.get(update.providerId, update.environment);
    if (current === null || current.profile.profileId !== update.profileId) {
      throw concurrencyConflict("DatabaseProfile");
    }
    return current;
  }
}

function profileSelect(): string {
  return `SELECT profile_id,provider_id,environment,cluster_ref,host,port,database_mode,
                 database_name,runtime_role_name,ssl_mode,admin_secret_ref,runtime_secret_ref,
                 provision_status,last_error_code,provisioned_at,created_audit_event_id,
                 last_audit_event_id,revision
            FROM database_profile`;
}

function profileFromRow(row: DatabaseProfileRow): DatabaseProfileRecord {
  return Object.freeze({
    profile: createDatabaseProfile({
      profileId: databaseProfileId(row.profile_id),
      providerId: providerId(row.provider_id),
      environment: environmentId(row.environment),
      clusterRef: row.cluster_ref,
      host: row.host,
      port: row.port,
      databaseMode: row.database_mode,
      sslMode: row.ssl_mode,
      adminSecretRef: secretRef(row.admin_secret_ref),
      runtimeSecretRef: secretRef(row.runtime_secret_ref),
    }),
    provisionStatus: row.provision_status,
    ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code }),
    ...(row.provisioned_at === null ? {} : { provisionedAt: new Date(row.provisioned_at) }),
    createdAuditEventId: row.created_audit_event_id,
    lastAuditEventId: row.last_audit_event_id,
    revision: Number(row.revision),
  });
}
