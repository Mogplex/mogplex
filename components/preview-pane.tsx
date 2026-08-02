"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  deriveSandboxHealthStatus,
  useSandboxHealth,
} from "@/hooks/use-sandbox-health";
import { useSandboxStore } from "@/hooks/use-sandbox";
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider";
import { useSessionsStore } from "@/hooks/use-sessions";
import {
  getPreviewFileSelectionResetState,
  resolvePreviewEnvVarHint,
} from "@/lib/preview-pane-state";
import type { SandboxHealthStatus } from "@/lib/sandbox/health-status";
import {
  createSandboxLaunchAttemptId,
  presentSandboxError,
  shouldShowSandboxLaunchError,
  type SandboxError,
} from "@/lib/sandbox/error-state";
import type { PreviewPaneTab } from "@/hooks/use-split-panes";
import { buildSandboxObservabilityHref } from "@/lib/sandbox/navigation";
import {
  derivePreviewOverlayStopReasonText,
  derivePreviewOverlayStatus,
  type PreviewOverlayStatus,
} from "@/lib/sandbox/preview-overlay-status";
import {
  getSandboxUiHealthStatus,
  isSandboxUiRuntimeRunning,
  resolveSandboxUiBundle,
} from "@/lib/sandbox/ui-state";
import type { SandboxRecord } from "@/lib/types";
import { usePreviewFeedbackStore } from "@/hooks/use-preview-feedback";
import { trackActivation } from "@/lib/activation-tracking";
import {
  bindSessionToPendingSandboxBranch,
  ensureSessionSandboxBinding,
} from "@/lib/sandbox/session-retarget";
import { presentSandboxVercelDiagnostics } from "@/lib/vercel/sandbox-diagnostics";
import { useSandboxLaunchActions } from "@/components/sandbox-launch-provider";
import { resolveSandboxLaunchIntentFromUiState } from "@/lib/sandbox/launch-intent";
import { resolvePreviewPaneLaunchContext } from "@/lib/sandbox/preview-launch-context";
import { CursorPointer, ChatBubble } from "iconoir-react";
import dynamic from "next/dynamic";

const FileTreePane = dynamic(
  () => import("./file-tree-pane").then((m) => m.FileTreePane),
  { ssr: false }
);
const MonacoPane = dynamic(
  () => import("./monaco-pane").then((m) => m.MonacoPane),
  { ssr: false }
);
const SandboxHealthPanel = dynamic(
  () => import("./sandbox-health-panel").then((m) => m.SandboxHealthPanel),
  { ssr: false }
);

interface Props {
  previewUrl?: string;
  sandboxRecordId?: string;
  sandboxCreating?: boolean;
  sandboxError?: SandboxError | null;
  sandboxId?: string;
  workingBranch?: string | null;
  rootLabel?: string;
  activeRepo?: {
    id: string;
    full_name: string;
    default_branch?: string;
    working_branch?: string | null;
  } | null;
  initialTab?: PreviewPaneTab;
  activeFilePath?: string | null;
  onActiveFileChange?: (filePath: string | null) => void;
  onRetargetFilePath?: (
    fromPath: string,
    toPath: string,
    sandboxId: string
  ) => void;
  onClearFilePath?: (targetPath: string, sandboxId: string) => void;
  onTabChange?: (tab: PreviewPaneTab) => void;
  onPopOut?: (activeFile?: string) => void;
}

