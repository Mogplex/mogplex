"use client";

import { resolvePreviewEnvVarHint } from "@/lib/preview-pane-state";
import { presentSandboxError } from "@/lib/sandbox/error-state";
import { presentSandboxVercelDiagnostics } from "@/lib/vercel/sandbox-diagnostics";
import { InlineEnvVarForm } from "./inline-env-var-form";
import type { StatusOverlayProps } from "./status-overlay-types";

function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
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
  );
}

export function AppErrorOverlay({
  error,
  details,
  launchLogs,
  repoId,
  onRetryHealth,
  onRestart,
  onOpenHealth,
}: StatusOverlayProps) {
  const lastPreviewHttpStatus =
    details?.runtime_summary.last_preview_http_status ?? null;
  const lastPreviewError = details?.error_summary.last_preview_error ?? null;
  const lastBootError = details?.error_summary.last_boot_error ?? null;
  const devLog = details?.dev_log ?? null;

  const envVarHint = resolvePreviewEnvVarHint({
    lastBootError,
    lastPreviewError,
    devLog,
    errorMessage: error?.message,
    launchLogs,
  });

  return (
    <div className="text-accent-red flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <ErrorIcon className="h-6 w-6" />
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

export function BuildFailedOverlay({
  error,
  details,
  onRestart,
  onOpenHealth,
}: StatusOverlayProps) {
  const lastPreviewError = details?.error_summary.last_preview_error ?? null;
  const lastBootError = details?.error_summary.last_boot_error ?? null;
  const vercelDiagnostics = details?.runtime_summary.vercel_diagnostics ?? null;
  const vercelPresentation = presentSandboxVercelDiagnostics(vercelDiagnostics);

  return (
    <div className="text-accent-red flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <ErrorIcon className="h-6 w-6" />
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

export function UnreachableOverlay({
  details,
  onRetryHealth,
  onRestart,
  onOpenHealth,
}: StatusOverlayProps) {
  const lastPreviewError = details?.error_summary.last_preview_error ?? null;
  const lastBootError = details?.error_summary.last_boot_error ?? null;

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

export function DeploymentMissingOverlay({
  details,
  onRestart,
  onOpenHealth,
}: StatusOverlayProps) {
  const lastPreviewError = details?.error_summary.last_preview_error ?? null;
  const lastBootError = details?.error_summary.last_boot_error ?? null;
  const vercelDiagnostics = details?.runtime_summary.vercel_diagnostics ?? null;
  const vercelPresentation = presentSandboxVercelDiagnostics(vercelDiagnostics);

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

export function GenericErrorOverlay({
  error,
  details,
  launchLogs,
  repoId,
  onRestart,
  onOpenHealth,
}: StatusOverlayProps) {
  const lastPreviewError = details?.error_summary.last_preview_error ?? null;
  const lastBootError = details?.error_summary.last_boot_error ?? null;
  const devLog = details?.dev_log ?? null;
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
        <ErrorIcon className="text-accent-red mt-0.5 h-4 w-4 shrink-0" />
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
