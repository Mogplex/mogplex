import { ACTIVE_TEAM_HEADER } from "@/lib/team-scope-header";

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
