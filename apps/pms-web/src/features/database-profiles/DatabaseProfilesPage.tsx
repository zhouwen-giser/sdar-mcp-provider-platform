import { Button, DataTable, PageHeader, StatusBadge } from "../../components/ui.js";

export function DatabaseProfilesPage() {
  return (
    <>
      <PageHeader
        title="Database Profiles"
        description="结构化原型：只显示引用与检查结果，不保存或展示凭据。"
        actions={<Button disabled>新建 Profile（后续版本）</Button>}
      />
      <section className="panel">
        <DataTable
          columns={["Profile", "Engine", "Scope", "Mock check"]}
          rows={[
            ["postgres-primary", "PostgreSQL", "production-mock", <StatusBadge status="ACTIVE" />],
            ["postgres-sandbox", "PostgreSQL", "staging-mock", <StatusBadge status="ACTIVE" />],
          ]}
        />
        <p className="prototype-note">页面永不呈现 connection string、口令或 Secret 值。</p>
      </section>
    </>
  );
}
