"use client";
import {
  presentSandboxError,
  type SandboxError,
} from "@/lib/sandbox/error-state";
import { AsciiLoader } from "@/components/ascii-loader";

const CREATING_MESSAGES: Record<string, string> = {
  preview: "Starting live preview...",
  files: "Preparing project files...",
  terminal: "Connecting terminal...",
  editor: "Loading code editor...",
};

export function SandboxPendingOverlay({
  creating,
  error,
  paneType,
}: {
  creating?: boolean;
  error?: SandboxError | null;
  paneType: string;
}) {
  if (error) {
    const errorState = presentSandboxError(error);
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <svg
          className="text-accent-red h-5 w-5"
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
            {errorState?.title || "Sandbox launch failed"}
          </div>
          <div className="text-muted-foreground max-w-md text-[11px] break-words whitespace-pre-wrap">
            {errorState?.message || error.message}
          </div>
        </div>
        {errorState?.cta && (
          <a
            href={errorState.cta.href}
            className="border-border text-foreground hover:bg-secondary rounded border px-3 py-1.5 text-[11px]"
          >
            {errorState.cta.label}
          </a>
        )}
      </div>
    );
  }

  if (creating) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <AsciiLoader />
        <span className="text-muted-foreground text-sm">
          {CREATING_MESSAGES[paneType] || "Starting sandbox..."}
        </span>
      </div>
    );
  }

  return null;
}
