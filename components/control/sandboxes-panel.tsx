"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  GitMerge,
  OpenNewWindow,
  Plus,
  Refresh,
  Xmark,
} from "iconoir-react";
import type { SandboxRecord } from "@/lib/types";
import { buildSandboxStateKey, useSandboxStore } from "@/hooks/use-sandbox";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

type PreviewTarget = { url: string; branch: string };

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

/** Ticks once a second while the sandbox is active; static once stopped. */
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
      {active ? formatElapsed(seconds) : `done in ${formatElapsed(seconds)}`}
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
  const raw =
    launchLogs[key] || sandbox.dev_log || sandbox.install_log || "";
  return raw
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-8);
}

function PreviewModal({
  target,
  onClose,
}: {
  target: PreviewTarget | null;
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
        className="flex h-[95dvh] w-[95dvw] max-w-[95dvw] flex-col gap-0 overflow-hidden rounded-xl border-ink-700 bg-ink-900 p-0 shadow-2xl sm:max-w-[95dvw]"
        aria-label="Sandbox preview"
      >
        <div className="flex items-center gap-2 border-b border-ink-800 bg-ink-850 px-3 py-2">
          <DialogTitle className="sr-only">Sandbox preview</DialogTitle>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-ink-700/60 bg-ink-950 px-3 py-1.5 font-mono text-[12.5px] text-ink-300">
            <span className="min-w-0 truncate">{target?.url ?? ""}</span>
          </div>
          <span className="hidden shrink-0 rounded-md border border-ink-700 bg-ink-800 px-2 py-1 font-mono text-[11.5px] text-ink-300 sm:inline">
            {target?.branch ?? ""}
          </span>
          <button
            type="button"
            aria-label="Reload preview"
            onClick={() => setReloadKey((key) => key + 1)}
            className="shrink-0 rounded-md p-1.5 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100"
          >
            <Refresh className="size-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="Open in new tab"
            onClick={() => {
              if (target) window.open(target.url, "_blank", "noreferrer");
            }}
            className="shrink-0 rounded-md p-1.5 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100"
          >
            <OpenNewWindow className="size-3.5" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="Close preview"
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100"
          >
            <Xmark className="size-3.5" strokeWidth={2} />
          </button>
        </div>
        {target ? (
          <iframe
            key={`${target.url}-${reloadKey}`}
            src={target.url}
            title={`Sandbox preview: ${target.branch}`}
            className="min-h-0 flex-1 bg-white"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SandboxCard({
  sandbox,
  focused,
  registerRef,
  launchLogs,
  canMerge,
  onMerge,
  onPreview,
}: {
  sandbox: SandboxRecord;
  focused: boolean;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
  launchLogs: Record<string, string>;
  canMerge: boolean;
  onMerge: (sandbox: SandboxRecord) => void;
  onPreview: (target: PreviewTarget) => void;
}) {
  const stop = useSandboxStore((state) => state.stop);
  const [stopping, setStopping] = useState(false);
  const status = sandbox.runtime_summary.status;
  const badge = BADGE[status] ?? BADGE.stopped;
  const previewUrl = sandbox.runtime_summary.preview_url;
  const lines = sandboxLogLines(sandbox, launchLogs);
  const running = status === "running";

  return (
    <div
      ref={(el) => registerRef(sandbox.id, el)}
      className={`flex flex-col overflow-hidden rounded-xl border bg-ink-900 transition ${
        focused ? "border-ink-800 ring-1 ring-brand-accent/70" : "border-ink-800"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-ink-800 px-4 py-2.5">
        <GitMerge
          className="size-3.5 shrink-0 text-ink-400"
          strokeWidth={1.8}
        />
        <span className="min-w-0 truncate font-mono text-[12.5px] text-ink-100">
          {sandbox.working_branch}
        </span>
        <span
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${badge.className}`}
        >
          <span className="size-1.5 rounded-full" />
          {badge.label}
        </span>
      </div>
      <div className="h-40 overflow-y-auto bg-ink-950 px-4 py-3 font-mono text-[12px] leading-5 text-ink-300">
        {lines.length === 0 ? (
          <div className="text-ink-600">
            No recent output for this sandbox.
          </div>
        ) : (
          lines.map((line, index) => <div key={index}>{line}</div>)
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-ink-800 px-4 py-2.5 text-[12px]">
        <Elapsed sandbox={sandbox} />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            disabled={!previewUrl}
            title={previewUrl ? previewUrl : "No preview URL for this sandbox"}
            onClick={() => {
              if (previewUrl) {
                onPreview({ url: previewUrl, branch: sandbox.working_branch });
              }
            }}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-medium transition-colors ${
              previewUrl
                ? "border-ink-700 bg-ink-850 text-ink-200 hover:bg-ink-800"
                : "cursor-not-allowed border-ink-800 bg-ink-900 text-ink-600"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                previewUrl ? "bg-emerald-400" : "bg-ink-600"
              }`}
            />
            Preview
          </button>
          {running ? (
            <button
              type="button"
              disabled={stopping}
              onClick={async () => {
                setStopping(true);
                try {
                  await stop(sandbox.id);
                } finally {
                  setStopping(false);
                }
              }}
              className="rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1 font-medium text-ink-300 transition-colors hover:bg-ink-800 disabled:opacity-50"
            >
              {stopping ? "Stopping…" : "Stop"}
            </button>
          ) : null}
          {running && canMerge ? (
            <button
              type="button"
              onClick={() => onMerge(sandbox)}
              className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 font-semibold text-primary-foreground transition-colors hover:bg-brand-accent-hover"
            >
              <Check className="size-3" strokeWidth={2.5} />
              Merge to main
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Sandboxes panel: one card per remote compute environment from the live
 * sandbox store, with
 * real launch/dev logs, status badges, elapsed timers, preview modal, stop,
 * and agent-driven merge. Git worktrees are a separate orchestration resource.
 */
export function SandboxesPanel({
  sandboxes,
  hasRepository,
  focusSandboxId,
  onClearFocus,
  canMerge,
  onMerge,
  onStartSandbox,
}: {
  sandboxes: SandboxRecord[];
  hasRepository: boolean;
  focusSandboxId: string | null;
  onClearFocus: () => void;
  canMerge: boolean;
  onMerge: (sandbox: SandboxRecord) => void;
  onStartSandbox: () => void;
}) {
  const launchLogs = useSandboxStore((state) => state.logs);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  const registerRef = (id: string, el: HTMLDivElement | null) => {
    if (el) {
      cardRefs.current.set(id, el);
    } else {
      cardRefs.current.delete(id);
    }
  };

  // Tab-click focus: scroll the card into view and ring it briefly.
  const [ringId, setRingId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusSandboxId) return;
    const card = cardRefs.current.get(focusSandboxId);
    if (!card) return;
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const frame = window.requestAnimationFrame(() => setRingId(focusSandboxId));
    const timeout = window.setTimeout(() => {
      setRingId(null);
      onClearFocus();
    }, 1600);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [focusSandboxId, onClearFocus]);

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-2 pb-4">
        <h2 className="text-[12px] font-semibold tracking-wider text-ink-300 uppercase">
          Sandboxes
        </h2>
        <span className="text-[12.5px] text-ink-400">
          {sandboxes.length === 0
            ? "No sandboxes yet"
            : `${sandboxes.length} sandbox${sandboxes.length === 1 ? "" : "es"}`}
        </span>
        <button
          type="button"
          onClick={onStartSandbox}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 text-[12.5px] font-medium text-ink-200 transition-colors hover:bg-ink-800"
        >
          <Plus className="size-3.5" strokeWidth={2} />
          Start sandbox
        </button>
      </div>
      {!hasRepository ? (
        <div className="mb-4 rounded-lg border border-ink-700 bg-ink-900/60 px-4 py-3 text-[12.5px] text-ink-300">
          No repository is linked to this session. Start a new mission and
          select a connected repository to create a sandbox.
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {sandboxes.map((sandbox) => (
          <SandboxCard
            key={sandbox.id}
            sandbox={sandbox}
            focused={ringId === sandbox.id}
            registerRef={registerRef}
            launchLogs={launchLogs}
            canMerge={canMerge}
            onMerge={onMerge}
            onPreview={setPreview}
          />
        ))}
        <button
          type="button"
          onClick={onStartSandbox}
          className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink-700 bg-ink-900/40 text-ink-400 transition-colors hover:border-ink-600 hover:bg-ink-900 hover:text-ink-200"
        >
          <span className="flex size-9 items-center justify-center rounded-lg border border-ink-700 bg-ink-850">
            <Plus className="size-4" strokeWidth={2} />
          </span>
          <span className="text-[13px] font-medium">Start sandbox</span>
          <span className="text-[12px]">
            Creates remote compute for the selected repository
          </span>
        </button>
      </div>
      <PreviewModal target={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
