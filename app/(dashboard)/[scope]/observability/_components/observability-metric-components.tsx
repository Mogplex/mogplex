import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  STAT_TONE_VALUE_CLASSES,
  type StatTone,
} from "@/lib/observability/stat-card-tone";
import type { AutomationHealthStatus } from "@/lib/observability/automation-health";

export type HealthState = {
  label: string;
  className: string;
};

export const HEALTH_STATES: Record<AutomationHealthStatus, HealthState> = {
  healthy: {
    label: "Healthy",
    className:
      "border-[var(--accent-green)]/20 bg-[var(--accent-green)]/5 text-[var(--accent-green)]",
  },
  needs_attention: {
    label: "Needs attention",
    className:
      "border-[var(--accent-red)]/20 bg-[var(--accent-red)]/5 text-[var(--accent-red)]",
  },
  no_activity: {
    label: "No activity yet",
    className: "border-border bg-secondary/40 text-muted-foreground",
  },
};

export function MetricLabel({ label, info }: { label: string; info: string }) {
  return (
    <Tooltip>
      <TooltipTrigger className="text-muted-foreground decoration-muted-foreground/50 cursor-help text-left text-xs underline decoration-dotted underline-offset-2">
        {label}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[300px] text-[11px]">
        {info}
      </TooltipContent>
    </Tooltip>
  );
}

export function MetricCell({
  label,
  value,
  detail,
  info,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  info: string;
  tone?: StatTone;
}) {
  return (
    <div className="bg-background min-w-0 p-3">
      <MetricLabel label={label} info={info} />
      <div
        className={`mt-1 text-lg font-medium ${
          tone ? STAT_TONE_VALUE_CLASSES[tone] : "text-foreground"
        }`}
      >
        {value}
      </div>
      <div className="text-muted-foreground mt-0.5 truncate text-xs">
        {detail}
      </div>
    </div>
  );
}

export function SignalButton({
  label,
  value,
  detail,
  ariaLabel,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  ariaLabel: string;
  tone?: StatTone;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="group bg-background hover:bg-secondary/50 focus-visible:ring-ring min-w-0 p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
      onClick={onClick}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-foreground group-hover:text-foreground text-xs font-medium">
          {label}
        </span>
        <span
          className={`text-base font-medium ${
            tone ? STAT_TONE_VALUE_CLASSES[tone] : "text-foreground"
          }`}
        >
          {value}
        </span>
      </div>
      <div className="text-muted-foreground mt-1 text-xs">{detail}</div>
    </button>
  );
}
