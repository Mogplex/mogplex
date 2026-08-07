"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { SelectionRect } from "./types";

export function GrabOverlay({
  onCapture,
  onCancel,
}: {
  onCapture: (region: SelectionRect) => void;
  onCancel: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;
    setStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!start) return;
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [start]
  );

  const handleMouseUp = useCallback(() => {
    if (!start || !current) return;
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);

    // Minimum 10px selection to avoid accidental clicks
    if (width < 10 || height < 10) {
      setStart(null);
      setCurrent(null);
      return;
    }

    // Normalize to percentages of the container
    onCapture({
      x: Math.round((x / rect.width) * 100),
      y: Math.round((y / rect.height) * 100),
      width: Math.round((width / rect.width) * 100),
      height: Math.round((height / rect.height) * 100),
    });
  }, [start, current, onCapture]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onCancel]);

  const selectionBox =
    start && current
      ? {
          left: Math.min(start.x, current.x),
          top: Math.min(start.y, current.y),
          width: Math.abs(current.x - start.x),
          height: Math.abs(current.y - start.y),
        }
      : null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-20 cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Dimmed backdrop */}
      <div className="absolute inset-0 bg-black/20" />

      {/* Selection rectangle */}
      {selectionBox && selectionBox.width > 2 && (
        <div
          className="absolute border-2 border-blue-400 bg-blue-400/10"
          style={selectionBox}
        />
      )}

      {/* Instructions */}
      <div className="bg-card/90 border-border text-muted-foreground pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-md border px-3 py-1.5 text-[10px] backdrop-blur-sm">
        Drag to select a region · Esc to cancel
      </div>
    </div>
  );
}