function formatSandboxTimeRemaining(msLeft: number): string {
  if (msLeft <= 0) return "Expiring";
  const totalMinutes = Math.floor(msLeft / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  if (minutes > 0) return `${minutes}m left`;
  return "<1m left";
}

function useSandboxTimeRemaining(
  baseTimestamp: string | null | undefined,
  effectiveTimeoutMs: number | null | undefined
): string | null {
  const [now, setNow] = useState(() => Date.now());
  const hasInput =
    typeof effectiveTimeoutMs === "number" &&
    effectiveTimeoutMs > 0 &&
    typeof baseTimestamp === "string" &&
    baseTimestamp.length > 0;

  useEffect(() => {
    if (!hasInput) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [hasInput]);

  if (!hasInput) return null;
  const baseMs = new Date(baseTimestamp as string).getTime();
  if (!Number.isFinite(baseMs)) return null;
  const msLeft = baseMs + (effectiveTimeoutMs as number) - now;
  return formatSandboxTimeRemaining(msLeft);
}

function formatPreviewToolbarStatus(status: PreviewOverlayStatus) {
  switch (status) {
    case "starting":
      return "Starting...";
    case "building":
      return "Building";
    case "pausing":
      return "Pausing";
    case "stopped":
      return "Stopped";
    case "paused":
      return "Paused";
    case "build_failed":
      return "Build failed";
    case "deployment_missing":
      return "Deployment issue";
    case "app_error":
      return "App error";
    case "unreachable":
      return "Unreachable";
    case "idle_warning":
      return "Idle warning";
    case "error":
      return "Error";
    default:
      return "No preview";
  }
}

function parseEnvText(input: string): Record<string, string> | null {
  const result: Record<string, string> = {};
  for (const raw of input.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = raw.indexOf("=");
    if (sep <= 0) return null;
    const key = raw.slice(0, sep).trim();
    if (!key) return null;
    const rawVal = raw.slice(sep + 1);
    const val =
      rawVal.match(/^"(.*)"$/)?.[1] ?? rawVal.match(/^'(.*)'$/)?.[1] ?? rawVal;
    result[key] = val;
  }
  if (Object.keys(result).length === 0) return null;
  return result;
}

export function InlineEnvVarForm({
  repoId,
  onSaved,
}: {
  repoId: string;
  onSaved?: () => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    const parsed = parseEnvText(text);
    if (!parsed) {
      setSaveError("Invalid format — use KEY=value lines");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      // Merge with existing env vars so we don't wipe previously configured keys
      let existingEnvVars: Record<string, string> = {};
      const repoRes = await fetch(`/api/repos?id=${repoId}`, {
        headers: getActiveTeamRequestHeaders(),
      });
      if (repoRes.ok) {
        const repos = (await repoRes.json().catch(() => [])) as Array<{
          id: string;
          sandbox_env_vars?: unknown;
        }>;
        const current = repos.find((r) => r.id === repoId);
        if (
          current?.sandbox_env_vars &&
          typeof current.sandbox_env_vars === "object" &&
          !Array.isArray(current.sandbox_env_vars)
        ) {
          existingEnvVars = current.sandbox_env_vars as Record<string, string>;
        }
      }
      const merged = { ...existingEnvVars, ...parsed };
      const res = await fetch("/api/repos", {
        method: "PATCH",
        headers: getActiveTeamRequestHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ id: repoId, sandbox_env_vars: merged }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        setSaveError(body.message ?? "Failed to save");
      } else {
        setSaved(true);
        onSaved?.();
      }
    } catch {
      setSaveError("Network error");
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="mt-2 text-[11px] text-red-300/70">
        Saved. Restarting preview…
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"MISSING_VAR=value\nANOTHER_VAR=value"}
        rows={3}
        className="w-full rounded border border-red-500/30 bg-black/20 px-2 py-1.5 font-mono text-[11px] text-red-100 placeholder:text-red-300/40 focus:ring-1 focus:ring-red-500/50 focus:outline-none"
      />
      {saveError && <div className="text-[10px] text-red-400">{saveError}</div>}
      <button
        onClick={() => void handleSave()}
        disabled={saving || !text.trim()}
        className="rounded border border-red-500/40 px-3 py-1 text-[11px] text-red-200 hover:bg-red-500/10 disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save & restart"}
      </button>
    </div>
  );
}

export function StatusOverlay({
  status,
  error,
  details,
  launchLogs,
  onLaunch,
  onRestart,
  onRetryHealth,
  onOpenHealth,
  onExtend,
  onResume,
  onStartFresh,
  workingBranch,
  startingStale,
  repoId,
}: {
  status: PreviewOverlayStatus;
  error?: SandboxError | null;
  details?: {
    runtime_summary: SandboxRecord["runtime_summary"];
    error_summary: SandboxRecord["error_summary"];
    dev_log?: SandboxRecord["dev_log"];
  } | null;
  launchLogs?: string;
  onLaunch?: () => void;
  onRestart?: () => void;
  onRetryHealth?: () => void;
  onOpenHealth?: () => void;
  onExtend?: () => void;
  onResume?: () => void;
  onStartFresh?: () => void;
  workingBranch?: string | null;
  startingStale?: boolean;
  repoId?: string;
}) {
  const lastPreviewHttpStatus =
    details?.runtime_summary.last_preview_http_status ?? null;
  const lastPreviewError = details?.error_summary.last_preview_error ?? null;
  const lastBootError = details?.error_summary.last_boot_error ?? null;
  const devLog = details?.dev_log ?? null;
  const vercelDiagnostics = details?.runtime_summary.vercel_diagnostics ?? null;
  const vercelPresentation = presentSandboxVercelDiagnostics(vercelDiagnostics);
  const stopReasonText = derivePreviewOverlayStopReasonText(status, details);

  if (status === "starting") {
    // Surface env-var hints as soon as they show up anywhere (boot error,
    // preview error, or streaming dev-server logs) — don't make the user
    // wait out the 120 s "stale" timeout when the cause is already clear.
    const startingEnvHint = resolvePreviewEnvVarHint({
      lastBootError,
      lastPreviewError,
      devLog,
      launchLogs,
    });
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <svg
          className="h-6 w-6 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span className="text-xs">Starting dev server...</span>
        {startingEnvHint ? (
          <div className="space-y-2">
            <div className="max-w-md rounded border border-amber-400/40 bg-amber-400/8 px-3 py-2 text-left text-[11px] text-amber-200">
              <div className="font-medium text-amber-100">
                {startingEnvHint}
              </div>
              <div className="mt-1 text-amber-200/80">
                Add the missing values in repo settings → Environment variables,
                then restart the preview.
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {onRestart && (
                <button
                  onClick={onRestart}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 rounded px-3 py-1 text-xs"
                >
                  Restart sandbox
                </button>
              )}
              {onOpenHealth && (
                <button
                  onClick={onOpenHealth}
                  className="text-muted-foreground hover:text-foreground text-[11px] underline"
                >
                  View health details
                </button>
              )}
            </div>
          </div>
        ) : startingStale ? (
          <div className="space-y-2">
            <p className="text-muted-foreground text-[11px]">
              {launchLogs && /error|fail|cannot|exited|crash/i.test(launchLogs)
                ? "The dev server logged an error but the cause couldn't be auto-detected. Open the terminal pane to see the full output."
                : "This is taking longer than expected. The dev server may have failed to start."}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {onRestart && (
                <button
                  onClick={onRestart}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 rounded px-3 py-1 text-xs"
                >
                  Restart sandbox
                </button>
              )}
              {onOpenHealth && (
                <button
                  onClick={onOpenHealth}
                  className="text-muted-foreground hover:text-foreground text-[11px] underline"
                >
                  View health details
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (status === "building") {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <svg
          className="h-6 w-6 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <div className="space-y-1">
          <div className="text-foreground text-sm">
            Vercel deployment is still building
          </div>
          <div className="text-muted-foreground max-w-md text-[11px] break-words whitespace-pre-wrap">
            {vercelPresentation?.summary ||
              "The latest deployment for the linked Vercel project is still building."}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onOpenHealth && (
            <button
              onClick={onOpenHealth}
              className="border-border text-muted-foreground hover:text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
            >
              Open health
            </button>
          )}
        </div>
      </div>
    );
  }

  if (status === "pausing") {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <svg
          className="h-6 w-6 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <div className="space-y-1">
          <div className="text-foreground text-sm">Pausing sandbox</div>
          <div className="text-muted-foreground max-w-md text-[11px]">
            Saving the persistent VM state. Resume will be available when this
            finishes.
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onOpenHealth && (
            <button
              onClick={onOpenHealth}
              className="border-border text-muted-foreground hover:text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
            >
              Open health
            </button>
          )}
        </div>
      </div>
    );
  }

  if (status === "stopped") {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <svg
          className="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <rect x="9" y="9" width="6" height="6" />
        </svg>
        <div className="space-y-1">
          <div className="text-foreground text-xs">
            {stopReasonText
              ? `Sandbox stopped — ${stopReasonText}`
              : "Sandbox stopped"}
          </div>
          {workingBranch ? (
            <div className="text-muted-foreground text-[11px]">
              Working branch: <span className="font-mono">{workingBranch}</span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {onLaunch && (
            <button
              onClick={onLaunch}
              className="border-border text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
            >
              Restart on this branch
            </button>
          )}
          {onStartFresh && (
            <button
              onClick={onStartFresh}
              className="text-muted-foreground hover:text-foreground text-[11px] underline-offset-2 hover:underline"
            >
              Start fresh ↗
            </button>
          )}
        </div>
      </div>
    );
  }

  if (status === "app_error") {
    const envVarHint = resolvePreviewEnvVarHint({
      lastBootError,
      lastPreviewError,
      devLog,
      errorMessage: error?.message,
      launchLogs,
    });
    return (
      <div className="text-accent-red flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <svg
          className="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div className="space-y-1">
          <div className="text-foreground text-sm">
            Preview returned an application error
          </div>
          {lastPreviewHttpStatus ? (
            <div className="text-muted-foreground text-[11px]">
              Last preview response: HTTP {lastPreviewHttpStatus}
            </div>
          ) : null}
          {envVarHint ? (
            <div className="max-w-md rounded border border-red-500/30 bg-red-500/8 px-3 py-2 text-left text-[11px] text-red-300">
              <div className="font-medium text-red-200">{envVarHint}</div>
              {repoId ? (
                <InlineEnvVarForm repoId={repoId} onSaved={onRestart} />
              ) : (
                <div className="mt-1 text-red-300/70">
                  Add the missing values in repo settings → Environment
                  variables, then restart.
                </div>
              )}
            </div>
          ) : (
            <div className="text-muted-foreground max-w-md text-[11px] break-words whitespace-pre-wrap">
              {lastPreviewError ||
                lastBootError ||
                error?.message ||
                "The sandbox is up, but the app failed to boot cleanly."}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onRetryHealth && (
            <button
              onClick={onRetryHealth}
              className="border-border text-foreground hover:bg-secondary rounded-md border px-3 py-1.5 text-[11px]"
            >
              Check again
            </button>
          )}
          {onRestart && (
            <button
              onClick={onRestart}
              className="border-border text-foreground hover:bg-secondary rounded-md border px-3 py-1.5 text-[11px]"
            >
              Restart preview
            </button>
          )}
          {onOpenHealth && (
            <button
              onClick={onOpenHealth}
              className="border-border text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md border px-3 py-1.5 text-[11px]"
            >
              Open health
            </button>
          )}
        </div>
        <div className="text-muted-foreground/60 mt-1 text-[10px]">
          Auto-retrying in background
        </div>
      </div>
    );
  }

  if (status === "build_failed") {
    return (
      <div className="text-accent-red flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <svg
          className="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div className="space-y-1">
          <div className="text-foreground text-sm">
            Latest Vercel deployment failed to build
          </div>
          {vercelDiagnostics?.deploymentStatus ? (
            <div className="text-muted-foreground text-[11px]">
              Latest deployment status: {vercelDiagnostics.deploymentStatus}
            </div>
          ) : null}
          <div className="text-muted-foreground max-w-md text-[11px] break-words whitespace-pre-wrap">
            {vercelPresentation?.summary ||
              lastPreviewError ||
              lastBootError ||
              error?.message ||
              "The latest deployment failed before the preview became healthy."}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onRestart && (
            <button
              onClick={onRestart}
              className="border-border text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
            >
              Restart preview
            </button>
          )}
          {onOpenHealth && (
            <button
              onClick={onOpenHealth}
              className="border-border text-muted-foreground hover:text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
            >
              Open health
            </button>
          )}
        </div>
      </div>
    );
  }

  if (status === "unreachable") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-amber-300">
        <svg
          className="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M8.5 15.5c.97-.98 2.25-1.5 3.5-1.5s2.53.52 3.5 1.5" />
          <path d="M6 12.5A8.28 8.28 0 0 1 12 10c2.28 0 4.4.92 6 2.5" />
          <line x1="3" y1="3" x2="21" y2="21" />
        </svg>
        <div className="space-y-1">
          <div className="text-foreground text-sm">Preview is unreachable</div>
          <div className="text-muted-foreground max-w-md text-[11px] break-words whitespace-pre-wrap">
            {lastPreviewError ||
              lastBootError ||
              "The sandbox is running, but the preview is not responding yet."}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onRetryHealth && (
            <button
              onClick={onRetryHealth}
              className="border-border text-foreground hover:bg-secondary rounded-md border px-3 py-1.5 text-[11px]"
            >
              Check again
            </button>
          )}
          {onRestart && (
            <button
              onClick={onRestart}
              className="border-border text-foreground hover:bg-secondary rounded-md border px-3 py-1.5 text-[11px]"
            >
              Restart preview
            </button>
          )}
          {onOpenHealth && (
            <button
              onClick={onOpenHealth}
              className="border-border text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md border px-3 py-1.5 text-[11px]"
            >
              Open health
            </button>
          )}
        </div>
        <div className="text-muted-foreground/60 mt-1 text-[10px]">
          Auto-retrying in background
        </div>
      </div>
    );
  }

  if (status === "deployment_missing") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-amber-300">
        <svg
          className="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12h8" />
          <path d="M12 8v8" />
        </svg>
        <div className="space-y-1">
          <div className="text-foreground text-sm">
            {vercelPresentation?.title ||
              "No deployment found for linked Vercel project"}
          </div>
          <div className="text-muted-foreground max-w-md text-[11px] break-words whitespace-pre-wrap">
            {vercelPresentation?.summary ||
              lastPreviewError ||
              lastBootError ||
              "The linked Vercel project does not have a ready deployment yet."}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onRestart && (
            <button
              onClick={onRestart}
              className="border-border text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
            >
              Restart preview
            </button>
          )}
          {onOpenHealth && (
            <button
              onClick={onOpenHealth}
              className="border-border text-muted-foreground hover:text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
            >
              Open health
            </button>
          )}
        </div>
      </div>
    );
  }

  if (status === "error") {
    const errorState = presentSandboxError(error);
    const envVarHint = resolvePreviewEnvVarHint({
      lastBootError,
      lastPreviewError,
      devLog,
      errorMessage: errorState?.message,
      launchLogs,
    });
    const title = envVarHint
      ? "Live preview failed to start"
      : errorState?.title || "Sandbox launch failed";
    const summary = errorState?.message || null;
    const rawLog = (() => {
      const raw = lastBootError || launchLogs || null;
      if (!raw || raw === summary) return null;
      const lines = raw.split("\n");
      return lines.length > 60 ? lines.slice(-60).join("\n") : raw;
    })();
    return (
      <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
        <div className="flex items-start gap-2.5">
          <svg
            className="text-accent-red mt-0.5 h-4 w-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="text-foreground text-sm font-medium">{title}</div>
            {envVarHint ? (
              <div className="rounded border border-red-500/30 bg-red-500/8 px-3 py-2 text-[11px] text-red-300">
                <div className="font-medium text-red-200">{envVarHint}</div>
                {repoId ? (
                  <InlineEnvVarForm repoId={repoId} onSaved={onRestart} />
                ) : (
                  <div className="mt-1 text-red-300/70">
                    Add the missing values in repo settings → Environment
                    variables, then restart.
                  </div>
                )}
              </div>
            ) : summary ? (
              <div className="text-muted-foreground text-[11px]">{summary}</div>
            ) : null}
            {rawLog ? (
              <pre className="bg-muted/40 border-border max-h-64 overflow-y-auto rounded border px-3 py-2 font-mono text-[10px] leading-relaxed break-all whitespace-pre-wrap text-red-300/80">
                {rawLog}
              </pre>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              {onRestart && (
                <button
                  onClick={onRestart}
                  className="border-border text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
                >
                  Restart preview
                </button>
              )}
              {errorState?.cta && (
                <a
                  href={errorState.cta.href}
                  className="border-border text-foreground hover:bg-secondary rounded border px-3 py-1 text-[10px]"
                >
                  {errorState.cta.label}
                </a>
              )}
              {onOpenHealth && (
                <button
                  onClick={onOpenHealth}
                  className="border-border text-muted-foreground hover:text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
                >
                  Open health
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === "paused") {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3">
        <svg
          className="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="10" y1="9" x2="10" y2="15" />
          <line x1="14" y1="9" x2="14" y2="15" />
        </svg>
        <span className="text-xs">Sandbox Paused</span>
        <span className="text-muted-foreground/60 text-[10px]">
          Your state is saved. Resume to pick up where you left off.
        </span>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onResume && (
            <button
              onClick={onResume}
              className="border-border text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
            >
              Resume preview
            </button>
          )}
          {onOpenHealth && (
            <button
              onClick={onOpenHealth}
              className="border-border text-muted-foreground hover:text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
            >
              Open health
            </button>
          )}
        </div>
      </div>
    );
  }

  if (status === "idle_warning") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-amber-300">
        <div className="text-foreground text-sm">
          Sandbox is about to idle out
        </div>
        <div className="text-muted-foreground text-[11px]">
          Extend it to keep the preview available.
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onExtend && (
            <button
              onClick={onExtend}
              className="border-border text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
            >
              Extend sandbox
            </button>
          )}
          {onOpenHealth && (
            <button
              onClick={onOpenHealth}
              className="border-border text-muted-foreground hover:text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
            >
              Open health
            </button>
          )}
        </div>
      </div>
    );
  }

  // not_available
  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 text-xs">
      <span>No preview available</span>
      {onLaunch && (
        <button
          onClick={onLaunch}
          className="border-border text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
        >
          Launch preview
        </button>
      )}
    </div>
  );
}

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function GrabOverlay({
  onCapture,
  onCancel,
}: {
  onCapture: (region: SelectionRect) => void;
  onCancel: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    setStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!start) return;
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [start]
  );

  const handleMouseUp = useCallback(() => {
    if (!start || !current) return;
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);

    // Minimum 10px selection to avoid accidental clicks
    if (width < 10 || height < 10) {
      setStart(null);
      setCurrent(null);
      return;
    }

    // Normalize to percentages of the container
    onCapture({
      x: Math.round((x / rect.width) * 100),
      y: Math.round((y / rect.height) * 100),
      width: Math.round((width / rect.width) * 100),
      height: Math.round((height / rect.height) * 100),
    });
  }, [start, current, onCapture]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onCancel]);

  const selectionBox =
    start && current
      ? {
          left: Math.min(start.x, current.x),
          top: Math.min(start.y, current.y),
          width: Math.abs(current.x - start.x),
          height: Math.abs(current.y - start.y),
        }
      : null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-20 cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Dimmed backdrop */}
      <div className="absolute inset-0 bg-black/20" />

      {/* Selection rectangle */}
      {selectionBox && selectionBox.width > 2 && (
        <div
          className="absolute border-2 border-blue-400 bg-blue-400/10"
          style={selectionBox}
        />
      )}

      {/* Instructions */}
      <div className="bg-card/90 border-border text-muted-foreground pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-md border px-3 py-1.5 text-[10px] backdrop-blur-sm">
        Drag to select a region · Esc to cancel
      </div>
    </div>
  );
}

