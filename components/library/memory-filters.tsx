"use client";

import { Search, Xmark } from "iconoir-react";
import { cn } from "@/lib/utils";
import type { MemoryResourceScope } from "./context-section-types";
import { SCOPE_LABELS } from "./context-section-types";

interface ProjectOption {
  id: string;
  label: string;
}

interface ScopeControlsProps {
  resourceScope: MemoryResourceScope;
  onScopeChange: (scope: MemoryResourceScope) => void;
  activeTeamId: string | null;
}

export function ScopeControls({
  resourceScope,
  onScopeChange,
  activeTeamId,
}: ScopeControlsProps) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      {(Object.keys(SCOPE_LABELS) as MemoryResourceScope[]).map((scope) => {
        const disabled = scope === "team" && !activeTeamId;
        return (
          <button
            key={scope}
            type="button"
            disabled={disabled}
            onClick={() => onScopeChange(scope)}
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
}

interface ProjectSelectProps {
  projectFilter: string;
  onProjectChange: (value: string) => void;
  projectOptions: ProjectOption[];
}

export function ProjectSelect({
  projectFilter,
  onProjectChange,
  projectOptions,
}: ProjectSelectProps) {
  return (
    <select
      value={projectFilter}
      onChange={(event) => onProjectChange(event.target.value)}
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
}

interface SearchControlsProps {
  searchDraft: string;
  onSearchDraftChange: (value: string) => void;
  query: string;
  onSubmitSearch: () => void;
  onClearSearch: () => void;
}

export function SearchControls({
  searchDraft,
  onSearchDraftChange,
  query,
  onSubmitSearch,
  onClearSearch,
}: SearchControlsProps) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <input
        value={searchDraft}
        onChange={(event) => onSearchDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSubmitSearch();
        }}
        placeholder="Search memories"
        className="border-border bg-input text-foreground min-w-0 flex-1 rounded border px-2 py-1 text-[11px] outline-none"
      />
      <button
        type="button"
        title="Search"
        onClick={onSubmitSearch}
        className="border-border hover:bg-secondary rounded border p-1 text-muted-foreground hover:text-foreground"
      >
        <Search className="size-3.5" />
      </button>
      {query && (
        <button
          type="button"
          title="Clear search"
          onClick={onClearSearch}
          className="border-border hover:bg-secondary rounded border p-1 text-muted-foreground hover:text-foreground"
        >
          <Xmark className="size-3.5" />
        </button>
      )}
    </div>
  );
}
