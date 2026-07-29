import { useCallback } from "react";
import { useDataQuery, usePmsWebDataSource, useScenario } from "../data/context.js";
import { PROTOTYPE_SCENARIOS } from "../data/scenarios.js";
import type { AppRoute } from "../router.js";
import {
  Button,
  CodeOrJsonViewer,
  ConfirmDialog,
  DataTable,
  DetailDrawer,
  DiffViewer,
  EmptyState,
  ErrorState,
  FilterBar,
  HealthIndicator,
  MetricCard,
  PageHeader,
  Skeleton,
  StatusBadge,
  StepProgress,
  Timeline,
  Toast,
  Wizard,
} from "../components/ui.js";
import { useState } from "react";

export function StructuredPlaceholder({ route }: { readonly route: AppRoute }) {
  return (
    <>
      <PageHeader
        title={route.title}
        description={`${route.level} 信息架构已就绪；业务交互将在对应任务中实现。`}
      />
      <div className="grid-two">
        <section className="panel">
          <h2>信息结构</h2>
          <p>概览、状态、关联对象、历史与模拟操作区域已纳入页面模型。</p>
        </section>
        <section className="panel">
          <h2>下一阶段边界</h2>
          <p>数据仅通过 PmsWebDataSource 投影，不连接真实 PMS 或 Runtime。</p>
        </section>
      </div>
      <EmptyState
        title={`${route.title} 暂无场景数据`}
        description="结构化空状态已就绪，不代表生产环境没有对象。"
      />
    </>
  );
}

export function ScenarioCatalogue() {
  const [scenario, setScenario] = useScenario();
  const query = useCallback(
    (source: ReturnType<typeof usePmsWebDataSource>) => source.dashboard(),
    [],
  );
  const state = useDataQuery(query);
  return (
    <>
      <PageHeader
        title="Prototype Scenarios"
        description="场景只改变 Mock Data 投影，不实现权限或网络行为。"
      />
      <div className="scenario-grid">
        {PROTOTYPE_SCENARIOS.map((item) => (
          <Button
            key={item}
            variant={item === scenario ? "primary" : "secondary"}
            onClick={() => setScenario(item)}
          >
            {item}
          </Button>
        ))}
      </div>
      <section className="panel">
        <h2>当前投影：{scenario}</h2>
        {state.status === "loading" ? (
          <Skeleton />
        ) : state.status === "error" ? (
          <ErrorState
            code={state.error.message}
            impact="Mock 数据投影不可用"
            action="切换 healthy 场景"
          />
        ) : (
          <CodeOrJsonViewer value={state.data} />
        )}
      </section>
    </>
  );
}

export function ComponentCatalogue() {
  const [drawer, setDrawer] = useState(false);
  const [dialog, setDialog] = useState(false);
  const source = usePmsWebDataSource();
  return (
    <>
      <PageHeader
        title="Component Catalogue"
        description="正式设计系统的可访问交互与状态样例。"
        actions={
          <Button
            variant="primary"
            onClick={() =>
              source.startOperation({ label: "组件模拟操作", steps: ["预检查", "执行", "确认"] })
            }
          >
            创建模拟 Operation
          </Button>
        }
      />
      <div className="metrics-row">
        <MetricCard label="Providers" value="3" hint="healthy" />
        <MetricCard label="Open incidents" value="1" hint="incident-active" />
        <MetricCard label="Worker backlog" value="47" hint="worker-backlog" />
      </div>
      <section className="panel component-stack">
        <h2>状态与健康</h2>
        <div className="inline">
          <StatusBadge status="ACTIVE" />
          <StatusBadge status="DEGRADED" />
          <StatusBadge status="STALE" />
          <HealthIndicator status="ACTIVE" label="Registry" />
        </div>
        <FilterBar>
          <input placeholder="搜索" />
          <select>
            <option>全部状态</option>
          </select>
          <Button>筛选</Button>
        </FilterBar>
        <DataTable
          columns={["对象", "状态", "Revision"]}
          rows={[
            ["deploy-ha-primary", <StatusBadge status="ACTIVE" />, "17"],
            ["deploy-ugv-primary", <StatusBadge status="STALE" />, "9 / 8"],
          ]}
        />
      </section>
      <section className="panel component-stack">
        <h2>工作流与差异</h2>
        <Wizard>
          <StepProgress steps={["选择", "校验", "影响", "提交"]} current={2} />
        </Wizard>
        <Timeline
          items={[
            { label: "Draft created", meta: "revision 41" },
            { label: "Validated", meta: "schema valid" },
          ]}
        />
        <DiffViewer before={'{"PORT": 8080}'} after={'{"PORT": 8090}'} />
      </section>
      <section className="panel component-stack">
        <h2>反馈与 Overlay</h2>
        <div className="inline">
          <Button onClick={() => setDrawer(true)}>打开 Drawer</Button>
          <Button variant="danger" onClick={() => setDialog(true)}>
            危险模拟操作
          </Button>
        </div>
        <Toast>Mock 配置草稿已保存</Toast>
        <ErrorState
          code="MOCK_RUNTIME_STALE"
          impact="Observed revision 落后"
          action="查看 Incident 并模拟 Reconcile"
        />
      </section>
      <DetailDrawer title="RuntimeProcess 快速详情" open={drawer} onClose={() => setDrawer(false)}>
        <CodeOrJsonViewer value={{ processId: "process-ha-01", status: "ACTIVE" }} />
      </DetailDrawer>
      <ConfirmDialog
        title="确认模拟重启"
        open={dialog}
        impact="仅推进前端 Operation，不调用 PM2。"
        onCancel={() => setDialog(false)}
        onConfirm={() => {
          setDialog(false);
          source.startOperation({
            label: "模拟 Runtime 重启",
            steps: ["影响确认", "Reconcile", "Observed ACTIVE"],
          });
        }}
      />
    </>
  );
}
