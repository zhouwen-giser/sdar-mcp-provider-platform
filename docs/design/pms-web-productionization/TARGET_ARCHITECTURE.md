# Target Architecture

```text
RouterProvider / BrowserRouter
  -> AppShell Layout + Outlet
  -> route-level lazy feature
  -> feature ViewModel
  -> TanStack Query adapter
  -> domain Gateway contract
  -> mock Gateway implementation
  -> existing scenario-aware mock engine
```

横切能力包括 Root Error Boundary、Route Error Boundary、`UiProblem`、统一 QueryClient、生产模式失败关闭、架构静态检查和 Workspace 脚本。
