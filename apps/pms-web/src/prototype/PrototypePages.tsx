import { useState } from "react";
import {
  Button,
  CodeOrJsonViewer,
  ConfirmDialog,
  DataTable,
  DiffViewer,
  MetricCard,
  PageHeader,
  StatusBadge,
  StepProgress,
  Timeline,
  Toast,
  Wizard,
} from "../components/ui.js";
import { PRODUCT_SCENARIOS } from "../scenarios/types.js";
import { useScenario } from "../app/providers/app-providers.js";

export function ScenarioCatalogue() {
  const [scenario, setScenario] = useScenario();
  return (
    <>
      <PageHeader
        title="Prototype Scenarios"
        description="开发模式下切换确定性 Contract-first Mock 场景。"
      />
      <section className="panel">
        <div className="scenario-grid">
          {PRODUCT_SCENARIOS.map((item) => (
            <Button
              key={item}
              variant={item === scenario ? "primary" : "secondary"}
              onClick={() => setScenario(item)}
            >
              {item}
            </Button>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>当前场景</h2>
        <CodeOrJsonViewer
          value={{
            scenario,
            source: "Frozen OpenAPI examples + deterministic overrides",
            productionRoute: false,
          }}
        />
      </section>
    </>
  );
}
export function ComponentCatalogue() {
  const [dialog, setDialog] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <>
      <PageHeader
        title="Component Catalogue"
        description="产品化设计系统组件、状态和高风险确认交互。"
      />
      <div className="metrics-row">
        <MetricCard label="Components" value="16" />
        <MetricCard label="Query states" value="8" />
        <MetricCard label="Mutation states" value="6" />
        <MetricCard label="Viewport floor" value="1024px" />
      </div>
      <section className="panel component-stack">
        <h2>Status and table</h2>
        <DataTable
          columns={["Object", "State", "Revision"]}
          rows={[
            ["deploy-001", <StatusBadge status="ACTIVE" />, "17"],
            ["provider-001", <StatusBadge status="DEGRADED" />, "updatedAt CAS"],
          ]}
        />
      </section>
      <section className="panel component-stack">
        <h2>Workflow and diff</h2>
        <Wizard>
          <StepProgress steps={["Input", "Validate", "Impact", "Submit"]} current={2} />
        </Wizard>
        <Timeline
          items={[
            { label: "Draft created", status: "SUCCEEDED" },
            { label: "Validation", status: "PASSED" },
            { label: "Publish", status: "READY" },
          ]}
        />
        <DiffViewer before={'{"desiredState":"running"}'} after={'{"desiredState":"stopped"}'} />
      </section>
      <section className="panel">
        <Button variant="danger" onClick={() => setDialog(true)}>
          打开高风险确认
        </Button>
        {done ? <Toast>本地确认交互完成。</Toast> : null}
      </section>
      <ConfirmDialog
        title="确认组件演示操作"
        open={dialog}
        impact={<p>该操作仅验证对话框、原因和二次确认，不调用 Gateway。</p>}
        requirePhrase="CONFIRM"
        reasonRequired
        onCancel={() => setDialog(false)}
        onConfirm={() => {
          setDialog(false);
          setDone(true);
        }}
      />
    </>
  );
}
