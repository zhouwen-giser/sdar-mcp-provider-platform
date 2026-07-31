interface NavigableRouter { navigate(to:string):Promise<void>; }
let activeRouter:NavigableRouter|undefined;
export function registerRouter(router:NavigableRouter){activeRouter=router;}
export function navigate(path:string){if(!activeRouter)throw new Error("PMS_ROUTER_NOT_READY");const scenario=new URLSearchParams(location.search).get("scenario");const url=new URL(path,location.origin);if(scenario&&!url.searchParams.has("scenario"))url.searchParams.set("scenario",scenario);void activeRouter.navigate(`${url.pathname}${url.search}`);}
