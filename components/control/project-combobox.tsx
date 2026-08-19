"use client";

import { useState } from "react";
import { Check, NavArrowDown } from "iconoir-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Repo } from "@/lib/types";

export function ProjectCombobox({
  repos,
  value,
  newProjectValue,
  onValueChange,
}: {
  repos: Repo[];
  value: string;
  newProjectValue: string;
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedRepo = repos.find((repo) => repo.id === value);
  const selectedLabel = selectedRepo?.full_name ?? "New project…";
  const query = search.trim().toLowerCase();
  const matchingRepos = repos.filter((repo) =>
    `${repo.full_name} ${repo.owner ?? ""} ${repo.name ?? ""}`
      .toLowerCase()
      .includes(query)
  );
  const showNewProject = "new project".includes(query);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setSearch("");
  };

  const selectProject = (nextValue: string) => {
    onValueChange(nextValue);
    handleOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id="control-project"
          role="combobox"
          aria-label="Project"
          aria-expanded={open}
          aria-controls="control-project-options"
          data-testid="control-project-combobox"
          className="border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 focus-visible:ring-ring/50 flex h-8 w-64 max-w-full min-w-0 flex-1 items-center justify-between gap-2 rounded-md border px-2 text-left text-xs font-medium shadow-none outline-none focus-visible:ring-2"
        >
          <span className="truncate">{selectedLabel}</span>
          <NavArrowDown
            aria-hidden="true"
            className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        id="control-project-options"
        align="start"
        className="border-border bg-popover w-[var(--radix-popover-trigger-width)] min-w-64 p-0 shadow-2xl"
      >
        <div className="border-b border-border px-3">
          <input
            autoFocus
            aria-label="Search projects"
            className="placeholder:text-muted-foreground h-9 w-full bg-transparent text-xs outline-none"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search projects..."
            value={search}
          />
        </div>
        <div
          aria-label="Project options"
          className="max-h-72 overflow-y-auto p-1"
          role="listbox"
        >
          {matchingRepos.map((repo) => {
            const selected = repo.id === value;
            return (
              <button
                aria-selected={selected}
                className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none focus-visible:bg-accent"
                key={repo.id}
                onClick={() => selectProject(repo.id)}
                role="option"
                type="button"
              >
                <span className="min-w-0 flex-1 truncate">{repo.full_name}</span>
                {selected ? (
                  <Check
                    aria-label="Selected"
                    className="size-3.5 shrink-0 text-foreground"
                  />
                ) : null}
              </button>
            );
          })}
          {showNewProject ? (
            <button
              aria-selected={value === newProjectValue}
              className="border-border hover:bg-accent mt-1 flex w-full items-center gap-2 border-t px-2 pt-2 pb-1.5 text-left text-xs outline-none focus-visible:bg-accent"
              onClick={() => selectProject(newProjectValue)}
              role="option"
              type="button"
            >
              <span className="min-w-0 flex-1 truncate">New project…</span>
              {value === newProjectValue ? (
                <Check
                  aria-label="Selected"
                  className="size-3.5 shrink-0 text-foreground"
                />
              ) : null}
            </button>
          ) : null}
          {matchingRepos.length === 0 && !showNewProject ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No matching projects.
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
