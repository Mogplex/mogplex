"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { ActiveScopeContext } from "@/hooks/use-active-team";
import {
  getActiveTeamIdForRequests,
  setActiveTeamIdForRequests,
} from "@/lib/active-team-request";

export {
  fetchWithActiveTeam,
  getActiveTeamIdForRequests,
  getActiveTeamRequestHeaders,
  setActiveTeamIdForRequests,
} from "@/lib/active-team-request";

export { useActiveTeamId } from "@/hooks/use-active-team";

export function ActiveScopeProvider({
  teamId,
  children,
}: {
  teamId: string | null;
  children: ReactNode;
}) {
  const normalizedTeamId = teamId?.trim() || null;

  useEffect(() => {
    setActiveTeamIdForRequests(normalizedTeamId);
    return () => {
      if (getActiveTeamIdForRequests() === normalizedTeamId) {
        setActiveTeamIdForRequests(null);
      }
    };
  }, [normalizedTeamId]);

  return (
    <ActiveScopeContext.Provider value={{ teamId: normalizedTeamId }}>
      {children}
    </ActiveScopeContext.Provider>
  );
}
