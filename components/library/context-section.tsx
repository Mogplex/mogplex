"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Filter } from "iconoir-react";
import { useActiveTeamId } from "@/components/active-scope-provider";
import type {
  ContextSectionProps,
  MemoryLane,
  MemoryPayload,
  MemoryResourceScope,
  Repo,
} from "./context-section-types";
import { LANE_INFO } from "./context-section-types";
import {
  buildMemoryUrl,
  emptyMemoryPayload,
  fetchMemoryGroups,
  fetchRepos,
  isCurrentProject,
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
import { useMemoryMutations } from "./use-memory-mutations";

export function ContextSection({
  compact,
  repoId,
  repoName,
  workspaceSessionId,
}: ContextSectionProps) {
  const activeTeamId = useActiveTeamId();
  const [lane, setLane] = useState<MemoryLane>("semantic");
  const [resourceScope, setResourceScope] =
    useState<MemoryResourceScope>("all");
  const [projectFilter, setProjectFilter] = useState(repoId ?? "all");
  const [projectTouched, setProjectTouched] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [newContent, setNewContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");

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
    data: payload = emptyMemoryPayload(),
    error: memoriesError,
    isLoading: loading,
    mutate,
  } = useSWR<MemoryPayload, Error>(memoriesKey, fetchMemoryGroups);
  const memories = payload.groups;
  const counts = payload.counts;

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

  const repoLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const repo of repos) labels.set(repo.id, repo.full_name);
    if (repoId && !labels.has(repoId)) {
      labels.set(repoId, repoName || "Current project");
    }
    return labels;
  }, [repoId, repoName, repos]);
  const projectOptions = useMemo(
    () => Array.from(repoLabels, ([id, label]) => ({ id, label })),
    [repoLabels]
  );

  useEffect(() => {
    if (
      projectFilter !== "all" &&
      projectTouched &&
      !repoLabels.has(projectFilter)
    ) {
      setProjectFilter("all");
    }
  }, [projectFilter, projectTouched, repoLabels]);

  const currentMemories = memories[lane] || [];
  const totalCount = Object.values(counts).reduce((acc, n) => acc + n, 0);
  const writeScope = scopeForWrites(resourceScope);
  const writeWorkspaceSessionId =
    isCurrentProject(projectFilter, repoId) && workspaceSessionId
      ? workspaceSessionId
      : null;

  const mutations = useMemoryMutations({
    lane,
    writeScope,
    activeTeamId,
    selectedRepoId,
    workspaceSessionId: writeWorkspaceSessionId,
    refresh: mutate,
  });
  const { busyId } = mutations;
  const errorMessage = mutations.error || memoriesError?.message || null;

  const addMemory = async () => {
    const content = newContent.trim();
    if (!content) return;
    if (await mutations.addMemory(content)) setNewContent("");
  };
  const saveMemory = async (id: string) => {
    const content = editingContent.trim();
    if (!content) return;
    if (await mutations.saveMemory(id, content)) {
      setEditingId(null);
      setEditingContent("");
    }
  };
  const deleteMemory = async (id: string) => {
    if (await mutations.deleteMemory(id)) {
      if (editingId === id) {
        setEditingId(null);
        setEditingContent("");
      }
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

  const list = (
    <MemoryList
      memories={currentMemories}
      lane={lane}
      repoLabels={repoLabels}
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
  );
  const composer = (
    <MemoryComposer
      lane={lane}
      writeScope={writeScope}
      query={query}
      newContent={newContent}
      onNewContentChange={setNewContent}
      creating={busyId === "create"}
      onAdd={() => void addMemory()}
      compact={compact}
    />
  );
  const actions = (
    <ActionButtons
      busyId={busyId}
      onPrune={() => void mutations.pruneMemories()}
      onCheckpoint={() => void mutations.checkpoint()}
      compact={compact}
    />
  );

  if (compact) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="border-border space-y-2 border-b p-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="ui-label">Memories</div>
              <div className="text-muted-foreground text-[11px]">
                {totalCount} stored
              </div>
            </div>
            {actions}
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
          {errorMessage && (
            <div className="text-destructive text-[11px]">{errorMessage}</div>
          )}
        </div>
        <LaneTabs lane={lane} onLaneChange={setLane} counts={counts} compact />
        {list}
        {composer}
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="ui-section-title">Memories</div>
          <div className="ui-section-caption">
            What Control recalls at the start of every turn: facts, procedures,
            and recent events for you and the selected project.{" "}
            {totalCount} stored.
          </div>
        </div>
        {actions}
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
        {errorMessage && (
          <div className="text-destructive text-[11px] md:col-span-3">
            {errorMessage}
          </div>
        )}
      </div>

      <LaneTabs lane={lane} onLaneChange={setLane} counts={counts} />

      <div className="border-border bg-card flex min-h-[360px] flex-1 flex-col overflow-hidden rounded-md border">
        <div className="border-border border-b px-3 py-2">
          <div className="text-foreground text-sm">{LANE_INFO[lane].label}</div>
          <div className="text-muted-foreground text-[11px]">
            {LANE_INFO[lane].desc}
          </div>
        </div>
        {list}
        {composer}
      </div>
    </div>
  );
}
