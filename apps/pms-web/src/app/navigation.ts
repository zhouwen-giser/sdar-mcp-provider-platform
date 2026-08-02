interface NavigableRouter {
  navigate(to: string): Promise<void>;
}
let activeRouter: NavigableRouter | undefined;
export function registerRouter(router: NavigableRouter) {
  activeRouter = router;
}
export function navigate(path: string) {
  if (!activeRouter) throw new Error("PMS_ROUTER_NOT_READY");
  const browserLocation = (
    globalThis as unknown as { location: { search: string; origin: string } }
  ).location;
  const scenario = new URLSearchParams(browserLocation.search).get("scenario");
  const url = new URL(path, browserLocation.origin);
  if (scenario && !url.searchParams.has("scenario")) url.searchParams.set("scenario", scenario);
  void activeRouter.navigate(`${url.pathname}${url.search}`);
}
