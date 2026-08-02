"use client"

import { useState } from "react"
import {
  normalizeRootDirectory,
  resolveSandboxRootDirectory,
} from "@/lib/repo-settings"
import { presentSandboxError } from "@/lib/sandbox/error-state"
import { presentSandboxDebug } from "@/lib/sandbox/debug-presenter"
import type { Repo, SandboxRecord } from "@/lib/types"
import { presentSandboxVercelDiagnostics } from "@/lib/vercel/sandbox-diagnostics"

interface Props {
  repo: Repo
  sandbox: SandboxRecord | null
  onLaunch: () => Promise<void>
  onStop: () => Promise<void>
  onRestart: () => Promise<void>
  onReconcile?: () => Promise<void>
  onExtend?: (minutes: number) => Promise<void>
  onOpenObservability?: () => void
}

export function SandboxHealthPanel({
  repo,
  sandbox,
  onLaunch,
  onStop,
  onRestart,
  onReconcile,
  onExtend,
  onOpenObservability,
}: Props) {
  const [acting, setActing] = useState<"launch" | "stop" | "restart" | "reconcile" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = sandbox
  const installLog = current?.install_log || ""
  const devLog = current?.dev_log || ""
  const runtime = current?.runtime_summary
  const vercelDiagnostics = runtime?.vercel_diagnostics ?? null
  const vercelPresentation = presentSandboxVercelDiagnostics(vercelDiagnostics)
  const debug = presentSandboxDebug({ sandbox: current })
  // The launch-time path snapshot. Surfacing this in the health panel
  // is the most useful place to diagnose "my preview is broken" reports
  // — drift between the sandbox's actual workspace and the repo's
  // current default is a common silent cause.
  // Use normalizeRootDirectory directly for the repo default to avoid
  // overloading resolveSandboxRootDirectory's sandbox argument with a
  // null sentinel — the resolver is for sandbox-vs-repo merging, not
  // for "give me the repo default in isolation".
  const repoDefaultPath = normalizeRootDirectory(repo?.root_directory)
  // Drift state only makes sense when a sandbox is actually attached.
  // Gating here (rather than relying on the JSX-level `{current && …}`
  // render guard) keeps the boolean honest if a future refactor moves
  // it: with no sandbox, sandboxPath would equal repoDefaultPath via
  // the resolver's undefined-fallback branch and "drift" would be
  // misleading.
  const sandboxPath = current ? resolveSandboxRootDirectory(current, repo) : null
  const pathDriftsFromRepoDefault = current
    ? sandboxPath !== repoDefaultPath
    : false
  const previewStatusLabel = debug.previewStatusLabel
  const bootAttemptsLabel = runtime?.boot_attempts ?? 0
  const actionError = presentSandboxError(error)
  const currentError = presentSandboxError(debug.currentError)

  const runAction = async (type: "launch" | "stop" | "restart" | "reconcile", action: () => Promise<void>) => {
    setActing(type)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${type} sandbox`)
    } finally {
      setActing(null)
    }
  }

  return (
    <section className="border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div>
          <div className="text-sm text-foreground">Sandbox Health</div>
          <div className="text-[11px] text-muted-foreground">{repo.full_name}</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px]">
          <span className="border border-border px-2 py-1 text-muted-foreground">
            status: {runtime?.status || "stopped"}
          </span>
          <span className="border border-border px-2 py-1 text-muted-foreground">
            health: {runtime?.health_status || "unknown"}
          </span>
          <span className="border border-border px-2 py-1 text-muted-foreground">
            preview: {previewStatusLabel}
          </span>
          <span className="border border-border px-2 py-1 text-muted-foreground">
            boots: {bootAttemptsLabel}
          </span>
          {current && (
            <span className="border border-border px-2 py-1 text-muted-foreground">
              branch: <span className="font-mono">{current.working_branch}</span>
            </span>
          )}
          {current && (
            <span
              className={`border px-2 py-1 ${
                pathDriftsFromRepoDefault
                  ? "border-amber-400/30 bg-amber-400/[0.06] text-amber-300"
                  : "border-border text-muted-foreground"
              }`}
              title={
                pathDriftsFromRepoDefault
                  ? `Sandbox launched at ${sandboxPath ?? "repo root"}; repo default is ${repoDefaultPath ?? "repo root"}.`
                  : "Sandbox is running at the repo's default workspace."
              }
            >
              path: <span className="font-mono">{sandboxPath ?? "/"}</span>
            </span>
          )}
          {runtime?.last_health_check_at && (
            <span className="text-muted-foreground">
              checked {new Date(runtime.last_health_check_at).toLocaleTimeString()}
            </span>
          )}
          {runtime?.preview_url && (
            <a
              href={runtime.preview_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              open preview
            </a>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 text-xs">
        <button
          onClick={() => runAction("launch", onLaunch)}
          disabled={acting !== null}
          className="border border-border px-3 py-1 text-foreground disabled:opacity-50"
        >
          {acting === "launch" ? "Launching..." : runtime?.status === "running" ? "Relaunch" : "Launch Sandbox"}
        </button>
        <button
          onClick={() => runAction("restart", onRestart)}
          disabled={acting !== null || !sandbox}
          className="border border-border px-3 py-1 text-foreground disabled:opacity-50"
        >
          {acting === "restart" ? "Restarting..." : "Restart Preview"}
        </button>
        {onReconcile && (
          <button
            onClick={() => runAction("reconcile", onReconcile)}
            disabled={acting !== null || !sandbox}
            className="border border-border px-3 py-1 text-foreground disabled:opacity-50"
          >
            {acting === "reconcile" ? "Reconciling..." : "Reconcile Now"}
          </button>
        )}
        <button
          onClick={() => runAction("stop", onStop)}
          disabled={acting !== null || !sandbox}
          className="border border-border px-3 py-1 text-foreground disabled:opacity-50"
        >
          {acting === "stop" ? "Stopping..." : "Stop Sandbox"}
        </button>
        {onOpenObservability && (
          <button
            onClick={onOpenObservability}
            className="border border-border px-3 py-1 text-muted-foreground hover:text-foreground"
          >
            Open in Observability
          </button>
        )}
        {onExtend && runtime?.status === "running" && (
          <>
            <button
              onClick={() => onExtend(30)}
              disabled={acting !== null}
              className="border border-border px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              +30m
            </button>
            <button
              onClick={() => onExtend(60)}
              disabled={acting !== null}
              className="border border-border px-2 py-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              +1h
            </button>
          </>
        )}
      </div>

      {actionError ? (
        <div className="mx-4 mt-4 border border-destructive px-3 py-2 text-[11px] text-destructive">
          <div className="font-medium">{actionError.title}</div>
          <div className="mt-1 whitespace-pre-wrap break-words text-destructive/80">{actionError.message}</div>
          {actionError.cta ? (
            <a
              href={actionError.cta.href}
              className="mt-2 inline-flex border border-destructive/40 px-2 py-1 text-[10px] text-destructive hover:bg-destructive/10"
            >
              {actionError.cta.label}
            </a>
          ) : null}
        </div>
      ) : null}

      {currentError ? (
        <div className="mx-4 mt-4 border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
          <div className="font-medium">{currentError.title}</div>
          <div className="mt-1 whitespace-pre-wrap break-words text-destructive/80">{currentError.message}</div>
          {currentError.cta ? (
            <a
              href={currentError.cta.href}
              className="mt-2 inline-flex border border-destructive/30 px-2 py-1 text-[10px] text-destructive hover:bg-destructive/10"
            >
              {currentError.cta.label}
            </a>
          ) : null}
        </div>
      ) : null}

      {vercelPresentation ? (
        <div className="mx-4 mt-4 border border-border bg-secondary/20 px-3 py-3 text-[11px]">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Vercel Diagnostics</div>
            <span className="border border-border px-2 py-1 text-muted-foreground">
              {vercelPresentation.stateLabel}
            </span>
            {vercelDiagnostics?.deploymentStatus ? (
              <span className="border border-border px-2 py-1 text-muted-foreground">
                deployment: {vercelDiagnostics.deploymentStatus}
              </span>
            ) : null}
            {vercelDiagnostics?.detectedAt ? (
              <span className="text-muted-foreground">
                checked {new Date(vercelDiagnostics.detectedAt).toLocaleTimeString()}
              </span>
            ) : null}
          </div>
          {vercelPresentation.summary ? (
            <div className="mt-2 whitespace-pre-wrap break-words text-foreground">{vercelPresentation.summary}</div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span>Deployment ID: {vercelDiagnostics?.deploymentId || "—"}</span>
            {vercelDiagnostics?.deploymentUrl ? (
              <a
                href={vercelDiagnostics.deploymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline break-all"
              >
                open deployment
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 border-b border-border px-4 py-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last Preview Error</div>
          <div className="text-xs text-foreground whitespace-pre-wrap break-words">
            {debug.lastPreviewErrorLabel}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last Boot Error</div>
          <div className="text-xs text-foreground whitespace-pre-wrap break-words">
            {debug.lastBootErrorLabel}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Boot Window</div>
          <div className="text-xs text-foreground">
            {runtime?.last_boot_started_at ? new Date(runtime.last_boot_started_at).toLocaleString() : "Never started"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {runtime?.last_boot_completed_at ? `Completed ${new Date(runtime.last_boot_completed_at).toLocaleString()}` : "No successful boot recorded"}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Preview URL</div>
          {runtime?.preview_url ? (
            <a
              href={runtime.preview_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary break-all hover:underline"
            >
              {runtime.preview_url}
            </a>
          ) : (
            <div className="text-xs text-foreground">Not available</div>
          )}
        </div>
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Billing</div>
          <div className="text-xs text-foreground">{debug.computeBillingLabel}</div>
          <div className="text-[11px] text-muted-foreground break-all">
            Project: {debug.projectLabel}
          </div>
          <div className="text-[11px] text-muted-foreground break-all">
            Team: {debug.teamLabel}
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Install Log</div>
          <pre className="max-h-80 overflow-auto border border-border bg-background p-3 text-[11px] text-foreground whitespace-pre-wrap">
            {installLog || "No install log yet."}
          </pre>
        </div>
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Dev Server Log</div>
          <pre className="max-h-80 overflow-auto border border-border bg-background p-3 text-[11px] text-foreground whitespace-pre-wrap">
            {devLog || "No dev log yet."}
          </pre>
        </div>
      </div>
    </section>
  )
}
