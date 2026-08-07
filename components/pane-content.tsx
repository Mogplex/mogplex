"use client";
import {
  createTerminalSessionKey,
  getTerminalSessionKey,
  type PaneNode,
  type PaneType,
  type TerminalSessionSummary,
} from "@/hooks/use-split-panes";
import { useSandboxStore } from "@/hooks/use-sandbox";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { useSessionsStore } from "@/hooks/use-sessions";
import { resolveSandboxRootDirectory } from "@/lib/repo-settings";
import type { SandboxError } from "@/lib/sandbox/error-state";
import { resolvePaneSandboxId } from "@/lib/sandbox/pane-binding";
import { resolvePreviewPaneUrl } from "@/lib/sandbox/preview-url";
import type { Repo } from "@/lib/types";
import { useState, useMemo, useCallback } from "react";
import { Xmark, DragSolid } from "iconoir-react";
import { useDraggable } from "@dnd-kit/core";
import { PaneDropZones } from "./pane-drop-zones";
import { useIsMobile } from "@/hooks/use-mobile";

import {
  PANE_ICONS,
  buildSplitSandboxOverrides,
} from "./pane-content/pane-constants";
import {
  SandboxPathTag,
  SandboxIndicator,
  PaneBadge,
} from "./pane-content/pane-header";
import { PaneErrorBoundary } from "./pane-content/pane-error-boundary";
import { PaneActionsMenu } from "./pane-content/pane-actions-menu";
import { PaneBody } from "./pane-content/pane-body";

interface Props {
  pane: PaneNode;
  active: boolean;
  onSelect: () => void;
  onUpdatePane?: (updates: Partial<PaneNode>) => void;
  onUpdateTerminalSession?: (
    terminalSessionKey: string,
    updates: Partial<PaneNode>
  ) => void;
  terminalSessions?: TerminalSessionSummary[];
  activeRepo?:
    | (Pick<Repo, "id" | "full_name" | "root_directory" | "default_branch"> & {
        working_branch?: string | null;
      })
    | null;
  activeSandbox?: { id: string } | null;
  sandboxCreating?: boolean;
  sandboxError?: SandboxError | null;
  onOpenFile?: (filePath: string, sandboxId?: string) => void;
  onRetargetFilePath?: (
    fromPath: string,
    toPath: string,
    sandboxId: string
  ) => void;
  onClearFilePath?: (targetPath: string, sandboxId: string) => void;
  onSplit?: (
    dir: "horizontal" | "vertical",
    type: PaneType,
    overrides?: Partial<PaneNode>
  ) => void;
  onClose?: () => void;
  onPopOutIDE?: (filePath?: string) => void;
}

