"use client";

import { useEffect, useId, useState } from "react";
import { OpenNewWindow, Refresh, Server, Trash, Xmark } from "iconoir-react";
import { buildSandboxStateKey, useSandboxStore } from "@/hooks/use-sandbox";
import type { SandboxRecord } from "@/lib/types";
import { getSandboxPreviewPresentation } from "@/lib/control/sandbox-presentation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export type SandboxPreviewTarget = {
  url: string;
  runtimeId: string;
  branch: string;
};

type LifecycleAction = "stop" | "resume" | "restart" | "delete";

const BADGE: Record<string, { label: string; className: string }> = {
  running: {
    label: "Running",
    className:
      "border-sky-400/25 bg-sky-400/10 text-sky-300 [&_span]:animate-pulse [&_span]:bg-sky-400",
  },
  creating: {
    label: "Starting",
    className:
      "border-sky-400/25 bg-sky-400/10 text-sky-300 [&_span]:animate-pulse [&_span]:bg-sky-400",
  },
  installing: {
    label: "Starting",
    className:
      "border-sky-400/25 bg-sky-400/10 text-sky-300 [&_span]:animate-pulse [&_span]:bg-sky-400",
  },
  pausing: {
    label: "Pausing",
    className: "border-ink-700 bg-ink-800 text-ink-300 [&_span]:bg-ink-400",
  },
  paused: {
    label: "Paused",
    className: "border-ink-700 bg-ink-800 text-ink-300 [&_span]:bg-ink-400",
  },
  stopped: {
    label: "Stopped",
    className: "border-ink-700 bg-ink-800 text-ink-400 [&_span]:bg-ink-600",
  },
  error: {
    label: "Error",
    className: "border-delr/25 bg-delr/10 text-delr [&_span]:bg-delr",
  },
};

const ACTIVE_STATUSES = new Set(["running", "creating", "installing"]);

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function Elapsed({ sandbox }: { sandbox: SandboxRecord }) {
  const active = ACTIVE_STATUSES.has(sandbox.runtime_summary.status);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  const start = Date.parse(sandbox.created_at);
  const end = active
    ? now
    : Date.parse(sandbox.last_active_at || sandbox.created_at);
  if (Number.isNaN(start)) return null;
  const seconds = Math.max(0, (end - start) / 1000);
  return (
    <span className="text-ink-400">
      {active
        ? formatElapsed(seconds)
        : `ended after ${formatElapsed(seconds)}`}
    </span>
  );
}

function sandboxLogLines(
  sandbox: SandboxRecord,
  launchLogs: Record<string, string>
): string[] {
  const key = buildSandboxStateKey(
    sandbox.repo_id,
    sandbox.working_branch,
    sandbox.root_directory
  );
  const raw = launchLogs[key] || sandbox.dev_log || sandbox.install_log || "";
  return raw
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-8);
}