function FeedbackForm({
  region,
  onSubmit,
  onCancel,
}: {
  region: SelectionRect;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onCancel]);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />

      {/* Region highlight */}
      <div
        className="pointer-events-none absolute border-2 border-blue-400 bg-blue-400/10"
        style={{
          left: `${region.x}%`,
          top: `${region.y}%`,
          width: `${region.width}%`,
          height: `${region.height}%`,
        }}
      />

      {/* Feedback input */}
      <div className="bg-card border-border relative z-30 w-72 overflow-hidden rounded-lg border shadow-lg">
        <div className="border-border bg-secondary flex items-center gap-2 border-b px-3 py-2">
          <ChatBubble className="h-3.5 w-3.5 text-blue-400" />
          <span className="text-secondary-foreground text-[11px] font-medium">
            Send feedback to agent
          </span>
        </div>
        <div className="p-2">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Describe what you see or what should change..."
            data-testid="preview-feedback-input"
            className="bg-background border-border focus:ring-ring placeholder:text-muted-foreground/50 h-16 w-full resize-none rounded border px-2 py-1.5 text-xs focus:ring-1 focus:outline-none"
          />
        </div>
        <div className="border-border flex items-center justify-between border-t px-3 py-2">
          <span className="text-muted-foreground/60 text-[9px]">
            Region: {region.x}%,{region.y}% · {region.width}×{region.height}%
          </span>
          <div className="flex gap-1.5">
            <button
              onClick={onCancel}
              className="text-muted-foreground hover:text-foreground border-border hover:bg-secondary rounded border px-2.5 py-1 text-[10px]"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!text.trim()}
              data-testid="preview-feedback-send"
              className="text-primary-foreground bg-primary hover:bg-primary/90 rounded px-2.5 py-1 text-[10px] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function describeRegion(r: SelectionRect): string {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const vPos = cy < 33 ? "top" : cy > 66 ? "bottom" : "middle";
  const hPos = cx < 33 ? "left" : cx > 66 ? "right" : "center";
  if (vPos === "middle" && hPos === "center") return "center area";
  if (hPos === "center") return `${vPos} area`;
  if (vPos === "middle") return `${hPos} side`;
  return `${vPos}-${hPos} area`;
}

