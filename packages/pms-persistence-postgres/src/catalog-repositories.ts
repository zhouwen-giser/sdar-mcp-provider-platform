import type { QueryResultRow } from "pg";
import {
  createProvider,
  createProviderPackage,
  createProviderType,
  createResource,
  environmentId,
  providerId,
  providerPackageId,
  providerTypeId,
  resourceId,
  type LastModifiedPrecondition,
  type JsonObject,
  type Page,
  type Provider,
  type ProviderPackage,
  type ProviderPackageKey,
  type ProviderPackageQuery,
  type ProviderPackageRepository,
  type ProviderQuery,
  type ProviderRepository,
  type ProviderResourceBinding,
  type ProviderResourceBindingRepository,
  type ProviderType,
  type ProviderTypeQuery,
  type ProviderTypeRepository,
  type Resource,
  type ResourceKey,
  type ResourceQuery,
  type ResourceRepository,
  type SavePrecondition,
} from "../../pms-domain/src/index.js";
import {
  concurrencyConflict,
  json,
  mapWriteError,
  pageLimit,
  pageOffset,
  toPage,
  type PmsSqlClient,
} from "./shared.js";

interface ProviderTypeRow extends QueryResultRow {
  provider_type_id: string;
  display_name: string;
  status: ProviderType["status"];
}

export class PostgresProviderTypeRepository implements ProviderTypeRepository {
  constructor(private readonly db: PmsSqlClient) {}

  async get(id: ProviderType["providerTypeId"]): Promise<ProviderType | null> {
    const result = await this.db.query<ProviderTypeRow>(
      `SELECT provider_type_id,display_name,status FROM provider_type WHERE provider_type_id=$1`,
      [id],
    );
    return result.rows[0] === undefined ? null : providerTypeFromRow(result.rows[0]);
  }

  async list(query: ProviderTypeQuery): Promise<Page<ProviderType>> {
    const result = await this.db.query<ProviderTypeRow>(
      `SELECT provider_type_id,display_name,status
         FROM provider_type
        WHERE ($1::text IS NULL OR status=$1)
        ORDER BY provider_type_id
        OFFSET $2 LIMIT $3`,
      [query.status ?? null, pageOffset(query), pageLimit(query) + 1],
    );
    return toPage(result.rows.map(providerTypeFromRow), query);
  }

  async save(value: ProviderType, precondition: SavePrecondition): Promise<void> {
    if (precondition.mode === "insert") {
      try {
        await this.db.query(
          `INSERT INTO provider_type(provider_type_id,display_name,status) VALUES ($1,$2,$3)`,
          [value.providerTypeId, value.displayName, value.status],
        );
      } catch (error) {
        mapWriteError(error, "ProviderType");
      }
      return;
    }
    const result = await this.db.query(
      `UPDATE provider_type
          SET display_name=$2,status=$3,
              updated_at=GREATEST(
                clock_timestamp(),date_trunc('milliseconds',updated_at)+interval '1 millisecond'
              )
        WHERE provider_type_id=$1
          AND updated_at>=$4 AND updated_at<$4+interval '1 millisecond'`,
      [value.providerTypeId, value.displayName, value.status, precondition.expectedUpdatedAt],
    );
    if (result.rowCount !== 1) throw concurrencyConflict("ProviderType");
  }
}

interface ProviderPackageRow extends QueryResultRow {
  package_id: string;
  package_version: string;
  provider_type_id: string;
  hosting_modes: ProviderPackage["hostingModes"];
  checksum: string;
  status: ProviderPackage["status"];
  source_document: ProviderPackage["sourceDocument"];
  updated_at: Date;
}

export class PostgresProviderPackageRepository implements ProviderPackageRepository {
  constructor(private readonly db: PmsSqlClient) {}

  async get(key: ProviderPackageKey): Promise<ProviderPackage | null> {
    const result = await this.db.query<ProviderPackageRow>(
      `SELECT package_id,package_version,provider_type_id,hosting_modes,checksum,status,
              source_document,updated_at
         FROM provider_package WHERE package_id=$1 AND package_version=$2`,
      [key.packageId, key.packageVersion],
    );
    return result.rows[0] === undefined ? null : providerPackageFromRow(result.rows[0]);
  }

