"use client"

import { FileDiff } from "@pierre/diffs/react"
import type { CSSProperties } from "react"
import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { detectPatch, type DetectedPatch } from "@/lib/diffs/detect"

const DEFAULT_OPTIONS = {
  theme: "pierre-dark" as const,
  diffStyle: "unified" as const,
  hunkSeparators: "line-info-basic" as const,
  lineDiffType: "word-alt" as const,
  overflow: "scroll" as const,
  collapsedContextThreshold: 1,
  expansionLineCount: 80,
  tokenizeMaxLineLength: 4000,
  maxLineDiffLength: 4000,
}

const DIFF_STYLE = {
  "--diffs-font-family": "var(--font-geist-mono), 'SF Mono', monospace",
  "--diffs-header-font-family": "var(--font-geist-mono), 'SF Mono', monospace",
  "--diffs-font-size": "11px",
  "--diffs-line-height": "1.5",
  "--diffs-gap-block": "0px",
  "--diffs-gap-inline": "6px",
} as CSSProperties

interface PatchViewerProps {
  patch?: string
  detectedPatch?: DetectedPatch | null
  className?: string
}

export function PatchViewer({ patch, detectedPatch, className }: PatchViewerProps) {
  const resolvedPatch = useMemo(() => {
    if (detectedPatch) return detectedPatch
    if (!patch) return null
    return detectPatch(patch)
  }, [detectedPatch, patch])

  if (!resolvedPatch) {
    return null
  }

  return (
    <div className={cn("my-2 overflow-hidden rounded-sm border border-white/8 bg-white/[0.03]", className)}>
      {resolvedPatch.files.map((fileDiff, index) => (
        <FileDiff
          key={`${fileDiff.prevName ?? ""}:${fileDiff.name}:${index}`}
          fileDiff={fileDiff}
          options={DEFAULT_OPTIONS}
          className={index > 0 ? "border-t border-white/8" : undefined}
          style={DIFF_STYLE}
        />
      ))}
    </div>
  )
}
