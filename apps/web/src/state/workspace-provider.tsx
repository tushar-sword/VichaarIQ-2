"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { createWorkspaceStore, type WorkspaceStore } from "../lib/workspace-store";

const WorkspaceContext = createContext<WorkspaceStore | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(() => createWorkspaceStore());
  useEffect(() => () => store.actions.cancelPending(), [store]);
  return <WorkspaceContext.Provider value={store}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const store = useContext(WorkspaceContext);
  if (!store) throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...state, ...store.actions };
}
