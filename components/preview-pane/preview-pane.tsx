"use client";

import dynamic from "next/dynamic";
import { CursorPointer } from "iconoir-react";
import { useSandboxStore } from "@/hooks/use-sandbox";
import { resolveSandboxLaunchIntentFromUiState } from "@/lib/sandbox/launch-intent";
import { ensureSessionSandboxBinding } from "@/lib/sandbox/session-retarget";
import { useSandboxLaunchActions } from "@/components/sandbox-launch-provider";
import type { Repo } from "@/lib/types";
import type { PreviewPaneProps } from "./types";
import { formatPreviewToolbarStatus } from "./utils";
import { StatusOverlay } from "./status-overlay";
import { GrabOverlay } from "./grab-overlay";
import { FeedbackForm } from "./feedback-form";
import { usePreviewPane } from "./use-preview-pane";

const FileTreePane = dynamic(
  () => import("../file-tree-pane").then((m) => m.FileTreePane),
  { ssr: false }
);
const MonacoPane = dynamic(
  () => import("../monaco-pane").then((m) => m.MonacoPane),
  { ssr: false }
);
const SandboxHealthPanel = dynamic(
  () => import("../sandbox-health-panel").then((m) => m.SandboxHealthPanel),
  { ssr: false }
);

export function PreviewPane(props: PreviewPaneProps) {
  const {
    rootLabel,
    onActiveFileChange,
    onRetargetFilePath,
    onClearFilePath,
  } = props;

  const {
    activeFile,
    activeTab,
    refreshKey,
    grabMode,
    capturedRegion,
    previewUrl,
    sandboxId,
    sandboxRecordId,
    sandboxRecord,
    sandboxError,
    sandboxUiState,
    overlayStatus,
    isRunning,
    isPaused,
    showOverlay,
    startingStale,
    launchLogs,
    repoId,
    activeRepo,
    activeSessionId,
    handlePause,
    handleStop,
    handleResume,
    handleRestart,
    handleOverlayLaunch,
    handleStartFresh,
    handleCapture,
    handleCancelGrab,
    handleFeedbackSubmit,
    handlePopOut,
    handleTabChange,
    handleOpenObservability,
    handleReconcile,
    handleToggleGrab,
    handleRefresh,
    reconcileHealth,
  } = usePreviewPane(props);

  const { launchRepoSandbox } = useSandboxLaunchActions();
  const stopSandbox = useSandboxStore((s) => s.stop);

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar + toolbar */}
      <div className="border-border-dim flex h-7 items-center gap-1 border-b px-2 text-[10px]">
        <button
          onClick={() => handleTabChange("preview")}
          className={`rounded px-2 py-0.5 font-mono transition-colors ${
            activeTab === "preview"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-secondary-foreground hover:bg-muted"
          }`}
        >
          Preview
        </button>
        {sandboxId && (
          <button
            onClick={() => handleTabChange("code")}
            className={`rounded px-2 py-0.5 font-mono transition-colors ${
              activeTab === "code"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-secondary-foreground hover:bg-muted"
            }`}
          >
            Code
          </button>
        )}
        {sandboxRecordId && (
          <button
            onClick={() => handleTabChange("health")}
            className={`rounded px-2 py-0.5 font-mono transition-colors ${
              activeTab === "health"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-secondary-foreground hover:bg-muted"
            }`}
          >
            Health
          </button>
        )}

        <div className="flex-1" />

        {/* Preview tab toolbar */}
        {activeTab === "preview" && (
          <PreviewToolbar
            isRunning={isRunning}
            isPaused={isPaused}
            grabMode={grabMode}
            previewUrl={previewUrl}
            overlayStatus={overlayStatus}
            sandboxRecord={sandboxRecord}
            onPause={handlePause}
            onResume={handleResume}
            onStop={handleStop}
            onToggleGrab={handleToggleGrab}
            onRefresh={handleRefresh}
          />
        )}

        {/* Code tab toolbar */}
        {activeTab === "code" && (
          <>
            {activeFile && (
              <span className="text-muted-foreground max-w-[200px] truncate font-mono">
                {activeFile}
              </span>
            )}
            {props.onPopOut && (
              <button
                onClick={handlePopOut}
                className="text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors"
                title="Pop out into separate panes"
              >
                ⧉ Pop out
              </button>
            )}
          </>
        )}
      </div>

      {/* Preview content */}
      {activeTab === "preview" && (
        <div
          className="relative flex-1 overflow-hidden"
          data-testid="preview-stage"
        >
          {previewUrl ? (
            <>
              <iframe
                key={refreshKey}
                src={previewUrl}
                className="bg-background h-full w-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                title="Sandbox Preview"
                onLoad={
                  showOverlay
                    ? () => {
                        void reconcileHealth();
                      }
                    : undefined
                }
              />
              {showOverlay && (
                <div className="bg-background/80 absolute inset-0 z-10">
                  <StatusOverlay
                    status={overlayStatus}
                    error={sandboxError}
                    details={sandboxRecord}
                    workingBranch={sandboxRecord?.working_branch ?? null}
                    onLaunch={
                      activeRepo
                        ? () => handleOverlayLaunch("status_overlay")
                        : undefined
                    }
                    onStartFresh={activeRepo ? handleStartFresh : undefined}
                    onRestart={
                      repoId
                        ? () => {
                            void handleRestart();
                          }
                        : undefined
                    }
                    onRetryHealth={() => {
                      void reconcileHealth();
                    }}
                    onOpenHealth={() => handleTabChange("health")}
                    onResume={
                      sandboxRecordId && isPaused
                        ? () => {
                            void handleResume();
                          }
                        : undefined
                    }
                    startingStale={startingStale}
                    launchLogs={launchLogs}
                    repoId={repoId}
                  />
                </div>
              )}
              {grabMode && (
                <GrabOverlay
                  onCapture={handleCapture}
                  onCancel={handleCancelGrab}
                />
              )}
              {capturedRegion && (
                <FeedbackForm
                  region={capturedRegion}
                  onSubmit={handleFeedbackSubmit}
                  onCancel={handleCancelGrab}
                />
              )}
            </>
          ) : (
            <StatusOverlay
              status={overlayStatus}
              error={sandboxError}
              details={sandboxRecord}
              workingBranch={sandboxRecord?.working_branch ?? null}
              onLaunch={
                activeRepo
                  ? () => handleOverlayLaunch("empty_state")
                  : undefined
              }
              onStartFresh={activeRepo ? handleStartFresh : undefined}
              onRestart={
                repoId
                  ? () => {
                      void handleRestart();
                    }
                  : undefined
              }
              onRetryHealth={() => {
                void reconcileHealth();
              }}
              onOpenHealth={() => handleTabChange("health")}
              onResume={
                sandboxRecordId && isPaused
                  ? () => {
                      void handleResume();
                    }
                  : undefined
              }
              startingStale={startingStale}
              launchLogs={launchLogs}
              repoId={repoId}
            />
          )}
        </div>
      )}

      {/* Code content */}
      {activeTab === "code" && sandboxId && (
        <div className="flex flex-1 overflow-hidden">
          <div className="border-border w-48 shrink-0 overflow-hidden border-r">
            <FileTreePane
              sandboxId={sandboxId}
              rootLabel={rootLabel || "/"}
              activeFilePath={activeFile}
              onOpenFile={(filePath) => onActiveFileChange?.(filePath)}
              onRetargetFilePath={onRetargetFilePath}
              onClearFilePath={onClearFilePath}
            />
          </div>
          <div className="flex-1 overflow-hidden">
            {activeFile ? (
              <MonacoPane sandboxId={sandboxId} filePath={activeFile} />
            ) : (
              <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
                Select a file to edit
              </div>
            )}
          </div>
        </div>
      )}

      {/* Health content */}
      {activeTab === "health" && activeRepo && (
        <div className="flex-1 overflow-auto">
          <SandboxHealthPanel
            repo={activeRepo as Repo}
            sandbox={sandboxRecord}
            onLaunch={async () => {
              if (activeRepo) {
                const outcome = await launchRepoSandbox(activeRepo, {
                  source: "preview_health_panel",
                  trigger: "launch_sandbox",
                  intent: resolveSandboxLaunchIntentFromUiState(
                    sandboxUiState,
                    sandboxRecordId
                  ),
                });
                if (outcome.status === "launched") {
                  ensureSessionSandboxBinding(
                    activeSessionId,
                    sandboxRecordId ?? null,
                    outcome.sandbox.id
                  );
                }
              }
            }}
            onStop={async () => {
              if (sandboxRecordId) await stopSandbox(sandboxRecordId);
            }}
            onRestart={async () => {
              await handleRestart();
            }}
            onReconcile={handleReconcile}
            onOpenObservability={handleOpenObservability}
          />
        </div>
      )}
    </div>
  );
}

