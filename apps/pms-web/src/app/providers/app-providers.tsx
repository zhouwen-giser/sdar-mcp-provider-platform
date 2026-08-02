import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "../query-client.js";
import { createGateways } from "../../gateways/factory.js";
import type { GatewayBundle } from "../../gateways/contracts/index.js";
import { isProductScenario, type ProductScenario } from "../../scenarios/types.js";
import { ClientWorkspaceProvider } from "../../client-workspace/context.js";

const GatewayContext = createContext<GatewayBundle | undefined>(undefined);

function scenarioFromUrl(): ProductScenario {
  const value = new URLSearchParams(globalThis.location?.search ?? "").get("scenario");
  return isProductScenario(value) ? value : "healthy";
}

export function AppProviders({
  children,
  gateways,
}: PropsWithChildren<{ readonly gateways?: GatewayBundle }>) {
  const value = useMemo(() => gateways ?? createGateways(scenarioFromUrl()), [gateways]);
  return (
    <QueryClientProvider client={queryClient}>
      <GatewayContext.Provider value={value}>
        <ClientWorkspaceProvider>{children}</ClientWorkspaceProvider>
      </GatewayContext.Provider>
    </QueryClientProvider>
  );
}

export function useGateways(): GatewayBundle {
  const gateways = useContext(GatewayContext);
  if (gateways === undefined) throw new Error("PMS_GATEWAYS_REQUIRED");
  return gateways;
}

export function useScenario(): readonly [ProductScenario, (next: ProductScenario) => void] {
  const gateways = useGateways();
  const query = useQueryClient();
  const current = useSyncExternalStore(
    (listener) => gateways.scenarios.subscribe(listener),
    () => gateways.scenarios.current(),
    () => gateways.scenarios.current(),
  );
  return [
    current,
    (next) => {
      const url = new URL(globalThis.location.href);
      url.searchParams.set("scenario", next);
      globalThis.history.replaceState({}, "", `${url.pathname}${url.search}`);
      gateways.scenarios.set(next);
      void query.invalidateQueries();
    },
  ] as const;
}
