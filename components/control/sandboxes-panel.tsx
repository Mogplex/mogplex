"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "iconoir-react";
import { useSandboxStore } from "@/hooks/use-sandbox";
import type { SandboxRecord } from "@/lib/types";
import { partitionControlSandboxes } from "@/lib/control/sandbox-presentation";
import {
  SandboxCard,
  SandboxPreviewModal,
  type SandboxPreviewTarget,
} from "./sandbox-card";

export function SandboxesPanel({
  sandboxes,
  loading,
  hasRepository,
  selectedSandboxId,
  focusSandboxId,
  onClearFocus,
  onSelectSandbox,
  onStartSandbox,
}: {
  sandboxes: SandboxRecord[];
  loading: boolean;
  hasRepository: boolean;
  selectedSandboxId: string | null;
  focusSandboxId: string | null;
  onClearFocus: () => void;
  onSelectSandbox: (id: string) => void;
  onStartSandbox: () => void;
}) {
  const launchLogs = useSandboxStore((state) => state.logs);
  const [preview, setPreview] = useState<SandboxPreviewTarget | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const [ringId, setRingId] = useState<string | null>(null);
  const { current, history } = partitionControlSandboxes(sandboxes);

  const registerRef = (id: string, element: HTMLElement | null) => {
    if (element) {
      cardRefs.current.set(id, element);
    } else {
      cardRefs.current.delete(id);
    }
  };

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
      <div className="border-ink-800 border-b pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-ink-300 text-[12px] font-semibold tracking-wider uppercase">
            Sandboxes
          </h2>
          <span
            aria-label={`${current.length} current ${current.length === 1 ? "sandbox" : "sandboxes"}, ${history.length} previous ${history.length === 1 ? "attempt" : "attempts"}`}
            className="text-ink-400 text-[12.5px]"
          >
            {loading
              ? "Loading compute"
              : `${current.length} current ${current.length === 1 ? "sandbox" : "sandboxes"} · ${history.length} previous ${history.length === 1 ? "attempt" : "attempts"}`}
          </span>
          <button
            type="button"
            onClick={onStartSandbox}
            className="border-ink-700 bg-ink-850 text-ink-200 hover:bg-ink-800 ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors"
          >
            <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
            Start sandbox
          </button>
        </div>
        <p className="text-ink-500 mt-1 max-w-2xl text-xs leading-5">
          Remote compute for commands and previews. A sandbox can host zero or
          more worktree checkouts.
        </p>
      </div>
      {!hasRepository ? (
        <div
          role="note"
          className="border-ink-700 bg-ink-900/60 text-ink-300 mt-4 rounded-lg border px-4 py-3 text-[12.5px]"
        >
          No repository is linked to this session. Start a new mission and
          select a connected repository before starting compute.
        </div>
      ) : null}
      {loading ? (
        <div
          role="status"
          aria-label="Loading sandbox compute"
          className="py-8"
        >
          <span className="sr-only">Loading sandbox compute</span>
          <div className="bg-ink-800 h-3 w-40 animate-pulse rounded" />
          <div className="bg-ink-900 mt-3 h-32 w-full animate-pulse rounded-xl" />
        </div>
      ) : current.length === 0 ? (
        <div className="text-ink-400 py-10 text-sm">
          <p className="text-ink-200 font-medium">No current sandbox</p>
          <p className="text-ink-500 mt-1 max-w-xl text-xs leading-5">
            Start a sandbox for commands and previews. Worktrees are created
            separately when a mission delegates coding tasks. Starting compute
            alone does not create a worktree.
          </p>
        </div>
      ) : null}
      {!loading ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {current.map((sandbox) => (
            <SandboxCard
              key={sandbox.id}
              sandbox={sandbox}
              selected={sandbox.id === selectedSandboxId}
              focused={ringId === sandbox.id}
              registerRef={registerRef}
              launchLogs={launchLogs}
              onSelect={onSelectSandbox}
              onPreview={setPreview}
            />
          ))}
          <button
            type="button"
            onClick={onStartSandbox}
            className="border-ink-700 bg-ink-900/40 text-ink-400 hover:border-ink-600 hover:bg-ink-900 hover:text-ink-200 flex min-h-48 min-w-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 text-center transition-colors"
          >
            <span className="border-ink-700 bg-ink-850 flex size-9 items-center justify-center rounded-lg border">
              <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="text-[13px] font-medium">Start sandbox</span>
            <span className="text-[12px]">
              Creates remote compute for the selected repository
            </span>
          </button>
        </div>
      ) : null}
      {!loading && history.length > 0 ? (
        <details className="border-ink-800 mt-6 border-t pt-4">
          <summary className="text-ink-300 hover:text-ink-100 cursor-pointer text-[12.5px] font-medium">
            Previous attempts ({history.length})
          </summary>
          <p className="text-ink-500 mt-1 text-xs leading-5">
            Stopped and failed attempts stay here for logs, restart, or removal.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {history.map((sandbox) => (
              <SandboxCard
                key={sandbox.id}
                sandbox={sandbox}
                selected={false}
                focused={ringId === sandbox.id}
                registerRef={registerRef}
                launchLogs={launchLogs}
                onPreview={setPreview}
              />
            ))}
          </div>
        </details>
      ) : null}
      <SandboxPreviewModal target={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
