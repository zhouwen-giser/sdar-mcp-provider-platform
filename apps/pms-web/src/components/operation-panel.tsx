import { useClientWorkspace, useClientWorkspaceStore } from "../client-workspace/context.js";
import { navigate } from "../app/navigation.js";
import { Button, StatusBadge } from "./ui.js";

export function OperationPanel() {
  const snapshot = useClientWorkspace();
  const store = useClientWorkspaceStore();
  const operations = snapshot.operations.filter(item => item.status === "ACCEPTED" || item.status === "RUNNING").slice(0, 3);
  if (operations.length === 0) return null;
  return <aside className="operation-panel" aria-label="操作反馈面板"><header><strong>Operation feedback</strong><span>Runtime Intent + Job + Audit read model</span></header>{operations.map(operation=><article key={operation.operationId}><div><button className="table-link" onClick={()=>navigate(`/operations/${operation.operationId}`)}>{operation.kind}</button><StatusBadge status={operation.status}/></div><p>{operation.subjectId} · {operation.progress}%</p><ol>{operation.timeline.map(step=><li key={step}>{step}</li>)}</ol><Button onClick={()=>store.advanceOperation(operation.operationId)}>推进本地 Job 投影</Button></article>)}</aside>;
}
