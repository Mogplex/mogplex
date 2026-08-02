"use client"

import {
  type AutomationCostSource,
  formatAutomationTimeoutBudgetLabel,
  getAutomationCostPrimaryLabel,
  getAutomationCostSecondaryLabel,
  getAutomationCostState,
  getAutomationStatusPresentation,
} from "@/lib/observability/automation-run-presentation"
import { CostSourceBadge, StatusBadge } from "./badges"

type AutomationMetadata = Record<string, unknown> | null | undefined

export function AutomationCostCell({
  status,
  costUsd,
  costSource,
}: {
  status: string
  costUsd: number | null | undefined
  costSource?: AutomationCostSource
}) {
  const costState = getAutomationCostState({ status, costUsd, costSource })
  const secondaryLabel = getAutomationCostSecondaryLabel(costState)
  const primaryLabel = getAutomationCostPrimaryLabel({ costState, costUsd })

  return (
    <div className="space-y-0.5 tabular-nums">
      <div className="flex items-center gap-1.5 text-foreground">
        <span>{primaryLabel}</span>
        {costState === "reconciled" && costSource && (
          <CostSourceBadge costSource={costSource} />
        )}
      </div>
      {secondaryLabel && (
        <div className="text-xs text-muted-foreground">{secondaryLabel}</div>
      )}
    </div>
  )
}

export function AutomationInlineCostSummary({
  status,
  costUsd,
  costSource,
}: {
  status: string
  costUsd: number | null | undefined
  costSource?: AutomationCostSource
}) {
  const costState = getAutomationCostState({ status, costUsd, costSource })
  const secondaryLabel = getAutomationCostSecondaryLabel(costState)
  const primaryLabel = getAutomationCostPrimaryLabel({ costState, costUsd })

  return (
    <>
      <span>{primaryLabel}</span>
      {secondaryLabel && <span>{secondaryLabel}</span>}
    </>
  )
}

export function AutomationStatusCell({
  status,
  metadata,
  error,
}: {
  status: string
  metadata?: AutomationMetadata
  error?: string | null
}) {
  const presentation = getAutomationStatusPresentation({
    status,
    metadata,
    error,
  })
  const timeoutBudget = formatAutomationTimeoutBudgetLabel(
    presentation.timeoutBudgetMs
  )

  return (
    <div className="space-y-0.5">
      <StatusBadge status={status} label={presentation.label} />
      {timeoutBudget && (
        <div className="text-xs text-muted-foreground">{timeoutBudget}</div>
      )}
    </div>
  )
}
