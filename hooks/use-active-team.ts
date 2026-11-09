"use client";

import { createContext, useContext } from "react";

export const ActiveScopeContext = createContext<{
  teamId: string | null;
}>({
  teamId: null,
});

export function useActiveTeamId() {
  return useContext(ActiveScopeContext).teamId;
}
