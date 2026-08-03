"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { type ColumnDef } from "@tanstack/react-table"
import { GitPullRequest, Search, Xmark } from "iconoir-react"
import { DataTable } from "@/components/ui/data-table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ActivityFilters } from "@/hooks/use-observability-activity"
import { resolveGithubObservabilityLink } from "@/lib/observability/github-links"
import type { AiCall } from "@/lib/types"
import {
  AutomationCostCell,
  AutomationStatusCell,
} from "./automation-presentation-cells"
import { CallExpandedRow } from "./call-expanded-row"
import { FilterSelect } from "./filter-select"
import {
  CALL_TYPE_LABELS,
  formatDuration,
  formatTokens,
  hasAnyTokenValue,
  hasPositiveTokenCount,
  repoShortName,
  timeAgo,
} from "./formatters"
import { PaginationControls } from "./pagination-controls"

const IO_TOOLTIP_LABELS = {
  freshInput: "Fresh input",
  cachedInput: "Cached input",
  cacheWrite: "Cache write",
  output: "Output",
  reasoning: "Reasoning",
} as const

function PrCell({
  call,
  reposById,
}: {
  call: AiCall
  reposById: Map<string, { full_name: string }>
}) {
  const repo = call.repo_id ? reposById.get(call.repo_id) : undefined
  const link = resolveGithubObservabilityLink({
    sourceType: call.type,
    repoFullName: repo?.full_name,
    metadata: call.metadata,
  })
  if (!link) return null
  if (link.kind !== "pr" && link.kind !== "pr_comment") return null

  const pathParts = (() => {
    try {
      return new URL(link.href).pathname.split("/").filter(Boolean)
    } catch {
      return [] as string[]
    }
  })()
  const pullIdx = pathParts.indexOf("pull")
  const prNumber = pullIdx >= 0 ? pathParts[pullIdx + 1] : undefined
  if (!prNumber) return null

  const repoShort = pathParts[1] ?? ""
  const labelText = repoShort ? `${repoShort}#${prNumber}` : `#${prNumber}`

  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground text-xs"
      onClick={(e) => e.stopPropagation()}
      title={link.href}
    >
      <GitPullRequest className="h-3 w-3" aria-hidden />
      <span className="tabular-nums max-w-[14ch] truncate">{labelText}</span>
    </a>
  )
}

function WhoCell({ call }: { call: AiCall }) {
  const model = call.model.split("/").pop() ?? call.model
  const label = CALL_TYPE_LABELS[call.type] ?? call.type
  return (
    <div className="space-y-0.5">
      <div className="text-foreground">{model}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

// Zero-valued token fields still mean the provider returned usage data.
function hasAnyUsage(call: AiCall) {
  return (
    hasAnyTokenValue(call.input_tokens) ||
    hasAnyTokenValue(call.cache_read_input_tokens) ||
    hasAnyTokenValue(call.cache_creation_input_tokens) ||
    hasAnyTokenValue(call.output_tokens) ||
    hasAnyTokenValue(call.reasoning_tokens)
  )
}

function hasFailedPartialUsageFlag(call: AiCall) {
  return call.metadata?.failed_with_partial_usage === true
}

function formatBreakdownTokens(value: number | null | undefined) {
  if (value == null) return "—"
  if (value === 0) return "0"
  return formatTokens(value)
}

function TokenChip({
  label,
  value,
}: {
  label: string
  value: number
}) {
  // Defense in depth — callers gate with hasPositiveTokenCount, but make the
  // contract explicit so a future zero-valued caller doesn't render "0 cached".
  if (!hasPositiveTokenCount(value)) return null
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
      {formatTokens(value)} {label}
    </span>
  )
}

function IoTooltipContent({ call }: { call: AiCall }) {
  // Only render rows the provider actually reported — keeps the tooltip
  // compact for basic OpenAI calls while still showing zero-as-reported values
  // (e.g. cache_read = 0) for Anthropic/extended-cache calls.
  const rows: { label: string; value: number }[] = []
  if (hasAnyTokenValue(call.input_tokens)) {
    rows.push({ label: IO_TOOLTIP_LABELS.freshInput, value: call.input_tokens })
  }
  if (hasAnyTokenValue(call.cache_read_input_tokens)) {
    rows.push({
      label: IO_TOOLTIP_LABELS.cachedInput,
      value: call.cache_read_input_tokens,
    })
  }
  if (hasAnyTokenValue(call.cache_creation_input_tokens)) {
    rows.push({
      label: IO_TOOLTIP_LABELS.cacheWrite,
      value: call.cache_creation_input_tokens,
    })
  }
  if (hasAnyTokenValue(call.output_tokens)) {
    rows.push({ label: IO_TOOLTIP_LABELS.output, value: call.output_tokens })
  }
  if (hasAnyTokenValue(call.reasoning_tokens)) {
    rows.push({
      label: IO_TOOLTIP_LABELS.reasoning,
      value: call.reasoning_tokens,
    })
  }

  return (
    <div className="space-y-1 tabular-nums">
      {rows.map((row) => (
        <div key={row.label}>
          {row.label} · {formatBreakdownTokens(row.value)}
        </div>
      ))}
    </div>
  )
}

function IoCell({ call }: { call: AiCall }) {
  const hasUsage = hasAnyUsage(call)
  if (!hasUsage) {
    if (call.status === "failed") {
      return (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <span>—</span>
          <span className="text-[10px]">(failed)</span>
        </span>
      )
    }

    return (
      <span className="text-muted-foreground">
        {formatTokens(call.total_tokens)}
      </span>
    )
  }

  const showsPartialUsage =
    call.status === "failed" && hasFailedPartialUsageFlag(call)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex max-w-full cursor-default flex-col gap-1 tabular-nums">
          {showsPartialUsage && (
            <span className="w-fit rounded bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
              (partial)
            </span>
          )}
          <div className="flex items-center gap-1 whitespace-nowrap text-xs text-foreground">
            <span>{formatTokens(call.input_tokens)}</span>
            <span className="text-muted-foreground">in</span>
            {hasPositiveTokenCount(call.cache_read_input_tokens) && (
              <TokenChip label="cached" value={call.cache_read_input_tokens} />
            )}
            {hasPositiveTokenCount(call.cache_creation_input_tokens) && (
              <TokenChip
                label="write"
                value={call.cache_creation_input_tokens}
              />
            )}
          </div>
          <div className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
            <span>{formatTokens(call.output_tokens)}</span>
            <span>out</span>
            {hasPositiveTokenCount(call.reasoning_tokens) && (
              <TokenChip label="reasoning" value={call.reasoning_tokens} />
            )}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[11px]">
        <IoTooltipContent call={call} />
      </TooltipContent>
    </Tooltip>
  )
}