export function SandboxPreviewModal({
  target,
  onClose,
}: {
  target: SandboxPreviewTarget | null;
  onClose: () => void;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="border-ink-700 bg-ink-900 flex h-[95dvh] w-[95dvw] max-w-[95dvw] flex-col gap-0 overflow-hidden rounded-xl p-0 shadow-2xl sm:max-w-[95dvw]"
        aria-label="Sandbox preview"
      >
        <div className="border-ink-800 bg-ink-850 flex items-center gap-2 border-b px-3 py-2">
          <DialogTitle className="sr-only">
            Preview for sandbox {target?.runtimeId ?? ""}
          </DialogTitle>
          <div className="border-ink-700/60 bg-ink-950 text-ink-300 flex min-w-0 flex-1 items-center gap-2 rounded-md border px-3 py-1.5 font-mono text-[12.5px]">
            <span className="min-w-0 truncate">{target?.url ?? ""}</span>
          </div>
          <span className="border-ink-700 bg-ink-800 text-ink-300 hidden shrink-0 rounded-md border px-2 py-1 font-mono text-[11.5px] sm:inline">
            {target?.branch ?? ""}
          </span>
          <button
            type="button"
            aria-label="Reload preview"
            onClick={() => setReloadKey((key) => key + 1)}
            className="text-ink-400 hover:bg-ink-800 hover:text-ink-100 shrink-0 rounded-md p-1.5 transition-colors"
          >
            <Refresh className="size-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="Open in new tab"
            onClick={() => {
              if (target) window.open(target.url, "_blank", "noreferrer");
            }}
            className="text-ink-400 hover:bg-ink-800 hover:text-ink-100 shrink-0 rounded-md p-1.5 transition-colors"
          >
            <OpenNewWindow className="size-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="Close preview"
            onClick={onClose}
            className="text-ink-400 hover:bg-ink-800 hover:text-ink-100 shrink-0 rounded-md p-1.5 transition-colors"
          >
            <Xmark className="size-3.5" strokeWidth={2} />
          </button>
        </div>
        {target ? (
          <iframe
            key={`${target.url}-${reloadKey}`}
            src={target.url}
            title={`Sandbox preview: ${target.runtimeId}`}
            className="min-h-0 flex-1 bg-white"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SandboxOutput({
  error,
  lines,
}: {
  error: string | null;
  lines: string[];
}) {
  return (
    <div className="bg-ink-950 text-ink-300 h-36 overflow-y-auto px-4 py-3 font-mono text-[12px] leading-5">
      {error ? (
        <div role="alert" className="text-delr mb-2">
          {error}
        </div>
      ) : null}
      {lines.length === 0 ? (
        <div className="text-ink-600">No recent compute output.</div>
      ) : (
        lines.map((line, index) => <div key={index}>{line}</div>)
      )}
    </div>
  );
}

function SandboxActions({
  sandbox,
  runtimeId,
  previewUrl,
  previewState,
  lifecycleAction,
  onRunAction,
  onSelect,
  onPreview,
  onStop,
  onDelete,
}: {
  sandbox: SandboxRecord;
  runtimeId: string;
  previewUrl: string | null;
  previewState: "ready" | "starting" | "error" | "unavailable";
  lifecycleAction: LifecycleAction | null;
  onRunAction: (action: LifecycleAction) => Promise<void>;
  onSelect?: (id: string) => void;
  onPreview: (target: SandboxPreviewTarget) => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  const status = sandbox.runtime_summary.status;
  const busy = lifecycleAction !== null;
  // `delr` is the project error color declared in app/globals.css.
  const previewDot =
    previewState === "ready"
      ? "bg-emerald-400"
      : previewState === "starting"
        ? "bg-sky-400"
        : previewState === "error"
          ? "bg-delr"
          : "bg-ink-600";
  return (
    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        disabled={!previewUrl}
        title={previewUrl || "No preview URL for this sandbox"}
        onClick={() => {
          if (!previewUrl) return;
          onSelect?.(sandbox.id);
          onPreview({
            url: previewUrl,
            runtimeId,
            branch: sandbox.working_branch,
          });
        }}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-medium transition-colors ${
          previewUrl
            ? "border-ink-700 bg-ink-850 text-ink-200 hover:bg-ink-800"
            : "border-ink-800 bg-ink-900 text-ink-600 cursor-not-allowed"
        }`}
      >
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${previewDot}`}
        />
        Preview
      </button>
      {status === "paused" ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onRunAction("resume")}
          className="border-ink-700 bg-ink-850 text-ink-200 hover:bg-ink-800 rounded-md border px-2.5 py-1 font-medium transition-colors disabled:opacity-50"
        >
          {lifecycleAction === "resume" ? "Resuming…" : "Resume"}
        </button>
      ) : null}
      {status === "stopped" ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onRunAction("restart")}
          className="border-ink-700 bg-ink-850 text-ink-200 hover:bg-ink-800 rounded-md border px-2.5 py-1 font-medium transition-colors disabled:opacity-50"
        >
          {lifecycleAction === "restart" ? "Restarting…" : "Restart"}
        </button>
      ) : null}
      {status === "running" || status === "paused" ? (
        <button
          type="button"
          disabled={busy}
          onClick={onStop}
          className="border-ink-700 bg-ink-850 text-ink-300 hover:bg-ink-800 rounded-md border px-2.5 py-1 font-medium transition-colors disabled:opacity-50"
        >
          Stop compute
        </button>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={onDelete}
        className="border-delr/30 text-delr hover:bg-delr/10 flex items-center gap-1 rounded-md border px-2.5 py-1 font-medium transition-colors disabled:opacity-50"
      >
        <Trash className="size-3" aria-hidden="true" /> Delete sandbox
      </button>
    </div>
  );
}

export function SandboxCard({
  sandbox,
  selected,
  focused,
  registerRef,
  launchLogs,
  onSelect,
  onPreview,
}: {
  sandbox: SandboxRecord;
  selected: boolean;
  focused: boolean;
  registerRef: (id: string, el: HTMLElement | null) => void;
  launchLogs: Record<string, string>;
  onSelect?: (id: string) => void;
  onPreview: (target: SandboxPreviewTarget) => void;
}) {
  const stop = useSandboxStore((state) => state.stop);
  const resume = useSandboxStore((state) => state.resume);
  const restart = useSandboxStore((state) => state.restart);
  const deleteRecord = useSandboxStore((state) => state.deleteRecord);
  const [lifecycleAction, setLifecycleAction] =
    useState<LifecycleAction | null>(null);
  const [stopOpen, setStopOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const descriptionId = useId();
  const status = sandbox.runtime_summary.status;
  const badge = BADGE[status] ?? BADGE.stopped;
  const preview = getSandboxPreviewPresentation({
    status,
    healthStatus: sandbox.runtime_summary.health_status,
    previewUrl: sandbox.runtime_summary.preview_url,
  });
  const previewUrl = preview.canOpen
    ? sandbox.runtime_summary.preview_url
    : null;
  const runtimeId = sandbox.runtime_summary.sandbox_id || sandbox.id;
  const lines = sandboxLogLines(sandbox, launchLogs);
  const displayError = sandbox.error_summary.display_error || actionError;
  const runAction = async (action: LifecycleAction) => {
    setLifecycleAction(action);
    setActionError(null);
    try {
      if (action === "stop") {
        await stop(sandbox.id);
        if (selected) onSelect?.(sandbox.id);
      } else if (action === "resume") {
        await resume(sandbox.id);
      } else if (action === "restart") {
        await restart(sandbox.repo_id, { sandboxId: sandbox.id });
      } else {
        await deleteRecord(sandbox.id);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Action failed");
    } finally {
      setLifecycleAction(null);
    }
  };
  return (
    <section
      ref={(element) => registerRef(sandbox.id, element)}
      role="region"
      aria-label={`Sandbox ${runtimeId}`}
      aria-describedby={descriptionId}
      className={`bg-ink-900 flex min-w-0 flex-col overflow-hidden rounded-xl border transition-colors ${
        selected
          ? "border-brand-accent/70 ring-brand-accent/60 ring-1"
          : focused
            ? "border-ink-600 ring-ink-500 ring-1"
            : "border-ink-800"
      }`}
    >
      <p id={descriptionId} className="sr-only">
        {badge.label} compute. Repository branch {sandbox.working_branch}.
        {selected ? " Selected for chat and preview." : ""}
      </p>
      <div className="border-ink-800 flex min-w-0 items-start gap-3 border-b px-4 py-3">
        <span className="border-ink-700 bg-ink-850 text-ink-300 flex size-8 shrink-0 items-center justify-center rounded-lg border">
          <Server className="size-4" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-ink-500 text-[11px] font-semibold tracking-wider uppercase">
              Sandbox
            </span>
            <span className="text-ink-100 min-w-0 truncate font-mono text-[12.5px]">
              {runtimeId}
            </span>
            <span
              aria-label={`Runtime status: ${badge.label}`}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${badge.className}`}
            >
              <span className="size-1.5 rounded-full" aria-hidden="true" />
              {badge.label}
            </span>
            {selected ? (
              <span className="border-brand-accent/30 bg-brand-accent/10 text-brand-accent rounded-full border px-2 py-0.5 text-[10.5px]">
                Selected context
              </span>
            ) : null}
          </div>
          <p className="text-ink-500 mt-1 text-[11.5px]">
            Remote compute for commands and previews
          </p>
        </div>
      </div>
      <dl className="border-ink-800 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 border-b px-4 py-3 text-[11.5px]">
        <dt className="text-ink-500">Preview</dt>
        <dd
          className={
            preview.state === "ready"
              ? "text-emerald-300"
              : preview.state === "starting"
                ? "text-sky-300"
                : preview.state === "error"
                  ? "text-delr"
                  : "text-ink-400"
          }
        >
          {preview.label}
        </dd>
        <dt className="text-ink-500">Sandbox record</dt>
        <dd className="text-ink-300 truncate font-mono" title={sandbox.id}>
          {sandbox.id}
        </dd>
        <dt className="text-ink-500">Repository context</dt>
        <dd className="text-ink-300 min-w-0 truncate font-mono">
          {sandbox.working_branch} from {sandbox.base_branch}
        </dd>
      </dl>
      <SandboxOutput error={displayError} lines={lines} />
      <div className="border-ink-800 flex flex-wrap items-center gap-3 border-t px-4 py-2.5 text-[12px]">
        <Elapsed sandbox={sandbox} />
        <SandboxActions
          sandbox={sandbox}
          runtimeId={runtimeId}
          previewUrl={previewUrl}
          previewState={preview.state}
          lifecycleAction={lifecycleAction}
          onRunAction={runAction}
          onSelect={onSelect}
          onPreview={onPreview}
          onStop={() => setStopOpen(true)}
          onDelete={() => setDeleteOpen(true)}
        />
      </div>
      <AlertDialog open={stopOpen} onOpenChange={setStopOpen}>
        <AlertDialogContent className="border-ink-700 bg-ink-900">
          <AlertDialogHeader>
            <AlertDialogTitle>Stop sandbox compute?</AlertDialogTitle>
            <AlertDialogDescription>
              Compute, snapshots, sessions, and preview are removed. The sandbox
              record and worktree records stay for restart, but checkout data
              becomes unavailable. Mogplex does not delete remote Git branches.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runAction("stop")}>
              Stop compute
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="border-ink-700 bg-ink-900">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete sandbox record?</AlertDialogTitle>
            <AlertDialogDescription>
              Compute, snapshots, sessions, and the sandbox record are removed.
              Worktree records stay, but their checkouts become unavailable.
              Mogplex does not delete remote Git branches.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-delr text-ink-50 hover:bg-delr/90"
              onClick={() => void runAction("delete")}
            >
              Delete sandbox
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
