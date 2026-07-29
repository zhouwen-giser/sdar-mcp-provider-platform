import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  CodeOrJsonViewer,
  DataTable,
  DiffViewer,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
} from "../../components/ui.js";
import { useDataQuery, usePmsWebDataSource } from "../../data/context.js";
import type {
  ConfigurationApplyMode,
  ConfigurationField,
  ConfigurationProfile,
  RuntimeConfigurationAck,
} from "../../data/types.js";
import { navigate } from "../../router.js";
import "../../design-system/configuration-experience.css";

type EditorTab = "form" | "json" | "diff" | "impact";

export function ConfigurationPage({ profileId }: { readonly profileId?: string }) {
  const source = usePmsWebDataSource();
  const queryProfiles = useCallback(
    (dataSource: ReturnType<typeof usePmsWebDataSource>) =>
      dataSource.configurationProfiles(),
    [],
  );
  const profiles = useDataQuery(queryProfiles);
  const selectedId = profileId ?? "provider-runtime";
  const queryAcks = useCallback(
    (dataSource: ReturnType<typeof usePmsWebDataSource>) =>
      dataSource.runtimeConfigurationAcks(selectedId),
    [selectedId],
  );
  const acks = useDataQuery(queryAcks);
  const [revision, setRevision] = useState<number>();

  if (profiles.status === "loading" || acks.status === "loading")
    return <Skeleton lines={9} />;
  if (profiles.status === "error" || acks.status === "error")
    return (
      <ErrorState
        code="MOCK_CONFIGURATION_UNAVAILABLE"
        impact="配置中心 Mock 投影不可用，未执行任何真实请求。"
        action="切换 healthy 场景"
      />
    );
  const selected =
    profiles.data.find((profile) => profile.profileId === selectedId) ?? profiles.data[0];
  if (selected === undefined)
    return (
      <ErrorState
        code="CONFIGURATION_EMPTY"
        impact="当前场景没有 Configuration Profile。"
        action="切换 healthy 场景"
      />
    );
  const selectedRevision = revision ?? selected.currentRevision;
  return (
    <>
      <PageHeader
        title="配置中心"
        description="Draft → 校验 → Diff → 影响 → 模拟发布 → Runtime ACK。Secret 永不显示值。"
        actions={
          <Button
            variant="primary"
            disabled={selected.status === "PENDING_APPROVAL"}
            onClick={() => source.publishConfiguration(selected.profileId)}
          >
            {selected.status === "PENDING_APPROVAL" ? "等待审批" : "模拟发布 Revision"}
          </Button>
        }
      />
      <div className="configuration-workbench">
        <aside className="configuration-column">
          <h2>Profiles</h2>
          {profiles.data.map((profile) => (
            <button
              key={profile.profileId}
              aria-current={profile.profileId === selected.profileId ? "page" : undefined}
              onClick={() => navigate(`/configuration/${profile.profileId}`)}
            >
              <strong>{profile.name}</strong>
              <small>{profile.status}</small>
            </button>
          ))}
        </aside>
        <aside className="configuration-column">
          <h2>Revisions</h2>
          {[selected.currentRevision, selected.publishedRevision].map((item) => (
            <button
              key={item}
              aria-current={item === selectedRevision ? "page" : undefined}
              onClick={() => setRevision(item)}
            >
              <strong>Revision {item}</strong>
              <small>{item === selected.publishedRevision ? "PUBLISHED" : "DRAFT"}</small>
            </button>
          ))}
        </aside>
        <ConfigurationEditor profile={selected} acks={acks.data} />
      </div>
    </>
  );
}

