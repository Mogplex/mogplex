"use client"

import { Button } from "@/components/ui/button"
import type { JobsFilters } from "@/hooks/use-observability"
import { FilterSelect } from "./filter-select"

export function RunsControls({
  jobsLoading,
  jobFilters,
  isCurrentPendingView,
  onUpdateJobFilter,
}: {
  jobsLoading: boolean
  jobFilters: JobsFilters
  isCurrentPendingView: boolean
  onUpdateJobFilter: (key: keyof JobsFilters, value: JobsFilters[keyof JobsFilters]) => void
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Inspect work, review its output, or open the workspace to continue.</p>
          {isCurrentPendingView ? (
            <p className="ui-meta text-foreground">
              Current active work across all dates.
            </p>
          ) : null}
        </div>
        {jobsLoading && <span className="text-sm text-muted-foreground animate-pulse">Loading runs…</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Run status"
          value={jobFilters.status || ""}
          options={[
            { label: "All", value: "" },
            { label: "Pending", value: "pending" },
            { label: "Running", value: "running" },
            { label: "Needs input", value: "awaiting_input" },
            { label: "Success", value: "success" },
            { label: "Failed", value: "failed" },
            { label: "Cancelled", value: "cancelled" },
          ]}
          onChange={(value) => onUpdateJobFilter("status", value || undefined)}
        />
        <FilterSelect
          label="Source"
          value={jobFilters.sourceKind || ""}
          options={[
            { label: "All", value: "" },
            { label: "Flow", value: "flow" },
            { label: "Trigger", value: "trigger" },
            { label: "Assignment", value: "assignment" },
            { label: "Manual Retry", value: "manual_retry" },
            { label: "Agent Run", value: "agent_run" },
          ]}
          onChange={(value) => onUpdateJobFilter("sourceKind", value || undefined)}
        />
        <Button
          variant={jobFilters.onlyRepairable ? "default" : "outline"}
          size="sm"
          className="h-8 text-sm"
          onClick={() => onUpdateJobFilter("onlyRepairable", !jobFilters.onlyRepairable || undefined)}
        >
          Repairable only
        </Button>
      </div>
    </>
  )
}
