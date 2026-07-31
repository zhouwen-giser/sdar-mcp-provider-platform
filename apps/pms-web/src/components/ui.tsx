import {
  type ButtonHTMLAttributes,
  type FormEvent,
  type PropsWithChildren,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { toUiProblem } from "../shared/errors/ui-problem.js";

export function StatusBadge({ status }: { readonly status: string }) {
  return <span className={`status status-${status.toLowerCase().replaceAll("_", "-")}`}>● {status}</span>;
}
export function MetricCard({ label, value, hint }: { readonly label: string; readonly value: ReactNode; readonly hint?: string }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong>{hint === undefined ? null : <small>{hint}</small>}</article>;
}
export function PageHeader({ title, description, actions, classification }: { readonly title: string; readonly description: string; readonly actions?: ReactNode; readonly classification?: "FROZEN_API" | "WEB_COMPOSED" | "CLIENT_ONLY" | "DEFERRED" | "FORBIDDEN" }) {
  return <header className="page-header"><div><Breadcrumbs items={["PMS", title]} /><div className="heading-line"><h1>{title}</h1>{classification === undefined ? null : <ClassificationBadge value={classification} />}</div><p>{description}</p></div><div className="page-actions">{actions}</div></header>;
}
export function Breadcrumbs({ items }: { readonly items: readonly string[] }) { return <nav aria-label="面包屑" className="breadcrumbs">{items.join(" / ")}</nav>; }
export function ClassificationBadge({ value }: { readonly value: string }) { return <span className={`classification classification-${value.toLowerCase().replaceAll("_", "-")}`}>{value}</span>; }
export function Button({ variant = "secondary", busy = false, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { readonly variant?: "primary" | "secondary" | "danger" | "ghost"; readonly busy?: boolean }) { return <button {...props} disabled={busy || props.disabled} aria-busy={busy} className={`button button-${variant} ${props.className ?? ""}`}>{busy ? "处理中…" : props.children}</button>; }
export function FilterBar({ children }: PropsWithChildren) { return <div className="filter-bar">{children}</div>; }
export function DataTable({ columns, rows, emptyTitle = "暂无数据", emptyDescription = "调整筛选条件或切换场景。" }: { readonly columns: readonly string[]; readonly rows: readonly (readonly ReactNode[])[]; readonly emptyTitle?: string; readonly emptyDescription?: string }) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return <div className="table-wrap"><table><thead><tr>{columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={String(rowIndex)}>{row.map((cell, cellIndex) => <td key={String(cellIndex)}>{cell}</td>)}</tr>)}</tbody></table></div>;
}
export function DetailDrawer({ title, open, onClose, returnFocus, children }: PropsWithChildren<{ readonly title: string; readonly open: boolean; readonly onClose: () => void; readonly returnFocus?: HTMLElement | null }>) {
  const titleId = useId(); const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!open) return; closeRef.current?.focus(); const listener = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", listener); return () => { window.removeEventListener("keydown", listener); returnFocus?.focus(); }; }, [onClose, open, returnFocus]);
  if (!open) return null;
  return <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}><header><h2 id={titleId}>{title}</h2><button ref={closeRef} className="button button-ghost" onClick={onClose} aria-label="关闭详情">×</button></header><div className="drawer-content">{children}</div></aside>;
}
export function ConfirmDialog({ title, open, impact, confirmText = "确认执行", requirePhrase, reasonRequired = false, busy = false, onCancel, onConfirm }: { readonly title: string; readonly open: boolean; readonly impact: ReactNode; readonly confirmText?: string; readonly requirePhrase?: string; readonly reasonRequired?: boolean; readonly busy?: boolean; readonly onCancel: () => void; readonly onConfirm: (reason: string) => void }) {
  const [phrase, setPhrase] = useState(""); const [reason, setReason] = useState("");
  if (!open) return null;
  const disabled = busy || (requirePhrase !== undefined && phrase !== requirePhrase) || (reasonRequired && reason.trim().length < 4);
  return <div className="dialog-backdrop"><section className="dialog" role="alertdialog" aria-modal="true"><h2>{title}</h2><div className="impact-box">{impact}</div>{reasonRequired ? <label className="form-field"><span>操作原因</span><textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="至少 4 个字符；仅作为当前交互记录" /></label> : null}{requirePhrase === undefined ? null : <label className="form-field"><span>输入 <code>{requirePhrase}</code> 完成二次确认</span><input value={phrase} onChange={event => setPhrase(event.target.value)} /></label>}<div className="dialog-actions"><Button onClick={onCancel}>取消</Button><Button variant="danger" busy={busy} disabled={disabled} onClick={() => onConfirm(reason)}>{confirmText}</Button></div></section></div>;
}
export function StepProgress({ steps, current }: { readonly steps: readonly string[]; readonly current: number }) { return <ol className="step-progress">{steps.map((step, index) => <li key={step} aria-current={index === current ? "step" : undefined} data-complete={index < current}><span>{String(index + 1)}</span>{step}</li>)}</ol>; }
export function Wizard({ children }: PropsWithChildren) { return <section className="wizard">{children}</section>; }
export function Timeline({ items }: { readonly items: readonly { readonly label: string; readonly meta?: string; readonly status?: string }[] }) { return <ol className="timeline">{items.map((item, index) => <li key={`${item.label}-${item.meta ?? index}`}><strong>{item.label}</strong><small>{item.meta}</small>{item.status === undefined ? null : <StatusBadge status={item.status} />}</li>)}</ol>; }
export function DiffViewer({ before, after }: { readonly before: string; readonly after: string }) { return <div className="diff-viewer"><pre aria-label="变更前">{before}</pre><pre aria-label="变更后">{after}</pre></div>; }
export function CodeOrJsonViewer({ value }: { readonly value: unknown }) { return <pre className="code-viewer">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>; }
export function EmptyState({ title, description, action }: { readonly title: string; readonly description: string; readonly action?: ReactNode }) { return <section className="state-panel"><strong>{title}</strong><p>{description}</p>{action}</section>; }
export function ErrorState({ error, action }: { readonly error: unknown; readonly action?: ReactNode }) { const problem = toUiProblem(error); return <section className="state-panel state-error"><strong>{problem.code} · {problem.title}</strong><p>{problem.detail}</p>{problem.correlationId === undefined ? null : <small>Correlation ID: <code>{problem.correlationId}</code></small>}{action}</section>; }
export function Skeleton({ lines = 4 }: { readonly lines?: number }) { return <div className="skeleton" aria-label="正在加载">{Array.from({ length: lines }, (_, index) => <span key={String(index)} />)}</div>; }
export function Toast({ children, tone = "success" }: PropsWithChildren<{ readonly tone?: "success" | "error" | "info" }>) { return <div className={`toast toast-${tone}`} role="status">{children}</div>; }
export function DeferredCapability({ title, reason, children }: PropsWithChildren<{ readonly title: string; readonly reason: string }>) { return <section className="panel deferred-panel"><div><ClassificationBadge value="DEFERRED" /><h2>{title}</h2><p>{reason}</p></div>{children}</section>; }
export function LocalOnlyNotice({ children }: PropsWithChildren) { return <section className="local-only-notice"><ClassificationBadge value="CLIENT_ONLY" /><span>{children}</span></section>; }
export function QuerySurface<T>({ query, children, emptyTitle = "暂无数据" }: { readonly query: { readonly isPending: boolean; readonly isError: boolean; readonly error: unknown; readonly data: T | undefined; readonly isFetching?: boolean; readonly isStale?: boolean }; readonly children: (data: T) => ReactNode; readonly emptyTitle?: string }) {
  if (query.isPending) return <Skeleton lines={8} />;
  if (query.isError) return <ErrorState error={query.error} />;
  if (query.data === undefined) return <EmptyState title={emptyTitle} description="查询未返回可展示的数据。" />;
  return <>{query.isFetching ? <div className="refresh-indicator">正在后台刷新</div> : null}{query.isStale ? <div className="stale-indicator">缓存数据可能已过期</div> : null}{children(query.data)}</>;
}
export function KeyValueList({ entries }: { readonly entries: readonly [string, ReactNode][] }) { return <dl className="key-value-list">{entries.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>; }
export function Tabs({ items, current, onChange }: { readonly items: readonly { readonly id: string; readonly label: string }[]; readonly current: string; readonly onChange: (id: string) => void }) { return <nav className="tabs" aria-label="页面区域">{items.map(item => <button key={item.id} aria-current={item.id === current ? "page" : undefined} onClick={() => onChange(item.id)}>{item.label}</button>)}</nav>; }
export function FormField({ label, children, hint }: PropsWithChildren<{ readonly label: string; readonly hint?: string }>) { return <label className="form-field"><span>{label}</span>{children}{hint === undefined ? null : <small>{hint}</small>}</label>; }
export function FormActions({ onCancel, submitLabel, busy = false, disabled = false }: { readonly onCancel?: () => void; readonly submitLabel: string; readonly busy?: boolean; readonly disabled?: boolean }) { return <div className="page-actions">{onCancel === undefined ? null : <Button type="button" onClick={onCancel}>取消</Button>}<Button type="submit" variant="primary" busy={busy} disabled={disabled}>{submitLabel}</Button></div>; }
export function SimpleForm({ onSubmit, children }: PropsWithChildren<{ readonly onSubmit: () => void }>) { return <form onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit(); }}>{children}</form>; }
