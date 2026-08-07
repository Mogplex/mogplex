"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Filter } from "iconoir-react";
import { useActiveTeamId } from "@/components/active-scope-provider";
import type {
  ContextSectionProps,
  MemoryGroups,
  MemoryLane,
  MemoryResourceScope,
  Repo,
} from "./context-section-types";
import { LANE_INFO } from "./context-section-types";
import {
  buildMemoryUrl,
  emptyMemoryGroups,
  fetchMemoryGroups,
  fetchRepos,
  isCurrentProject,
  requestHeaders,
  scopeForWrites,
} from "./context-section-utils";
import { ActionButtons, LaneTabs } from "./memory-actions";
import { MemoryComposer } from "./memory-composer";
import { MemoryList } from "./memory-list";
import {
  ProjectSelect,
  ScopeControls,
  SearchControls,
} from "./memory-filters";

export function ContextSection({
  compact,
  repoId,
  repoName,
  workspaceSessionId,
}: ContextSectionProps) {
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
  const totalCount = Object.values(memories).reduce(
    (acc, arr) => acc + (arr?.length || 0),
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
  const handleStartEdit = (memory: { id: string; content: string }) => {
    setEditingId(memory.id);
    setEditingContent(memory.content);
  };
  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingContent("");
  };

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
            <ActionButtons
              busyId={busyId}
              onCompact={() => void compactMemories()}
              onCheckpoint={() => void checkpoint()}
              compact
            />
          </div>
          <div className="flex items-center gap-1">
            <Filter className="text-muted-foreground size-3.5 shrink-0" />
            <ScopeControls
              resourceScope={resourceScope}
              onScopeChange={setResourceScope}
              activeTeamId={activeTeamId}
            />
          </div>
          <div className="flex gap-1">
            <ProjectSelect
              projectFilter={projectFilter}
              onProjectChange={selectProject}
              projectOptions={projectOptions}
            />
          </div>
          <SearchControls
            searchDraft={searchDraft}
            onSearchDraftChange={setSearchDraft}
            query={query}
            onSubmitSearch={submitSearch}
            onClearSearch={clearSearch}
          />
          {(error || memoriesError) && (
            <div className="text-destructive text-[11px]">
              {error || memoriesError?.message}
            </div>
          )}
        </div>
        <LaneTabs
          lane={lane}
          onLaneChange={setLane}
          memories={memories}
          compact
        />
        <MemoryList
          memories={currentMemories}
          lane={lane}
          compact={compact}
          loading={loading}
          memoriesError={memoriesError}
          editingId={editingId}
          busyId={busyId}
          editingContent={editingContent}
          onEditingContentChange={setEditingContent}
          onStartEdit={handleStartEdit}
          onSaveMemory={(id) => void saveMemory(id)}
          onCancelEdit={handleCancelEdit}
          onDeleteMemory={(id) => void deleteMemory(id)}
        />
        <MemoryComposer
          lane={lane}
          writeScope={writeScope}
          query={query}
          newContent={newContent}
          onNewContentChange={setNewContent}
          creating={creating}
          onAdd={() => void addMemory()}
          compact={compact}
        />
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
        <ActionButtons
          busyId={busyId}
          onCompact={() => void compactMemories()}
          onCheckpoint={() => void checkpoint()}
        />
      </div>

      <div className="border-border bg-card grid gap-3 rounded-md border p-3 md:grid-cols-[auto_minmax(180px,280px)_minmax(240px,1fr)]">
        <div>
          <div className="ui-label mb-1">Scope</div>
          <ScopeControls
            resourceScope={resourceScope}
            onScopeChange={setResourceScope}
            activeTeamId={activeTeamId}
          />
        </div>
        <div>
          <div className="ui-label mb-1">Project</div>
          <ProjectSelect
            projectFilter={projectFilter}
            onProjectChange={selectProject}
            projectOptions={projectOptions}
          />
        </div>
        <div>
          <div className="ui-label mb-1">Search</div>
          <SearchControls
            searchDraft={searchDraft}
            onSearchDraftChange={setSearchDraft}
            query={query}
            onSubmitSearch={submitSearch}
            onClearSearch={clearSearch}
          />
        </div>
        {(error || memoriesError) && (
          <div className="text-destructive text-[11px] md:col-span-3">
            {error || memoriesError?.message}
          </div>
        )}
      </div>

      <LaneTabs lane={lane} onLaneChange={setLane} memories={memories} />

      <div className="border-border bg-card flex min-h-[360px] flex-1 flex-col overflow-hidden rounded-md border">
        <div className="border-border border-b px-3 py-2">
          <div className="text-foreground text-sm">{LANE_INFO[lane].label}</div>
          <div className="text-muted-foreground text-[11px]">
            {LANE_INFO[lane].desc}
          </div>
        </div>
        <MemoryList
          memories={currentMemories}
          lane={lane}
          compact={compact}
          loading={loading}
          memoriesError={memoriesError}
          editingId={editingId}
          busyId={busyId}
          editingContent={editingContent}
          onEditingContentChange={setEditingContent}
          onStartEdit={handleStartEdit}
          onSaveMemory={(id) => void saveMemory(id)}
          onCancelEdit={handleCancelEdit}
          onDeleteMemory={(id) => void deleteMemory(id)}
        />
        <MemoryComposer
          lane={lane}
          writeScope={writeScope}
          query={query}
          newContent={newContent}
          onNewContentChange={setNewContent}
          creating={creating}
          onAdd={() => void addMemory()}
          compact={compact}
        />
      </div>
    </div>
  );
}