export function PreviewPane({
  previewUrl,
  sandboxRecordId,
  sandboxCreating,
  sandboxError,
  sandboxId,
  workingBranch,
  rootLabel,
  activeRepo,
  initialTab,
  activeFilePath,
  onActiveFileChange,
  onRetargetFilePath,
  onClearFilePath,
  onTabChange,
  onPopOut,
}: Props) {
  const router = useRouter();
  const { scope } = useParams<{ scope: string }>();
  const activeFile = activeFilePath ?? null;
  const [refreshKey, setRefreshKey] = useState(0);
  const [grabMode, setGrabMode] = useState(false);
  const [capturedRegion, setCapturedRegion] = useState<SelectionRect | null>(
    null
  );
  const sendFeedback = usePreviewFeedbackStore((s) => s.send);
  const activeSessionId = useSessionsStore((s) => s.activeSessionId);
  const activeTab = initialTab ?? "preview";

  const repoId = activeRepo?.id;
  const sandboxRecord = useSandboxStore((s) =>
    sandboxRecordId
      ? s.getSandboxById(sandboxRecordId)
      : repoId
        ? s.getSandboxForRepo(repoId)
        : null
  );
  const restartSandbox = useSandboxStore((s) => s.restart);
  const stopSandbox = useSandboxStore((s) => s.stop);
  const pauseSandbox = useSandboxStore((s) => s.pause);
  const resumeSandbox = useSandboxStore((s) => s.resume);
  const extendSandbox = useSandboxStore((s) => s.extend);
  const launchLogs = useSandboxStore((s) => {
    if (!repoId) return undefined;
    return s.getLaunchLogs(
      repoId,
      sandboxRecordId
        ? { sandboxId: sandboxRecordId }
        : workingBranch
          ? { workingBranch }
          : undefined
    );
  });
  const { launchRepoSandbox } = useSandboxLaunchActions();
  const onActiveFileChangeRef = useRef(onActiveFileChange);
  const trackedSandboxIdRef = useRef<string | null>(sandboxId ?? null);
  const activeRepoRef = useRef(activeRepo);
  const sandboxRecordIdRef = useRef(sandboxRecordId);
  const effectiveSandboxRecordId = sandboxRecordId ?? sandboxRecord?.id ?? null;
  const [stoppedOverlayLaunchAttempt, setStoppedOverlayLaunchAttempt] =
    useState<{
      repoId: string | undefined;
      sandboxRecordId: string | null;
      launchAttemptId: string;
    } | null>(null);
  const stoppedOverlayLaunchAttemptId =
    stoppedOverlayLaunchAttempt &&
    stoppedOverlayLaunchAttempt.repoId === repoId &&
    stoppedOverlayLaunchAttempt.sandboxRecordId === effectiveSandboxRecordId
      ? stoppedOverlayLaunchAttempt.launchAttemptId
      : null;

  useEffect(() => {
    onActiveFileChangeRef.current = onActiveFileChange;
  }, [onActiveFileChange]);

  useEffect(() => {
    activeRepoRef.current = activeRepo;
    sandboxRecordIdRef.current = sandboxRecordId;
  }, [activeRepo, sandboxRecordId]);

  // Reset file selection when sandbox changes — intentional sync of external
  // state (active file) when the sandbox identity changes.

  useEffect(() => {
    const nextSelectionState = getPreviewFileSelectionResetState(
      trackedSandboxIdRef.current,
      sandboxId
    );
    trackedSandboxIdRef.current = nextSelectionState.trackedSandboxId;
    if (!nextSelectionState.shouldClearActiveFile) return;
    onActiveFileChangeRef.current?.(null);
  }, [sandboxId]);

  const { status, reconcileHealth } = useSandboxHealth({
    sandboxRecordId,
    enabled: !!sandboxRecordId,
  });

  // Resolve UI state and overlay status from a single traversal so they cannot
  // drift apart on inputs or on resolver code paths.
  const { state: sandboxUiState, overlayStatus: resolvedOverlayStatus } =
    resolveSandboxUiBundle({
      session: null,
      record: sandboxRecord,
      liveProbe: status,
    });
  const resolvedHealthStatus = getSandboxUiHealthStatus(sandboxUiState);
  const shouldShowLaunchError = shouldShowSandboxLaunchError({
    error: sandboxError,
    overlayStatus: resolvedOverlayStatus,
    stoppedOverlayLaunchAttemptId,
  });
  const preResolverOverride: SandboxHealthStatus | null = shouldShowLaunchError
    ? "error"
    : sandboxCreating && !sandboxRecord
      ? "starting"
      : !sandboxRecordId
        ? "not_available"
        : null;
  const effectiveStatus: SandboxHealthStatus =
    preResolverOverride ?? resolvedHealthStatus;
  // Priority: sandboxError > sandboxCreating (no record yet) > !sandboxRecordId
  // > resolver bundle. When the override fires we re-derive the overlay so that
  // Vercel diagnostics (e.g. build_failed, deployment_missing) on an existing
  // record still enrich the overlay even though the override forces an error or
  // starting health status.
  const overlayStatus: PreviewOverlayStatus = preResolverOverride
    ? derivePreviewOverlayStatus(preResolverOverride, sandboxRecord)
    : resolvedOverlayStatus;

  // isRunning means the VM is up and the toolbar should be interactive — this
  // includes all degraded sub-reasons (idle_warning still serves traffic, and
  // app_error/unreachable still need pause/stop available for recovery). The
  // override path forces the toolbar inert because there is no usable record.
  const isRunning =
    preResolverOverride === null && isSandboxUiRuntimeRunning(sandboxUiState);
  const isPaused =
    preResolverOverride === null && sandboxUiState.kind === "paused";
  const showOverlay = overlayStatus !== "running";

  // Idle timeout resets on activity, so the toolbar countdown must measure from
  // last_active_at (matching getLiveExpiresAt); fall back to created_at for
  // records without activity yet.
  const timeRemainingLabel = useSandboxTimeRemaining(
    sandboxRecord?.last_active_at ?? sandboxRecord?.created_at,
    sandboxRecord?.runtime_summary.effective_timeout_ms
  );

  const handlePause = useCallback(async () => {
    if (!sandboxRecordId) return;
    await pauseSandbox(sandboxRecordId);
  }, [pauseSandbox, sandboxRecordId]);

  const handleStop = useCallback(async () => {
    if (!sandboxRecordId) return;
    const confirmed = window.confirm(
      "Stop this sandbox? The VM will be destroyed and any unsaved state lost."
    );
    if (!confirmed) return;
    await stopSandbox(sandboxRecordId);
  }, [sandboxRecordId, stopSandbox]);

  const handleResume = useCallback(async () => {
    if (!sandboxRecordId) return;
    await resumeSandbox(sandboxRecordId);
  }, [resumeSandbox, sandboxRecordId]);

  // Detect when the "starting" state has persisted too long — likely the dev
  // server crashed silently or the SSE stream disconnected before delivering
  // the error.  After 120 s we surface a restart prompt instead of spinning
  // indefinitely.
  const STARTING_STALE_TIMEOUT_MS = 120_000;
  const [startingStale, setStartingStale] = useState(false);
  // Only "starting" arms the staleness timer; leaving that status tears the
  // effect down, so the cleanup is what clears the flag. Keeping the reset in
  // cleanup (rather than an else-branch) avoids a synchronous setState on every
  // unrelated status change.
  useEffect(() => {
    if (overlayStatus !== "starting") return;
    const timer = setTimeout(() => {
      setStartingStale(true);
    }, STARTING_STALE_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
      setStartingStale(false);
    };
  }, [overlayStatus]);

  // Auto-refresh the iframe when status transitions to running so the user
  // sees actual dev-server output instead of the stale 502/blank page Chrome
  // cached during the "starting" phase.
  // Adjusting state during render (React's documented pattern for reacting to a
  // prop change) rather than in an effect: this way the remount is queued in the
  // same pass that observed the transition, with no intermediate stale paint.
  const [prevEffectiveStatus, setPrevEffectiveStatus] = useState(effectiveStatus);
  if (prevEffectiveStatus !== effectiveStatus) {
    setPrevEffectiveStatus(effectiveStatus);
    if (effectiveStatus === "running") {
      setRefreshKey((k) => k + 1);
    }
  }

  const handleRestart = useCallback(async () => {
    if (!repoId || !sandboxRecordId) return;

    bindSessionToPendingSandboxBranch(
      activeSessionId,
      sandboxRecord?.working_branch ?? null
    );
    const restartedSandbox = await restartSandbox(repoId, {
      sandboxId: sandboxRecordId,
    });
    if (!restartedSandbox?.id) return;

    ensureSessionSandboxBinding(
      activeSessionId,
      sandboxRecordId,
      restartedSandbox.id
    );
  }, [
    activeSessionId,
    repoId,
    restartSandbox,
    sandboxRecord?.working_branch,
    sandboxRecordId,
  ]);

  const beginStoppedOverlayLaunchAttempt = useCallback(
    (
      nextSandboxRecordId: string | null = effectiveSandboxRecordId,
      nextRepoId: string | undefined = repoId
    ) => {
      const launchAttemptId = createSandboxLaunchAttemptId();
      setStoppedOverlayLaunchAttempt({
        repoId: nextRepoId,
        sandboxRecordId: nextSandboxRecordId,
        launchAttemptId,
      });
      return launchAttemptId;
    },
    [effectiveSandboxRecordId, repoId]
  );

  const clearStoppedOverlayLaunchAttempt = useCallback(
    (launchAttemptId: string | undefined) => {
      if (!launchAttemptId) return;
      setStoppedOverlayLaunchAttempt((current) =>
        current?.launchAttemptId === launchAttemptId ? null : current
      );
    },
    []
  );

  const handleOverlayLaunch = useCallback(
    (trigger: "status_overlay" | "empty_state") => {
      void (async () => {
        const currentActiveRepo = activeRepoRef.current;
        if (!currentActiveRepo) return;

        const currentSession = useSessionsStore.getState().getActiveSession();
        const currentSessionId = currentSession?.id ?? null;
        const currentSandboxRecordId = sandboxRecordIdRef.current;
        const currentRepoId = currentActiveRepo.id;
        const currentSandboxRecord = currentSandboxRecordId
          ? useSandboxStore.getState().getSandboxById(currentSandboxRecordId)
          : currentRepoId
            ? useSandboxStore.getState().getSandboxForRepo(currentRepoId)
            : null;
        const currentLiveProbe =
          deriveSandboxHealthStatus(currentSandboxRecord);
        const launchContext = resolvePreviewPaneLaunchContext({
          trigger,
          session: currentSession,
          record: currentSandboxRecord,
          sandboxRecordId: currentSandboxRecordId,
          liveProbe: currentLiveProbe,
        });
        const launchAttemptId =
          launchContext.shouldReserveStoppedOverlayLaunchAttempt
            ? beginStoppedOverlayLaunchAttempt(
                launchContext.effectiveSandboxRecordId,
                currentRepoId
              )
            : undefined;
        const outcome = await launchRepoSandbox(currentActiveRepo, {
          source: "preview_pane",
          trigger,
          intent: launchContext.intent,
          launchAttemptId,
          onConfirmed: launchAttemptId
            ? (request) => {
                bindSessionToPendingSandboxBranch(
                  currentSessionId,
                  request.workingBranch ?? null
                );
              }
            : undefined,
        });
        if (outcome.status === "launched") {
          clearStoppedOverlayLaunchAttempt(launchAttemptId);
          ensureSessionSandboxBinding(
            currentSessionId,
            launchContext.effectiveSandboxRecordId,
            outcome.sandbox.id
          );
        } else if (outcome.status === "cancelled") {
          clearStoppedOverlayLaunchAttempt(launchAttemptId);
        }
        // Failed stopped-overlay launches intentionally do not clear the
        // attempt ID; the matching launch error needs it to render inline.
      })();
    },
    [
      beginStoppedOverlayLaunchAttempt,
      clearStoppedOverlayLaunchAttempt,
      launchRepoSandbox,
    ]
  );

  const handleStartFresh = useCallback(() => {
    const currentActiveRepo = activeRepoRef.current;
    if (!currentActiveRepo) return;

    void (async () => {
      const currentSession = useSessionsStore.getState().getActiveSession();
      const currentSessionId = currentSession?.id ?? null;
      const currentRepoId = currentActiveRepo.id;
      const currentSandboxRecordId =
        sandboxRecordIdRef.current ??
        useSandboxStore.getState().getSandboxForRepo(currentRepoId)?.id ??
        null;
      // Only reachable from the stopped overlay. Reserve the attempt ID before
      // the dialog so the confirmed request and any failure share one scope.
      const launchAttemptId = beginStoppedOverlayLaunchAttempt(
        currentSandboxRecordId,
        currentRepoId
      );
      const outcome = await launchRepoSandbox(currentActiveRepo, {
        source: "preview_pane",
        trigger: "stopped_overlay_start_fresh",
        intent: { kind: "start_fresh" },
        launchAttemptId,
        onConfirmed: (request) => {
          bindSessionToPendingSandboxBranch(
            currentSessionId,
            request.workingBranch ?? null
          );
        },
      });
      if (outcome.status === "launched") {
        clearStoppedOverlayLaunchAttempt(launchAttemptId);
        // Preserve the same old-sandbox binding captured by the previous
        // inline handlers; if the record is already gone, bind from null.
        ensureSessionSandboxBinding(
          currentSessionId,
          currentSandboxRecordId,
          outcome.sandbox.id
        );
      } else if (outcome.status === "cancelled") {
        clearStoppedOverlayLaunchAttempt(launchAttemptId);
      }
      // Failed stopped-overlay launches intentionally do not clear the
      // attempt ID; the matching launch error needs it to render inline.
    })();
  }, [
    beginStoppedOverlayLaunchAttempt,
    clearStoppedOverlayLaunchAttempt,
    launchRepoSandbox,
  ]);

  const handleCapture = useCallback((region: SelectionRect) => {
    setCapturedRegion(region);
    setGrabMode(false);
  }, []);

  const handleCancelGrab = useCallback(() => {
    setGrabMode(false);
    setCapturedRegion(null);
  }, []);

  const handleFeedbackSubmit = useCallback(
    (text: string) => {
      if (!capturedRegion) return;
      const regionDesc = describeRegion(capturedRegion);
      trackActivation("preview_feedback_sent", {
        source: "preview_pane",
        region: regionDesc,
        width_pct: capturedRegion.width,
        height_pct: capturedRegion.height,
      });
      sendFeedback({
        id: crypto.randomUUID(),
        text: `[Preview feedback — ${regionDesc} (${capturedRegion.x}%,${capturedRegion.y}% ${capturedRegion.width}×${capturedRegion.height}%)]\n${text}`,
        region: capturedRegion,
        timestamp: Date.now(),
      });
      setCapturedRegion(null);
    },
    [capturedRegion, sendFeedback]
  );

  const handlePopOut = useCallback(() => {
    onPopOut?.(activeFile || undefined);
  }, [onPopOut, activeFile]);

  const handleTabChange = useCallback(
    (tab: PreviewPaneTab) => {
      onTabChange?.(tab);
    },
    [onTabChange]
  );

  const handleOpenObservability = useCallback(() => {
    if (!activeRepo?.id) return;
    router.push(
      buildSandboxObservabilityHref({
        scope,
        repoId: activeRepo.id,
        sandboxRecordId: sandboxRecord?.id || sandboxRecordId,
      })
    );
  }, [activeRepo, router, sandboxRecord, sandboxRecordId, scope]);

  const handleReconcile = useCallback(async () => {
    if (!sandboxRecordId) return;

    const response = await fetch(`/api/sandbox/${sandboxRecordId}/reconcile`, {
      method: "POST",
      headers: getActiveTeamRequestHeaders(),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "Failed to reconcile sandbox";
      throw new Error(message);
    }

    if (
      payload &&
      typeof payload === "object" &&
      "sandbox" in payload &&
      payload.sandbox
    ) {
      useSandboxStore
        .getState()
        .setSandboxRecord(payload.sandbox as SandboxRecord);
    }

    await reconcileHealth();
  }, [reconcileHealth, sandboxRecordId]);

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
                {formatPreviewToolbarStatus(overlayStatus)}
              </span>
            )}
            {isRunning && timeRemainingLabel && (
              <span
                data-testid="preview-time-remaining"
                className="text-muted-foreground/70 font-mono text-[10px]"
                title="Approximate time until the sandbox VM reaches its lifetime. Extend in the Health panel to keep it alive."
              >
                {timeRemainingLabel}
              </span>
            )}
            {sandboxRecord?.runtime_summary.persistent && (
              <span
                data-testid="preview-persistent-badge"
                className="text-muted-foreground/80 border-border/50 rounded-sm border px-1.5 py-[1px] font-mono text-[9px] tracking-wide uppercase"
                title="Persistent sandbox — pause auto-saves state, resume wakes the same VM."
              >
                Persistent
              </span>
            )}
            {isRunning && (
              <button
                onClick={() => {
                  void handlePause();
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
                  void handleResume();
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
                  void handleStop();
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
              onClick={() => {
                setGrabMode(!grabMode);
                setCapturedRegion(null);
              }}
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
              onClick={() => setRefreshKey((k) => k + 1)}
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
        )}

        {/* Code tab toolbar */}
        {activeTab === "code" && (
          <>
            {activeFile && (
              <span className="text-muted-foreground max-w-[200px] truncate font-mono">
                {activeFile}
              </span>
            )}
            {onPopOut && (
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
                    onExtend={
                      sandboxRecordId
                        ? () => {
                            void extendSandbox(sandboxRecordId, 30);
                          }
                        : undefined
                    }
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
              onExtend={
                sandboxRecordId
                  ? () => {
                      void extendSandbox(sandboxRecordId, 30);
                    }
                  : undefined
              }
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
            repo={activeRepo as import("@/lib/types").Repo}
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
            onExtend={async (minutes) => {
              if (sandboxRecordId)
                await extendSandbox(sandboxRecordId, minutes);
            }}
            onOpenObservability={handleOpenObservability}
          />
        </div>
      )}
    </div>
  );
}
