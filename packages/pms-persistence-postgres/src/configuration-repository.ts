import type { QueryResultRow } from "pg";
import {
  configRevisionId,
  createConfigRevision,
  environmentId,
  PmsRepositoryError,
  type ConfigAck,
  type ConfigurationDefinition,
  type ConfigurationRepository,
  type ConfigurationTarget,
  type ConfigRevision,
  type ConfigRevisionId,
  type ConfigRevisionStatus,
  type NewConfigRevision,
  type Page,
  type PageRequest,
  type RevisionPrecondition,
  type SavePrecondition,
} from "../../pms-domain/src/index.js";
import {
  concurrencyConflict,
  isDatabaseError,
  json,
  mapWriteError,
  pageLimit,
  pageOffset,
  toPage,
  type PmsSqlClient,
} from "./shared.js";

interface DefinitionRow extends QueryResultRow {
  definition_id: string;
  environment: string;
  target_type: ConfigurationTarget["targetType"];
  target_id: string;
  config_group: string;
  data_id: string;
  schema_document: ConfigurationDefinition["schema"];
  default_content: ConfigurationDefinition["defaultContent"];
  secret_paths: string[];
  field_metadata: ConfigurationDefinition["fieldMetadata"];
  status: ConfigurationDefinition["status"];
}

interface RevisionRow extends QueryResultRow {
  revision_id: string;
  environment: string;
  target_type: ConfigurationTarget["targetType"];
  target_id: string;
  config_group: string;
  data_id: string;
  revision: string;
  checksum: string;
  apply_mode: ConfigRevision["applyMode"];
  status: ConfigRevision["status"];
  content: ConfigRevision["content"];
  created_at: Date;
}

interface AckRow extends QueryResultRow {
  ack_id: string;
  revision_id: string;
  runtime_instance_id: string;
  status: ConfigAck["status"];
  applied_checksum: string | null;
  reason_code: string | null;
  details: ConfigAck["details"];
  acknowledged_at: Date;
}

const TARGET_WHERE = `environment=$1 AND target_type=$2 AND target_id=$3
  AND config_group=$4 AND data_id=$5`;

export class PostgresConfigurationRepository implements ConfigurationRepository {
  constructor(private readonly db: PmsSqlClient) {}

  async getDefinition(target: ConfigurationTarget): Promise<ConfigurationDefinition | null> {
    const result = await this.db.query<DefinitionRow>(
      `SELECT definition_id,environment,target_type,target_id,config_group,data_id,
              schema_document,default_content,secret_paths,field_metadata,status
         FROM config_definition WHERE ${TARGET_WHERE}`,
      targetValues(target),
    );
    return result.rows[0] === undefined ? null : definitionFromRow(result.rows[0]);
  }

  async saveDefinition(
    value: ConfigurationDefinition,
    precondition: SavePrecondition,
  ): Promise<void> {
    const values = [
      value.definitionId,
      ...targetValues(value.target),
      json(value.schema),
      json(value.defaultContent),
      json(value.secretPaths),
      json(value.fieldMetadata),
      value.status,
    ];
    if (precondition.mode === "insert") {
      try {
        await this.db.query(
          `INSERT INTO config_definition(
             definition_id,environment,target_type,target_id,config_group,data_id,
             schema_document,default_content,secret_paths,field_metadata,status
           ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11)`,
          values,
        );
      } catch (error) {
        mapWriteError(error, "ConfigurationDefinition");
      }
      return;
    }
    const result = await this.db.query(
      `UPDATE config_definition
          SET schema_document=$7::jsonb,default_content=$8::jsonb,
              secret_paths=$9::jsonb,field_metadata=$10::jsonb,status=$11,
              updated_at=GREATEST(
                clock_timestamp(),date_trunc('milliseconds',updated_at)+interval '1 millisecond'
              )
        WHERE definition_id=$1
          AND updated_at>=$12 AND updated_at<$12+interval '1 millisecond'`,
      [...values, precondition.expectedUpdatedAt],
    );
    if (result.rowCount !== 1) throw concurrencyConflict("ConfigurationDefinition");
  }

  async getRevision(revisionId: ConfigRevisionId): Promise<ConfigRevision | null> {
    const result = await this.db.query<RevisionRow>(`${REVISION_SELECT} WHERE revision_id=$1`, [
      revisionId,
    ]);
    return result.rows[0] === undefined ? null : revisionFromRow(result.rows[0]);
  }

  async getPublishedRevision(target: ConfigurationTarget): Promise<ConfigRevision | null> {
    const result = await this.db.query<RevisionRow>(
      `${REVISION_SELECT} WHERE ${qualifiedTargetWhere("d")} AND r.status='published'`,
      targetValues(target),
    );
    return result.rows[0] === undefined ? null : revisionFromRow(result.rows[0]);
  }

  async listRevisions(
    target: ConfigurationTarget,
    page: PageRequest,
  ): Promise<Page<ConfigRevision>> {
    const result = await this.db.query<RevisionRow>(
      `${REVISION_SELECT}
        WHERE ${qualifiedTargetWhere("d")}
        ORDER BY r.revision DESC OFFSET $6 LIMIT $7`,
      [...targetValues(target), pageOffset(page), pageLimit(page) + 1],
    );
    return toPage(result.rows.map(revisionFromRow), page);
  }

