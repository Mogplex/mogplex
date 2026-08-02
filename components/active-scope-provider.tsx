"use client";

import { createContext, useContext, useEffect } from "react";
import { ACTIVE_TEAM_HEADER } from "@/lib/team-capabilities";
import type { ReactNode } from "react";

type ActiveScopeContextValue = {
  teamId: string | null;
};

const ActiveScopeContext = createContext<ActiveScopeContextValue>({
  teamId: null,
});

let activeTeamId: string | null = null;

export function getActiveTeamIdForRequests() {
  return activeTeamId;
}

export function setActiveTeamIdForRequests(teamId: string | null) {
  activeTeamId = teamId?.trim() || null;
}

export function getActiveTeamRequestHeaders(
  headers?: HeadersInit,
  teamId?: string | null
): Headers {
  const nextHeaders = new Headers(headers);
  const resolvedTeamId =
    teamId === undefined ? activeTeamId : teamId?.trim() || null;
  if (resolvedTeamId) {
    nextHeaders.set(ACTIVE_TEAM_HEADER, resolvedTeamId);
  }
  return nextHeaders;
}

export function fetchWithActiveTeam(
  input: RequestInfo | URL,
  init: RequestInit = {}
) {
  return fetch(input, {
    ...init,
    headers: getActiveTeamRequestHeaders(init.headers),
  });
}

export function ActiveScopeProvider({
  teamId,
  children,
}: {
  teamId: string | null;
  children: ReactNode;
}) {
  const normalizedTeamId = teamId?.trim() || null;

  useEffect(() => {
    activeTeamId = normalizedTeamId;
    return () => {
      if (activeTeamId === normalizedTeamId) {
        activeTeamId = null;
      }
    };
  }, [normalizedTeamId]);

  return (
    <ActiveScopeContext.Provider value={{ teamId: normalizedTeamId }}>
      {children}
    </ActiveScopeContext.Provider>
  );
}

export function useActiveTeamId() {
  return useContext(ActiveScopeContext).teamId;
}