  async list(query: ProviderPackageQuery): Promise<Page<ProviderPackage>> {
    const result = await this.db.query<ProviderPackageRow>(
      `SELECT package_id,package_version,provider_type_id,hosting_modes,checksum,status,
              source_document,updated_at
         FROM provider_package
        WHERE ($1::text IS NULL OR provider_type_id=$1)
          AND ($2::text IS NULL OR status=$2)
        ORDER BY package_id,package_version
        OFFSET $3 LIMIT $4`,
      [query.providerTypeId ?? null, query.status ?? null, pageOffset(query), pageLimit(query) + 1],
    );
    return toPage(result.rows.map(providerPackageFromRow), query);
  }

  async save(value: ProviderPackage, precondition: SavePrecondition): Promise<void> {
    const source = value.sourceDocument ?? {};
    const adapter = objectField(source, "adapter");
    const qualification = objectField(source, "qualification");
    const runtime = objectField(source, "runtime");
    const packageDocument = [
      value.packageId,
      value.packageVersion,
      value.providerTypeId,
      value.hostingModes,
      json(adapter),
      json({ id: stringField(adapter, "configSchemaId") }),
      stringField(adapter, "migrationSet"),
      json({ ...qualification, runtime }),
      value.checksum,
      value.status,
      json(source),
    ];
    if (precondition.mode === "insert") {
      try {
        await this.db.query(
          `INSERT INTO provider_package(
             package_id,package_version,provider_type_id,hosting_modes,adapter_entry,
             config_schema,migration_set,qualification,checksum,status,source_document
           ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb,$9,$10,$11::jsonb)`,
          packageDocument,
        );
      } catch (error) {
        mapWriteError(error, "ProviderPackage");
      }
      return;
    }
    const result = await this.db.query(
      `UPDATE provider_package
          SET hosting_modes=$4,adapter_entry=$5::jsonb,config_schema=$6::jsonb,
              migration_set=$7,qualification=$8::jsonb,checksum=$9,status=$10,
              source_document=$11::jsonb,
              updated_at=GREATEST(
                clock_timestamp(),date_trunc('milliseconds',updated_at)+interval '1 millisecond'
              )
        WHERE package_id=$1 AND package_version=$2 AND provider_type_id=$3
          AND updated_at>=$12 AND updated_at<$12+interval '1 millisecond'`,
      [...packageDocument, precondition.expectedUpdatedAt],
    );
    if (result.rowCount !== 1) throw concurrencyConflict("ProviderPackage");
  }
}

interface ProviderRow extends QueryResultRow {
  provider_id: string;
  provider_type_id: string;
  package_id: string | null;
  package_version: string | null;
  hosting_mode: Provider["hostingMode"];
  adapter_endpoint: string | null;
  status: Provider["status"];
}

export class PostgresProviderRepository implements ProviderRepository {
  constructor(private readonly db: PmsSqlClient) {}

  async get(id: Provider["providerId"]): Promise<Provider | null> {
    const result = await this.db.query<ProviderRow>(
      `SELECT provider_id,provider_type_id,package_id,package_version,
              hosting_mode,adapter_endpoint,status
         FROM provider WHERE provider_id=$1`,
      [id],
    );
    return result.rows[0] === undefined ? null : providerFromRow(result.rows[0]);
  }

  async list(query: ProviderQuery): Promise<Page<Provider>> {
    const result = await this.db.query<ProviderRow>(
      `SELECT provider_id,provider_type_id,package_id,package_version,
              hosting_mode,adapter_endpoint,status
         FROM provider
        WHERE ($1::text IS NULL OR provider_type_id=$1)
          AND ($2::text IS NULL OR hosting_mode=$2)
          AND ($3::text IS NULL OR status=$3)
        ORDER BY provider_id OFFSET $4 LIMIT $5`,
      [
        query.providerTypeId ?? null,
        query.hostingMode ?? null,
        query.status ?? null,
        pageOffset(query),
        pageLimit(query) + 1,
      ],
    );
    return toPage(result.rows.map(providerFromRow), query);
  }

