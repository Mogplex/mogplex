"use client";

import { Archive, Undo } from "iconoir-react";
import type { SessionArchiveControls } from "./use-session-archive";

export function SessionArchiveList({ archive }: { archive: SessionArchiveControls }) {
  return <>
    <div className="flex items-center justify-between px-4 py-2">
      <span className="text-xs font-medium text-ink-200">Archived chats</span>
      <button type="button" onClick={archive.back} className="rounded px-2 py-1 text-xs text-ink-400 hover:text-ink-100">Back to chats</button>
    </div>
    <div className="flex-1 overflow-y-auto px-3 pb-3" aria-busy={archive.loading || archive.busy}>
      {archive.loading ? <p role="status" className="py-4 text-sm text-ink-400">Loading archived chats…</p> : null}
      {archive.error ? <div role="alert" className="py-3 text-sm text-destructive">{archive.error} <button type="button" onClick={() => void archive.show()} className="underline">Try again</button></div> : null}
      {!archive.loading && !archive.error && !archive.sessions.length ? <p className="py-4 text-sm text-ink-400">No archived chats.</p> : null}
      {archive.sessions.map(session => <div key={session.id} className="flex items-center gap-2 rounded-md px-2 py-2">
        <Archive className="size-4 shrink-0 text-ink-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-ink-200" title={session.title}>{session.title}</div>
          <div className="truncate text-xs text-ink-400">{session.project ?? "General"}</div>
        </div>
        <button type="button" aria-label={`Restore ${session.title}`} title="Restore chat" disabled={archive.busy || archive.loading} onClick={() => void archive.restore(session)} className="grid size-8 shrink-0 place-items-center rounded-md text-ink-400 hover:bg-ink-800 hover:text-ink-100 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring">
          <Undo className="size-4" aria-hidden="true" />
        </button>
      </div>)}
    </div>
  </>;
}
