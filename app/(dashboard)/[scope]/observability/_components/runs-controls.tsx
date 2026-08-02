"use client"

import { Button } from "@/components/ui/button"
import type { JobsFilters } from "@/hooks/use-observability"
import type { ObservabilityDateRangePreset } from "@/hooks/use-observability-date-range"
import { FilterSelect } from "./filter-select"

const DATE_RANGE_PRESETS: ObservabilityDateRangePreset[] = ["1h", "today", "7d", "30d", ""]

export function RunsControls({
  jobsLoading,
  jobFilters,
  datePreset,
  onApplyDateRange,
  onUpdateJobFilter,
}: {
  jobsLoading: boolean
  jobFilters: JobsFilters
  datePreset: ObservabilityDateRangePreset
  onApplyDateRange: (preset: ObservabilityDateRangePreset) => void
  onUpdateJobFilter: (key: keyof JobsFilters, value: JobsFilters[keyof JobsFilters]) => void
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="ui-section-title">Runs</h2>
          <p className="ui-meta">Background runtime runs with repair and retry controls.</p>
        </div>
        {jobsLoading && <span className="text-sm text-muted-foreground animate-pulse">Loading runs…</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Status"
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
        {DATE_RANGE_PRESETS.map((preset) => (
          <Button
            key={preset || "all"}
            variant={datePreset === preset ? "default" : "outline"}
            size="sm"
            className="h-8 text-sm"
            onClick={() => onApplyDateRange(preset)}
          >
            {preset === "1h" ? "Last hour" : preset === "today" ? "Today" : preset === "7d" ? "Last 7d" : preset === "30d" ? "Last 30d" : "All"}
          </Button>
        ))}
      </div>
    </>
  )
}