export function PaneContent({
  pane,
  active,
  onSelect,
  onUpdatePane,
  onUpdateTerminalSession,
  terminalSessions,
  activeRepo,
  activeSandbox,
  sandboxCreating,
  sandboxError,
  onOpenFile,
  onRetargetFilePath,
  onClearFilePath,
  onSplit,
  onClose,
  onPopOutIDE,
}: Props) {
  const [streaming, setStreaming] = useState(false);
  const borderClass = streaming || active ? "ring-1 ring-border" : "";
  const isMobile = useIsMobile();
  const {
    setNodeRef: setDragHandleRef,
    listeners: dragListeners,
    attributes: dragAttributes,
    isDragging,
  } = useDraggable({ id: pane.id, disabled: isMobile });

  const pendingSandboxBranch = useSessionsStore((state) => {
    const session =
      state.sessions.find((sess) => sess.id === state.activeSessionId) ||
      state.sessions[0];
    return session?.pendingSandboxBranch ?? null;
  });
  const currentWorkspaceSessionId = useSessionsStore(
    (state) => state.activeSessionId
  );

  const resolvedSandboxId = resolvePaneSandboxId(pane, activeSandbox?.id);
  const splitSandboxOverrides = buildSplitSandboxOverrides(
    pane,
    resolvedSandboxId
  );
  const resolvedSandboxRecord = useSandboxStore((s) =>
    resolvedSandboxId ? s.getSandboxById(resolvedSandboxId) : null
  );
  const resolvedSandbox = resolvedSandboxId ? { id: resolvedSandboxId } : null;
  const resolvedPreviewUrl = resolvePreviewPaneUrl(pane, resolvedSandboxRecord);
  const effectivePathForActiveSandbox = resolveSandboxRootDirectory(
    resolvedSandboxRecord,
    activeRepo
  );

  const repoPath = !activeRepo?.full_name
    ? undefined
    : effectivePathForActiveSandbox
      ? `${activeRepo.full_name}:${effectivePathForActiveSandbox}`
      : activeRepo.full_name;

  const currentTerminalSessionKey =
    pane.type === "terminal" ? getTerminalSessionKey(pane) : null;

  const currentTerminalSession = useMemo(
    () =>
      currentTerminalSessionKey
        ? (terminalSessions?.find(
            (session) =>
              session.terminalSessionKey === currentTerminalSessionKey
          ) ?? null)
        : null,
    [currentTerminalSessionKey, terminalSessions]
  );

  const otherTerminalSessions = useMemo(
    () =>
      (terminalSessions ?? []).filter(
        (session) => session.terminalSessionKey !== currentTerminalSessionKey
      ),
    [currentTerminalSessionKey, terminalSessions]
  );

  const attachTerminalSession = useCallback(
    (dir: "horizontal" | "vertical", session: TerminalSessionSummary) => {
      if (!onSplit) return;
      onSplit(dir, "terminal", {
        name: session.name,
        terminalSessionKey: session.terminalSessionKey,
        sandboxBinding: session.sandboxBinding,
        sandboxId:
          session.sandboxBinding === "pinned" ? session.sandboxId : undefined,
      });
    },
    [onSplit]
  );

  const renameTerminalSession = useCallback(() => {
    if (!currentTerminalSession || !onUpdateTerminalSession) return;
    const nextName = window.prompt(
      "Rename terminal session",
      currentTerminalSession.name
    );
    const trimmed = nextName?.trim();
    if (!trimmed || trimmed === currentTerminalSession.name) return;
    onUpdateTerminalSession(currentTerminalSession.terminalSessionKey, {
      name: trimmed.slice(0, 80),
    });
  }, [currentTerminalSession, onUpdateTerminalSession]);

  const resetTerminalSession = useCallback(async () => {
    if (
      !currentTerminalSession ||
      !resolvedSandboxId ||
      !onUpdateTerminalSession
    )
      return;
    const confirmed = window.confirm(
      `Reset terminal session "${currentTerminalSession.name}"?`
    );
    if (!confirmed) return;

    const response = await fetch(
      `/api/sandbox/${resolvedSandboxId}/terminal/session`,
      {
        method: "POST",
        headers: getActiveTeamRequestHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          action: "kill",
          terminalSessionKey: currentTerminalSession.terminalSessionKey,
        }),
      }
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      window.alert(payload?.error || "Failed to reset terminal session");
      return;
    }

    onUpdateTerminalSession(currentTerminalSession.terminalSessionKey, {
      terminalSessionKey: createTerminalSessionKey(),
    });
  }, [currentTerminalSession, onUpdateTerminalSession, resolvedSandboxId]);

  return (
    <div
      onClick={onSelect}
      data-testid={`pane-${pane.id}`}
      data-pane-type={pane.type}
      className={`bg-card relative flex h-full flex-col overflow-hidden rounded-md text-[13px] ${borderClass} ${isDragging ? "opacity-50" : ""}`}
      style={{ animation: "pane-enter 0.2s ease-out" }}
    >
      <PaneDropZones paneId={pane.id} />
      <div className="bg-secondary border-border-dim flex h-10 items-center gap-2.5 border-b px-3">
        {!isMobile && (
          <button
            ref={setDragHandleRef}
            {...dragListeners}
            {...dragAttributes}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Drag ${pane.name}`}
            title="Drag to reorder"
            className="text-muted-foreground hover:text-secondary-foreground -ml-1 flex h-6 w-5 cursor-grab items-center justify-center active:cursor-grabbing"
          >
            <DragSolid className="size-3.5" />
          </button>
        )}
        <span className="text-muted-foreground text-sm">
          {PANE_ICONS[pane.type] || "◻"}
        </span>
        <span className="text-secondary-foreground flex-1 text-[13px] font-medium">
          {pane.name}
        </span>
        {(pane.type === "agent" || pane.type === "preview") && (
          <>
            <SandboxPathTag path={effectivePathForActiveSandbox} />
            <SandboxIndicator
              sandbox={resolvedSandbox}
              creating={sandboxCreating}
            />
          </>
        )}
        <PaneBadge status={pane.status} />
        <div className="flex items-center gap-1">
          {onSplit && (
            <PaneActionsMenu
              pane={pane}
              currentTerminalSession={currentTerminalSession}
              otherTerminalSessions={otherTerminalSessions}
              splitSandboxOverrides={splitSandboxOverrides}
              onSplit={onSplit}
              onAttachTerminalSession={attachTerminalSession}
              onRenameTerminalSession={renameTerminalSession}
              onResetTerminalSession={() => void resetTerminalSession()}
            />
          )}
          {onClose && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              data-testid={`pane-close-${pane.id}`}
              className="text-muted-foreground hover:bg-muted hover:text-secondary-foreground flex h-6 w-6 items-center justify-center rounded-[4px] text-sm"
              title="Close pane"
            >
              <Xmark className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <PaneErrorBoundary paneName={pane.name}>
        <PaneBody
          pane={pane}
          repoPath={repoPath}
          activeRepo={activeRepo}
          resolvedSandbox={resolvedSandbox}
          resolvedSandboxId={resolvedSandboxId}
          resolvedPreviewUrl={resolvedPreviewUrl}
          sandboxCreating={sandboxCreating}
          sandboxError={sandboxError}
          effectivePathForActiveSandbox={effectivePathForActiveSandbox}
          pendingSandboxBranch={pendingSandboxBranch}
          currentWorkspaceSessionId={currentWorkspaceSessionId}
          onStreamingChange={setStreaming}
          onOpenFile={onOpenFile}
          onRetargetFilePath={onRetargetFilePath}
          onClearFilePath={onClearFilePath}
          onUpdatePane={onUpdatePane}
          onPopOutIDE={onPopOutIDE}
        />
      </PaneErrorBoundary>
    </div>
  );
}
