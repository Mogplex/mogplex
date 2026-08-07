"use client"

import { useMemo } from "react"
import { MiniMap, useStore as useReactFlowStore } from "@xyflow/react"
import { getMinimapSize } from "@/lib/flows/minimap-size"
import type { FlowDraftSnapshot } from "@/lib/flows/editor"
import type { FlowStartFilter, TriggerEvent } from "@/lib/types"
import { EVENT_OPTIONS } from "./constants"

/**
 * The minimap has to track the canvas, not the window — docking the inspector
 * narrows the canvas without the window changing at all.
 *
 * It gets an explicit `style` rather than a CSS rule because React Flow reads
 * `style.width`/`style.height` to build its pan scale; see `getMinimapSize`.
 */
export function ResponsiveMiniMap() {
  const canvasWidth = useReactFlowStore((state) => state.width)
  const canvasHeight = useReactFlowStore((state) => state.height)
  const size = useMemo(
    () => getMinimapSize(canvasWidth, canvasHeight),
    [canvasWidth, canvasHeight]
  )
  return (
    <MiniMap
      pannable
      zoomable
      position="bottom-right"
      className="hidden xl:block"
      style={size}
    />
  )
}

export function readFlowTabFromLocation(): "editor" | "runs" {
  if (typeof window === "undefined") return "editor"
  return new URL(window.location.href).searchParams.get("tab") === "runs" ? "runs" : "editor"
}

export function isMacPrimaryModifier() {
  if (typeof navigator === "undefined") return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}

export function createDraftHistory(snapshot: FlowDraftSnapshot) {
  return {
    past: [] as FlowDraftSnapshot[],
    present: snapshot,
    future: [] as FlowDraftSnapshot[],
  }
}

export function startDataForEvent(
  data: Record<string, unknown>,
  nextEvent: TriggerEvent,
): Record<string, unknown> {
  const filtered = stripAuthorFilterForEvent(data, nextEvent)
  const {
    labelName: _labelName,
    labelPrOnly: _labelPrOnly,
    tagPattern: _tagPattern,
    scheduleCron: _scheduleCron,
    scheduleTimezone: _scheduleTimezone,
    slackTeamId: _slackTeamId,
    slackChannelId: _slackChannelId,
    slackChannelName: _slackChannelName,
    ...rest
  } = filtered

  return {
    ...rest,
    event: nextEvent,
    label: EVENT_OPTIONS.find((option) => option.value === nextEvent)?.label || data.label,
    ...(nextEvent === "schedule"
      ? { scheduleCron: "0 9 * * 1-5", scheduleTimezone: "UTC" }
      : {}),
  }
}

// The "PR authors" control only renders for pr_opened, so switching to another
// event must also drop authorFilter from the node data — a hidden
// dependabot_only fails closed on events without PR-author context and would
// silently stop the flow from routing.
export function stripAuthorFilterForEvent(
  data: Record<string, unknown>,
  nextEvent: string,
): Record<string, unknown> {
  if (nextEvent === "pr_opened") return data
  const filter = data.filter as FlowStartFilter | undefined
  if (!filter?.authorFilter) return data
  const { authorFilter: _omit, ...restFilter } = filter
  const isEmpty =
    (restFilter.scope ?? "all") === "all" &&
    !restFilter.installationIds?.length &&
    !restFilter.repos?.length
  if (isEmpty) {
    const { filter: _omitFilter, ...restData } = data
    return restData
  }
  return { ...data, filter: restFilter }
}
