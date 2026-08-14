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
}: {
  session: ControlSessionSummary;
  selected: boolean;
  /** The selected session's chat is streaming a reply right now. */
  working: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(session.id)}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
        selected
          ? "bg-ink-750 text-ink-100 font-medium"
          : "text-ink-400 hover:bg-ink-800"
      }`}
    >
      {working ? (
        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-sky-400" />
      ) : null}
      {working ? <span className="shrink-0 text-sky-400">Working</span> : null}
      <span className="min-w-0 truncate">{session.title}</span>
      <span className="text-ink-400 ml-auto shrink-0 text-xs">
        {formatAge(session.updated_at)}
      </span>
    </button>
  );
}

function ProjectGroupSection({
  group,
  selectedId,
  workingIds,
  onSelect,
}: {
  group: SessionGroup<ControlSessionSummary>;
  selectedId: string | null;
  workingIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const hiddenCount = group.sessions.length - MAX_VISIBLE_SESSIONS;
  const visible = showAll
    ? group.sessions
    : group.sessions.slice(0, MAX_VISIBLE_SESSIONS);

  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="text-ink-200 hover:bg-ink-800 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] transition-colors"
      >
        {open ? (
          <NavArrowDown className="text-ink-400 size-3 shrink-0" />
        ) : (
          <NavArrowRight className="text-ink-400 size-3 shrink-0" />
        )}
        <span
          aria-hidden="true"
          className={`size-3.5 shrink-0 rounded-full ${projectColorClass(group.name)}`}
        />
        <span className="min-w-0 truncate font-medium">{group.name}</span>
        <span className="text-ink-400 ml-auto shrink-0 text-xs">
          {group.sessions.length}
        </span>
      </button>
      {open ? (
        <div className="ml-6 space-y-px">
          {visible.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              selected={session.id === selectedId}
              working={workingIds.has(session.id)}
              onSelect={onSelect}
            />
          ))}
          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowAll((current) => !current)}
              className="text-ink-400 hover:bg-ink-800 hover:text-ink-200 w-full rounded-md px-2 py-1.5 text-left text-[13px] transition-colors"
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
}: {
  sessions: ControlSessionSummary[];
  selectedId: string | null;
  /** Sessions whose chats are currently streaming (shows Working badges). */
  workingIds?: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onNew: () => void;
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
        className="border-ink-800 bg-ink-900 hidden w-10 shrink-0 flex-col border-r md:flex"
      >
        <button
          type="button"
          aria-label="Expand sessions"
          title="Expand sessions"
          onClick={toggleCollapsed}
          className="text-ink-400 hover:bg-ink-800 hover:text-ink-100 grid size-10 place-items-center"
        >
          <SidebarExpand className="size-4" />
        </button>
        <button
          type="button"
          aria-label="New session"
          title="New session"
          onClick={onNew}
          className="text-ink-400 hover:bg-ink-800 hover:text-ink-100 grid size-10 place-items-center"
        >
          <Plus className="size-4" strokeWidth={2} />
        </button>
        <div className="text-ink-400 mt-2 flex flex-1 justify-center">
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
      className="border-ink-800 bg-ink-900 relative hidden shrink-0 flex-col border-r md:flex"
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
          className="border-ink-700/60 bg-ink-800 text-ink-400 hover:border-ink-600 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
        >
          <Search className="size-4 shrink-0" strokeWidth={2} />
          <span className="min-w-0 flex-1 text-left">Search</span>
          <kbd className="text-ink-400 font-sans text-xs">⌘K</kbd>
        </button>
      </div>
      <div className="flex items-center justify-between px-4 pb-1.5">
        <span className="text-ink-400 text-[11px] font-semibold tracking-widest uppercase">
          Projects
        </span>
        <div className="text-ink-400 flex items-center gap-1">
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
            className="hover:bg-ink-800 hover:text-ink-200 grid size-6 place-items-center rounded-md"
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
            onClick={onNew}
            className="hover:bg-ink-800 hover:text-ink-200 grid size-6 place-items-center rounded-md"
          >
            <Plus className="size-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="Collapse sessions"
            title="Collapse sessions"
            onClick={toggleCollapsed}
            className="hover:bg-ink-800 hover:text-ink-200 grid size-6 place-items-center rounded-md"
          >
            <SidebarCollapse className="size-3.5" />
          </button>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-3 text-[13px]">
        {sessions.length === 0 ? (
          <p className="text-ink-400 px-2 py-6 text-center text-[11px]">
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
            />
          ))
        )}
      </nav>
    </aside>
  );
}
