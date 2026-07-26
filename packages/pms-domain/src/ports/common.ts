export interface PageRequest {
  readonly limit: number;
  readonly cursor?: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

export interface LastModifiedPrecondition {
  /** Update must affect exactly one row with this value or raise OPTIMISTIC_CONCURRENCY_CONFLICT. */
  readonly expectedUpdatedAt: Date;
}

export interface RevisionPrecondition {
  /** Null means no revision may exist; otherwise this must equal the latest persisted revision. */
  readonly expectedRevision: number | null;
}

export type SavePrecondition =
  { readonly mode: "insert" } | ({ readonly mode: "update" } & LastModifiedPrecondition);
