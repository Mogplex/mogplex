"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useModelChain } from "@/components/library/use-model-chain";

type ModelChainState = ReturnType<typeof useModelChain>;

const ModelChainContext = createContext<ModelChainState | null>(null);

/**
 * Holds the unsaved routing-chain draft above the Catalog and Configuration
 * routes so a "Use as primary" click in the catalog survives switching tabs.
 */
export function ModelChainProvider({ children }: { children: ReactNode }) {
  const chain = useModelChain();
  return (
    <ModelChainContext.Provider value={chain}>
      {children}
    </ModelChainContext.Provider>
  );
}

export function useModelChainContext(): ModelChainState {
  const value = useContext(ModelChainContext);
  if (!value) {
    throw new Error(
      "useModelChainContext must be used inside <ModelChainProvider>"
    );
  }
  return value;
}
