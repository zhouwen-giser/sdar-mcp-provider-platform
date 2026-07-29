import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { PmsWebDataSourceProvider } from "./data/context.js";

const root = document.getElementById("app");
if (root === null) throw new Error("PMS_WEB_ROOT_MISSING");

createRoot(root).render(
  <StrictMode>
    <PmsWebDataSourceProvider>
      <App />
    </PmsWebDataSourceProvider>
  </StrictMode>,
);
