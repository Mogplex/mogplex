"use client";

import { cn } from "@/lib/utils";
import type { MemoryGroups, MemoryLane } from "./context-section-types";
import { LANES, LANE_INFO } from "./context-section-types";

interface ActionButtonsProps {
  busyId: string | null;
  onCompact: () => void;
  onCheckpoint: () => void;
  compact?: boolean;
}

export function ActionButtons({
  busyId,
  onCompact,
  onCheckpoint,
  compact,
}: ActionButtonsProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          title="Compact old session memories"
          disabled={busyId === "compact"}
          onClick={onCompact}
          className="border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded border px-2 py-1 text-[11px] disabled:opacity-50"
        >
          Compact
        </button>
        <button
          type="button"
          title="Add checkpoint memory"
          disabled={busyId === "checkpoint"}
          onClick={onCheckpoint}
          className="border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded border px-2 py-1 text-[11px] disabled:opacity-50"
        >
          Checkpoint
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={busyId === "compact"}
        onClick={onCompact}
        className="border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded border px-3 py-1.5 text-sm disabled:opacity-50"
      >
        Compact
      </button>
      <button
        type="button"
        disabled={busyId === "checkpoint"}
        onClick={onCheckpoint}
        className="border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded border px-3 py-1.5 text-sm disabled:opacity-50"
      >
        Checkpoint
      </button>
    </div>
  );
}

interface LaneTabsProps {
  lane: MemoryLane;
  onLaneChange: (lane: MemoryLane) => void;
  memories: MemoryGroups;
  compact?: boolean;
}

export function LaneTabs({
  lane,
  onLaneChange,
  memories,
  compact,
}: LaneTabsProps) {
  if (compact) {
    return (
      <div className="border-border flex border-b">
        {LANES.map((currentLane) => (
          <button
            key={currentLane}
            type="button"
            onClick={() => onLaneChange(currentLane)}
            className={cn(
              "text-muted-foreground hover:bg-secondary flex-1 px-2 py-2 text-[11px]",
              lane === currentLane &&
                "border-foreground bg-muted text-foreground border-b-2"
            )}
          >
            {LANE_INFO[currentLane].label} (
            {(memories[currentLane] || []).length})
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
          onClick={() => onLaneChange(currentLane)}
          className={cn(
            "border-border text-muted-foreground hover:text-foreground rounded border px-3 py-1.5 text-sm",
            lane === currentLane && "border-primary text-primary"
          )}
        >
          {LANE_INFO[currentLane].label} ({(memories[currentLane] || []).length}
          )
        </button>
      ))}
    </div>
  );
}
