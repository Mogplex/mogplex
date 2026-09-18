"use client";

import { cn } from "@/lib/utils";
import type { MemoryCounts, MemoryLane } from "./context-section-types";
import { LANES, LANE_INFO } from "./context-section-types";

interface ActionButtonsProps {
  busyId: string | null;
  onPrune: () => void;
  onCheckpoint: () => void;
  compact?: boolean;
}

const PRUNE_TITLE =
  "Delete session notes older than 30 days and machine-generated rows (harness prompt dumps, automation run outcomes). Hand-written and agent-written memories are kept.";
const CHECKPOINT_TITLE =
  "Add a timestamped marker to the current lane so later notes can be read relative to it.";

export function ActionButtons({
  busyId,
  onPrune,
  onCheckpoint,
  compact,
}: ActionButtonsProps) {
  const buttonClass = compact
    ? "border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded border px-2 py-1 text-[11px] disabled:opacity-50"
    : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded border px-3 py-1.5 text-sm disabled:opacity-50";

  return (
    <div className={cn("flex items-center", compact ? "gap-1" : "gap-2")}>
      <button
        type="button"
        title={PRUNE_TITLE}
        disabled={busyId === "prune"}
        onClick={onPrune}
        className={buttonClass}
      >
        {busyId === "prune" ? "Pruning…" : "Prune"}
      </button>
      <button
        type="button"
        title={CHECKPOINT_TITLE}
        disabled={busyId === "checkpoint"}
        onClick={onCheckpoint}
        className={buttonClass}
      >
        Checkpoint
      </button>
    </div>
  );
}

interface LaneTabsProps {
  lane: MemoryLane;
  onLaneChange: (lane: MemoryLane) => void;
  counts: MemoryCounts;
  compact?: boolean;
}

export function LaneTabs({ lane, onLaneChange, counts, compact }: LaneTabsProps) {
  if (compact) {
    return (
      <div className="border-border flex border-b">
        {LANES.map((currentLane) => (
          <button
            key={currentLane}
            type="button"
            title={LANE_INFO[currentLane].desc}
            onClick={() => onLaneChange(currentLane)}
            className={cn(
              "text-muted-foreground hover:bg-secondary flex-1 px-2 py-2 text-[11px]",
              lane === currentLane &&
                "border-foreground bg-muted text-foreground border-b-2"
            )}
          >
            {LANE_INFO[currentLane].label} ({counts[currentLane] ?? 0})
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {LANES.map((currentLane) => (
        <button
          key={currentLane}
          type="button"
          title={LANE_INFO[currentLane].desc}
          onClick={() => onLaneChange(currentLane)}
          className={cn(
            "border-border text-muted-foreground hover:text-foreground rounded border px-3 py-1.5 text-sm",
            lane === currentLane && "border-primary text-primary"
          )}
        >
          {LANE_INFO[currentLane].label} ({counts[currentLane] ?? 0})
        </button>
      ))}
    </div>
  );
}
