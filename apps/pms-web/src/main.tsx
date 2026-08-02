import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { RootErrorBoundary } from "./app/error-boundaries/root-error-boundary.js";
import { AppProviders } from "./app/providers/app-providers.js";
import "./styles.css";

const root = document.getElementById("app");
if (root === null) throw new Error("PMS_WEB_ROOT_MISSING");
createRoot(root).render(
  <StrictMode>
    <RootErrorBoundary>
      <AppProviders>
        <App />
      </AppProviders>
    </RootErrorBoundary>
  </StrictMode>,
);
