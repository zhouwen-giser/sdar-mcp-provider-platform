export interface LocalNotification {
  readonly id: string;
  readonly category: string;
  readonly title: string;
  readonly subjectId: string;
  readonly createdAt: string;
  readonly read: boolean;
}
export interface LocalJob {
  readonly jobId: string;
  readonly kind: string;
  readonly subjectId: string;
  readonly status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  readonly attempt: number;
  readonly leaseOwner: string;
  readonly fenceToken: string;
  readonly updatedAt: string;
  readonly error?: string;
}
export interface LocalOperation {
  readonly operationId: string;
  readonly kind: string;
  readonly subjectId: string;
  readonly status: "ACCEPTED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  readonly progress: number;
  readonly correlationId: string;
  readonly jobId?: string;
  readonly timeline: readonly string[];
}
export interface LocalIncident {
  readonly incidentId: string;
  readonly title: string;
  readonly severity: "SEV-1" | "SEV-2" | "SEV-3";
  readonly status: "OPEN" | "MITIGATING" | "CLOSED";
  readonly deploymentId: string;
  readonly jobId?: string;
  readonly owner: string;
  readonly notes: readonly string[];
  readonly updatedAt: string;
}
export interface LocalChange {
  readonly changeId: string;
  readonly title: string;
  readonly kind: string;
  readonly subjectId: string;
  readonly status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "REJECTED";
  readonly impact: string;
  readonly timeline: readonly string[];
}
export interface LocalPreferences {
  readonly density: "comfortable" | "compact";
  readonly defaultEnvironment: string;
  readonly showFutureNavigation: boolean;
}
export interface LocalConfigRevision {
  readonly draftId: string;
  readonly revisionId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly applyMode: string;
  readonly status: string;
  readonly content: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}
export interface WorkspaceSnapshot {
  readonly notifications: readonly LocalNotification[];
  readonly jobs: readonly LocalJob[];
  readonly operations: readonly LocalOperation[];
  readonly incidents: readonly LocalIncident[];
  readonly changes: readonly LocalChange[];
  readonly configurationDraftIds: readonly string[];
  readonly configurationRevisions: readonly LocalConfigRevision[];
  readonly preferences: LocalPreferences;
}

