"use client"

import { type ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"
import { StructuredValueViewer } from "@/components/diffs/structured-value-viewer"
import { DataTable } from "@/components/ui/data-table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type {
  AutomationFailuresFilters,
  AutomationFailuresResponse,
} from "@/hooks/use-observability"
import type { AutomationFailureBreakdown, AutomationFailureRecord } from "@/lib/automation-failure-observability"
import { FilterSelect } from "./filter-select"
import { formatDuration, timeAgo } from "./formatters"
import { GithubEventLinkPanel } from "./github-event-link-panel"
import { PaginationControls } from "./pagination-controls"

function FailureStatCard({
  label,
  value,
  sub,
  valueClass,
  info,
}: {
  label: string
  value: string
  sub?: string
  valueClass?: string
  info?: string
}) {
  return (
    <div className="border border-border rounded-md p-3">
      <div className="text-muted-foreground text-xs mb-1">
        {info ? (
          <Tooltip>
            <TooltipTrigger className="cursor-help text-left underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
              {label}
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[300px] text-[11px]">
              {info}
            </TooltipContent>
          </Tooltip>
        ) : (
          label
        )}
      </div>
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
  onUpdateFilter,
}: {
  data: AutomationFailuresResponse | undefined
  isLoading: boolean
  filters: AutomationFailuresFilters
  pages: number
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
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <FailureStatCard
          label="Failed Runs"
          value={String(summary?.failedTotal ?? 0)}
          sub={`${summary?.retriedFailures ?? 0} retried`}
          valueClass={(summary?.failedTotal ?? 0) > 0 ? "text-accent-red" : ""}
          info="Automation runs in the window that ended failed. The sub-line counts those that attempted at least one model retry before giving up."
        />
        <FailureStatCard
          label="Successful Recoveries"
          value={String(summary?.successfulRecoveries ?? 0)}
          sub="Completed after a model retry"
          valueClass={(summary?.successfulRecoveries ?? 0) > 0 ? "text-accent-green" : ""}
          info="Runs that completed successfully after recovering from a model failure mid-run. The failure they recovered from is shown in the row's expanded view."
        />
        <div className="rounded-md border border-dashed border-border p-2 lg:col-span-3">
          <div className="ui-label mb-2">Failure Types</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <FailureStatCard
              label="Timeout"
              value={String(summary?.timeoutFailures ?? 0)}
              valueClass={(summary?.timeoutFailures ?? 0) > 0 ? "text-accent-amber" : ""}
              info="Failed runs classified as timeouts — the run hit its execution time budget. The Timeout Budget breakdown below shows which budget tier each hit."
            />
            <FailureStatCard
              label="Provider / Upstream"
              value={String(summary?.providerFailures ?? 0)}
              sub={`${summary?.dependencyFailures ?? 0} dependency`}
              valueClass={(summary?.providerFailures ?? 0) > 0 ? "text-accent-amber" : ""}
              info="Failed runs caused upstream of Mogplex: the model provider behind the AI gateway was unavailable, erroring, or rate-limiting (HTTP 429/5xx). These usually clear on their own — retry, or switch models if persistent. The dependency sub-count is different: one of Mogplex's own dependencies failed, which points at a platform problem, not the provider."
            />
            <FailureStatCard
              label="Auth / Config"
              value={String((summary?.authenticationFailures ?? 0) + (summary?.configurationFailures ?? 0))}
              sub={`${summary?.authenticationFailures ?? 0} auth · ${summary?.configurationFailures ?? 0} config`}
              valueClass={((summary?.authenticationFailures ?? 0) + (summary?.configurationFailures ?? 0)) > 0 ? "text-accent-red" : ""}
              info="Failed runs caused by a bad credential (auth — e.g. an expired or revoked token) or an invalid setup (config — e.g. a bad model id or missing setting). These will not fix themselves on retry."
            />
          </div>
        </div>
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
