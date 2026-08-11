"use client";

import type { TriggerWithAgent } from "./triggers-pane-types";
import { EVENT_BADGES } from "./triggers-pane-types";

interface TriggerRowProps {
  trigger: TriggerWithAgent;
  onToggle: () => void;
  onDelete: () => void;
  isToggling: boolean;
  isDeleting: boolean;
}

export function TriggerRow({
  trigger,
  onToggle,
  onDelete,
  isToggling,
  isDeleting,
}: TriggerRowProps) {
  const badge = EVENT_BADGES[trigger.event];

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border-dim">
      <button
        onClick={onToggle}
        disabled={isToggling}
        className={`w-8 h-4 rounded-full relative transition-colors shrink-0 ${
          trigger.enabled ? "bg-accent-green" : "bg-muted"
        }`}
      >
        <span
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-primary-foreground transition-transform ${
            trigger.enabled ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>
      <span
        className={`font-mono text-[11px] px-2 py-0.5 rounded border shrink-0 ${badge.color}`}
      >
        {badge.label}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-foreground">
          {trigger.agents?.name || "Unknown agent"}
          {trigger.agents?.slug && (
            <span className="text-muted-foreground ml-1">
              /{trigger.agents.slug}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            Last run: {trigger.last_run_status || "never"}
            {trigger.last_run_started_at
              ? ` · ${new Date(trigger.last_run_started_at).toLocaleString()}`
              : ""}
          </span>
          {typeof trigger.failed_24h === "number" && trigger.failed_24h > 0 && (
            <span className="rounded border border-accent-red/20 bg-accent-red/5 px-1.5 py-px text-accent-red">
              {trigger.failed_24h} failed / 24h
            </span>
          )}
          {typeof trigger.running_count === "number" &&
            trigger.running_count > 0 && (
              <span className="rounded border border-accent-blue/20 bg-accent-blue/5 px-1.5 py-px text-accent-blue">
                {trigger.running_count} running
              </span>
            )}
          {typeof trigger.pending_count === "number" &&
            trigger.pending_count > 0 && (
              <span className="rounded border border-accent-amber/20 bg-accent-amber/5 px-1.5 py-px text-accent-amber">
                {trigger.pending_count} pending
              </span>
            )}
          {typeof trigger.suppressed_24h === "number" &&
            trigger.suppressed_24h > 0 && (
              <span className="rounded border border-accent-red/20 bg-accent-red/5 px-1.5 py-px text-accent-red">
                {trigger.suppressed_24h} suppressed / 24h
              </span>
            )}
          {typeof trigger.deferred_24h === "number" &&
            trigger.deferred_24h > 0 && (
              <span className="rounded border border-accent-amber/20 bg-accent-amber/5 px-1.5 py-px text-accent-amber">
                {trigger.deferred_24h} deferred / 24h
              </span>
            )}
          {trigger.last_pressure_reason && (
            <span
              className="truncate text-accent-amber"
              title={trigger.last_pressure_reason}
            >
              Pressure: {trigger.last_pressure_reason}
            </span>
          )}
        </div>
      </div>
      {trigger.is_default && (
        <span className="text-[10px] px-1.5 py-px rounded bg-purple-400/10 text-purple-400 border border-purple-400/20 shrink-0">
          default
        </span>
      )}
      <button
        onClick={onDelete}
        disabled={isDeleting}
        className="text-muted-foreground hover:text-accent-red disabled:opacity-50 text-sm shrink-0"
        title="Delete"
      >
        &#215;
      </button>
    </div>
  );
}
