"use client";

import { useEffect, useMemo, useState } from "react";
import {
  NavArrowDown,
  NavArrowRight,
  Plus,
  SidebarCollapse,
  SidebarExpand,
} from "iconoir-react";
import {
  groupSessionsByProject,
  projectColorClass,
  type SessionGroup,
} from "@/lib/control/session-groups";

export type ControlSessionSummary = {
  id: string;
  title: string;
  /** Project the session belongs to; null groups under "General". */
  project: string | null;
  pinned: boolean;
  updated_at: string;
};

const COLLAPSED_KEY = "mogplex.sessionList.collapsed";
const MAX_VISIBLE_SESSIONS = 5;

function formatAge(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function SessionRow({
  session,
  selected,
  onSelect,
}: {
  session: ControlSessionSummary;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(session.id)}
      className={`w-full rounded-md px-2.5 py-1.5 text-left transition-colors ${
        selected
          ? "bg-accent text-foreground"
          : "text-secondary-foreground hover:bg-secondary hover:text-foreground"
      }`}
    >
      <span className="block truncate text-xs font-medium">
        {session.title}
      </span>
      <span className="text-muted-foreground block text-[10px]">
        {formatAge(session.updated_at)}
      </span>
    </button>
  );
}

function ProjectGroupSection({
  group,
  selectedId,
  onSelect,
}: {
  group: SessionGroup<ControlSessionSummary>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const hiddenCount = group.sessions.length - MAX_VISIBLE_SESSIONS;
  const visible = showAll
    ? group.sessions
    : group.sessions.slice(0, MAX_VISIBLE_SESSIONS);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="hover:bg-secondary flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5"
      >
        {open ? (
          <NavArrowDown className="text-muted-foreground size-3 shrink-0" />
        ) : (
          <NavArrowRight className="text-muted-foreground size-3 shrink-0" />
        )}
        <span
          aria-hidden="true"
          className={`grid size-4 shrink-0 place-items-center rounded text-[9px] font-bold text-white ${projectColorClass(group.name)}`}
        >
          {group.name.charAt(0).toUpperCase()}
        </span>
        <span className="truncate text-xs font-semibold">{group.name}</span>
        <span className="text-muted-foreground ml-auto font-mono text-[9px]">
          {group.sessions.length}
        </span>
      </button>
      {open ? (
        <div className="border-border mb-1 ml-[13px] space-y-0.5 border-l pl-1">
          {visible.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              selected={session.id === selectedId}
              onSelect={onSelect}
            />
          ))}
          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowAll((current) => !current)}
              className="text-muted-foreground hover:text-foreground w-full px-2.5 py-1 text-left text-[10px]"
            >
              {showAll ? "Show less" : `Show ${hiddenCount} more`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Left session rail, Conductor-style: sessions grouped under collapsible
 * project sections. Collapsed by default: the conversation column shares a
 * row with the artifacts panel and the live rail, so the list only takes
 * horizontal space when the user expands it.
 */
export function SessionList({
  sessions,
  selectedId,
  onSelect,
  onNew,
}: {
  sessions: ControlSessionSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) !== "false");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const groups = useMemo(() => groupSessionsByProject(sessions), [sessions]);

  const toggle = () => {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(COLLAPSED_KEY, String(next));
      return next;
    });
  };

  if (collapsed) {
    return (
      <aside
        aria-label="Sessions"
        className="border-border hidden w-10 shrink-0 flex-col border-r md:flex"
      >
        <button
          type="button"
          aria-label="Expand sessions"
          title="Expand sessions"
          onClick={toggle}
          className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-10 place-items-center"
        >
          <SidebarExpand className="size-4" />
        </button>
        <button
          type="button"
          aria-label="New session"
          title="New session"
          onClick={onNew}
          className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-10 place-items-center"
        >
          <Plus className="size-4" strokeWidth={2} />
        </button>
        <div className="text-muted-foreground mt-2 flex flex-1 justify-center">
          <span className="text-[10px] font-semibold tracking-wide uppercase [writing-mode:vertical-rl]">
            Sessions · {sessions.length}
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Sessions"
      className="border-border hidden w-56 shrink-0 flex-col border-r md:flex"
    >
      <div className="border-border flex items-center justify-between border-b px-3 py-2.5">
        <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
          Projects
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="New session"
            title="New session"
            onClick={onNew}
            className="text-muted-foreground hover:bg-secondary hover:text-foreground grid size-6 place-items-center rounded-md"
          >
            <Plus className="size-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="Collapse sessions"
            title="Collapse sessions"
            onClick={toggle}
            className="text-muted-foreground hover:bg-secondary hover:text-foreground grid size-6 place-items-center rounded-md"
          >
            <SidebarCollapse className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {sessions.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-[11px]">
            No sessions yet. Start one from the composer.
          </p>
        ) : (
          groups.map((group) => (
            <ProjectGroupSection
              key={group.project ?? "__general__"}
              group={group}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </aside>
  );
}
