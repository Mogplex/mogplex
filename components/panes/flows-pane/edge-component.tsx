"use client"

import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react"
import { cn } from "@/lib/utils"
import { isRecord } from "@/lib/flows/run-presentation"
import { getOrganicEdgePath } from "@/lib/flows/organic-edge-path"
import type { FlowRenderableEdgeData } from "./types"

export function edgeToneClass(tone: FlowRenderableEdgeData["tone"]) {
  switch (tone) {
    case "success":
      return "flows-edge-tone-success"
    case "danger":
      return "flows-edge-tone-danger"
    case "condition":
      return "flows-edge-tone-condition"
    case "alternate":
      return "flows-edge-tone-alternate"
    case "parallel":
      return "flows-edge-tone-parallel"
    case "join":
      return "flows-edge-tone-join"
    case "default":
    default:
      return "flows-edge-tone-default"
  }
}

export function FlowSemanticEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd,
  data,
}: EdgeProps) {
  const edgeData = isRecord(data) ? data as FlowRenderableEdgeData : undefined
  const toneClass = edgeToneClass(edgeData?.tone)
  const [edgePath, labelX, labelY] = getOrganicEdgePath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <>
      <BaseEdge
        id={`${id}-underlay`}
        path={edgePath}
        className="flows-edge-path-underlay"
        style={{
          strokeWidth: selected ? 8 : 6,
          opacity: selected ? 0.16 : 0.08,
        }}
      />
      <BaseEdge
        id={`${id}-foreground`}
        path={edgePath}
        markerEnd={markerEnd}
        className={cn("flows-edge-path-foreground", toneClass)}
        style={{
          strokeWidth: selected ? 2.8 : 1.9,
          opacity: selected ? 1 : 0.84,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-none absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <div className="pointer-events-auto flex items-center gap-2">
            {edgeData?.label ? (
              <span className={`flows-edge-label ${toneClass}`}>
                {edgeData.label}
              </span>
            ) : null}
            {edgeData?.onInsertMenu ? (
              <button
                type="button"
                data-testid={`flow-edge-insert-${id}`}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  edgeData.onInsertMenu?.(edgeData.edgeId, event.clientX, event.clientY)
                }}
                className="rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground shadow-lg transition-colors hover:border-accent-blue hover:bg-secondary hover:text-accent-blue"
                aria-label="Insert node on edge"
                title="Insert node on edge"
              >
                +
              </button>
            ) : null}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
