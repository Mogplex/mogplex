"use client";

import { resolvePreviewEnvVarHint } from "@/lib/preview-pane-state";
import { presentSandboxVercelDiagnostics } from "@/lib/vercel/sandbox-diagnostics";
import type { StatusOverlayProps } from "./status-overlay-types";

export function StartingOverlay({
  details,
  launchLogs,
  startingStale,
  onRestart,
  onOpenHealth,
}: StatusOverlayProps) {
  const lastPreviewError = details?.error_summary.last_preview_error ?? null;
  const lastBootError = details?.error_summary.last_boot_error ?? null;
  const devLog = details?.dev_log ?? null;

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
            <div className="font-medium text-amber-100">{startingEnvHint}</div>
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

export function BuildingOverlay({
  details,
  onOpenHealth,
}: StatusOverlayProps) {
  const vercelDiagnostics = details?.runtime_summary.vercel_diagnostics ?? null;
  const vercelPresentation = presentSandboxVercelDiagnostics(vercelDiagnostics);

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

export function PausingOverlay({ onOpenHealth }: StatusOverlayProps) {
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
