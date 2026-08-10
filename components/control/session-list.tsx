"use client";

import { useEffect, useState } from "react";
import { Plus, SidebarCollapse, SidebarExpand } from "iconoir-react";

export type ControlSessionSummary = {
  id: string;
  title: string;
  pinned: boolean;
  updated_at: string;
};

const COLLAPSED_KEY = "mogplex.sessionList.collapsed";

function formatAge(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Left session rail. Collapsed by default: the conversation column shares a
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
          Sessions
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
      <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {sessions.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-[11px]">
            No sessions yet. Start one from the composer.
          </p>
        ) : (
          sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              aria-current={session.id === selectedId ? "true" : undefined}
              onClick={() => onSelect(session.id)}
              className={`w-full rounded-md px-2.5 py-2 text-left transition-colors ${
                session.id === selectedId
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
          ))
        )}
      </div>
    </aside>
  );
}
