"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { scopedHref } from "@/lib/scoped-href";
import { switchScopePath } from "@/lib/scope-switch";
import { useMemberships } from "@/hooks/use-memberships";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useSandboxStore } from "@/hooks/use-sandbox";
import {
  isSandboxUiRuntimeRunning,
  resolveSandboxUiState,
} from "@/lib/sandbox/ui-state";
import type { Agent, Repo, SandboxRecord } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repos: Repo[];
  agents: Agent[];
  onOpenChat?: (repo: Repo) => void;
  onStopSandbox?: (repoId: string) => void;
  onAssignAgent?: (repo: Repo) => void;
  onSyncRepos?: () => void;
  onToggleTheme?: () => void;
}

type PaletteActionItem = {
  key: string;
  value: string;
  label: string;
  icon: string;
};

type NavigationItem = {
  path: string;
  value: string;
  label: string;
};

const QUICK_ACTIONS: PaletteActionItem[] = [
  {
    key: "sync-repos",
    value: "sync github repos",
    label: "Sync GitHub",
    icon: "↻",
  },
  {
    key: "toggle-theme",
    value: "toggle theme dark light",
    label: "Toggle Theme",
    icon: "◐",
  },
];

const NAVIGATION_ITEMS: NavigationItem[] = [
  { path: "/projects/workspace", value: "go to projects workspace", label: "Workspace" },
  { path: "/projects/repositories", value: "go to projects repositories", label: "Repositories" },
  {
    path: "/projects/repositories/sandboxes",
    value: "go to sandboxes manage running previews",
    label: "Sandboxes",
  },
  { path: "/agents/roster", value: "go to agents roster", label: "Agents" },
  { path: "/agents/skills", value: "go to agent skills", label: "Skills" },
  { path: "/agents/rules", value: "go to agent rules", label: "Rules" },
  { path: "/agents/context", value: "go to agent context", label: "Context" },
  { path: "/assignments", value: "go to assignments", label: "Assignments" },
  { path: "/workflows", value: "go to workflows automations", label: "Workflows" },
  {
    path: "/observability",
    value: "go to observability",
    label: "Observability",
  },
  { path: "/settings", value: "go to settings", label: "Settings" },
];

