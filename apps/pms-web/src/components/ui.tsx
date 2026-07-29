import {
  type ButtonHTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import type { EntityStatus } from "../data/types.js";

export function StatusBadge({ status }: { readonly status: EntityStatus | string }) {
  return <span className={`status status-${status.toLowerCase()}`}>● {status}</span>;
}

export function HealthIndicator({
  label,
  status,
}: {
  readonly label: string;
  readonly status: EntityStatus;
}) {
  return (
    <span className="health-indicator">
      <StatusBadge status={status} /> <span>{label}</span>
    </span>
  );
}

export function MetricCard({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly hint?: string;
}) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint === undefined ? null : <small>{hint}</small>}
    </article>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  readonly title: string;
  readonly description: string;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <Breadcrumbs items={["PMS", title]} />
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-actions">{actions}</div>
    </header>
  );
}

export function Breadcrumbs({ items }: { readonly items: readonly string[] }) {
  return (
    <nav aria-label="面包屑" className="breadcrumbs">
      {items.join(" / ")}
    </nav>
  );
}

export function Button({
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  return <button {...props} className={`button button-${variant} ${props.className ?? ""}`} />;
}

export function FilterBar({ children }: PropsWithChildren) {
  return <div className="filter-bar">{children}</div>;
}

export function DataTable({
  columns,
  rows,
}: {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly ReactNode[])[];
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={String(rowIndex)}>
              {row.map((cell, cellIndex) => (
                <td key={String(cellIndex)}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DetailDrawer({
  title,
  open,
  onClose,
  returnFocus,
  children,
}: PropsWithChildren<{
  readonly title: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly returnFocus?: HTMLElement | null;
}>) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
      returnFocus?.focus();
    };
  }, [onClose, open, returnFocus]);
  if (!open) return null;
  return (
    <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header>
        <h2 id={titleId}>{title}</h2>
        <button
          ref={closeRef}
          className="button button-ghost"
          onClick={onClose}
          aria-label="关闭详情"
        >
          ×
        </button>
      </header>
      <div className="drawer-content">{children}</div>
    </aside>
  );
}

export function ConfirmDialog({
  title,
  open,
  impact,
  onCancel,
  onConfirm,
}: {
  readonly title: string;
  readonly open: boolean;
  readonly impact: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop">
      <section className="dialog" role="alertdialog" aria-modal="true">
        <h2>{title}</h2>
        <p>{impact}</p>
        <p className="prototype-note">此操作仅修改浏览器内的 Mock Data。</p>
        <div className="dialog-actions">
          <Button onClick={onCancel}>取消</Button>
          <Button variant="danger" onClick={onConfirm}>
            确认模拟操作
          </Button>
        </div>
      </section>
    </div>
  );
}

export function StepProgress({
  steps,
  current,
}: {
  readonly steps: readonly string[];
  readonly current: number;
}) {
  return (
    <ol className="step-progress">
      {steps.map((step, index) => (
        <li
          key={step}
          aria-current={index === current ? "step" : undefined}
          data-complete={index < current}
        >
          <span>{String(index + 1)}</span>
          {step}
        </li>
      ))}
    </ol>
  );
}

export function Wizard({ children }: PropsWithChildren) {
  return <section className="wizard">{children}</section>;
}

export function Timeline({
  items,
}: {
  readonly items: readonly { readonly label: string; readonly meta?: string }[];
}) {
  return (
    <ol className="timeline">
      {items.map((item) => (
        <li key={`${item.label}-${item.meta ?? ""}`}>
          <strong>{item.label}</strong>
          <small>{item.meta}</small>
        </li>
      ))}
    </ol>
  );
}

export function DiffViewer({ before, after }: { readonly before: string; readonly after: string }) {
  return (
    <div className="diff-viewer">
      <pre aria-label="变更前">{before}</pre>
      <pre aria-label="变更后">{after}</pre>
    </div>
  );
}

export function CodeOrJsonViewer({ value }: { readonly value: unknown }) {
  return (
    <pre className="code-viewer">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function EmptyState({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) {
  return (
    <section className="state-panel">
      <strong>{title}</strong>
      <p>{description}</p>
    </section>
  );
}

export function ErrorState({
  code,
  impact,
  action,
}: {
  readonly code: string;
  readonly impact: string;
  readonly action: string;
}) {
  return (
    <section className="state-panel state-error">
      <strong>{code}</strong>
      <p>{impact}</p>
      <small>建议：{action}</small>
    </section>
  );
}

export function Skeleton({ lines = 4 }: { readonly lines?: number }) {
  return (
    <div className="skeleton" aria-label="正在加载">
      {Array.from({ length: lines }, (_, index) => (
        <span key={String(index)} />
      ))}
    </div>
  );
}

export function Toast({ children }: PropsWithChildren) {
  return (
    <div className="toast" role="status">
      {children}
    </div>
  );
}
