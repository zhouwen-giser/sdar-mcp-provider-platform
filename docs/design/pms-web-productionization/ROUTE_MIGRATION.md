# Route Migration

- 删除 `App.tsx` 页面 if/else 分发，改为 `createBrowserRouter`。
- `AppShell` 成为 Layout Route，并通过 `Outlet` 承载页面。
- 123 条路由清单继续作为正式路径元数据来源。
- 支持参数路由、Query 参数、浏览器前进后退、Not Found、Route Error Boundary。
- Dashboard、Provider、Runtime、Configuration、Catalog/Registry、Operations、Audit/System 采用动态 import。
- 旧页面中的 `navigate()` 暂保留为兼容适配器，但其实现委托给 React Router 实例，不再使用 `pushState` 或 `popstate`。
- `/_prototype/*` 仅在开发模式且显式允许时注册。
