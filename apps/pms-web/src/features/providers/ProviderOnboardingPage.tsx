import { useState } from "react";
import { usePmsWebDataSource } from "../../data/context.js";
import type { MockCheckResult, ProviderOnboardingDraft } from "../../data/types.js";
import { navigate } from "../../router.js";
import {
  Button,
  CodeOrJsonViewer,
  ErrorState,
  PageHeader,
  StatusBadge,
  StepProgress,
  Wizard,
} from "../../components/ui.js";

const steps = ["身份", "Adapter", "数据库", "Runtime", "预检查", "确认"];

const initialDraft: ProviderOnboardingDraft = {
  name: "",
  providerId: "",
  packageId: "home-assistant-climate",
  hostingMode: "platform-managed",
  adapterEndpoint: "mock://adapter.local",
  databaseProfileId: "",
  runtimeRelease: "",
  environment: "production-mock",
};

export function ProviderOnboardingPage() {
  const source = usePmsWebDataSource();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(initialDraft);
  const [adapterCheck, setAdapterCheck] = useState<MockCheckResult>();
  const [preflight, setPreflight] = useState<MockCheckResult>();
  const [errors, setErrors] = useState<readonly string[]>([]);
  const update = <K extends keyof ProviderOnboardingDraft>(
    key: K,
    value: ProviderOnboardingDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const next = () => {
    const nextErrors = validateOnboardingStep(step, draft, adapterCheck, preflight);
    setErrors(nextErrors);
    if (nextErrors.length === 0) setStep((current) => Math.min(current + 1, steps.length - 1));
  };
  const submit = () => {
    const nextErrors = validateOnboardingStep(5, draft, adapterCheck, preflight);
    setErrors(nextErrors);
    if (nextErrors.length > 0) return;
    const result = source.onboardProvider(draft);
    navigate(`/providers/${result.provider.providerId}`);
  };

  return (
    <>
      <PageHeader
        title="接入 Provider"
        description="六步交互原型；Adapter、数据库和 Runtime 检查均为 Mock。"
        actions={<span className="prototype-note">模拟操作</span>}
      />
      <Wizard>
        <StepProgress steps={steps} current={step} />
        {errors.length > 0 && (
          <ErrorState
            code="MOCK_ONBOARDING_BLOCKED"
            impact={errors.join("；")}
            action="修正当前步骤后继续"
          />
        )}
        <section className="wizard-body">
          {step === 0 && (
            <div className="form-grid">
              <label>
                显示名称
                <input
                  value={draft.name}
                  onChange={(event) => update("name", event.target.value)}
                />
              </label>
              <label>
                Provider ID
                <input
                  value={draft.providerId}
                  placeholder="provider-example"
                  onChange={(event) => update("providerId", event.target.value)}
                />
              </label>
              <label>
                Provider Package
                <select
                  value={draft.packageId}
                  onChange={(event) => update("packageId", event.target.value)}
                >
                  <option value="home-assistant-climate">home-assistant-climate</option>
                  <option value="ugv">ugv</option>
                  <option value="npc-tank">npc-tank</option>
                </select>
              </label>
              <label>
                环境
                <select
                  value={draft.environment}
                  onChange={(event) => update("environment", event.target.value)}
                >
                  <option value="production-mock">production-mock</option>
                  <option value="staging-mock">staging-mock</option>
                </select>
              </label>
            </div>
          )}
          {step === 1 && (
            <div className="form-grid">
              <label>
                Hosting Mode
                <select
                  value={draft.hostingMode}
                  onChange={(event) =>
                    update(
                      "hostingMode",
                      event.target.value as ProviderOnboardingDraft["hostingMode"],
                    )
                  }
                >
                  <option value="platform-managed">platform-managed</option>
                  <option value="vendor-managed">vendor-managed</option>
                </select>
              </label>
              <label>
                Adapter Endpoint
                <input
                  value={draft.adapterEndpoint}
                  onChange={(event) => {
                    update("adapterEndpoint", event.target.value);
                    setAdapterCheck(undefined);
                  }}
                />
              </label>
              <Button
                type="button"
                onClick={() => void source.checkAdapter(draft).then(setAdapterCheck)}
              >
                运行 Mock Adapter 检查
              </Button>
              {adapterCheck === undefined ? null : (
                <div className="check-result">
                  <StatusBadge status={adapterCheck.passed ? "ACTIVE" : "FAILED"} />
                  <p>{adapterCheck.summary}</p>
                </div>
              )}
            </div>
          )}
          {step === 2 && (
            <div className="form-grid">
              <label>
                Database Profile
                <select
                  value={draft.databaseProfileId}
                  onChange={(event) => update("databaseProfileId", event.target.value)}
                >
                  <option value="">请选择</option>
                  <option value="db-profile-production-shared">production-shared (Mock)</option>
                  <option value="db-profile-staging">staging (Mock)</option>
                </select>
              </label>
              <p className="muted">仅选择引用 ID；原型不展示连接串或 Secret。</p>
            </div>
          )}
          {step === 3 && (
            <div className="form-grid">
              <label>
                Runtime Release
                <select
                  value={draft.runtimeRelease}
                  onChange={(event) => update("runtimeRelease", event.target.value)}
                >
                  <option value="">请选择</option>
                  <option value="@sdar/runtime@2.0.0-rc.1">@sdar/runtime@2.0.0-rc.1</option>
                </select>
              </label>
              <p>将模拟创建 Desired State = ACTIVE 的 RuntimeDeployment。</p>
            </div>
          )}
          {step === 4 && (
            <div>
              <Button
                type="button"
                variant="primary"
                onClick={() => void source.preflightProvider(draft).then(setPreflight)}
              >
                执行 Mock 预检查
              </Button>
              {preflight === undefined ? (
                <p className="muted">尚未执行预检查。</p>
              ) : (
                <div className="check-result">
                  <StatusBadge status={preflight.passed ? "ACTIVE" : "BLOCKED"} />
                  <p>{preflight.summary}</p>
                  {preflight.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </div>
              )}
            </div>
          )}
          {step === 5 && (
            <div>
              <h2>确认模拟接入</h2>
              <CodeOrJsonViewer value={draft} />
              <p className="prototype-note">
                提交仅创建 PrototypeOperation 和浏览器内存 Provider，不执行真实接入。
              </p>
            </div>
          )}
        </section>
        <footer className="wizard-actions">
          <Button
            type="button"
            disabled={step === 0}
            onClick={() => {
              setErrors([]);
              setStep((current) => Math.max(0, current - 1));
            }}
          >
            上一步
          </Button>
          <Button type="button" onClick={() => navigate("/providers")}>
            取消
          </Button>
          {step < steps.length - 1 ? (
            <Button type="button" variant="primary" onClick={next}>
              下一步
            </Button>
          ) : (
            <Button type="button" variant="primary" onClick={submit}>
              提交模拟接入
            </Button>
          )}
        </footer>
      </Wizard>
    </>
  );
}

export function validateOnboardingStep(
  step: number,
  draft: ProviderOnboardingDraft,
  adapterCheck?: MockCheckResult,
  preflight?: MockCheckResult,
): readonly string[] {
  if (step === 0) {
    return [
      ...(draft.name.trim().length < 2 ? ["显示名称至少 2 个字符"] : []),
      ...(!/^provider-[a-z0-9-]+$/.test(draft.providerId)
        ? ["Provider ID 必须使用 provider- 前缀和小写字符"]
        : []),
    ];
  }
  if (step === 1 && adapterCheck?.passed !== true) return ["请先通过 Mock Adapter 检查"];
  if (step === 2 && draft.databaseProfileId.length === 0) return ["请选择 Database Profile"];
  if (step === 3 && draft.runtimeRelease.length === 0) return ["请选择 Runtime Release"];
  if ((step === 4 || step === 5) && preflight?.passed !== true) {
    return ["请先通过 Mock 预检查"];
  }
  return [];
}
