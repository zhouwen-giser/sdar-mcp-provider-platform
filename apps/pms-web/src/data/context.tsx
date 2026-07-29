import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { MockPmsWebDataSource } from "./mock-data-source.js";
import { isPrototypeScenario } from "./scenarios.js";
import type { PmsWebDataSource, PrototypeScenario } from "./types.js";

const DataSourceContext = createContext<PmsWebDataSource | undefined>(undefined);

export function PmsWebDataSourceProvider({
  children,
  dataSource,
}: PropsWithChildren<{ readonly dataSource?: PmsWebDataSource }>) {
  const value = useMemo(
    () => dataSource ?? new MockPmsWebDataSource(scenarioFromUrl()),
    [dataSource],
  );
  return <DataSourceContext.Provider value={value}>{children}</DataSourceContext.Provider>;
}

export function usePmsWebDataSource(): PmsWebDataSource {
  const value = useContext(DataSourceContext);
  if (value === undefined) throw new Error("PMS_WEB_DATA_SOURCE_REQUIRED");
  return value;
}

export function useScenario(): [PrototypeScenario, (scenario: PrototypeScenario) => void] {
  const source = usePmsWebDataSource();
  const scenario = useSyncExternalStore(
    (listener) => source.subscribe(listener),
    () => source.scenario(),
    () => source.scenario(),
  );
  const update = (next: PrototypeScenario) => {
    const url = new URL(window.location.href);
    url.searchParams.set("scenario", next);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    source.setScenario(next);
  };
  return [scenario, update];
}

export function useDataQuery<T>(query: (source: PmsWebDataSource) => Promise<T>) {
  const source = usePmsWebDataSource();
  const scenario = useSyncExternalStore(
    (listener) => source.subscribe(listener),
    () => source.scenario(),
    () => source.scenario(),
  );
  const [state, setState] = useState<
    | { readonly status: "loading" }
    | { readonly status: "success"; readonly data: T }
    | { readonly status: "error"; readonly error: Error }
  >({ status: "loading" });
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void query(source).then(
      (data) => active && setState({ status: "success", data }),
      (error: unknown) =>
        active &&
        setState({
          status: "error",
          error: error instanceof Error ? error : new Error("MOCK_DATA_ERROR"),
        }),
    );
    return () => {
      active = false;
    };
  }, [query, scenario, source]);
  return state;
}

function scenarioFromUrl(): PrototypeScenario {
  const value = new URLSearchParams(window.location.search).get("scenario");
  return isPrototypeScenario(value) ? value : "healthy";
}
