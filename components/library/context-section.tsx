"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  Check,
  EditPencil,
  Filter,
  Plus,
  Search,
  Trash,
  Xmark,
} from "iconoir-react";
import {
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider";
import { cn } from "@/lib/utils";
import type { Repo } from "@/lib/types";

type MemoryLane = "session" | "semantic" | "episodic" | "procedural";
type MemoryResourceScope = "all" | "personal" | "team";
type Memory = {
  id: string;
  lane: MemoryLane;
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
type MemoryGroups = Record<MemoryLane, Memory[]>;

const LANES: MemoryLane[] = ["session", "semantic", "episodic", "procedural"];

const LANE_INFO: Record<MemoryLane, { label: string; desc: string }> = {
  session: { label: "Session", desc: "Working set for current task" },
  semantic: { label: "Semantic", desc: "Durable truths and preferences" },
  episodic: { label: "Episodic", desc: "Timeline events and milestones" },
  procedural: { label: "Procedural", desc: "Reusable workflows and runbooks" },
};

const SCOPE_LABELS: Record<MemoryResourceScope, string> = {
  all: "All",
  personal: "Personal",
  team: "Team",
};

interface Props {
  /** Compact mode for split-pane usage */
  compact?: boolean;
  repoId?: string | null;
  repoName?: string | null;
  workspaceSessionId?: string | null;
}

function emptyMemoryGroups(): MemoryGroups {
  return { session: [], semantic: [], episodic: [], procedural: [] };
}

function groupMemories(rows: Memory[]): MemoryGroups {
  const grouped = emptyMemoryGroups();
  for (const row of rows) {
    grouped[row.lane]?.push(row);
  }
  return grouped;
}

function normalizeMemoryPayload(payload: unknown): MemoryGroups {
  if (Array.isArray(payload)) return groupMemories(payload as Memory[]);
  if (payload && typeof payload === "object") {
    return {
      ...emptyMemoryGroups(),
      ...(payload as Partial<MemoryGroups>),
    };
  }
  return emptyMemoryGroups();
}

function buildMemoryUrl(input: {
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

function requestHeaders(input: {
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

async function fetchMemoryGroups([
  url,
  resourceScope,
  activeTeamId,
]: [string, MemoryResourceScope, string | null]) {
  const res = await fetch(url, {
    headers: requestHeaders({ resourceScope, activeTeamId }),
  });
  if (!res.ok) throw new Error("Failed to load memories");
  return normalizeMemoryPayload(await res.json());
}

async function fetchRepos([
  url,
  resourceScope,
  activeTeamId,
]: [string, Exclude<MemoryResourceScope, "all">, string | null]) {
  const res = await fetch(url, {
    headers: requestHeaders({ resourceScope, activeTeamId }),
  });
  if (!res.ok) throw new Error("Failed to load projects");
  return (await res.json()) as Repo[];
}

function isCurrentProject(
  projectFilter: string,
  repoId?: string | null
): boolean {
  return Boolean(repoId && projectFilter === repoId);
}

function formatMemoryDate(value: string) {
  return new Date(value).toLocaleString();
}

function scopeForWrites(scope: MemoryResourceScope): Exclude<
  MemoryResourceScope,
  "all"
> {
  return scope === "team" ? "team" : "personal";
}

export function ContextSection({
  compact,
  repoId,
  repoName,
  workspaceSessionId,
}: Props) {
  const activeTeamId = useActiveTeamId();
  const [lane, setLane] = useState<MemoryLane>("session");
  const [resourceScope, setResourceScope] =
    useState<MemoryResourceScope>("all");
  const [projectFilter, setProjectFilter] = useState(repoId ?? "all");
  const [projectTouched, setProjectTouched] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [newContent, setNewContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectTouched) setProjectFilter(repoId ?? "all");
  }, [projectTouched, repoId]);

  useEffect(() => {
    if (!activeTeamId && resourceScope === "team") {
      setResourceScope("all");
    }
  }, [activeTeamId, resourceScope]);

  const selectedRepoId = projectFilter === "all" ? null : projectFilter;
  const memoriesUrl = buildMemoryUrl({
    repoId: selectedRepoId,
    resourceScope,
    q: query,
  });
  const memoriesKey =
    resourceScope === "team" && !activeTeamId
      ? null
      : ([memoriesUrl, resourceScope, activeTeamId] as [
          string,
          MemoryResourceScope,
          string | null,
        ]);
  const {
    data: memories = emptyMemoryGroups(),
    error: memoriesError,
    isLoading: loading,
    mutate,
  } = useSWR<MemoryGroups, Error>(memoriesKey, fetchMemoryGroups);

  const projectListScope: Exclude<MemoryResourceScope, "all"> =
    resourceScope === "team" ? "team" : "personal";
  const reposKey =
    projectListScope === "team" && !activeTeamId
      ? null
      : (["/api/repos", projectListScope, activeTeamId] as [
          string,
          Exclude<MemoryResourceScope, "all">,
          string | null,
        ]);
  const { data: repos = [] } = useSWR<Repo[], Error>(reposKey, fetchRepos);

  const projectOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const repo of repos) {
      options.set(repo.id, repo.full_name);
    }
    if (repoId && !options.has(repoId)) {
      options.set(repoId, repoName || "Current project");
    }
    return Array.from(options, ([id, label]) => ({ id, label }));
  }, [repoId, repoName, repos]);

  useEffect(() => {
    if (
      projectFilter !== "all" &&
      projectTouched &&
      !projectOptions.some((project) => project.id === projectFilter)
    ) {
      setProjectFilter("all");
    }
  }, [projectFilter, projectOptions, projectTouched]);

  const currentMemories = memories[lane] || [];
  const totalCount = LANES.reduce(
    (acc, currentLane) => acc + (memories[currentLane] || []).length,
    0
  );
  const writeScope = scopeForWrites(resourceScope);
  const writeWorkspaceSessionId =
    isCurrentProject(projectFilter, repoId) && workspaceSessionId
      ? workspaceSessionId
      : null;

  const runMutation = async (
    action: () => Promise<Response>,
    failureMessage: string
  ) => {
    setError(null);
    const res = await action();
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(payload?.error || failureMessage);
    }
    await mutate();
  };

  const addMemory = async () => {
    const content = newContent.trim();
    if (!content) return;
    setCreating(true);
    try {
      await runMutation(
        () =>
          fetch("/api/memories", {
            method: "POST",
            headers: requestHeaders({
              resourceScope: writeScope,
              activeTeamId,
              json: true,
            }),
            body: JSON.stringify({
              lane,
              content,
              repoId: selectedRepoId,
              workspaceSessionId: writeWorkspaceSessionId,
              resourceScope: writeScope,
              source: "memories-pane",
            }),
          }),
        "Failed to add memory"
      );
      setNewContent("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add memory");
    } finally {
      setCreating(false);
    }
  };

  const saveMemory = async (id: string) => {
    const content = editingContent.trim();
    if (!content) return;
    setBusyId(id);
    try {
      await runMutation(
        () =>
          fetch("/api/memories", {
            method: "PATCH",
            headers: requestHeaders({
              resourceScope: writeScope,
              activeTeamId,
              json: true,
            }),
            body: JSON.stringify({ id, content }),
          }),
        "Failed to update memory"
      );
      setEditingId(null);
      setEditingContent("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update memory");
    } finally {
      setBusyId(null);
    }
  };

  const deleteMemory = async (id: string) => {
    setBusyId(id);
    try {
      await runMutation(
        () =>
          fetch(`/api/memories?id=${id}`, {
            method: "DELETE",
            headers: requestHeaders({ resourceScope: writeScope, activeTeamId }),
          }),
        "Failed to delete memory"
      );
      if (editingId === id) {
        setEditingId(null);
        setEditingContent("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete memory");
    } finally {
      setBusyId(null);
    }
  };

  const compactMemories = async () => {
    setBusyId("compact");
    try {
      await runMutation(
        () =>
          fetch("/api/memories/actions", {
            method: "POST",
            headers: requestHeaders({
              resourceScope: writeScope,
              activeTeamId,
              json: true,
            }),
            body: JSON.stringify({ action: "compact" }),
          }),
        "Failed to compact memories"
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to compact memories"
      );
    } finally {
      setBusyId(null);
    }
  };

  const checkpoint = async () => {
    setBusyId("checkpoint");
    try {
      await runMutation(
        () =>
          fetch("/api/memories/actions", {
            method: "POST",
            headers: requestHeaders({
              resourceScope: writeScope,
              activeTeamId,
              json: true,
            }),
            body: JSON.stringify({
              action: "checkpoint",
              lane,
              repoId: selectedRepoId,
              workspaceSessionId: writeWorkspaceSessionId,
              resourceScope: writeScope,
              source: "memories-pane",
            }),
          }),
        "Failed to create checkpoint"
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create checkpoint"
      );
    } finally {
      setBusyId(null);
    }
  };

  const submitSearch = () => setQuery(searchDraft.trim());
  const clearSearch = () => {
    setSearchDraft("");
    setQuery("");
  };

  const selectProject = (value: string) => {
    setProjectTouched(true);
    setProjectFilter(value);
  };

  const scopeControls = (
    <div className="flex min-w-0 items-center gap-1">
      {(Object.keys(SCOPE_LABELS) as MemoryResourceScope[]).map((scope) => {
        const disabled = scope === "team" && !activeTeamId;
        return (
          <button
            key={scope}
            type="button"
            disabled={disabled}
            onClick={() => setResourceScope(scope)}
            className={cn(
              "border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded border px-2 py-1 text-[11px] disabled:pointer-events-none disabled:opacity-40",
              resourceScope === scope && "border-primary text-primary"
            )}
          >
            {SCOPE_LABELS[scope]}
          </button>
        );
      })}
    </div>
  );

  const projectSelect = (
    <select
      value={projectFilter}
      onChange={(event) => selectProject(event.target.value)}
      className="border-border bg-input text-foreground min-w-0 flex-1 rounded border px-2 py-1 text-[11px] outline-none"
    >
      <option value="all">All projects</option>
      {projectOptions.map((project) => (
        <option key={project.id} value={project.id}>
          {project.label}
        </option>
      ))}
    </select>
  );

  const searchControls = (
    <div className="flex min-w-0 items-center gap-1">
      <input
        value={searchDraft}
        onChange={(event) => setSearchDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submitSearch();
        }}
        placeholder="Search memories"
        className="border-border bg-input text-foreground min-w-0 flex-1 rounded border px-2 py-1 text-[11px] outline-none"
      />
      <button
        type="button"
        title="Search"
        onClick={submitSearch}
        className="border-border hover:bg-secondary rounded border p-1 text-muted-foreground hover:text-foreground"
      >
        <Search className="size-3.5" />
      </button>
      {query && (
        <button
          type="button"
          title="Clear search"
          onClick={clearSearch}
          className="border-border hover:bg-secondary rounded border p-1 text-muted-foreground hover:text-foreground"
        >
          <Xmark className="size-3.5" />
        </button>
      )}
    </div>
  );

  const memoryList = (
    <div className="flex-1 overflow-auto">
      <div className={cn("space-y-2", compact ? "p-2" : "p-3")}>
        {loading && (
          <div className="text-muted-foreground text-[11px]">
            Loading memories...
          </div>
        )}
        {memoriesError && (
          <div className="text-destructive text-[11px]">
            {memoriesError.message}
          </div>
        )}
        {!loading && currentMemories.length === 0 && (
          <div className="text-muted-foreground flex min-h-28 items-center justify-center px-4 text-center text-[11px]">
            No {LANE_INFO[lane].label.toLowerCase()} memories match these
            filters.
          </div>
        )}
        {currentMemories.map((memory) => {
          const isEditing = editingId === memory.id;
          const isBusy = busyId === memory.id;
          return (
            <div
              key={memory.id}
              className="border-border bg-card rounded-md border p-2"
            >
              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={editingContent}
                    onChange={(event) => setEditingContent(event.target.value)}
                    rows={compact ? 4 : 5}
                    className="border-border bg-input text-foreground w-full resize-none rounded border px-2 py-1.5 text-xs outline-none"
                  />
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void saveMemory(memory.id)}
                      className="border-border hover:bg-secondary inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] text-foreground disabled:opacity-50"
                    >
                      <Check className="size-3.5" />
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        setEditingId(null);
                        setEditingContent("");
                      }}
                      className="border-border text-muted-foreground hover:bg-secondary hover:text-foreground inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] disabled:opacity-50"
                    >
                      <Xmark className="size-3.5" />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground whitespace-pre-wrap break-words text-xs">
                      {memory.content}
                    </div>
                    <div className="text-muted-foreground mt-1 text-[11px]">
                      {formatMemoryDate(memory.updated_at || memory.created_at)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      title="Edit memory"
                      disabled={isBusy}
                      onClick={() => {
                        setEditingId(memory.id);
                        setEditingContent(memory.content);
                      }}
                      className="text-muted-foreground hover:bg-secondary hover:text-foreground rounded p-1 disabled:opacity-50"
                    >
                      <EditPencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Delete memory"
                      disabled={isBusy}
                      onClick={() => void deleteMemory(memory.id)}
                      className="text-muted-foreground hover:bg-secondary hover:text-destructive rounded p-1 disabled:opacity-50"
                    >
                      <Trash className="size-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const composer = (
    <div className={cn("border-border border-t", compact ? "p-2" : "p-3")}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="ui-label">Add to {LANE_INFO[lane].label}</div>
        <div className="text-muted-foreground text-[11px]">
          Saves as {SCOPE_LABELS[writeScope]}
        </div>
      </div>
      <textarea
        value={newContent}
        onChange={(event) => setNewContent(event.target.value)}
        placeholder={`Add ${LANE_INFO[lane].label.toLowerCase()} memory...`}
        rows={compact ? 2 : 3}
        className="border-border bg-input text-foreground w-full resize-none rounded border px-2 py-1.5 text-xs outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-muted-foreground min-w-0 truncate text-[11px]">
          {query ? `Filtered by "${query}"` : LANE_INFO[lane].desc}
        </div>
        <button
          type="button"
          disabled={creating}
          onClick={() => void addMemory()}
          className="border-border bg-secondary hover:bg-primary hover:text-primary-foreground inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1.5 text-[11px] text-foreground disabled:opacity-50"
        >
          <Plus className="size-3.5" />
          Add
        </button>
      </div>
    </div>
  );

  if (compact) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="border-border space-y-2 border-b p-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="ui-label">Memories</div>
              <div className="text-muted-foreground text-[11px]">
                {totalCount} visible
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="Compact old session memories"
                disabled={busyId === "compact"}
                onClick={() => void compactMemories()}
                className="border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded border px-2 py-1 text-[11px] disabled:opacity-50"
              >
                Compact
              </button>
              <button
                type="button"
                title="Add checkpoint memory"
                disabled={busyId === "checkpoint"}
                onClick={() => void checkpoint()}
                className="border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded border px-2 py-1 text-[11px] disabled:opacity-50"
              >
                Checkpoint
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Filter className="text-muted-foreground size-3.5 shrink-0" />
            {scopeControls}
          </div>
          <div className="flex gap-1">{projectSelect}</div>
          {searchControls}
          {(error || memoriesError) && (
            <div className="text-destructive text-[11px]">
              {error || memoriesError?.message}
            </div>
          )}
        </div>
        <div className="border-border flex border-b">
          {LANES.map((currentLane) => (
            <button
              key={currentLane}
              type="button"
              onClick={() => setLane(currentLane)}
              className={cn(
                "text-muted-foreground hover:bg-secondary flex-1 px-2 py-2 text-[11px]",
                lane === currentLane &&
                  "border-foreground bg-muted text-foreground border-b-2"
              )}
            >
              {LANE_INFO[currentLane].label} (
              {(memories[currentLane] || []).length})
            </button>
          ))}
        </div>
        {memoryList}
        {composer}
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="ui-section-title">Context / Memories</div>
          <div className="ui-section-caption">
            {totalCount} visible memories across four lanes.
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busyId === "compact"}
            onClick={() => void compactMemories()}
            className="border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Compact
          </button>
          <button
            type="button"
            disabled={busyId === "checkpoint"}
            onClick={() => void checkpoint()}
            className="border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Checkpoint
          </button>
        </div>
      </div>

      <div className="border-border bg-card grid gap-3 rounded-md border p-3 md:grid-cols-[auto_minmax(180px,280px)_minmax(240px,1fr)]">
        <div>
          <div className="ui-label mb-1">Scope</div>
          {scopeControls}
        </div>
        <div>
          <div className="ui-label mb-1">Project</div>
          {projectSelect}
        </div>
        <div>
          <div className="ui-label mb-1">Search</div>
          {searchControls}
        </div>
        {(error || memoriesError) && (
          <div className="text-destructive text-[11px] md:col-span-3">
            {error || memoriesError?.message}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {LANES.map((currentLane) => (
          <button
            key={currentLane}
            type="button"
            onClick={() => setLane(currentLane)}
            className={cn(
              "border-border text-muted-foreground hover:text-foreground rounded border px-3 py-1.5 text-sm",
              lane === currentLane && "border-primary text-primary"
            )}
          >
            {LANE_INFO[currentLane].label} (
            {(memories[currentLane] || []).length})
          </button>
        ))}
      </div>

      <div className="border-border bg-card flex min-h-[360px] flex-1 flex-col overflow-hidden rounded-md border">
        <div className="border-border border-b px-3 py-2">
          <div className="text-foreground text-sm">{LANE_INFO[lane].label}</div>
          <div className="text-muted-foreground text-[11px]">
            {LANE_INFO[lane].desc}
          </div>
        </div>
        {memoryList}
        {composer}
      </div>
    </div>
  );
}