const mockInitial: WorkspaceSnapshot = {
  notifications: [
    {
      id: "notification-001",
      category: "runtime",
      title: "deploy-001 已完成调和",
      subjectId: "deploy-001",
      createdAt: "2026-07-30T05:16:00.000Z",
      read: false,
    },
    {
      id: "notification-002",
      category: "configuration",
      title: "draft-001 发布为 Revision 3",
      subjectId: "draft-001",
      createdAt: "2026-07-30T05:12:00.000Z",
      read: true,
    },
    {
      id: "notification-003",
      category: "registry",
      title: "Registry Revision 4 包含 Catalog 变化",
      subjectId: "registry-4",
      createdAt: "2026-07-30T05:15:00.000Z",
      read: false,
    },
  ],
  jobs: [
    {
      jobId: "job-reconcile-001",
      kind: "RECONCILE_RUNTIME",
      subjectId: "deploy-001",
      status: "SUCCEEDED",
      attempt: 1,
      leaseOwner: "worker-a",
      fenceToken: "fence-44",
      updatedAt: "2026-07-30T05:15:00.000Z",
    },
    {
      jobId: "job-catalog-002",
      kind: "DISCOVER_CATALOG",
      subjectId: "ha-east-001",
      status: "RUNNING",
      attempt: 1,
      leaseOwner: "worker-b",
      fenceToken: "fence-45",
      updatedAt: "2026-07-30T05:14:30.000Z",
    },
    {
      jobId: "job-runtime-003",
      kind: "RECONCILE_RUNTIME",
      subjectId: "deploy-001",
      status: "FAILED",
      attempt: 3,
      leaseOwner: "worker-a",
      fenceToken: "fence-43",
      updatedAt: "2026-07-30T05:09:00.000Z",
      error: "RUNTIME_PROCESS_NOT_FOUND",
    },
  ],
  operations: [
    {
      operationId: "op-runtime-001",
      kind: "runtime.reconcile",
      subjectId: "deploy-001",
      status: "SUCCEEDED",
      progress: 100,
      correlationId: "corr-runtime-001",
      jobId: "job-reconcile-001",
      timeline: ["Intent accepted", "Job leased", "Observed revision converged", "Audit recorded"],
    },
    {
      operationId: "op-config-002",
      kind: "configuration.publish",
      subjectId: "draft-001",
      status: "SUCCEEDED",
      progress: 100,
      correlationId: "corr-001",
      timeline: ["Draft validated", "Revision published", "Runtime ACK pending"],
    },
    {
      operationId: "op-catalog-003",
      kind: "catalog.discovery",
      subjectId: "ha-east-001",
      status: "RUNNING",
      progress: 60,
      correlationId: "corr-catalog-003",
      jobId: "job-catalog-002",
      timeline: ["Reconcile accepted", "Runtime discovery started", "Registry projection pending"],
    },
  ],
  incidents: [
    {
      incidentId: "incident-runtime-001",
      title: "NPC runtime process missing",
      severity: "SEV-2",
      status: "OPEN",
      deploymentId: "deploy-001",
      jobId: "job-runtime-003",
      owner: "operator-a",
      notes: ["自动检测到连续三次调和失败", "等待确认 Provider adapter 状态"],
      updatedAt: "2026-07-30T05:10:00.000Z",
    },
  ],
  changes: [
    {
      changeId: "change-config-001",
      title: "提高 UGV Runtime 日志等级",
      kind: "configuration",
      subjectId: "draft-001",
      status: "IN_REVIEW",
      impact: "需要 Runtime restart；预计 30 秒不可用。",
      timeline: ["Draft created", "Impact reviewed", "Awaiting local approval"],
    },
    {
      changeId: "change-catalog-002",
      title: "审核 UGV Catalog 必填字段变化",
      kind: "catalog",
      subjectId: "ugv-prod-001",
      status: "DRAFT",
      impact: "可能影响旧客户端请求。",
      timeline: ["Breaking difference detected"],
    },
  ],
  configurationDraftIds: ["draft-001", "draft-ha-east"],
  configurationRevisions: [
    {
      draftId: "draft-001",
      revisionId: "123e4567-e89b-42d3-a456-426614174000",
      revision: 3,
      checksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      applyMode: "restart_required",
      status: "published",
      content: { runtime: { port: 8201, logLevel: "info" } },
      createdAt: "2026-07-30T05:12:00.000Z",
    },
    {
      draftId: "draft-001",
      revisionId: "223e4567-e89b-42d3-a456-426614174000",
      revision: 2,
      checksum: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      applyMode: "hot_reload",
      status: "superseded",
      content: { runtime: { port: 8201, logLevel: "debug" } },
      createdAt: "2026-07-29T05:12:00.000Z",
    },
  ],
  preferences: {
    density: "comfortable",
    defaultEnvironment: "production",
    showFutureNavigation: true,
  },
};

const apiInitial: WorkspaceSnapshot = {
  notifications: [],
  jobs: [],
  operations: [],
  incidents: [],
  changes: [],
  configurationDraftIds: [],
  configurationRevisions: [],
  preferences: {
    density: "comfortable",
    defaultEnvironment: "",
    showFutureNavigation: false,
  },
};

