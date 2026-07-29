import { Button, DataTable, PageHeader, StatusBadge } from "../../components/ui.js";

export function ConformancePage() {
  return (
    <>
      <PageHeader title="Conformance" description="结构化占位：未来承载兼容性套件和证据评审。" actions={<Button disabled>运行套件（后续版本）</Button>} />
      <section className="panel">
        <DataTable
          columns={["Suite", "Scope", "Prototype status", "Evidence"]}
          rows={[
            ["schema-compatibility", "Catalog revisions", <StatusBadge status="PENDING" />, "Mock classification only"],
            ["runtime-contract", "Provider adapter", <StatusBadge status="PENDING" />, "No live invocation"],
          ]}
        />
      </section>
    </>
  );
}