function PreviewToolbar({
  isRunning,
  isPaused,
  grabMode,
  previewUrl,
  overlayStatus,
  sandboxRecord,
  onPause,
  onResume,
  onStop,
  onToggleGrab,
  onRefresh,
}: {
  isRunning: boolean;
  isPaused: boolean;
  grabMode: boolean;
  previewUrl?: string;
  overlayStatus: string;
  sandboxRecord: {
    runtime_summary: { persistent?: boolean | null };
  } | null;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onStop: () => Promise<void>;
  onToggleGrab: () => void;
  onRefresh: () => void;
}) {
  return (
    <>
      {isRunning && previewUrl ? (
        <a
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary max-w-[200px] truncate hover:underline"
        >
          {previewUrl}
        </a>
      ) : (
        <span className="text-muted-foreground truncate">
          {formatPreviewToolbarStatus(overlayStatus as Parameters<typeof formatPreviewToolbarStatus>[0])}
        </span>
      )}
      {sandboxRecord?.runtime_summary.persistent && (
        <span
          data-testid="preview-persistent-badge"
          className="text-muted-foreground/80 border-border/50 rounded-sm border px-1.5 py-[1px] font-mono text-[9px] tracking-wide uppercase"
          title="Pause saves this development environment so you can resume it later."
        >
          Persistent
        </span>
      )}
      {isRunning && (
        <button
          onClick={() => {
            void onPause();
          }}
          data-testid="preview-pause-button"
          className="text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors"
          title={
            sandboxRecord?.runtime_summary.persistent
              ? "Pause sandbox — state is auto-saved; Resume picks up where you left off"
              : "Pause sandbox — snapshot state and stop the VM"
          }
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
          <span>Pause</span>
        </button>
      )}
      {isPaused && (
        <button
          onClick={() => {
            void onResume();
          }}
          data-testid="preview-resume-button"
          className="text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors"
          title="Resume sandbox from saved snapshot"
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          >
            <polygon points="6 4 20 12 6 20" />
          </svg>
          <span>Resume</span>
        </button>
      )}
      {(isRunning || isPaused) && (
        <button
          onClick={() => {
            void onStop();
          }}
          data-testid="preview-stop-button"
          className="text-muted-foreground hover:text-foreground hover:bg-muted flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors"
          title="Stop sandbox — destroy the VM (state not preserved)"
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          >
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
          <span>Stop</span>
        </button>
      )}
      <button
        onClick={onToggleGrab}
        data-testid="preview-grab-button"
        className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
          grabMode
            ? "bg-blue-400/10 text-blue-400"
            : isRunning
              ? "text-muted-foreground hover:text-foreground hover:bg-muted"
              : "text-muted-foreground/40 cursor-not-allowed"
        }`}
        disabled={!isRunning}
        title="Grab region to send feedback to agent"
      >
        <CursorPointer className="h-3 w-3" />
        <span>Grab</span>
      </button>
      <button
        onClick={onRefresh}
        className={`${isRunning ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/40 cursor-not-allowed"}`}
        disabled={!isRunning}
      >
        ↻
      </button>
      {previewUrl && (
        <a
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${isRunning ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/40 pointer-events-none"}`}
        >
          ↗
        </a>
      )}
    </>
  );
}
