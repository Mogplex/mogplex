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
          <p className="ui-meta">Background runtime runs with repair and retry controls. Current failures and pending recovery appear in Automation health above.</p>
          {isCurrentPendingView ? (
            <p className="ui-meta text-foreground">
              Current pending runs across all dates.
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
