import { Button, CodeOrJsonViewer, PageHeader } from "../../components/ui.js";

export function McpExplorerPage() {
  return (
    <>
      <PageHeader title="MCP Explorer" description="结构化只读占位；原型不会发送 MCP 或网络请求。" actions={<Button disabled>发送请求（不可用）</Button>} />
      <div className="grid-two">
        <section className="panel">
          <h2>Request composer</h2>
          <CodeOrJsonViewer value={{ method: "tools/call", params: { name: "select_mock_operation" } }} />
          <p className="prototype-note">NO REQUEST SENT · 无 fetch、WebSocket 或真实 MCP transport。</p>
        </section>
        <section className="panel"><h2>Response preview</h2><p className="muted">选择 Mock Evidence 后可在后续版本预览。</p></section>
      </div>
    </>
  );
}
