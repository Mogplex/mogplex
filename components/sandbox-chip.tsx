import type { SandboxUiState } from "@/lib/sandbox/ui-state";

export type SandboxChipTimeInfo = {
  remainingMin: number;
  remainingMs: number;
};

const LIVE_CRITICAL_MS = 30_000;
const LIVE_WARNING_MS = 120_000;

type SandboxChipTone = "neutral" | "green" | "amber" | "red" | "muted";

const TONE_CLASSES: Record<SandboxChipTone, { shell: string; dot: string }> = {
  neutral: {
    shell: "border-border-dim bg-background text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  green: {
    shell: "border-accent-green/20 bg-accent-green/[0.06] text-accent-green",
    dot: "bg-accent-green",
  },
  amber: {
    shell: "border-amber-400/20 bg-amber-400/[0.06] text-amber-400",
    dot: "bg-amber-400",
  },
  red: {
    shell: "border-red-500/20 bg-red-500/[0.06] text-red-500",
    dot: "bg-red-500",
  },
  muted: {
    shell: "border-border-dim bg-muted/20 text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

const BOOTING_LABELS = {
  creating: "starting · provisioning",
  installing: "starting · installing",
} as const;

type SandboxChipPresentation = {
  label: string;
  tone: SandboxChipTone;
  pulse?: boolean;
};

const DEGRADED_PRESENTATION = {
  app_error: { label: "app error", tone: "red" },
  unreachable: { label: "unreachable", tone: "amber" },
} as const satisfies Record<
  "app_error" | "unreachable",
  { label: string; tone: SandboxChipTone }
>;

function resolveLiveSandboxChipPresentation(
  timeInfo?: SandboxChipTimeInfo | null
): SandboxChipPresentation {
  if (!timeInfo) return { label: "live", tone: "green" };
  const label = `live · ${formatMinutesLeft(timeInfo)}`;
  if (timeInfo.remainingMs < LIVE_CRITICAL_MS) {
    return { label, tone: "red" };
  }
  if (timeInfo.remainingMs < LIVE_WARNING_MS) {
    return { label, tone: "amber", pulse: true };
  }
  return { label, tone: "green" };
}

function formatMinutesLeft(timeInfo?: SandboxChipTimeInfo | null) {
  return `${timeInfo?.remainingMin ?? 0}m left`;
}

function resolveDegradedSandboxChipPresentation(
  state: Extract<SandboxUiState, { kind: "degraded" }>,
  timeInfo?: SandboxChipTimeInfo | null
) {
  if (state.reason === "idle_warning") {
    return {
      label: timeInfo ? `idle · ${formatMinutesLeft(timeInfo)}` : "idle",
      tone: "amber" as const,
      pulse: true,
    };
  }

  return DEGRADED_PRESENTATION[state.reason];
}

function resolveSandboxChipPresentation(
  state: SandboxUiState,
  timeInfo?: SandboxChipTimeInfo | null
): SandboxChipPresentation | null {
  switch (state.kind) {
    case "booting":
      if (state.runtimeStatus === "pausing") {
        return { label: "pausing", tone: "neutral" };
      }
      return { label: BOOTING_LABELS[state.phase], tone: "neutral" };
    case "starting":
      return { label: "starting dev server", tone: "neutral" };
    case "live":
      return resolveLiveSandboxChipPresentation(timeInfo);
    case "degraded":
      return resolveDegradedSandboxChipPresentation(state, timeInfo);
    case "paused":
      return { label: "paused · resume", tone: "neutral" };
    case "stopped":
      return { label: "stopped", tone: "muted" };
    case "errored":
      return { label: "error", tone: "red" };
    case "no_sandbox":
    case "no_session":
      return null;
    default: {
      const _exhaustive: never = state;
      void _exhaustive;
      return null;
    }
  }
}

export function SandboxChip({
  state,
  timeInfo,
}: {
  state: SandboxUiState;
  timeInfo?: SandboxChipTimeInfo | null;
}) {
  const presentation = resolveSandboxChipPresentation(state, timeInfo);
  if (!presentation) return null;

  const tone = TONE_CLASSES[presentation.tone];
  const dotClassName = `h-1.5 w-1.5 rounded-full ${tone.dot}${
    presentation.pulse ? " animate-pulse" : ""
  }`;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] ${tone.shell}`}
    >
      <span className={dotClassName} />
      {presentation.label}
    </span>
  );
}
