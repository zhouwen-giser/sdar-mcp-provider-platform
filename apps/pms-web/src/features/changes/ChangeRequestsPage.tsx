import { Button, DataTable, PageHeader, StatusBadge } from "../../components/ui.js";

export function ChangeRequestsPage() {
  return (
    <>
      <PageHeader title="Change Requests" description="结构化占位：展示审批状态，不实现身份或审批后端。" actions={<Button disabled>新建变更（后续版本）</Button>} />
      <section className="panel"><DataTable columns={["Change", "Kind", "Status", "Impact"]} rows={[["change-catalog-043", "Catalog breaking review", <StatusBadge status="PENDING" />, "Registry publish blocked"]]} /></section>
    </>
  );
}
