import { Button, DataTable, PageHeader, StatusBadge } from "../../components/ui.js";

export function RuntimeReleasesPage() {
  return (
    <>
      <PageHeader
        title="Runtime Releases"
        description="结构化原型：展示可选版本与兼容性，不提供真实发布能力。"
        actions={<Button disabled>上传 Release（后续版本）</Button>}
      />
      <section className="panel">
        <DataTable
          columns={["Release", "Channel", "Compatibility", "Availability"]}
          rows={[
            ["@sdar/runtime@2.0.0-rc.1", "release-candidate", "PMS V0.1", <StatusBadge status="ACTIVE" />],
            ["@sdar/runtime@1.9.4", "stable", "Legacy adapter", <StatusBadge status="ACTIVE" />],
          ]}
        />
        <p className="prototype-note">Mock 清单固定在浏览器内；无制品上传或远程下载。</p>
      </section>
    </>
  );
}
