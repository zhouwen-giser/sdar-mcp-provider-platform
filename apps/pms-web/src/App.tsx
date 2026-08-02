import { RouterProvider } from "react-router-dom";
import { router } from "./app/router.js";
import ApiModeUnconfiguredPage from "./app/api-mode-unconfigured-page.js";
import { dataMode } from "./gateways/factory.js";

export function App() {
  if (dataMode() === "api") return <ApiModeUnconfiguredPage />;
  return <RouterProvider router={router} />;
}
