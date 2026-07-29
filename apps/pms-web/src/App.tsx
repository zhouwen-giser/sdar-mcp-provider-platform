import { useEffect } from "react";
import { AppShell } from "./components/shell.js";
import { OperationPanel } from "./components/operation-panel.js";
import {
  ComponentCatalogue,
  ScenarioCatalogue,
  StructuredPlaceholder,
} from "./pages/foundation.js";
import { navigate, useRoute } from "./router.js";
import "./styles.css";

export function App() {
  const route = useRoute();
  useEffect(() => {
    if (window.location.pathname === "/") navigate("/dashboard");
  }, []);
  if (window.location.pathname === "/") return null;
  return (
    <AppShell route={route} operationPanel={<OperationPanel />}>
      {route === undefined ? (
        <StructuredPlaceholder
          route={{
            path: window.location.pathname,
            title: "页面不存在",
            group: "Error",
            level: "P1",
          }}
        />
      ) : route.path === "/_prototype/components" ? (
        <ComponentCatalogue />
      ) : route.path === "/_prototype/scenarios" ? (
        <ScenarioCatalogue />
      ) : (
        <StructuredPlaceholder route={route} />
      )}
    </AppShell>
  );
}
