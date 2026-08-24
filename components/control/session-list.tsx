"use client";

import { useEffect, useMemo, useState } from "react";
import {
  NavArrowDown,
  NavArrowRight,
  Plus,
  Search,
  SidebarCollapse,
  SidebarExpand,
  SortDown,
  SortUp,
} from "iconoir-react";
import { useCommandPalette } from "@/components/command-palette-provider";
import {
  groupSessionsByProject,
  projectColorClass,
  type SessionGroup,
} from "@/lib/control/session-groups";
import type { ControlSessionSummary } from "@/lib/control/session-types";
import { usePanelWidth } from "@/hooks/use-panel-width";
import {
  ProjectRowActions,
  SessionRowActions,
  type NewSessionTarget,
} from "./session-list-actions";

export type { ControlSessionSummary } from "@/lib/control/session-types";

type SortMode = "recent" | "alpha";

const COLLAPSED_KEY = "mogplex.sessionList.collapsed";
const WIDTH_KEY = "mogplex.sessionList.width";
const SORT_KEY = "mogplex.sessionList.sort";
const DEFAULT_WIDTH = 288;
const MIN_WIDTH = 220;
const MAX_WIDTH = 320;
const MAX_VISIBLE_SESSIONS = 5;
const EMPTY_WORKING_IDS: ReadonlySet<string> = new Set();

