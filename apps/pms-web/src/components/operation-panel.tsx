import { useSyncExternalStore } from "react";
import { usePmsWebDataSource } from "../data/context.js";
import { Button, StatusBadge } from "./ui.js";

export function OperationPanel() {
  const source = usePmsWebDataSource();
  const operations = useSyncExternalStore(
    (listener) => source.subscribe(listener),
    () => source.operations(),
    () => source.operations(),
  );
  if (operations.length === 0) return null;
  return (
    <aside className="operation-panel" aria-label="模拟操作面板">
      <header>
        <strong>Prototype Operations</strong>
        <span>仅浏览器内存</span>
      </header>
      {operations.map((operation) => (
        <article key={operation.operationId}>
          <div>
            <strong>{operation.label}</strong>
            <StatusBadge status={operation.status} />
          </div>
          <ol>
            {operation.steps.map((step) => (
              <li key={step.id} data-status={step.status}>
                {step.label} · {step.status}
              </li>
            ))}
          </ol>
          {operation.status === "COMPLETED" || operation.status === "FAILED" ? (
            <small>{operation.resultMessage}</small>
          ) : (
            <Button onClick={() => source.advanceOperation(operation.operationId)}>
              推进模拟步骤
            </Button>
          )}
        </article>
      ))}
    </aside>
  );
}