  async insert(value: Provider): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO provider(
           provider_id,provider_type_id,package_id,package_version,
           hosting_mode,adapter_endpoint,status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        providerValues(value),
      );
    } catch (error) {
      mapWriteError(error, "Provider");
    }
  }

  async update(value: Provider, precondition: LastModifiedPrecondition): Promise<void> {
    const result = await this.db.query(
      `UPDATE provider
          SET provider_type_id=$2,package_id=$3,package_version=$4,
              hosting_mode=$5,adapter_endpoint=$6,status=$7,
              updated_at=GREATEST(
                clock_timestamp(),date_trunc('milliseconds',updated_at)+interval '1 millisecond'
              )
        WHERE provider_id=$1
          AND updated_at>=$8 AND updated_at<$8+interval '1 millisecond'`,
      [...providerValues(value), precondition.expectedUpdatedAt],
    );
    if (result.rowCount !== 1) throw concurrencyConflict("Provider");
  }
}

interface ResourceRow extends QueryResultRow {
  environment: string;
  resource_id: string;
  resource_type: string;
  metadata: Resource["metadata"];
  status: Resource["status"];
}

export class PostgresResourceRepository implements ResourceRepository {
  constructor(private readonly db: PmsSqlClient) {}

  async get(key: ResourceKey): Promise<Resource | null> {
    const result = await this.db.query<ResourceRow>(
      `SELECT environment,resource_id,resource_type,metadata,status
         FROM resource WHERE environment=$1 AND resource_id=$2`,
      [key.environment, key.resourceId],
    );
    return result.rows[0] === undefined ? null : resourceFromRow(result.rows[0]);
  }

  async list(query: ResourceQuery): Promise<Page<Resource>> {
    const result = await this.db.query<ResourceRow>(
      `SELECT environment,resource_id,resource_type,metadata,status
         FROM resource
        WHERE environment=$1
          AND ($2::text IS NULL OR resource_type=$2)
          AND ($3::text IS NULL OR status=$3)
        ORDER BY resource_id OFFSET $4 LIMIT $5`,
      [
        query.environment,
        query.resourceType ?? null,
        query.status ?? null,
        pageOffset(query),
        pageLimit(query) + 1,
      ],
    );
    return toPage(result.rows.map(resourceFromRow), query);
  }

  async insert(value: Resource): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO resource(environment,resource_id,resource_type,metadata,status)
         VALUES ($1,$2,$3,$4::jsonb,$5)`,
        resourceValues(value),
      );
    } catch (error) {
      mapWriteError(error, "Resource");
    }
  }

  async update(value: Resource, precondition: LastModifiedPrecondition): Promise<void> {
    const result = await this.db.query(
      `UPDATE resource
          SET resource_type=$3,metadata=$4::jsonb,status=$5,
              updated_at=GREATEST(
                clock_timestamp(),date_trunc('milliseconds',updated_at)+interval '1 millisecond'
              )
        WHERE environment=$1 AND resource_id=$2
          AND updated_at>=$6 AND updated_at<$6+interval '1 millisecond'`,
      [...resourceValues(value), precondition.expectedUpdatedAt],
    );
    if (result.rowCount !== 1) throw concurrencyConflict("Resource");
  }
}

interface BindingRow extends QueryResultRow {
  provider_id: string;
  environment: string;
  resource_id: string;
  bound_at: Date;
}

export class PostgresProviderResourceBindingRepository implements ProviderResourceBindingRepository {
  constructor(private readonly db: PmsSqlClient) {}

  async bind(value: ProviderResourceBinding): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO provider_resource_binding(provider_id,environment,resource_id,bound_at)
         VALUES ($1,$2,$3,$4)`,
        [value.providerId, value.environment, value.resourceId, value.boundAt],
      );
    } catch (error) {
      mapWriteError(error, "ProviderResourceBinding");
    }
  }

  async unbind(provider: Provider["providerId"], key: ResourceKey): Promise<void> {
    const result = await this.db.query(
      `DELETE FROM provider_resource_binding
        WHERE provider_id=$1 AND environment=$2 AND resource_id=$3`,
      [provider, key.environment, key.resourceId],
    );
    if (result.rowCount !== 1) throw concurrencyConflict("ProviderResourceBinding");
  }

  async listByProvider(
    provider: Provider["providerId"],
  ): Promise<readonly ProviderResourceBinding[]> {
    const result = await this.db.query<BindingRow>(
      `SELECT provider_id,environment,resource_id,bound_at
         FROM provider_resource_binding WHERE provider_id=$1
        ORDER BY environment,resource_id`,
      [provider],
    );
    return result.rows.map(bindingFromRow);
  }

  async listByResource(key: ResourceKey): Promise<readonly ProviderResourceBinding[]> {
    const result = await this.db.query<BindingRow>(
      `SELECT provider_id,environment,resource_id,bound_at
         FROM provider_resource_binding WHERE environment=$1 AND resource_id=$2
        ORDER BY provider_id`,
      [key.environment, key.resourceId],
    );
    return result.rows.map(bindingFromRow);
  }
}