function formatAge(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function sortGroups(
  groups: SessionGroup<ControlSessionSummary>[],
  mode: SortMode
): SessionGroup<ControlSessionSummary>[] {
  if (mode === "recent") return groups;
  return groups
    .map((group) => ({
      ...group,
      sessions: [...group.sessions].sort((a, b) =>
        a.title.localeCompare(b.title)
      ),
    }))
    .sort((a, b) => {
      // General always trails named projects, matching the recent ordering.
      if (a.project === null) return 1;
      if (b.project === null) return -1;
      return a.name.localeCompare(b.name);
    });
}

function SessionRow({
  session,
  selected,
  working,
  onSelect,
  onDelete,
}: {
  session: ControlSessionSummary;
  selected: boolean;
  /** The selected session's chat is streaming a reply right now. */
  working: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<boolean>;
}) {
  return (
    <SessionRowActions session={session} onDelete={onDelete}>
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(session.id)}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
          selected
            ? "bg-ink-750 font-medium text-ink-100"
            : "text-ink-400 hover:bg-ink-800"
        }`}
      >
        {working ? (
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-sky-400" />
        ) : null}
        {working ? (
          <span className="shrink-0 text-sky-400">Working</span>
        ) : null}
        <span className="min-w-0 truncate">{session.title}</span>
        <span className="ml-auto shrink-0 text-xs text-ink-400">
          {formatAge(session.updated_at)}
        </span>
      </button>
    </SessionRowActions>
  );
}

function ProjectGroupSection({
  group,
  selectedId,
  workingIds,
  onSelect,
  onNew,
  onDelete,
}: {
  group: SessionGroup<ControlSessionSummary>;
  selectedId: string | null;
  workingIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onNew: (target: NewSessionTarget) => void;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const hiddenCount = group.sessions.length - MAX_VISIBLE_SESSIONS;
  const visible = showAll
    ? group.sessions
    : group.sessions.slice(0, MAX_VISIBLE_SESSIONS);
  const newSessionTarget = {
    project: group.project,
    repoId:
      group.sessions.find((session) => session.repo_id)?.repo_id ?? null,
  };

  return (
    <div className="mt-1">
      <ProjectRowActions
        projectName={group.name}
        onNew={() => onNew(newSessionTarget)}
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-ink-200 transition-colors hover:bg-ink-800"
        >
          {open ? (
            <NavArrowDown className="size-3 shrink-0 text-ink-400" />
          ) : (
            <NavArrowRight className="size-3 shrink-0 text-ink-400" />
          )}
          <span
            aria-hidden="true"
            className={`size-3.5 shrink-0 rounded-full ${projectColorClass(group.name)}`}
          />
          <span className="min-w-0 truncate font-medium">{group.name}</span>
          <span className="ml-auto shrink-0 text-xs text-ink-400">
            {group.sessions.length}
          </span>
        </button>
      </ProjectRowActions>
      {open ? (
        <div className="ml-6 space-y-px">
          {visible.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              selected={session.id === selectedId}
              working={workingIds.has(session.id)}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowAll((current) => !current)}
              className="w-full rounded-md px-2 py-1.5 text-left text-[13px] text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-200"
            >
              {showAll ? "Show less" : "Show more"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Secondary sidebar: sessions grouped under collapsible project sections,
 * with palette search, sort toggle, drag resize, and double-click collapse
 * to an icon rail. Width and collapse persist to localStorage.
 */
export function SessionList({
  sessions,
  selectedId,
  workingIds = EMPTY_WORKING_IDS,
  onSelect,
  onNew,
  onDelete,
}: {
  sessions: ControlSessionSummary[];
  selectedId: string | null;
  /** Sessions whose chats are currently streaming (shows Working badges). */
  workingIds?: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onNew: (target?: NewSessionTarget) => void;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const { open: openCommandPalette } = useCommandPalette();
  const [collapsed, setCollapsed] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const { width, resizing, panelRef, resizerProps } = usePanelWidth({
    storageKey: WIDTH_KEY,
    defaultWidth: DEFAULT_WIDTH,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    handle: "right",
  });

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "true");
      const storedSort = window.localStorage.getItem(SORT_KEY);
      if (storedSort === "recent" || storedSort === "alpha") {
        setSortMode(storedSort);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const groups = useMemo(
    () => sortGroups(groupSessionsByProject(sessions), sortMode),
    [sessions, sortMode]
  );
  const workingCount = workingIds.size;

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(COLLAPSED_KEY, String(next));
      return next;
    });
  };

  const toggleSort = () => {
    setSortMode((current) => {
      const next = current === "recent" ? "alpha" : "recent";
      window.localStorage.setItem(SORT_KEY, next);
      return next;
    });
  };

  if (collapsed) {
    return (
      <aside
        aria-label="Sessions"
        className="hidden w-10 shrink-0 flex-col border-r border-ink-800 bg-ink-900 md:flex"
      >
        <button
          type="button"
          aria-label="Expand sessions"
          title="Expand sessions"
          onClick={toggleCollapsed}
          className="grid size-10 place-items-center text-ink-400 hover:bg-ink-800 hover:text-ink-100"
        >
          <SidebarExpand className="size-4" />
        </button>
        <button
          type="button"
          aria-label="New session"
          title="New session"
          onClick={() => onNew()}
          className="grid size-10 place-items-center text-ink-400 hover:bg-ink-800 hover:text-ink-100"
        >
          <Plus className="size-4" strokeWidth={2} />
        </button>
        <div className="mt-2 flex flex-1 justify-center text-ink-400">
          {workingCount > 0 ? (
            <span
              aria-label={`${workingCount} ${workingCount === 1 ? "session" : "sessions"} working`}
              title={`${workingCount} working`}
              className="mt-1 size-1.5 shrink-0 animate-pulse rounded-full bg-sky-400"
            />
          ) : null}
          <span className="text-[10px] font-semibold tracking-wide uppercase [writing-mode:vertical-rl]">
            Sessions · {sessions.length}
            {workingCount > 0 ? ` · ${workingCount} working` : ""}
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside
      ref={panelRef}
      aria-label="Sessions"
      data-resizing={resizing ? "true" : "false"}
      style={{ width }}
      className="relative hidden shrink-0 flex-col border-r border-ink-800 bg-ink-900 md:flex"
    >
      <div
        {...resizerProps}
        onDoubleClick={toggleCollapsed}
        aria-label="Resize sessions panel"
        title="Drag to resize · double-click to collapse"
        className="app-panel-resizer absolute inset-y-0 -right-1 z-30 w-2 cursor-col-resize touch-none outline-none"
      />
      <div className="px-3 pt-3 pb-3">
        <button
          type="button"
          onClick={openCommandPalette}
          className="flex w-full items-center gap-2 rounded-lg border border-ink-700/60 bg-ink-800 px-3 py-2 text-sm text-ink-400 transition-colors hover:border-ink-600"
        >
          <Search className="size-4 shrink-0" strokeWidth={2} />
          <span className="min-w-0 flex-1 text-left">Search</span>
          <kbd className="font-sans text-xs text-ink-400">⌘K</kbd>
        </button>
      </div>
      <div className="flex items-center justify-between px-4 pb-1.5">
        <span className="text-[11px] font-semibold tracking-widest text-ink-400 uppercase">
          Projects
        </span>
        <div className="flex items-center gap-1 text-ink-400">
          <button
            type="button"
            aria-label={
              sortMode === "recent"
                ? "Sort projects alphabetically"
                : "Sort projects by recent activity"
            }
            title={
              sortMode === "recent"
                ? "Sort alphabetically"
                : "Sort by recent activity"
            }
            onClick={toggleSort}
            className="grid size-6 place-items-center rounded-md hover:bg-ink-800 hover:text-ink-200"
          >
            {sortMode === "recent" ? (
              <SortDown className="size-3.5" strokeWidth={2} />
            ) : (
              <SortUp className="size-3.5" strokeWidth={2} />
            )}
          </button>
          <button
            type="button"
            aria-label="New session"
            title="New session"
            onClick={() => onNew()}
            className="grid size-6 place-items-center rounded-md hover:bg-ink-800 hover:text-ink-200"
          >
            <Plus className="size-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="Collapse sessions"
            title="Collapse sessions"
            onClick={toggleCollapsed}
            className="grid size-6 place-items-center rounded-md hover:bg-ink-800 hover:text-ink-200"
          >
            <SidebarCollapse className="size-3.5" />
          </button>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-3 text-[13px]">
        {sessions.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] text-ink-400">
            No sessions yet. Start one from the composer.
          </p>
        ) : (
          groups.map((group) => (
            <ProjectGroupSection
              key={group.project ?? "__general__"}
              group={group}
              selectedId={selectedId}
              workingIds={workingIds}
              onSelect={onSelect}
              onNew={onNew}
              onDelete={onDelete}
            />
          ))
        )}
      </nav>
    </aside>
  );
}
