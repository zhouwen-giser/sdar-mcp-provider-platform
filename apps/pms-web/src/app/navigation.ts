interface NavigableRouter {
  navigate(to: string): Promise<void>;
}
let activeRouter: NavigableRouter | undefined;
export function registerRouter(router: NavigableRouter) {
  activeRouter = router;
}
export function navigate(path: string) {
  if (!activeRouter) throw new Error("PMS_ROUTER_NOT_READY");
  void activeRouter.navigate(preserveNavigationContext(path));
}
export function preserveNavigationContext(path: string): string {
  const browserLocation = (
    globalThis as unknown as { location: { search: string; origin: string } }
  ).location;
  const current = new URLSearchParams(browserLocation.search);
  const url = new URL(path, browserLocation.origin);
  for (const name of ["scenario", "environment"] as const) {
    if (url.searchParams.has(name)) continue;
    for (const value of current.getAll(name)) url.searchParams.append(name, value);
  }
  return `${url.pathname}${url.search}`;
}