export function CommandPalette({
  open,
  onOpenChange,
  repos,
  agents,
  onOpenChat,
  onStopSandbox,
  onAssignAgent,
  onSyncRepos,
  onToggleTheme,
}: Props) {
  const sandboxes = useSandboxStore((state) => state.sandboxes);
  const sandboxesById = useSandboxStore((state) => state.sandboxesById);
  const setActiveSandbox = useSandboxStore((state) => state.setActiveSandbox);
  const router = useRouter();
  const pathname = usePathname();
  const { scope } = useParams<{ scope: string }>();
  const { memberships } = useMemberships();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const matchesQuery = useCallback(
    (value: string) =>
      deferredSearch.length === 0 ||
      value.toLowerCase().includes(deferredSearch),
    [deferredSearch]
  );

  const workspaceRepos = useMemo(() => {
    const filtered = repos.filter((repo) =>
      matchesQuery(`open workspace ${repo.full_name}`)
    );
    return filtered.slice(0, deferredSearch ? 50 : 24);
  }, [deferredSearch, matchesQuery, repos]);

  const runningPreviewRepos = useMemo(() => {
    return repos
      .filter((repo) =>
        isSandboxUiRuntimeRunning(
          resolveSandboxUiState({
            session: null,
            record: sandboxes[repo.id] ?? null,
          })
        )
      )
      .filter((repo) => matchesQuery(`stop preview ${repo.full_name}`))
      .slice(0, 24);
  }, [matchesQuery, repos, sandboxes]);

  const runningSandboxes = useMemo<
    Array<{ sandbox: SandboxRecord; repo: Repo }>
  >(() => {
    const reposById = new Map(repos.map((repo) => [repo.id, repo]));
    const results: Array<{ sandbox: SandboxRecord; repo: Repo }> = [];
    for (const sandbox of Object.values(sandboxesById)) {
      if (
        !isSandboxUiRuntimeRunning(
          resolveSandboxUiState({ session: null, record: sandbox })
        )
      ) {
        continue;
      }
      const repo = reposById.get(sandbox.repo_id);
      if (!repo) continue;
      const haystack = `switch workspace ${repo.full_name} ${sandbox.working_branch}`;
      if (!matchesQuery(haystack)) continue;
      results.push({ sandbox, repo });
      if (results.length >= 24) break;
    }
    return results;
  }, [matchesQuery, repos, sandboxesById]);

  const assignableRepos = useMemo(() => {
    if (agents.length === 0) return [];
    return repos
      .filter((repo) => matchesQuery(`assign agent ${repo.full_name}`))
      .slice(0, deferredSearch ? 16 : 8);
  }, [agents.length, deferredSearch, matchesQuery, repos]);

  const quickActions = useMemo(
    () => QUICK_ACTIONS.filter((item) => matchesQuery(item.value)),
    [matchesQuery]
  );

  const scopeOptions = useMemo(() => {
    const options: Array<{
      key: string;
      slug: string;
      label: string;
      kind: "personal" | "team";
    }> = [];
    if (memberships.personal.slug) {
      const label = memberships.personal.name || "Personal";
      options.push({
        key: `scope-personal-${memberships.personal.slug}`,
        slug: memberships.personal.slug,
        label,
        kind: "personal",
      });
    }
    for (const team of memberships.teams) {
      options.push({
        key: `scope-team-${team.id}`,
        slug: team.slug,
        label: team.name,
        kind: "team",
      });
    }
    return options
      .filter(
        (option) =>
          option.slug !== scope &&
          matchesQuery(`switch scope ${option.label} ${option.slug}`)
      )
      .slice(0, 12);
  }, [matchesQuery, memberships, scope]);

  const navigationItems = useMemo(
    () => NAVIGATION_ITEMS.filter((item) => matchesQuery(item.value)),
    [matchesQuery]
  );

  const handleSelect = useCallback(
    (action: string, payload?: string) => {
      setSearch("");
      onOpenChange(false);

      if (action === "chat" && payload) {
        const repo = repos.find((r) => r.id === payload);
        if (repo) onOpenChat?.(repo);
      }

      if (action === "stop" && payload) {
        onStopSandbox?.(payload);
      }

      if (action === "switch" && payload) {
        setActiveSandbox(payload);
      }

      if (action === "assign" && payload) {
        const repo = repos.find((r) => r.id === payload);
        if (repo) onAssignAgent?.(repo);
      }

      if (action === "navigate" && payload && scope) {
        router.push(scopedHref(scope, payload));
      }

      if (action === "switch-scope" && payload) {
        const target = switchScopePath(pathname || "/", scope, payload);
        router.push(target);
      }

      if (action === "sync-repos") {
        onSyncRepos?.();
      }

      if (action === "toggle-theme") {
        onToggleTheme?.();
      }
    },
    [
      onAssignAgent,
      onOpenChange,
      onOpenChat,
      onStopSandbox,
      onSyncRepos,
      onToggleTheme,
      pathname,
      repos,
      router,
      scope,
      setActiveSandbox,
    ]
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  const showAnyItems =
    workspaceRepos.length > 0 ||
    runningSandboxes.length > 0 ||
    runningPreviewRepos.length > 0 ||
    assignableRepos.length > 0 ||
    quickActions.length > 0 ||
    navigationItems.length > 0 ||
    scopeOptions.length > 0;

  return (
    <CommandDialog
      className="mogplex-command-palette"
      open={open}
      onOpenChange={handleOpenChange}
      showCloseButton={false}
      commandProps={{
        shouldFilter: false,
        className: "mogplex-command-palette-command",
      }}
    >
      <CommandInput
        placeholder="Search projects, settings, and actions..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        {!showAnyItems && <CommandEmpty>No results found.</CommandEmpty>}

        {workspaceRepos.length > 0 && (
          <CommandGroup heading="Open Workspace">
            {workspaceRepos.map((repo) => {
              const sandbox = sandboxes[repo.id];

              return (
                <CommandItem
                  key={repo.id}
                  value={`open workspace ${repo.full_name}`}
                  onSelect={() => handleSelect("chat", repo.id)}
                >
                  <span className="text-muted-foreground">
                    {repo.is_favorite ? "★" : "◻"}
                  </span>
                  <span className="flex-1 truncate">
                    Open workspace · {repo.full_name}
                  </span>
                  {isSandboxUiRuntimeRunning(
                    resolveSandboxUiState({ session: null, record: sandbox })
                  ) && (
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  )}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {(runningSandboxes.length > 0 || runningPreviewRepos.length > 0) && (
          <>
            {workspaceRepos.length > 0 && <CommandSeparator />}
            <CommandGroup heading="Running Previews">
              {runningSandboxes.map(({ sandbox, repo }) => (
                <CommandItem
                  key={`switch-${sandbox.id}`}
                  value={`switch workspace ${repo.full_name} ${sandbox.working_branch}`}
                  onSelect={() => handleSelect("switch", sandbox.id)}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  <span className="flex-1 truncate">
                    {repo.full_name}
                    <span className="text-muted-foreground">
                      {" "}
                      — {sandbox.working_branch}
                    </span>
                  </span>
                </CommandItem>
              ))}
              {runningPreviewRepos.map((repo) => (
                <CommandItem
                  key={`stop-${repo.id}`}
                  value={`stop preview ${repo.full_name}`}
                  onSelect={() => handleSelect("stop", repo.id)}
                >
                  <span className="text-destructive">■</span>
                  <span className="flex-1 truncate">
                    Stop preview · {repo.full_name}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {assignableRepos.length > 0 && (
          <>
            {(workspaceRepos.length > 0 ||
              runningSandboxes.length > 0 ||
              runningPreviewRepos.length > 0) && <CommandSeparator />}
            <CommandGroup heading="Assign Agent">
              {assignableRepos.map((repo) => (
                <CommandItem
                  key={`assign-${repo.id}`}
                  value={`assign agent ${repo.full_name}`}
                  onSelect={() => handleSelect("assign", repo.id)}
                >
                  <span className="text-accent-violet">◈</span>
                  <span className="flex-1 truncate">
                    Assign agent to {repo.full_name}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {quickActions.length > 0 && (
          <>
            {(workspaceRepos.length > 0 ||
              runningSandboxes.length > 0 ||
              runningPreviewRepos.length > 0 ||
              assignableRepos.length > 0) && <CommandSeparator />}
            <CommandGroup heading="Quick Actions">
              {quickActions.map((item) => (
                <CommandItem
                  key={item.key}
                  value={item.value}
                  onSelect={() => handleSelect(item.key)}
                >
                  <span className="text-muted-foreground">{item.icon}</span>
                  <span>{item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {navigationItems.length > 0 && (
          <>
            {(workspaceRepos.length > 0 ||
              runningSandboxes.length > 0 ||
              runningPreviewRepos.length > 0 ||
              assignableRepos.length > 0 ||
              quickActions.length > 0) && <CommandSeparator />}
            <CommandGroup heading="Navigate">
              {navigationItems.map((item) => (
                <CommandItem
                  key={item.path}
                  value={item.value}
                  onSelect={() => handleSelect("navigate", item.path)}
                >
                  <span className="text-muted-foreground">→</span>
                  <span>{item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {scopeOptions.length > 0 && (
          <>
            {(workspaceRepos.length > 0 ||
              runningSandboxes.length > 0 ||
              runningPreviewRepos.length > 0 ||
              assignableRepos.length > 0 ||
              quickActions.length > 0 ||
              navigationItems.length > 0) && <CommandSeparator />}
            <CommandGroup heading="Switch Scope">
              {scopeOptions.map((option) => (
                <CommandItem
                  key={option.key}
                  value={`switch scope ${option.label} ${option.slug}`}
                  onSelect={() => handleSelect("switch-scope", option.slug)}
                >
                  <span className="text-muted-foreground">
                    {option.kind === "personal" ? "◉" : "▣"}
                  </span>
                  <span className="flex-1 truncate">
                    Switch to {option.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    /{option.slug}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
