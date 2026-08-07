"use client";

import type { SandboxRecord } from "@/lib/types";
import {
  getSandboxUiRuntimeStatus,
  isSandboxUiBooting,
  isSandboxUiIdleWarning,
  isSandboxUiRuntimeRunning,
  resolveSandboxUiState,
} from "@/lib/sandbox/ui-state";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RepoPill } from "./repo-pill";
import { getSandboxCreationLabel, getSandboxErrorMessage } from "./helpers";

function renderSandboxErrorPill(label: string, message: string) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <RepoPill dotClassName="bg-red-300">{label}</RepoPill>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72 text-xs">
        {message}
      </TooltipContent>
    </Tooltip>
  );
}

export function SandboxStatusBadge({
  sandbox,
  isCreating,
}: {
  sandbox?: SandboxRecord | null;
  isCreating: boolean;
}) {
  const sandboxUiState = resolveSandboxUiState({
    session: null,
    record: sandbox ?? null,
  });

  if (isCreating || isSandboxUiBooting(sandboxUiState)) {
    return (
      <RepoPill dotClassName="bg-amber-300">
        {getSandboxCreationLabel(getSandboxUiRuntimeStatus(sandboxUiState))}
      </RepoPill>
    );
  }
  if (isSandboxUiIdleWarning(sandboxUiState)) {
    return <RepoPill dotClassName="bg-emerald-300">Ready</RepoPill>;
  }
  if (
    sandboxUiState.kind === "degraded" &&
    sandboxUiState.reason === "app_error"
  ) {
    return renderSandboxErrorPill(
      "App error",
      getSandboxErrorMessage(
        sandbox?.error_summary.display_error ?? null,
        "The dev server returned an error"
      )
    );
  }
  if (
    sandboxUiState.kind === "degraded" &&
    sandboxUiState.reason === "unreachable"
  ) {
    return <RepoPill dotClassName="bg-amber-300">Unreachable</RepoPill>;
  }
  if (isSandboxUiRuntimeRunning(sandboxUiState))
    return <RepoPill dotClassName="bg-emerald-300">Ready</RepoPill>;
  if (sandboxUiState.kind === "errored") {
    return renderSandboxErrorPill(
      "Error",
      getSandboxErrorMessage(sandboxUiState.message, "Sandbox failed to start")
    );
  }
  return null;
}
