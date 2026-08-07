"use client";

import { derivePreviewOverlayStopReasonText } from "@/lib/sandbox/preview-overlay-status";
import type { StatusOverlayProps } from "./status-overlay-types";

export function StoppedOverlay({
  status,
  details,
  workingBranch,
  onLaunch,
  onStartFresh,
}: StatusOverlayProps) {
  const stopReasonText = derivePreviewOverlayStopReasonText(status, details);

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

export function PausedOverlay({
  onResume,
  onOpenHealth,
}: StatusOverlayProps) {
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

export function NotAvailableOverlay({ onLaunch }: StatusOverlayProps) {
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
