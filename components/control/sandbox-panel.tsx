"use client";

import { useMemo, useState } from "react";
import { BoxIso, OpenNewWindow } from "iconoir-react";
import { useSandboxStore } from "@/hooks/use-sandbox";
import type { SandboxLifecycleStatus } from "@/lib/types";

const STATUS_STYLES: Record<string, string> = {
  running: "text-accent-green",
  creating: "text-accent-blue",
  installing: "text-accent-blue",
  stopped: "text-muted-foreground",
  error: "text-accent-red",
};

const STOPPABLE: ReadonlySet<string> = new Set<SandboxLifecycleStatus>([
  "running",
  "creating",
  "installing",
]);

function formatAge(iso: string | null): string {
  if (!iso) return "";
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function SandboxPanel() {
  const sandboxesById = useSandboxStore((state) => state.sandboxesById);
  const stop = useSandboxStore((state) => state.stop);
  const [stoppingId, setStoppingId] = useState<string | null>(null);

  const sandboxes = useMemo(
    () =>
      Object.values(sandboxesById).sort((a, b) =>
        (b.last_active_at ?? "").localeCompare(a.last_active_at ?? "")
      ),
    [sandboxesById]
  );

  if (sandboxes.length === 0) {
    return (
      <div className="border-border bg-input text-muted-foreground rounded-lg border border-dashed px-3 py-8 text-center text-xs">
        <BoxIso
          className="mx-auto mb-3 size-10 opacity-30"
          strokeWidth={1.5}
          aria-hidden="true"
        />
        No sandboxes yet. One appears here as soon as the agent starts it.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sandboxes.map((sandbox) => {
        const status = sandbox.runtime_summary.status;
        const previewUrl = sandbox.runtime_summary.preview_url;
        const canStop = STOPPABLE.has(status);
        return (
          <div
            key={sandbox.id}
            className="border-border bg-card rounded-lg border p-3"
          >
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-semibold ${STATUS_STYLES[status] ?? "text-muted-foreground"}`}
              >
                {status}
              </span>
              <span className="text-muted-foreground truncate font-mono text-[11px]">
                {sandbox.sandbox_id}
              </span>
              {canStop ? (
                <button
                  type="button"
                  disabled={stoppingId === sandbox.id}
                  onClick={async () => {
                    setStoppingId(sandbox.id);
                    try {
                      await stop(sandbox.id);
                    } finally {
                      setStoppingId(null);
                    }
                  }}
                  className="border-accent-red/40 text-accent-red hover:bg-accent-red/10 ml-auto rounded border px-2 py-0.5 text-[11px] disabled:opacity-50"
                >
                  {stoppingId === sandbox.id ? "Stopping…" : "Stop"}
                </button>
              ) : null}
            </div>
            <div className="text-muted-foreground mt-1 flex items-center gap-2 text-[11px]">
              <span className="truncate">{sandbox.working_branch}</span>
              {sandbox.last_active_at ? (
                <span className="ml-auto shrink-0">
                  {formatAge(sandbox.last_active_at)}
                </span>
              ) : null}
            </div>
            {previewUrl ? (
              <a
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent-blue mt-1.5 flex items-center gap-1 truncate text-[11px] hover:underline"
              >
                <OpenNewWindow className="size-3 shrink-0" strokeWidth={1.8} />
                {previewUrl}
              </a>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
