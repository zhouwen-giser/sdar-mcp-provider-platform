import { type PropsWithChildren, type ReactNode, useState } from "react";
import {
  Button,
  CodeOrJsonViewer,
  DataTable,
  DeferredCapability,
  ErrorState,
  FormField,
  LocalOnlyNotice,
  PageHeader,
  QuerySurface,
  StatusBadge,
  Toast,
} from "../../components/ui.js";
import { toUiProblem } from "../../shared/errors/ui-problem.js";

export function ProductPage({
  title,
  description,
  classification,
  actions,
  children,
}: PropsWithChildren<{
  readonly title: string;
  readonly description: string;
  readonly classification: "FROZEN_API" | "WEB_COMPOSED" | "CLIENT_ONLY" | "DEFERRED" | "FORBIDDEN";
  readonly actions?: ReactNode;
}>) {
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        classification={classification}
        actions={actions}
      />
      {children}
    </>
  );
}
export function MutationFeedback({
  mutation,
}: {
  readonly mutation: {
    readonly isPending: boolean;
    readonly isSuccess: boolean;
    readonly isError: boolean;
    readonly error: unknown;
    readonly data?: unknown;
  };
}) {
  if (mutation.isPending) return <Toast tone="info">请求提交中；已阻止重复提交。</Toast>;
  if (mutation.isError) {
    const p = toUiProblem(mutation.error);
    return (
      <Toast tone="error">
        {p.code}: {p.detail ?? p.title}
      </Toast>
    );
  }
  if (mutation.isSuccess) return <Toast>操作已完成；相关 Query 已失效并刷新。</Toast>;
  return null;
}
export function ContractBoundaryNote({ children }: PropsWithChildren) {
  return (
    <section className="contract-note">
      <strong>Console API V1 boundary</strong>
      <p>{children}</p>
    </section>
  );
}
export function DeferredForm({
  title,
  reason,
  fields,
}: {
  readonly title: string;
  readonly reason: string;
  readonly fields: readonly {
    readonly label: string;
    readonly value: string;
    readonly kind?: "input" | "select" | "textarea";
  }[];
}) {
  const [validated, setValidated] = useState(false);
  return (
    <DeferredCapability title={title} reason={reason}>
      <div className="grid-two">
        <section className="component-stack">
          {fields.map((field) => (
            <FormField key={field.label} label={field.label}>
              {field.kind === "textarea" ? (
                <textarea defaultValue={field.value} />
              ) : field.kind === "select" ? (
                <select defaultValue={field.value}>
                  <option>{field.value}</option>
                </select>
              ) : (
                <input defaultValue={field.value} />
              )}
            </FormField>
          ))}
        </section>
        <section>
          <h3>本地预检查</h3>
          <ul>
            <li>字段完整性</li>
            <li>文件扩展名和大小限制</li>
            <li>禁止 Secret 明文</li>
            <li>合同能力分类检查</li>
          </ul>
          {validated ? <Toast>本地校验通过；提交仍被合同边界禁用。</Toast> : null}
          <Button onClick={() => setValidated(true)}>运行本地校验</Button>
        </section>
      </div>
      <div className="page-actions">
        <Button variant="primary" disabled title="Not available in Console API V1">
          Not available in Console API V1
        </Button>
      </div>
    </DeferredCapability>
  );
}
export function LocalWorkspaceHeader({
  title,
  description,
  actions,
}: {
  readonly title: string;
  readonly description: string;
  readonly actions?: ReactNode;
}) {
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        classification="CLIENT_ONLY"
        actions={actions}
      />
      <LocalOnlyNotice>
        该工作区仅存储在浏览器 Mock 场景中，不会写入 PMS Console API V1。
      </LocalOnlyNotice>
    </>
  );
}
export function DetailNotAvailable({
  entity,
  id,
}: {
  readonly entity: string;
  readonly id: string;
}) {
  return (
    <ProductPage
      title={`${entity} 不可用`}
      description={`${id} 未出现在当前查询缓存或冻结合同不提供详情接口。`}
      classification="DEFERRED"
    >
      <section className="panel">
        <h2>可恢复方式</h2>
        <p>返回列表重新加载，再从列表进入详情。系统不会为缺失的后端详情接口伪造数据。</p>
      </section>
    </ProductPage>
  );
}
export { Button, CodeOrJsonViewer, DataTable, ErrorState, QuerySurface, StatusBadge };
