"use client"

import { type ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"
import { StructuredValueViewer } from "@/components/diffs/structured-value-viewer"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import type {
  AutomationFailuresFilters,
  AutomationFailuresResponse,
} from "@/hooks/use-observability"
import type { ObservabilityDateRangePreset } from "@/hooks/use-observability-date-range"
import type { AutomationFailureBreakdown, AutomationFailureRecord } from "@/lib/automation-failure-observability"
import { FilterSelect } from "./filter-select"
import { formatDuration, timeAgo } from "./formatters"
import { GithubEventLinkPanel } from "./github-event-link-panel"
import { PaginationControls } from "./pagination-controls"

const DATE_RANGE_PRESETS: ObservabilityDateRangePreset[] = ["1h", "today", "7d", "30d", ""]

function FailureStatCard({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string
  value: string
  sub?: string
  valueClass?: string
}) {
  return (
    <div className="border border-border rounded-md p-3">
      <div className="text-muted-foreground text-xs mb-1">{label}</div>
      <div className={`text-foreground text-lg font-medium ${valueClass || ""}`}>{value}</div>
      {sub ? <div className="text-muted-foreground text-xs mt-0.5">{sub}</div> : null}
    </div>
  )
}

function BreakdownPanel({
  title,
  items,
}: {
  title: string
  items: AutomationFailureBreakdown[]
}) {
  const visibleItems = items.slice(0, 5)

  return (
    <div className="border border-border rounded-md p-3 space-y-2">
      <div className="ui-label">{title}</div>
      {visibleItems.length > 0 ? (
        <div className="space-y-1.5">
          {visibleItems.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-foreground truncate">{item.label}</span>
              <span className="text-muted-foreground shrink-0">{item.count}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">—</div>
      )}
    </div>
  )
}

function AutomationFailureExpandedRow({
  record,
}: {
  record: AutomationFailureRecord
}) {
  return (
    <div className="p-4 space-y-3 text-sm">
      <GithubEventLinkPanel
        sourceType={record.sourceType}
        repoFullName={record.repo.fullName}
        metadata={record.metadata}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <div className="ui-label mb-0.5">Failure</div>
          <div className="text-foreground">{record.diagnostics.failureLabel || "Other"}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">HTTP Status</div>
          <div className="text-foreground">{record.diagnostics.failureStatusCode ?? "—"}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Phase</div>
          <div className="text-foreground">{record.diagnostics.executionPhase || "—"}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Job Run</div>
          <div className="font-mono text-foreground break-all">{record.jobRunId || "—"}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <div className="ui-label mb-0.5">Reason</div>
          <div className="text-foreground">{record.reasonLabel}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Timeout Budget</div>
          <div className="text-foreground">
            {record.diagnostics.effectiveTimeoutMs != null
              ? formatDuration(record.diagnostics.effectiveTimeoutMs)
              : "—"}
          </div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Attempts</div>
          <div className="text-foreground">
            {record.diagnostics.attempts > 0 ? record.diagnostics.attempts : "—"}
          </div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Retry</div>
          <div className="text-foreground">
            {record.diagnostics.retryAttempted
              ? `${record.diagnostics.retryCount} retr${record.diagnostics.retryCount === 1 ? "y" : "ies"}`
              : "No"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="ui-label mb-1">Failure Message</div>
          <div className="rounded bg-accent-red/5 px-2 py-1 font-mono text-accent-red break-words">
            {record.diagnostics.failureMessage || "—"}
          </div>
        </div>
        <div>
          <div className="ui-label mb-1">Recovered From</div>
          <div className="rounded bg-secondary/50 px-2 py-1 text-foreground break-words">
            {record.diagnostics.recoveredFromFailureLabel && record.diagnostics.recoveredFromMessage
              ? `${record.diagnostics.recoveredFromFailureLabel}: ${record.diagnostics.recoveredFromMessage}`
              : "—"}
          </div>
        </div>
      </div>

      <div>
        <div className="ui-label mb-1">Metadata</div>
        <StructuredValueViewer value={record.metadata || {}} className="my-0" stringLanguage="language-json" />
      </div>
    </div>
  )
}

export function AutomationFailuresSection({
  data,
  isLoading,
  filters,
  pages,
  datePreset,
  onApplyDateRange,
  onUpdateFilter,
}: {
  data: AutomationFailuresResponse | undefined
  isLoading: boolean
  filters: AutomationFailuresFilters
  pages: number
  datePreset: ObservabilityDateRangePreset
  onApplyDateRange: (preset: ObservabilityDateRangePreset) => void
  onUpdateFilter: (
    key: keyof AutomationFailuresFilters,
    value: AutomationFailuresFilters[keyof AutomationFailuresFilters]
  ) => void
}) {
  const records = data?.records || []
  const summary = data?.summary
  const breakdowns = data?.breakdowns
  const filterOptions = data?.filter_options

  const columns = useMemo<ColumnDef<AutomationFailureRecord, unknown>[]>(() => [
    {
      accessorKey: "createdAt",
      header: "Time",
      cell: ({ row }) => <span title={row.original.createdAt}>{timeAgo(row.original.createdAt)}</span>,
    },
    {
      id: "failure",
      header: "Failure",
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <div className="text-foreground">{row.original.diagnostics.failureLabel || "Other"}</div>
          <div className="text-xs text-muted-foreground">
            {row.original.diagnostics.failureStatusCode != null
              ? `HTTP ${row.original.diagnostics.failureStatusCode}`
              : row.original.diagnostics.timeoutBucketLabel}
          </div>
        </div>
      ),
    },
    {
      id: "repo",
      header: "Repo",
      cell: ({ row }) => row.original.repo.fullName ? (
        <span className="text-muted-foreground">{row.original.repo.fullName.split("/").pop()}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    },
    {
      id: "agent",
      header: "Agent",
      cell: ({ row }) => row.original.agent.name ? row.original.agent.name : <span className="text-muted-foreground">—</span>,
    },
    {
      id: "source",
      header: "Source",
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <div className="capitalize text-foreground">{row.original.sourceKind.replace("_", " ")}</div>
          <div className="text-xs text-muted-foreground">{row.original.sourceType}</div>
        </div>
      ),
    },
    {
      id: "model",
      header: "Model",
      cell: ({ row }) => row.original.agent.model ? (
        <div className="space-y-0.5">
          <div className="text-foreground">{row.original.agent.model.split("/").pop()}</div>
          <div className="text-xs text-muted-foreground">{row.original.agent.provider || "unknown"}</div>
        </div>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    },
    {
      id: "retry",
      header: "Retry",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.diagnostics.retryAttempted
            ? `${row.original.diagnostics.retryCount} retr${row.original.diagnostics.retryCount === 1 ? "y" : "ies"}`
            : "—"}
        </span>
      ),
    },
    {
      id: "reason",
      header: "Reason",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.reasonLabel}</span>,
    },
  ], [])

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="ui-section-title">Automation Failures</h2>
          <p className="ui-meta">Timeout, auth, provider, and configuration failures across automation entry points.</p>
        </div>
        {isLoading ? <span className="text-sm text-muted-foreground animate-pulse">Loading failures…</span> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Failure"
          value={filters.failureClass || ""}
          options={[
            { label: "All", value: "" },
            ...(filterOptions?.failureClasses || []).map((option) => ({
              label: option.label,
              value: option.value,
            })),
          ]}
          onChange={(value) => onUpdateFilter("failureClass", value || undefined)}
        />
        <FilterSelect
          label="Source"
          value={filters.sourceType || ""}
          options={[
            { label: "All", value: "" },
            ...(filterOptions?.sourceTypes || []).map((option) => ({
              label: option.label,
              value: option.value,
            })),
          ]}
          onChange={(value) => onUpdateFilter("sourceType", value || undefined)}
        />
        <FilterSelect
          label="Provider"
          value={filters.provider || ""}
          options={[
            { label: "All", value: "" },
            ...(filterOptions?.providers || []).map((option) => ({
              label: option.label,
              value: option.value,
            })),
          ]}
          onChange={(value) => onUpdateFilter("provider", value || undefined)}
        />
        <FilterSelect
          label="Model"
          value={filters.model || ""}
          options={[
            { label: "All", value: "" },
            ...(filterOptions?.models || []).map((option) => ({
              label: option.label,
              value: option.value,
            })),
          ]}
          onChange={(value) => onUpdateFilter("model", value || undefined)}
        />
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <FailureStatCard
          label="Failed Runs"
          value={String(summary?.failedTotal ?? 0)}
          sub={`${summary?.retriedFailures ?? 0} retried`}
          valueClass={(summary?.failedTotal ?? 0) > 0 ? "text-accent-red" : ""}
        />
        <FailureStatCard
          label="Successful Recoveries"
          value={String(summary?.successfulRecoveries ?? 0)}
          sub="Completed after a model retry"
          valueClass={(summary?.successfulRecoveries ?? 0) > 0 ? "text-accent-green" : ""}
        />
        <FailureStatCard
          label="Timeout Failures"
          value={String(summary?.timeoutFailures ?? 0)}
          sub={`${summary?.providerFailures ?? 0} provider/rate-limit · ${summary?.dependencyFailures ?? 0} dependency`}
          valueClass={(summary?.timeoutFailures ?? 0) > 0 ? "text-accent-amber" : ""}
        />
        <FailureStatCard
          label="Auth / Config"
          value={String((summary?.authenticationFailures ?? 0) + (summary?.configurationFailures ?? 0))}
          sub={`${summary?.authenticationFailures ?? 0} auth · ${summary?.configurationFailures ?? 0} config`}
          valueClass={((summary?.authenticationFailures ?? 0) + (summary?.configurationFailures ?? 0)) > 0 ? "text-accent-red" : ""}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <BreakdownPanel title="Failure Class" items={breakdowns?.byFailureClass || []} />
        <BreakdownPanel title="Source Type" items={breakdowns?.bySourceType || []} />
        <BreakdownPanel title="Provider" items={breakdowns?.byProvider || []} />
        <BreakdownPanel title="Model" items={breakdowns?.byModel || []} />
        <BreakdownPanel title="Timeout Budget" items={breakdowns?.byTimeoutBucket || []} />
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        <DataTable columns={columns} data={records} renderExpandedRow={(record) => <AutomationFailureExpandedRow record={record} />} />
      </div>
      <PaginationControls
        page={filters.page}
        totalPages={pages}
        total={data?.total || 0}
        limit={filters.limit}
        onChange={(page) => onUpdateFilter("page", page)}
      />
    </section>
  )
}
