"use client"

import { type ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import type { JobsFilters } from "@/hooks/use-observability"
import type { ObservabilityJob } from "@/lib/types"
import {
  AutomationCostCell,
  AutomationStatusCell,
} from "./automation-presentation-cells"
import {
  formatDispatchOutcome,
  formatTokens,
  getJobAutomationSummary,
  timeAgo,
} from "./formatters"
import { JobExpandedRow } from "./job-expanded-row"
import { PaginationControls } from "./pagination-controls"
import { RunsControls } from "./runs-controls"

export function RunsSection({
  jobs,
  jobsLoading,
  jobsTotal,
  jobsPages,
  jobFilters,
  jobActionId,
  onUpdateJobFilter,
  onRunJobAction,
}: {
  jobs: ObservabilityJob[]
  jobsLoading: boolean
  jobsTotal: number
  jobsPages: number
  jobFilters: JobsFilters
  jobActionId: string | null
  onUpdateJobFilter: (key: keyof JobsFilters, value: JobsFilters[keyof JobsFilters]) => void
  onRunJobAction: (jobId: string, action: "repair" | "requeue" | "cancel") => Promise<void>
}) {
  const jobColumns = useMemo<ColumnDef<ObservabilityJob, unknown>[]>(() => [
    {
      accessorKey: "created_at",
      header: "Time",
      cell: ({ row }) => <span title={row.original.created_at}>{timeAgo(row.original.created_at)}</span>,
    },
    {
      id: "repo",
      header: "Repo",
      cell: ({ row }) => row.original.repo.full_name ? (
        <span className="text-muted-foreground">{row.original.repo.full_name.split("/").pop()}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    },
    {
      id: "agent",
      header: "Agent",
      cell: ({ row }) => row.original.agent.name ? (
        <span>{row.original.agent.name}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    },
    {
      id: "source",
      header: "Source",
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <div className="capitalize text-foreground">{row.original.source_kind.replace("_", " ")}</div>
          <div className="text-xs text-muted-foreground">{row.original.source_type}</div>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <AutomationStatusCell
          status={row.original.status}
          metadata={row.original.latest_dispatch_event?.metadata}
          error={row.original.error}
        />
      ),
    },
    {
      id: "automation",
      header: "Automation",
      cell: ({ row }) => row.original.latest_dispatch_event ? (
        <div className="space-y-0.5">
          <div className="text-foreground">{getJobAutomationSummary(row.original)}</div>
          <div className="text-xs text-muted-foreground">{formatDispatchOutcome(row.original.latest_dispatch_event.outcome)}</div>
        </div>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    },
    {
      accessorKey: "start_attempts",
      header: "Attempts",
      cell: ({ row }) => row.original.start_attempts,
    },
    {
      accessorKey: "cost_usd",
      header: "Cost",
      cell: ({ row }) => (
        <AutomationCostCell
          status={row.original.status}
          costUsd={row.original.cost_usd}
        />
      ),
    },
    {
      id: "latest_call",
      header: "Latest Call",
      cell: ({ row }) => row.original.latest_ai_call ? (
        <div className="space-y-0.5">
          <div className="text-foreground">{row.original.latest_ai_call.model.split("/").pop()}</div>
          <div className="text-xs text-muted-foreground">
            {formatTokens(row.original.latest_ai_call.total_tokens)} · {row.original.latest_ai_call.tool_calls_count} tools
          </div>
        </div>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          {row.original.repairable && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={jobActionId !== null}
              onClick={(event) => {
                event.stopPropagation()
                void onRunJobAction(row.original.id, "repair")
              }}
            >
              Repair
            </Button>
          )}
          {row.original.cancelable && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={jobActionId !== null}
              onClick={(event) => {
                event.stopPropagation()
                void onRunJobAction(row.original.id, "cancel")
              }}
            >
              Cancel
            </Button>
          )}
          {row.original.requeueable && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={jobActionId !== null}
              onClick={(event) => {
                event.stopPropagation()
                void onRunJobAction(row.original.id, "requeue")
              }}
            >
              Requeue
            </Button>
          )}
          {!row.original.repairable && !row.original.requeueable && !row.original.cancelable && (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
  ], [jobActionId, onRunJobAction])

  return (
    <section className="space-y-3">
      <RunsControls
        jobsLoading={jobsLoading}
        jobFilters={jobFilters}
        onUpdateJobFilter={onUpdateJobFilter}
      />

      <div className="border border-border rounded-md overflow-hidden">
        <DataTable columns={jobColumns} data={jobs} renderExpandedRow={(job) => <JobExpandedRow job={job} />} />
      </div>
      <PaginationControls
        page={jobFilters.page}
        totalPages={jobsPages}
        total={jobsTotal}
        limit={jobFilters.limit}
        onChange={(page) => onUpdateJobFilter("page", page)}
      />
    </section>
  )
}
