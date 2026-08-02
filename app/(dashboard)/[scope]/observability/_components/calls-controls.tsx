"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import type { CallsFilters } from "@/hooks/use-observability"
import { FilterSelect } from "./filter-select"
import { CALL_TYPE_LABELS } from "./formatters"

export function CallsControls({
  callsLoading,
  callFilters,
  filteredRepoLabel,
  selectedCallId,
  onUpdateCallFilter,
  onClearRepoCallFilter,
  onClearSandboxCallFilter,
  onClearSelectedCallId,
  onCopySelectedCallLink,
}: {
  callsLoading: boolean
  callFilters: CallsFilters
  filteredRepoLabel?: string | null
  selectedCallId?: string
  onUpdateCallFilter: (key: keyof CallsFilters, value: CallsFilters[keyof CallsFilters]) => void
  onClearRepoCallFilter: () => void
  onClearSandboxCallFilter: () => void
  onClearSelectedCallId: () => void
  onCopySelectedCallLink: () => Promise<boolean>
}) {
  const [copied, setCopied] = useState(false)
  const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        clearTimeout(copyResetTimeoutRef.current)
      }
    }
  }, [])

  const handleCopySelectedCallLink = useCallback(async () => {
    const copiedSuccessfully = await onCopySelectedCallLink()
    if (!copiedSuccessfully) return

    setCopied(true)
    if (copyResetTimeoutRef.current) {
      clearTimeout(copyResetTimeoutRef.current)
    }
    copyResetTimeoutRef.current = setTimeout(() => {
      setCopied(false)
      copyResetTimeoutRef.current = null
    }, 1500)
  }, [onCopySelectedCallLink])

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="ui-section-title">Calls</h2>
          <p className="ui-meta">Model invocations and tool activity linked to automation runs and chat.</p>
        </div>
        {callsLoading && <span className="text-sm text-muted-foreground animate-pulse">Loading calls…</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {callFilters.repoId && (
          <>
            <span className="rounded border border-border px-2 py-1 text-sm text-muted-foreground">
              Repo: {filteredRepoLabel || callFilters.repoId}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-sm"
              onClick={onClearRepoCallFilter}
            >
              Clear repo filter
            </Button>
          </>
        )}
        {callFilters.sandboxRecordId && (
          <>
            <span className="rounded border border-border px-2 py-1 text-sm text-muted-foreground">
              Sandbox: {callFilters.sandboxRecordId}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-sm"
              onClick={onClearSandboxCallFilter}
            >
              Clear sandbox filter
            </Button>
          </>
        )}
        {selectedCallId && (
          <>
            <span className="rounded border border-border px-2 py-1 text-sm text-muted-foreground">
              Call: {selectedCallId}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-sm"
              onClick={onClearSelectedCallId}
            >
              Clear call selection
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-sm"
              onClick={() => void handleCopySelectedCallLink()}
            >
              {copied ? "Copied" : "Copy exact call link"}
            </Button>
          </>
        )}
        <FilterSelect
          label="Type"
          value={callFilters.type || ""}
          options={[
            { label: "All", value: "" },
            ...Object.entries(CALL_TYPE_LABELS).map(([value, label]) => ({ label, value })),
          ]}
          onChange={(value) => onUpdateCallFilter("type", value || undefined)}
        />
        <FilterSelect
          label="Status"
          value={callFilters.status || ""}
          options={[
            { label: "All", value: "" },
            { label: "Pending", value: "pending" },
            { label: "Streaming", value: "streaming" },
            { label: "Success", value: "success" },
            { label: "Failed", value: "failed" },
            { label: "Cancelled", value: "cancelled" },
          ]}
          onChange={(value) => onUpdateCallFilter("status", value || undefined)}
        />
      </div>
    </>
  )
}
