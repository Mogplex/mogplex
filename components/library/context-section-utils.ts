import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import type {
  Memory,
  MemoryGroups,
  MemoryResourceScope,
  Repo,
} from "./context-section-types";

export function emptyMemoryGroups(): MemoryGroups {
  return { session: [], semantic: [], episodic: [], procedural: [] };
}

export function groupMemories(rows: Memory[]): MemoryGroups {
  const grouped = emptyMemoryGroups();
  for (const row of rows) {
    grouped[row.lane]?.push(row);
  }
  return grouped;
}

export function normalizeMemoryPayload(payload: unknown): MemoryGroups {
  if (Array.isArray(payload)) return groupMemories(payload as Memory[]);
  if (payload && typeof payload === "object") {
    return {
      ...emptyMemoryGroups(),
      ...(payload as Partial<MemoryGroups>),
    };
  }
  return emptyMemoryGroups();
}

export function buildMemoryUrl(input: {
  repoId?: string | null;
  resourceScope: MemoryResourceScope;
  q?: string;
}) {
  const params = new URLSearchParams();
  if (input.repoId) params.set("repoId", input.repoId);
  if (input.resourceScope !== "all") {
    params.set("resourceScope", input.resourceScope);
  }
  const query = input.q?.trim();
  if (query) params.set("q", query);
  const queryString = params.toString();
  return queryString ? `/api/memories?${queryString}` : "/api/memories";
}

export function requestHeaders(input: {
  resourceScope: MemoryResourceScope;
  activeTeamId: string | null;
  json?: boolean;
}) {
  const headers = input.json
    ? new Headers({ "Content-Type": "application/json" })
    : new Headers();
  if (input.resourceScope === "team") {
    return getActiveTeamRequestHeaders(headers, input.activeTeamId);
  }
  return headers;
}

export async function fetchMemoryGroups([url, resourceScope, activeTeamId]: [
  string,
  MemoryResourceScope,
  string | null,
]) {
  const res = await fetch(url, {
    headers: requestHeaders({ resourceScope, activeTeamId }),
  });
  if (!res.ok) throw new Error("Failed to load memories");
  return normalizeMemoryPayload(await res.json());
}

export async function fetchRepos([url, resourceScope, activeTeamId]: [
  string,
  Exclude<MemoryResourceScope, "all">,
  string | null,
]) {
  const res = await fetch(url, {
    headers: requestHeaders({ resourceScope, activeTeamId }),
  });
  if (!res.ok) throw new Error("Failed to load projects");
  return (await res.json()) as Repo[];
}

export function isCurrentProject(
  projectFilter: string,
  repoId?: string | null
): boolean {
  return Boolean(repoId && projectFilter === repoId);
}

export function formatMemoryDate(value: string) {
  return new Date(value).toLocaleString();
}

export function scopeForWrites(
  scope: MemoryResourceScope
): Exclude<MemoryResourceScope, "all"> {
  return scope === "team" ? "team" : "personal";
}