function providerTypeFromRow(row: ProviderTypeRow): ProviderType {
  return createProviderType({
    providerTypeId: providerTypeId(row.provider_type_id),
    displayName: row.display_name,
    status: row.status,
  });
}

function providerPackageFromRow(row: ProviderPackageRow): ProviderPackage {
  return createProviderPackage({
    packageId: providerPackageId(row.package_id),
    packageVersion: row.package_version,
    providerTypeId: providerTypeId(row.provider_type_id),
    hostingModes: row.hosting_modes,
    checksum: row.checksum,
    status: row.status,
    ...(row.source_document === undefined ? {} : { sourceDocument: row.source_document }),
    updatedAt: row.updated_at,
  });
}

function providerFromRow(row: ProviderRow): Provider {
  if ((row.package_id === null) !== (row.package_version === null)) {
    throw new Error("PMS_PROVIDER_PACKAGE_IDENTITY_CORRUPT");
  }
  const packageIdentity =
    row.package_id === null || row.package_version === null
      ? {}
      : {
          packageId: providerPackageId(row.package_id),
          packageVersion: row.package_version,
        };
  return createProvider({
    providerId: providerId(row.provider_id),
    providerTypeId: providerTypeId(row.provider_type_id),
    ...packageIdentity,
    hostingMode: row.hosting_mode,
    ...(row.adapter_endpoint === null ? {} : { adapterEndpoint: row.adapter_endpoint }),
    status: row.status,
  });
}

function providerValues(value: Provider): unknown[] {
  return [
    value.providerId,
    value.providerTypeId,
    value.packageId ?? null,
    value.packageVersion ?? null,
    value.hostingMode,
    value.adapterEndpoint ?? null,
    value.status,
  ];
}

function resourceFromRow(row: ResourceRow): Resource {
  return createResource({
    environment: environmentId(row.environment),
    resourceId: resourceId(row.resource_id),
    resourceType: row.resource_type,
    metadata: row.metadata,
    status: row.status,
  });
}

function resourceValues(value: Resource): unknown[] {
  return [
    value.environment,
    value.resourceId,
    value.resourceType,
    json(value.metadata),
    value.status,
  ];
}

function bindingFromRow(row: BindingRow): ProviderResourceBinding {
  return Object.freeze({
    providerId: providerId(row.provider_id),
    environment: environmentId(row.environment),
    resourceId: resourceId(row.resource_id),
    boundAt: new Date(row.bound_at),
  });
}

function objectField(object: JsonObject, key: string): JsonObject {
  const value = object[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function stringField(object: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = object[key];
  return typeof value === "string" ? value : null;
}
