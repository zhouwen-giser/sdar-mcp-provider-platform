import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import { ClientWorkspaceStore } from "./store.js";
import { dataMode } from "../gateways/factory.js";
const Context = createContext<ClientWorkspaceStore | undefined>(undefined);
export function ClientWorkspaceProvider({
  children,
  store,
}: PropsWithChildren<{ readonly store?: ClientWorkspaceStore }>) {
  const value = useMemo(() => store ?? new ClientWorkspaceStore(dataMode()), [store]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useClientWorkspaceStore() {
  const value = useContext(Context);
  if (value === undefined) throw new Error("CLIENT_WORKSPACE_REQUIRED");
  return value;
}
export function useClientWorkspace() {
  const store = useClientWorkspaceStore();
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}