function ActivitySearchInput({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  // Hold the latest onChange in a ref so parent re-renders (SWR revalidation,
  // realtime row arrivals, isLoading flips) don't reset the debounce timer.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (draft === value) return
    const handle = window.setTimeout(() => onChangeRef.current(draft), 250)
    return () => window.clearTimeout(handle)
  }, [draft, value])

  return (
    <label className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus-within:border-primary/35">
      <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Search model, repo, PR#…"
        aria-label="Search activity"
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-foreground shadow-none outline-none placeholder:text-muted-foreground/70"
      />
      {draft && (
        <button
          type="button"
          onClick={() => setDraft("")}
          aria-label="Clear search"
          className="grid size-4 place-items-center rounded text-muted-foreground hover:text-foreground"
        >
          <Xmark className="size-3" />
        </button>
      )}
    </label>
  )
}

export function ActivitySection({
  calls,
  isLoading,
  total,
  pages,
  filters,
  reposById,
  expandedCallRowIds,
  onUpdateFilter,
  onExpandedRowToggle,
  onOpenSandboxHealth,
  canOpenSandboxHealth,
}: {
  calls: AiCall[]
  isLoading: boolean
  total: number
  pages: number
  filters: ActivityFilters
  reposById: Map<string, { full_name: string }>
  expandedCallRowIds: string[]
  onUpdateFilter: (key: keyof ActivityFilters, value: ActivityFilters[keyof ActivityFilters]) => void
  onExpandedRowToggle: (call: AiCall, expanded: boolean) => void
  onOpenSandboxHealth: (call: AiCall) => void
  canOpenSandboxHealth: (call: AiCall) => boolean
}) {
  const columns = useMemo<ColumnDef<AiCall, unknown>[]>(() => [
    {
      accessorKey: "started_at",
      header: "When",
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums" title={row.original.started_at}>
          {timeAgo(row.original.started_at)}
        </span>
      ),
    },
    {
      id: "who",
      header: "Who",
      cell: ({ row }) => <WhoCell call={row.original} />,
    },
    {
      id: "where",
      header: "Where",
      cell: ({ row }) => {
        const repoId = row.original.repo_id
        if (!repoId) return <span className="text-muted-foreground">—</span>
        const repo = reposById.get(repoId)
        const label = repo ? repoShortName(repo.full_name) : repoId.slice(0, 8)
        return <span className="text-muted-foreground text-xs">{label}</span>
      },
    },
    {
      id: "pr",
      header: "PR",
      cell: ({ row }) => <PrCell call={row.original} reposById={reposById} />,
    },
    {
      id: "io",
      header: "IO",
      cell: ({ row }) => <IoCell call={row.original} />,
    },
    {
      accessorKey: "cost_usd",
      header: "Cost",
      cell: ({ row }) => (
        <AutomationCostCell
          status={row.original.status}
          costUsd={row.original.cost_usd}
          costSource={row.original.cost_source}
        />
      ),
    },
    {
      accessorKey: "duration_ms",
      header: "Duration",
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDuration(row.original.duration_ms)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Result",
      cell: ({ row }) => (
        <AutomationStatusCell
          status={row.original.status}
          metadata={row.original.metadata}
          error={row.original.error}
        />
      ),
    },
  ], [reposById])

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="ui-section-title">Activity</h2>
          <p className="ui-meta">Model calls across CLI, cloud, and automation — with tokens and cost.</p>
        </div>
        {isLoading && <span className="text-sm text-muted-foreground animate-pulse">Loading…</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Call status"
          value={filters.status || ""}
          options={[
            { label: "All", value: "" },
            { label: "Success", value: "success" },
            { label: "Failed", value: "failed" },
            { label: "Live", value: "streaming" },
            { label: "Pending", value: "pending" },
            { label: "Cancelled", value: "cancelled" },
          ]}
          onChange={(value) => onUpdateFilter("status", value || undefined)}
        />
        <ActivitySearchInput
          value={filters.q ?? ""}
          onChange={(value) => onUpdateFilter("q", value || undefined)}
        />
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        <DataTable
          columns={columns}
          data={calls}
          getRowId={(call) => call.id}
          expandedRowIds={expandedCallRowIds}
          onExpandedRowToggle={onExpandedRowToggle}
          renderExpandedRow={(call) => (
            <CallExpandedRow
              call={call}
              canOpenSandboxHealth={canOpenSandboxHealth(call)}
              onOpenSandboxHealth={onOpenSandboxHealth}
            />
          )}
        />
      </div>

      <PaginationControls
        page={filters.page}
        totalPages={pages}
        total={total}
        limit={filters.limit}
        onChange={(page) => onUpdateFilter("page", page)}
      />
    </section>
  )
}