function ConfigurationEditor({
  profile,
  acks,
}: {
  readonly profile: ConfigurationProfile;
  readonly acks: readonly RuntimeConfigurationAck[];
}) {
  const [tab, setTab] = useState<EditorTab>("form");
  const [fields, setFields] = useState(profile.fields);
  const endpointRef = useRef<HTMLInputElement>(null);
  useEffect(() => setFields(profile.fields), [profile]);
  const endpoint = fields.find((field) => field.key === "adapter.endpoint");
  const errors =
    typeof endpoint?.value === "string" && endpoint.value.startsWith("mock://")
      ? []
      : ["adapter.endpoint：原型 Endpoint 必须以 mock:// 开头"];
  const warnings = fields
    .filter((field) => field.applyMode === "RESTART" || field.applyMode === "IMMUTABLE")
    .map((field) => `${field.key}：${field.applyMode} 会扩大应用影响`);
  return (
    <main className="configuration-editor">
      <div className="section-heading">
        <div>
          <h2>{profile.name}</h2>
          <p>Revision {profile.currentRevision} · {profile.status}</p>
        </div>
        <StatusBadge status={errors.length === 0 ? "ACTIVE" : "FAILED"} />
      </div>
      <nav className="tabs" aria-label="配置编辑器">
        {(["form", "json", "diff", "impact"] as const).map((value) => (
          <button
            key={value}
            aria-current={tab === value ? "page" : undefined}
            onClick={() => setTab(value)}
          >
            {value === "form" ? "Form" : value === "json" ? "JSON" : value === "diff" ? "Diff" : "Impact"}
          </button>
        ))}
      </nav>
      {tab === "form" ? (
        <div className="configuration-form">
          {fields.map((field) => (
            <ConfigurationFieldEditor
              key={field.key}
              field={field}
              {...(field.key === "adapter.endpoint" ? { endpointRef } : {})}
              onChange={(value) =>
                setFields((current) =>
                  current.map((item) => (item.key === field.key ? { ...item, value } : item)),
                )
              }
            />
          ))}
        </div>
      ) : tab === "json" ? (
        <CodeOrJsonViewer
          value={Object.fromEntries(
            fields.map((field) => [
              field.key,
              field.secretRef === undefined ? field.value : { secretRef: field.secretRef },
            ]),
          )}
        />
      ) : tab === "diff" ? (
        <DiffViewer
          before={'{"runtime.logLevel":"warn","database.poolSize":8}'}
          after={'{"runtime.logLevel":"info","database.poolSize":12}'}
        />
      ) : (
        <ImpactSummary fields={fields} />
      )}
      <section className="validation-panel">
        <div>
          <strong>Schema validation</strong>
          <p>{errors.length === 0 ? "通过：字段类型与 Mock Schema 一致。" : "存在阻断错误。"}</p>
          {errors.map((error) => (
            <button key={error} className="validation-link" onClick={() => endpointRef.current?.focus()}>
              {error}
            </button>
          ))}
          {warnings.map((warning) => <small key={warning}>Warning · {warning}</small>)}
        </div>
      </section>
      <section className="ack-section">
        <h3>Runtime ACK</h3>
        <DataTable
          columns={["Runtime", "Revision", "ACK", "Detail"]}
          rows={acks.map((ack) => [
            ack.runtimeId,
            ack.revision,
            ack.status,
            ack.detail,
          ])}
        />
      </section>
    </main>
  );
}

function ConfigurationFieldEditor({
  field,
  endpointRef,
  onChange,
}: {
  readonly field: ConfigurationField;
  readonly endpointRef?: RefObject<HTMLInputElement | null>;
  readonly onChange: (value: string | number | boolean) => void;
}) {
  const secret = field.secretRef !== undefined;
  return (
    <label className="configuration-field">
      <span>
        <strong>{field.key}</strong>
        <small>{field.source} · default {String(field.defaultValue)} · {field.applyMode}</small>
      </span>
      {secret ? (
        <code aria-label={`${field.key} SecretRef`}>{field.secretRef}</code>
      ) : typeof field.value === "number" ? (
        <input
          type="number"
          value={field.value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      ) : (
        <input
          ref={endpointRef}
          value={String(field.value)}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function ImpactSummary({ fields }: { readonly fields: readonly ConfigurationField[] }) {
  const modes: readonly ConfigurationApplyMode[] = [
    "HOT_RELOAD",
    "RECONNECT",
    "RESTART",
    "IMMUTABLE",
  ];
  return (
    <div className="impact-grid">
      {modes.map((mode) => (
        <section key={mode}>
          <strong>{mode}</strong>
          <p>{fields.filter((field) => field.applyMode === mode).map((field) => field.key).join(", ") || "无变化"}</p>
        </section>
      ))}
    </div>
  );
}
