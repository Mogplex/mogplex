"use client"

import { type ColumnDef } from "@tanstack/react-table"
import { useMemo } from "react"
import { StructuredValueViewer } from "@/components/diffs/structured-value-viewer"
import { DataTable } from "@/components/ui/data-table"
import type { AutomationEventsFilters } from "@/hooks/use-observability"
import type { AutomationDispatchEvent } from "@/lib/types"
import { PressureOutcomeBadge } from "./badges"
import { FilterSelect } from "./filter-select"
import { formatDispatchReason, timeAgo } from "./formatters"
import { GithubEventLinkPanel } from "./github-event-link-panel"
import { PaginationControls } from "./pagination-controls"

function DispatchExpandedRow({ event }: { event: AutomationDispatchEvent }) {
  return (
    <div className="p-4 space-y-3 text-sm">
      <GithubEventLinkPanel
        sourceType={event.source_type}
        repoFullName={event.repo.full_name}
        metadata={event.metadata}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <div className="ui-label mb-0.5">Reason</div>
          <div className="text-foreground">{formatDispatchReason(event.reason, event.metadata)}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Source</div>
          <div className="text-foreground capitalize">{event.source_kind.replace("_", " ")} · {event.source_type}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Job Run</div>
          <div className="font-mono text-foreground break-all">{event.job_run_id || "—"}</div>
        </div>
      </div>
      <div>
        <div className="ui-label mb-1">Metadata</div>
        <StructuredValueViewer value={event.metadata || {}} className="my-0" stringLanguage="language-json" />
      </div>
    </div>
  )
}

export function PressureSection({
  pressureEvents,
  pressureLoading,
  pressureTotal,
  pressurePages,
  pressureFilters,
  onUpdatePressureFilter,
}: {
  pressureEvents: AutomationDispatchEvent[]
  pressureLoading: boolean
  pressureTotal: number
  pressurePages: number
  pressureFilters: AutomationEventsFilters
  onUpdatePressureFilter: (key: keyof AutomationEventsFilters, value: AutomationEventsFilters[keyof AutomationEventsFilters]) => void
}) {
  const pressureColumns = useMemo<ColumnDef<AutomationDispatchEvent, unknown>[]>(() => [
    {
      accessorKey: "created_at",
      header: "Time",
      cell: ({ row }) => <span title={row.original.created_at}>{timeAgo(row.original.created_at)}</span>,
    },
    {
      accessorKey: "outcome",
      header: "Outcome",
      cell: ({ row }) => <PressureOutcomeBadge outcome={row.original.outcome} />,
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
      cell: ({ row }) => row.original.agent.name ? row.original.agent.name : <span className="text-muted-foreground">—</span>,
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
      accessorKey: "reason",
      header: "Reason",
      cell: ({ row }) => row.original.reason ? (
        <span className="text-muted-foreground">{formatDispatchReason(row.original.reason, row.original.metadata)}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    },
  ], [])

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="ui-section-title">Pressure</h2>
          <p className="ui-meta">Queue suppression, deferrals, and start failures across the automation fleet.</p>
        </div>
        {pressureLoading && <span className="text-sm text-muted-foreground animate-pulse">Loading pressure…</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Outcome"
          value={pressureFilters.outcome || ""}
          options={[
            { label: "All", value: "" },
            { label: "Queued", value: "queued" },
            { label: "Suppressed", value: "suppressed" },
            { label: "Started", value: "started" },
            { label: "Deferred", value: "deferred" },
            { label: "Start Failed", value: "start_failed" },
            { label: "Completed", value: "completed" },
            { label: "Failed", value: "failed" },
            { label: "Cancel Requested", value: "cancel_requested" },
            { label: "Cancelled", value: "cancelled" },
            { label: "Cancel Failed", value: "cancel_failed" },
            { label: "Reconciled", value: "reconciled" },
          ]}
          onChange={(value) => onUpdatePressureFilter("outcome", value || undefined)}
        />
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        <DataTable columns={pressureColumns} data={pressureEvents} renderExpandedRow={(event) => <DispatchExpandedRow event={event} />} />
      </div>
      <PaginationControls
        page={pressureFilters.page}
        totalPages={pressurePages}
        total={pressureTotal}
        limit={pressureFilters.limit}
        onChange={(page) => onUpdatePressureFilter("page", page)}
      />
    </section>
  )
}
