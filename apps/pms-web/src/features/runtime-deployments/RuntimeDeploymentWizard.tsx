import { type PropsWithChildren, useState } from "react";
import { Button, PageHeader, StepProgress, Wizard } from "../../components/ui.js";
import { usePmsWebDataSource } from "../../data/context.js";
import type { RuntimeDeploymentDraft } from "../../data/types.js";
import { navigate } from "../../router.js";
import "../../design-system/runtime-experience.css";

const STEPS = ["Provider", "Release", "Database", "Config", "Placement", "影响与提交"];
const INITIAL: RuntimeDeploymentDraft = {
  providerId: "provider-ha-east",
  release: "@sdar/runtime@2.0.0-rc.1",
  databaseProfileId: "postgres-primary",
  configurationProfileId: "provider-runtime-r43",
  placement: "local-pm2 / zone-a",
  replicas: 1,
};

export function RuntimeDeploymentWizard() {
  const source = usePmsWebDataSource();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(INITIAL);
  const update = (field: keyof RuntimeDeploymentDraft, value: string | number) =>
    setDraft((current) => ({ ...current, [field]: value }));
  return (
    <>
      <PageHeader
        title="创建 RuntimeDeployment"
        description="六步模拟向导；不会连接真实 Worker、PM2 或数据库。"
      />
      <Wizard>
        <StepProgress steps={STEPS} current={step} />
        <section className="wizard-body">
          <h2>{STEPS[step]}</h2>
          {step === 0 ? (
            <Field label="Provider">
              <select
                value={draft.providerId}
                onChange={(event) => update("providerId", event.target.value)}
              >
                <option value="provider-ha-east">华东楼宇气候</option>
                <option value="provider-ugv-fleet">园区 UGV 车队</option>
              </select>
            </Field>
          ) : step === 1 ? (
            <Field label="Runtime Release">
              <select
                value={draft.release}
                onChange={(event) => update("release", event.target.value)}
              >
                <option>@sdar/runtime@2.0.0-rc.1</option>
                <option>@sdar/runtime@1.9.4</option>
              </select>
            </Field>
          ) : step === 2 ? (
            <Field label="Database Profile">
              <select
                value={draft.databaseProfileId}
                onChange={(event) => update("databaseProfileId", event.target.value)}
              >
                <option value="postgres-primary">postgres-primary</option>
                <option value="postgres-sandbox">postgres-sandbox</option>
              </select>
            </Field>
          ) : step === 3 ? (
            <Field label="Configuration Profile">
              <input
                value={draft.configurationProfileId}
                onChange={(event) => update("configurationProfileId", event.target.value)}
              />
            </Field>
          ) : step === 4 ? (
            <>
              <Field label="Placement">
                <select
                  value={draft.placement}
                  onChange={(event) => update("placement", event.target.value)}
                >
                  <option>local-pm2 / zone-a</option>
                  <option>local-pm2 / zone-b</option>
                </select>
              </Field>
              <Field label="Replicas">
                <input
                  type="number"
                  min={1}
                  max={2}
                  value={draft.replicas}
                  onChange={(event) => update("replicas", Number(event.target.value))}
                />
              </Field>
            </>
          ) : (
            <div className="impact-box">
              <strong>模拟影响分析</strong>
              <p>创建 1 个 RuntimeDeployment 与 {draft.replicas} 个本地 PM2 投影。</p>
              <p>生命周期将显示 REQUESTED → PROVISIONING → STARTING → ACTIVE。</p>
              <p>不会执行 Shell、PM2 命令、数据库写入或远程操作。</p>
            </div>
          )}
        </section>
        <footer className="wizard-actions">
          <Button disabled={step === 0} onClick={() => setStep((current) => current - 1)}>
            上一步
          </Button>
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={() => setStep((current) => current + 1)}>
              下一步
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                const result = source.createRuntimeDeployment(draft);
                navigate(`/runtime/deployments/${result.deployment.deploymentId}`);
              }}
            >
              提交模拟创建
            </Button>
          )}
        </footer>
      </Wizard>
    </>
  );
}

function Field({ label, children }: PropsWithChildren<{ readonly label: string }>) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
