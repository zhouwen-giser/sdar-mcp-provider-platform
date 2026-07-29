import { EmptyState, PageHeader, StatusBadge } from "../../components/ui.js";

export function ProviderPackagesPage() {
  return (
    <>
      <PageHeader
        title="Provider Packages"
        description="声明 Provider 类型、适配能力和支持的 Hosting Mode。"
        actions={<StatusBadge status="DRAFT" />}
      />
      <div className="grid-two">
        <section className="panel">
          <h2>未来信息结构</h2>
          <p>Package ID、版本、签名状态、兼容 Runtime、Manifest 摘要和验证结果。</p>
        </section>
        <section className="panel">
          <h2>下一阶段边界</h2>
          <p>原型不上传 Package、不执行安装，也不读取生产 Registry。</p>
        </section>
      </div>
      <EmptyState
        title="Package 管理交互尚未纳入 P0"
        description="Provider 接入向导使用固定 Mock Package 清单。"
      />
    </>
  );
}
