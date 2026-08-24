"use client";

import { Network } from "iconoir-react";
import type { Repo } from "@/lib/types";
import type { ComposerSendOptions } from "./composer";
import { NewMissionComposer } from "./new-mission-composer";
import { SessionList } from "./session-list";
import type { ControlSessionSummary } from "@/lib/control/session-types";
import type { NewSessionTarget } from "./session-list-actions";

/**
 * Standalone view shown when there is no mission selected (fresh load or the
 * user asked for a new session): session rail and centered composer.
 */
export function NewMissionView({
  repos,
  sessions,
  sessionId,
  workingIds,
  canCancel,
  onCancel,
  onCreate,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  initialRepoId,
}: {
  repos: Repo[];
  sessions: ControlSessionSummary[];
  sessionId: string | null;
  workingIds: ReadonlySet<string>;
  canCancel: boolean;
  onCancel: () => void;
  onCreate: (
    text: string,
    project: string,
    repoId: string | null,
    options: ComposerSendOptions,
    createdRepo?: Repo
  ) => Promise<boolean>;
  onSelectSession: (id: string) => void;
  onNewSession: (target?: NewSessionTarget) => void;
  onDeleteSession: (id: string) => Promise<boolean>;
  initialRepoId?: string | null;
}) {
  return (
    <div className="app-control-shell flex h-full overflow-hidden">
      <SessionList
        sessions={sessions}
        selectedId={sessionId}
        workingIds={workingIds}
        onSelect={onSelectSession}
        onNew={onNewSession}
        onDelete={onDeleteSession}
      />
      <main
        className="app-chat-column flex min-w-0 flex-1 flex-col"
        aria-label="Command Center"
      >
        <div className="border-border flex h-14 shrink-0 items-center gap-3 border-b px-6">
          <h1 className="text-xl font-semibold">Command Center</h1>
          <span className="bg-secondary text-secondary-foreground inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs">
            <Network
              className="text-accent-blue size-3.5"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            Orchestrator
          </span>
        </div>
        <NewMissionComposer
          key={initialRepoId ?? "default-project"}
          repos={repos}
          initialRepoId={initialRepoId}
          onCancel={canCancel ? onCancel : undefined}
          onCreate={onCreate}
        />
      </main>
    </div>
  );
}