  async createRevision(
    value: NewConfigRevision,
    precondition: RevisionPrecondition,
  ): Promise<ConfigRevision> {
    try {
      const result = await this.db.query<RevisionRow>(
        `WITH candidate AS (
           SELECT d.definition_id,COALESCE(max(r.revision),0)::bigint AS latest_revision
             FROM config_definition d
             LEFT JOIN config_revision r ON r.definition_id=d.definition_id
            WHERE ${qualifiedTargetWhere("d")}
            GROUP BY d.definition_id
         ), inserted AS (
           INSERT INTO config_revision(
             revision_id,definition_id,revision,checksum,apply_mode,status,
             content,created_by,created_at
           )
           SELECT $6,c.definition_id,c.latest_revision+1,$7,$8,'draft',$9::jsonb,$10,$11
             FROM candidate c
            WHERE ($12::bigint IS NULL AND c.latest_revision=0)
               OR c.latest_revision=$12
           RETURNING *
         )
         SELECT i.revision_id,d.environment,d.target_type,d.target_id,d.config_group,d.data_id,
                i.revision,i.checksum,i.apply_mode,i.status,i.content,i.created_at
           FROM inserted i JOIN config_definition d USING (definition_id)`,
        [
          ...targetValues(value.target),
          value.revisionId,
          value.checksum,
          value.applyMode,
          json(value.content),
          value.createdBy,
          value.createdAt,
          precondition.expectedRevision,
        ],
      );
      const row = result.rows[0];
      if (row === undefined) throw concurrencyConflict("ConfigRevision");
      return revisionFromRow(row);
    } catch (error) {
      if (error instanceof PmsRepositoryError) throw error;
      if (isDatabaseError(error) && error.code === "23505") {
        throw concurrencyConflict("ConfigRevision");
      }
      throw error;
    }
  }

  async transitionRevision(
    revisionId: ConfigRevisionId,
    targetStatus: ConfigRevisionStatus,
    expectedStatus: ConfigRevisionStatus,
  ): Promise<ConfigRevision> {
    const result = await this.db.query<RevisionRow>(
      `WITH updated AS (
         UPDATE config_revision
            SET status=$2,
                published_at=CASE WHEN $2='published' THEN clock_timestamp() ELSE published_at END
          WHERE revision_id=$1 AND status=$3
          RETURNING *
       )
       SELECT u.revision_id,d.environment,d.target_type,d.target_id,d.config_group,d.data_id,
              u.revision,u.checksum,u.apply_mode,u.status,u.content,u.created_at
         FROM updated u JOIN config_definition d USING (definition_id)`,
      [revisionId, targetStatus, expectedStatus],
    );
    const row = result.rows[0];
    if (row === undefined) throw concurrencyConflict("ConfigRevision");
    return revisionFromRow(row);
  }

  async appendAck(value: ConfigAck): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO config_ack(
           ack_id,revision_id,runtime_instance_id,status,applied_checksum,
           reason_code,details,acknowledged_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [
          value.ackId,
          value.revisionId,
          value.runtimeInstanceId,
          value.status,
          value.appliedChecksum ?? null,
          value.reasonCode ?? null,
          json(value.details),
          value.acknowledgedAt,
        ],
      );
    } catch (error) {
      mapWriteError(error, "ConfigAck");
    }
  }

  async listAcks(revisionId: ConfigRevisionId, page: PageRequest): Promise<Page<ConfigAck>> {
    const result = await this.db.query<AckRow>(
      `SELECT ack_id,revision_id,runtime_instance_id,status,applied_checksum,
              reason_code,details,acknowledged_at
         FROM config_ack WHERE revision_id=$1
        ORDER BY acknowledged_at,ack_id OFFSET $2 LIMIT $3`,
      [revisionId, pageOffset(page), pageLimit(page) + 1],
    );
    return toPage(result.rows.map(ackFromRow), page);
  }
}

const REVISION_SELECT = `SELECT r.revision_id,d.environment,d.target_type,d.target_id,
  d.config_group,d.data_id,r.revision,r.checksum,r.apply_mode,r.status,r.content,r.created_at
  FROM config_revision r JOIN config_definition d USING (definition_id)`;

function qualifiedTargetWhere(alias: string): string {
  return `${alias}.environment=$1 AND ${alias}.target_type=$2 AND ${alias}.target_id=$3
    AND ${alias}.config_group=$4 AND ${alias}.data_id=$5`;
}

function targetValues(target: ConfigurationTarget): unknown[] {
  return [
    target.environment,
    target.targetType,
    target.targetId,
    target.configGroup,
    target.dataId,
  ];
}

function definitionFromRow(row: DefinitionRow): ConfigurationDefinition {
  return Object.freeze({
    definitionId: row.definition_id,
    target: Object.freeze({
      environment: environmentId(row.environment),
      targetType: row.target_type,
      targetId: row.target_id,
      configGroup: row.config_group,
      dataId: row.data_id,
    }),
    schema: Object.freeze({ ...row.schema_document }),
    defaultContent: Object.freeze({ ...row.default_content }),
    secretPaths: Object.freeze([...row.secret_paths]),
    fieldMetadata: Object.freeze({ ...row.field_metadata }),
    status: row.status,
  });
}

function revisionFromRow(row: RevisionRow): ConfigRevision {
  return createConfigRevision({
    revisionId: configRevisionId(row.revision_id),
    target: {
      environment: environmentId(row.environment),
      targetType: row.target_type,
      targetId: row.target_id,
      configGroup: row.config_group,
      dataId: row.data_id,
    },
    revision: Number(row.revision),
    checksum: row.checksum,
    applyMode: row.apply_mode,
    status: row.status,
    content: row.content,
    createdAt: row.created_at,
  });
}

function ackFromRow(row: AckRow): ConfigAck {
  return Object.freeze({
    ackId: row.ack_id,
    revisionId: configRevisionId(row.revision_id),
    runtimeInstanceId: row.runtime_instance_id,
    status: row.status,
    ...(row.applied_checksum === null ? {} : { appliedChecksum: row.applied_checksum }),
    ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
    details: Object.freeze({ ...row.details }),
    acknowledgedAt: new Date(row.acknowledged_at),
  });
}
