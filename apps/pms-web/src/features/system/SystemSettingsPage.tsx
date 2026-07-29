import { Button, DataTable, PageHeader } from "../../components/ui.js";

export function SystemSettingsPage() {
  return (
    <>
      <PageHeader title="System Settings" description="结构化只读占位：不包含凭据、鉴权或远程控制入口。" actions={<Button disabled>保存（后续版本）</Button>} />
      <section className="panel"><DataTable columns={["Setting", "Projection", "Scope"]} rows={[["Environment label", "production-mock", "Browser prototype"], ["Observation freshness", "120 seconds", "Display only"], ["Secret handling", "REDACTED / SecretRef", "Non-revealable"]]} /></section>
    </>
  );
}
