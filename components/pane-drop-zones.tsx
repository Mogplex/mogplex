"use client";
import { useDroppable } from "@dnd-kit/core";
import { useDndMonitor } from "@dnd-kit/core";
import { useState } from "react";
import type { MovePosition } from "@/hooks/use-split-panes";

type ZoneSpec = {
  position: MovePosition;
  className: string;
  label: string;
};

const ZONES: ZoneSpec[] = [
  {
    position: "top",
    className: "top-0 inset-x-0 h-1/3 rounded-t-md",
    label: "Above",
  },
  {
    position: "bottom",
    className: "bottom-0 inset-x-0 h-1/3 rounded-b-md",
    label: "Below",
  },
  {
    position: "left",
    className: "left-0 inset-y-0 w-1/3 rounded-l-md",
    label: "Left",
  },
  {
    position: "right",
    className: "right-0 inset-y-0 w-1/3 rounded-r-md",
    label: "Right",
  },
  { position: "swap", className: "inset-1/3 rounded-md", label: "Swap" },
];

interface DropZoneProps {
  paneId: string;
  spec: ZoneSpec;
  hidden: boolean;
}

function DropZone({ paneId, spec, hidden }: DropZoneProps) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: `${paneId}:${spec.position}`,
    data: { paneId, position: spec.position },
  });
  const isSelf = active?.id === paneId;
  if (hidden || isSelf) return null;

  return (
    <div
      ref={setNodeRef}
      className={`pointer-events-auto absolute z-20 flex items-center justify-center transition-colors ${
        spec.className
      } ${
        isOver
          ? "bg-primary/15 border border-primary/60"
          : "bg-transparent border border-transparent"
      }`}
    >
      {isOver && (
        <span className="text-[11px] font-medium text-primary uppercase tracking-wider">
          {spec.label}
        </span>
      )}
    </div>
  );
}

interface PaneDropZonesProps {
  paneId: string;
}

export function PaneDropZones({ paneId }: PaneDropZonesProps) {
  const [dragging, setDragging] = useState(false);
  useDndMonitor({
    onDragStart: () => setDragging(true),
    onDragEnd: () => setDragging(false),
    onDragCancel: () => setDragging(false),
  });

  if (!dragging) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {ZONES.map((spec) => (
        <DropZone
          key={spec.position}
          paneId={paneId}
          spec={spec}
          hidden={false}
        />
      ))}
    </div>
  );
}
