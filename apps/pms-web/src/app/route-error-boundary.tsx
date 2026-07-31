import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { toUiProblem } from "../shared/errors/ui-problem.js";
export function RouteErrorBoundary(){
  const error=useRouteError();
  if(isRouteErrorResponse(error)){return <section className="panel"><h1>{error.status} {error.statusText}</h1><p>{String(error.data??"")}</p><code>PMS_ROUTE_ERROR</code><p><a href="/dashboard">返回工作台</a></p></section>;}
  const problem=toUiProblem(error);
  return <section className="panel"><h1>{problem.title}</h1><p>{problem.detail}</p><code>{problem.code}</code><p><a href="/dashboard">返回工作台</a></p></section>;
}
