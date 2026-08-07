import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { fetchJsonObject } from "@/lib/client-fetch";
import type { TeamRole } from "@/lib/team-capabilities";

export function fetchTeamSettingsJson<T extends Record<string, unknown>>(
  teamId: string,
  url: string
) {
  return fetchJsonObject<T>(url, "Failed to load team settings", {
    headers: getActiveTeamRequestHeaders(undefined, teamId),
  });
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatAuditAction(action: string) {
  return action.replace(/\./g, " ");
}

type EditableRole = "admin" | "developer" | "viewer";

export function roleOptions(
  viewerRole: TeamRole,
  targetRole: TeamRole
): readonly EditableRole[] {
  if (targetRole === "owner") return [];
  if (viewerRole === "owner") return ["admin", "developer", "viewer"];
  if (viewerRole === "admin" && targetRole !== "admin") {
    return ["developer", "viewer"];
  }
  return [];
}
