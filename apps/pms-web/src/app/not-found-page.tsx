export default function NotFoundPage() {
  return (
    <section className="panel">
      <h1>页面不存在</h1>
      <p>当前 URL 未注册为 PMS Web 正式路由。</p>
      <a href="/dashboard">返回工作台</a>
    </section>
  );
}