export class ClientWorkspaceStore {
  private value: WorkspaceSnapshot;
  private listeners = new Set<() => void>();
  constructor(mode: "mock" | "api" = "mock") {
    this.value = structuredClone(mode === "mock" ? mockInitial : apiInitial);
  }
  snapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(next: WorkspaceSnapshot) {
    this.value = next;
    for (const listener of this.listeners) listener();
  }
  markNotification(id: string, read: boolean) {
    this.update({
      ...this.value,
      notifications: this.value.notifications.map((item) =>
        item.id === id ? { ...item, read } : item,
      ),
    });
  }
  markAllNotifications() {
    this.update({
      ...this.value,
      notifications: this.value.notifications.map((item) => ({ ...item, read: true })),
    });
  }
  clearNotifications() {
    this.update({ ...this.value, notifications: [] });
  }
  createIncident(input: Pick<LocalIncident, "title" | "severity" | "deploymentId" | "owner">) {
    const incident: LocalIncident = {
      incidentId: `incident-local-${this.value.incidents.length + 1}`,
      ...input,
      status: "OPEN",
      notes: ["Created in client-side operational workspace"],
      updatedAt: "2026-07-30T05:20:00.000Z",
    };
    this.update({ ...this.value, incidents: [incident, ...this.value.incidents] });
    return incident;
  }
  closeIncident(id: string) {
    this.update({
      ...this.value,
      incidents: this.value.incidents.map((item) =>
        item.incidentId === id
          ? { ...item, status: "CLOSED", updatedAt: "2026-07-30T05:21:00.000Z" }
          : item,
      ),
    });
  }
  addIncidentNote(id: string, note: string) {
    this.update({
      ...this.value,
      incidents: this.value.incidents.map((item) =>
        item.incidentId === id
          ? { ...item, notes: [...item.notes, note], updatedAt: "2026-07-30T05:21:00.000Z" }
          : item,
      ),
    });
  }
  addConfigurationDraftId(draftId: string) {
    if (this.value.configurationDraftIds.includes(draftId)) return;
    this.update({
      ...this.value,
      configurationDraftIds: [...this.value.configurationDraftIds, draftId],
    });
  }
  recordConfigurationRevision(
    draftId: string,
    revision: {
      readonly revisionId: string;
      readonly revision: number;
      readonly checksum: string;
      readonly applyMode: string;
      readonly status: string;
      readonly content: Readonly<Record<string, unknown>>;
      readonly createdAt: string;
    },
  ) {
    this.update({
      ...this.value,
      configurationRevisions: [{ draftId, ...revision }, ...this.value.configurationRevisions],
    });
  }
  createChange(input: Pick<LocalChange, "title" | "kind" | "subjectId" | "impact">) {
    const change: LocalChange = {
      changeId: `change-local-${this.value.changes.length + 1}`,
      ...input,
      status: "DRAFT",
      timeline: ["Created in local governance workspace"],
    };
    this.update({ ...this.value, changes: [change, ...this.value.changes] });
    return change;
  }
  reviewChange(id: string, accepted: boolean) {
    this.update({
      ...this.value,
      changes: this.value.changes.map((item) =>
        item.changeId === id
          ? {
              ...item,
              status: accepted ? "APPROVED" : "REJECTED",
              timeline: [...item.timeline, accepted ? "Locally approved" : "Locally rejected"],
            }
          : item,
      ),
    });
  }
  setPreferences(preferences: LocalPreferences) {
    this.update({ ...this.value, preferences });
  }
  recordIntent(kind: string, subjectId: string, correlationId: string) {
    const jobId = `job-local-${this.value.jobs.length + 1}`;
    const operation: LocalOperation = {
      operationId: `op-local-${this.value.operations.length + 1}`,
      kind,
      subjectId,
      status: "ACCEPTED",
      progress: 20,
      correlationId,
      jobId,
      timeline: ["202 Intent accepted", "Waiting for simulated job projection"],
    };
    const job: LocalJob = {
      jobId,
      kind: kind.toUpperCase().replaceAll(".", "_"),
      subjectId,
      status: "PENDING",
      attempt: 0,
      leaseOwner: "unleased",
      fenceToken: "pending",
      updatedAt: "2026-07-30T05:20:00.000Z",
    };
    this.update({
      ...this.value,
      operations: [operation, ...this.value.operations],
      jobs: [job, ...this.value.jobs],
    });
  }
  advanceOperation(id: string) {
    const operation = this.value.operations.find((item) => item.operationId === id);
    if (
      operation === undefined ||
      operation.status === "SUCCEEDED" ||
      operation.status === "FAILED"
    )
      return;
    const nextStatus: LocalOperation["status"] =
      operation.status === "ACCEPTED" ? "RUNNING" : "SUCCEEDED";
    const nextProgress = nextStatus === "RUNNING" ? 65 : 100;
    const operations = this.value.operations.map((item) =>
      item.operationId === id
        ? {
            ...item,
            status: nextStatus,
            progress: nextProgress,
            timeline: [
              ...item.timeline,
              nextStatus === "RUNNING"
                ? "Job leased by simulated worker"
                : "Observed state converged",
            ],
          }
        : item,
    );
    const jobs = this.value.jobs.map((item) =>
      item.jobId === operation.jobId
        ? {
            ...item,
            status: nextStatus === "RUNNING" ? ("RUNNING" as const) : ("SUCCEEDED" as const),
            attempt: nextStatus === "RUNNING" ? 1 : item.attempt,
            leaseOwner: nextStatus === "RUNNING" ? "worker-local" : item.leaseOwner,
            fenceToken: nextStatus === "RUNNING" ? "fence-local" : item.fenceToken,
            updatedAt: "2026-07-30T05:22:00.000Z",
          }
        : item,
    );
    this.update({ ...this.value, operations, jobs });
  }
}
