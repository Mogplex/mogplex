"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

const SelfHostedContext = createContext(false);

/** Carries the server's self-host mode to client UI that hides billing. */
export function SelfHostedProvider({
  selfHosted,
  children,
}: {
  selfHosted: boolean;
  children: ReactNode;
}) {
  return (
    <SelfHostedContext.Provider value={selfHosted}>
      {children}
    </SelfHostedContext.Provider>
  );
}

export function useSelfHostedMode(): boolean {
  return useContext(SelfHostedContext);
}
