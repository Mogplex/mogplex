"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation"
import { useObservabilityActivity, type ActivityFilters } from "@/hooks/use-observability-activity"
import {
  useObservabilityAutomationEvents,
  useObservabilityAutomationFailures,
  useObservabilityJobs,
  useObservabilityStats,
  type AutomationEventsFilters,
  type AutomationFailuresFilters,
  type JobsFilters,
} from "@/hooks/use-observability"
import { useObservabilityAutomationEventFilters } from "@/hooks/use-observability-automation-event-filters"
import { useObservabilityAutomationFailureFilters } from "@/hooks/use-observability-automation-failure-filters"
import { useObservabilityCallFilters } from "@/hooks/use-observability-call-filters"
import { useObservabilityJobFilters } from "@/hooks/use-observability-job-filters"
import { useRepos } from "@/hooks/use-repos"
import { useSessionsStore } from "@/hooks/use-sessions"
import { getExpandedCallRowIds } from "@/lib/observability/call-expansion"
import {
  buildActivityDateRangeHref,
  isCustomRangeIncomplete,
  readActivityDateRangeSelection,
  resolveActivityDateRange,
  type ActivityDateRangeSelection,
} from "@/lib/observability/activity-date-range"
import { navigateToSandboxHealth } from "@/lib/sandbox/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { AiCall } from "@/lib/types"
import { ActivityDateRangeFilter } from "./_components/activity-date-range-filter"
import { ActivitySection } from "./_components/activity-section"
import { AutomationFailuresSection } from "./_components/automation-failures-section"
import {
  ObservabilitySummary,
  type PressureOutcome,
  type RunDrilldown,
} from "./_components/observability-summary"
import { PendingApprovalsSection } from "./_components/pending-approvals-section"
import { AttentionRuns } from "./_components/attention-runs"
import { LoadError } from "./_components/load-error"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { UsageAndCost, ReconciliationNotice } from "./_components/observability-usage-section"
import { readWorkView, writeWorkFilters, type WorkView } from "@/lib/observability/work-route"
import { PressureSection } from "./_components/pressure-section"
import { RunsSection } from "./_components/runs-section"

const INITIAL_FILTERS: ActivityFilters = {
  page: 1,
  limit: 50,
  sort: "started_at",
  order: "desc",
}

type TableTab = "runs" | "failures" | "pressure" | "activity"

function TabCount({ value }: { value: number | undefined }) {
  if (value === undefined) return null
  return (
    <span className="tabular-nums text-xs text-muted-foreground">{value}</span>
  )
}

function ObservabilityContent() {
  const router = useRouter()
  const { scope } = useParams<{ scope: string }>()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { repos } = useRepos()
  const openWorkspaceSession = useSessionsStore((s) => s.openWorkspaceSession)

  const dateRangeSelection = useMemo<ActivityDateRangeSelection>(
    () => readActivityDateRangeSelection(searchParams),
    [searchParams]
  )

  const { preset: rangePreset, custom: { from: customFrom, to: customTo } } = dateRangeSelection
  const dateRange = useMemo(() => {
    const custom = { from: customFrom, to: customTo }
    if (isCustomRangeIncomplete({ preset: rangePreset, custom })) return {}
    return resolveActivityDateRange(
      rangePreset,
      custom
    )
  }, [rangePreset, customFrom, customTo])

  const { stats, error: statsError, refresh: refreshStats } = useObservabilityStats(dateRange)

  const {
    callFilters: legacyCallFilters,
    selectedCallId,
    clearSelectedCallId,
    setSelectedCallId,
  } = useObservabilityCallFilters()

  const [activityFilters, setActivityFilters] = useState<ActivityFilters>(() => ({
    ...INITIAL_FILTERS,
    repoId: legacyCallFilters.repoId,
    sandboxRecordId: legacyCallFilters.sandboxRecordId,
  }))

  const filters = useMemo<ActivityFilters>(() => ({
    ...activityFilters,
    repoId: legacyCallFilters.repoId,
    sandboxRecordId: legacyCallFilters.sandboxRecordId,
    from: dateRange.from,
    to: dateRange.to,
  }), [activityFilters, dateRange.from, dateRange.to, legacyCallFilters.repoId, legacyCallFilters.sandboxRecordId])

  const updateFilter = useCallback(
    <K extends keyof ActivityFilters>(key: K, value: ActivityFilters[K]) => {
      setActivityFilters((prev) => ({
        ...prev,
        [key]: value,
        page: key === "page" ? (value as number) : 1,
      }))
    },
    []
  )

  const { data, isLoading, error: activityError, refresh: refreshActivity } = useObservabilityActivity(filters)
  const calls = useMemo(() => data?.calls ?? [], [data?.calls])
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / filters.limit))

  // Terminal run views share the page-level date range. Pending runs are
  // current state, so their table view must remain unbounded just like the
  // pending/stale summary metrics above.
  const { jobFilters, updateJobFilter } = useObservabilityJobFilters()
  const isCurrentPendingView = jobFilters.status === "pending" || jobFilters.status === "awaiting_input" || jobFilters.status === "running"
  const jobsQuery = useMemo<JobsFilters>(() => ({
    ...jobFilters,
    from: isCurrentPendingView ? undefined : dateRange.from,
    to: isCurrentPendingView ? undefined : dateRange.to,
  }), [jobFilters, dateRange.from, dateRange.to, isCurrentPendingView])
  const { data: jobsData, isLoading: jobsLoading, error: jobsError, refresh: refreshJobs } = useObservabilityJobs(jobsQuery)
  const jobs = jobsData?.jobs ?? []
  const jobsTotal = jobsData?.total ?? 0
  const jobsPages = Math.max(1, Math.ceil(jobsTotal / jobFilters.limit))

  // Failures and Pressure share the page-level date range like Runs does,
  // so the summary outcomes above (failed, prevented, delayed, start failed)
  // and these tables describe the same window. Both reset to the first page
  // on a range change for the same reason as Runs.
  const { automationFailureFilters, updateAutomationFailureFilter } =
    useObservabilityAutomationFailureFilters()
  const failuresQuery = useMemo<AutomationFailuresFilters>(() => ({
    ...automationFailureFilters,
    from: dateRange.from,
    to: dateRange.to,
  }), [automationFailureFilters, dateRange.from, dateRange.to])
  const { data: failuresData, isLoading: failuresLoading, error: failuresError, refresh: refreshFailures } =
    useObservabilityAutomationFailures(failuresQuery)
  const failuresPages = Math.max(
    1,
    Math.ceil((failuresData?.total ?? 0) / automationFailureFilters.limit)
  )

  const { pressureFilters, updatePressureFilter } =
    useObservabilityAutomationEventFilters()
  const pressureQuery = useMemo<AutomationEventsFilters>(() => ({
    ...pressureFilters,
    from: dateRange.from,
    to: dateRange.to,
  }), [pressureFilters, dateRange.from, dateRange.to])
  const { data: pressureData, isLoading: pressureLoading, error: pressureError, refresh: refreshPressure } =
    useObservabilityAutomationEvents(pressureQuery)
  const pressureTotal = pressureData?.total ?? 0
  const pressurePages = Math.max(
    1,
    Math.ceil(pressureTotal / pressureFilters.limit)
  )
  // Call/sandbox/repo deep links (e.g. from Sandbox health) target the
  // Activity table, so they must land on its tab rather than the default.
  const viewToTab: Record<WorkView, TableTab> = { runs: "runs", attention: "failures", events: "pressure", usage: "activity" }
  const activeTable = viewToTab[readWorkView(new URLSearchParams(searchParams))]
  const setActiveTable = useCallback((tab: TableTab) => {
    const next = new URLSearchParams(searchParams)
    next.set("view", ({ runs: "runs", failures: "attention", pressure: "events", activity: "usage" } as const)[tab])
    router.replace(`${pathname}?${next}`, { scroll: false })
  }, [searchParams, router, pathname])
  // Focus runs as an effect because the target section only mounts after the
  // tab switch renders; the seq counter re-fires it when the tab is unchanged.
  const [tableFocusRequest, setTableFocusRequest] = useState<{
    tab: "runs" | "pressure"
    seq: number
  } | null>(null)
  useEffect(() => {
    if (!tableFocusRequest) return
    const section = document.getElementById(tableFocusRequest.tab)
    section?.scrollIntoView({ block: "start" })
    section?.focus({ preventScroll: true })
  }, [tableFocusRequest])
  const focusSection = useCallback((sectionId: "runs" | "pressure") => {
    setActiveTable(sectionId)
    setTableFocusRequest((prev) => ({ tab: sectionId, seq: (prev?.seq ?? 0) + 1 }))
  }, [setActiveTable])
  const inspectPressure = useCallback(
    (outcome: PressureOutcome) => {
      updatePressureFilter("outcome", outcome)
      focusSection("pressure")
    },
    [focusSection, updatePressureFilter]
  )
  const inspectRuns = useCallback(
    (target: RunDrilldown) => {
      const pending = target !== "failed"
      const next = writeWorkFilters(new URLSearchParams(searchParams), {
        ...jobFilters,
        status: pending ? "pending" : "failed",
        onlyRepairable: target === "repairable_pending" || undefined,
        page: 1,
      })
      next.set("view", "runs")
      router.replace(`${pathname}?${next}`, { scroll: false })
      setTableFocusRequest((prev) => ({ tab: "runs", seq: (prev?.seq ?? 0) + 1 }))
    },
    [jobFilters, pathname, router, searchParams]
  )
  const handleDateRangeChange = useCallback(
    (next: ActivityDateRangeSelection) => {
      // Reset every range-bound table in the same event so none requests a
      // stale page for the new, potentially smaller result window.
      updateFilter("page", 1)
      updateAutomationFailureFilter("page", 1)
      updatePressureFilter("page", 1)
      // Pass the scoped pathname: the builder's "/observability" default
      // depends on the proxy rescue redirect to recover the scope.
      const updated = new URLSearchParams(window.location.search)
      updated.delete("run_page")
      router.replace(buildActivityDateRangeHref(updated, next, pathname))
    },
    [
      pathname,
      router,
      updateAutomationFailureFilter,
      updateFilter,
      updatePressureFilter,
    ]
  )
  const [jobActionId, setJobActionId] = useState<string | null>(null)
  const [jobActionError, setJobActionError] = useState<{ id: string; message: string } | null>(null)
  const [actionReceipt, setActionReceipt] = useState<{ message: string; runId?: string } | null>(null)
  // One action in flight at a time: jobActionId only disables the acting
  // row's buttons, so without this guard a second job's action could start
  // and then be re-enabled mid-flight by the first action's cleanup.
  const jobActionInFlight = useRef(false)

  const runJobAction = useCallback(async (jobId: string, action: "repair" | "requeue" | "cancel") => {
    if (jobActionInFlight.current) return
    jobActionInFlight.current = true
    setJobActionId(jobId)
    setJobActionError(null)
    setActionReceipt(null)
    try {
      const res = await fetch(`/api/observability/jobs/${jobId}/${action}`, { method: "POST" })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        setJobActionError({ id: jobId, message: body?.error ?? `Failed to ${action} job run` })
        return
      }
      const result = await res.json().catch(() => null) as { started?: boolean; suppressed?: boolean; deferred?: boolean; jobRunId?: string } | null
      const message = result?.suppressed && !result.jobRunId ? "The request was accepted, but no new run was queued. Check automation events for the reason."
        : action === "cancel" ? "Cancellation requested. The run may take time to stop."
        : result?.started ? "The runtime accepted the start request. Follow the run for its result."
        : "Request accepted. Execution has not been confirmed; check the latest run state."
      setActionReceipt({ message, runId: typeof result?.jobRunId === "string" ? result.jobRunId : undefined })
      await refreshJobs()
    } catch (error) {
      console.error(`Failed to ${action} job run`, error)
      setJobActionError({ id: jobId, message: `Failed to ${action} job run` })
    } finally {
      jobActionInFlight.current = false
      setJobActionId(null)
    }
  }, [refreshJobs])

  const reposById = useMemo(
    () => new Map(repos.map((r) => [r.id, r])),
    [repos]
  )

  const expandedCallRowIds = useMemo(
    () => getExpandedCallRowIds(calls, {
      callId: selectedCallId,
      sandboxRecordId: filters.sandboxRecordId,
    }),
    [calls, filters.sandboxRecordId, selectedCallId]
  )

  const handleExpandedRowToggle = useCallback((call: AiCall, expanded: boolean) => {
    if (expanded) {
      setSelectedCallId(call.id)
    } else {
      clearSelectedCallId()
    }
  }, [clearSelectedCallId, setSelectedCallId])

  const handleOpenSandboxHealth = useCallback((call: AiCall) => {
    if (!call.sandbox_context) return
    navigateToSandboxHealth({
      scope,
      repoId: call.repo_id,
      sandboxRecordId: call.sandbox_context.sandbox_record_id,
      repos,
      openWorkspaceSession,
      router,
    })
  }, [openWorkspaceSession, repos, router, scope])

  const canOpenSandboxHealth = useCallback((call: AiCall) => {
    return Boolean(
      call.sandbox_context &&
      call.repo_id &&
      repos.some((r) => r.id === call.repo_id)
    )
  }, [repos])

  return (
    <div className="observability-work min-w-0 p-3 space-y-4 md:p-6 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="ui-page-title">Observability</h1>
          <p className="ui-page-subtitle">Follow the work, understand the outcome, and decide what happens next.</p>
        </div>
        <ActivityDateRangeFilter
          selection={dateRangeSelection}
          onChange={handleDateRangeChange}
        />
      </div>

      {statsError ? <LoadError subject="Automation health" onRetry={() => void refreshStats()} /> : <ObservabilitySummary
        summary={stats?.summary}
        rangePreset={dateRangeSelection.preset}
        onInspectPressure={inspectPressure}
        onInspectRuns={inspectRuns}
        showUsage={false}
      />}

      {actionReceipt && <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-4 text-sm"><p>{actionReceipt.message}</p>{actionReceipt.runId && <Button asChild variant="outline" size="sm"><Link href={`/${scope}/observability?view=runs&run_id=${encodeURIComponent(actionReceipt.runId)}`}>Inspect retry run</Link></Button>}</div>}

      <Tabs
        value={activeTable}
        onValueChange={(value) => setActiveTable(value as TableTab)}
        className="gap-3"
      >
        <TabsList className="h-auto max-w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="runs">
            Runs <TabCount value={jobsData?.total} />
          </TabsTrigger>
          <TabsTrigger value="failures">
            Needs attention
          </TabsTrigger>
          <TabsTrigger value="pressure">
            Automation events <TabCount value={pressureData?.total} />
          </TabsTrigger>
          <TabsTrigger value="activity">
            Usage <TabCount value={data?.total} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="runs">
          <RunsSection
            jobs={jobs}
            jobsLoading={jobsLoading}
            jobsTotal={jobsTotal}
            jobsPages={jobsPages}
            jobFilters={jobFilters}
            isCurrentPendingView={isCurrentPendingView}
            jobActionId={jobActionId}
            jobActionError={jobActionError?.id === searchParams.get("run_id") ? jobActionError.message : null}
            loadError={jobsError}
            onRefresh={() => void refreshJobs()}
            onUpdateJobFilter={updateJobFilter}
            onRunJobAction={runJobAction}
          />
        </TabsContent>

        <TabsContent value="failures">
          <div className="space-y-6">
          <PendingApprovalsSection showEmpty />
          <AttentionRuns status="awaiting_input" />
          <AttentionRuns />
          <details className="rounded-md border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">Failure history in selected dates{failuresData ? ` (${failuresData.total})` : ""}</summary>
          <p className="my-3 text-sm text-muted-foreground">Past failures and recovery attempts are history, not a count of unresolved problems.</p>
          {failuresError ? <LoadError subject="Failure history" onRetry={() => void refreshFailures()} /> : <AutomationFailuresSection
            data={failuresData}
            isLoading={failuresLoading}
            filters={automationFailureFilters}
            pages={failuresPages}
            onUpdateFilter={updateAutomationFailureFilter}
          />}
          </details>
          </div>
        </TabsContent>

        <TabsContent value="pressure">
          {pressureError ? <LoadError subject="Automation events" onRetry={() => void refreshPressure()} /> : <PressureSection
            pressureEvents={pressureData?.events ?? []}
            pressureLoading={pressureLoading}
            pressureTotal={pressureTotal}
            pressurePages={pressurePages}
            pressureFilters={pressureFilters}
            onUpdatePressureFilter={updatePressureFilter}
          />}
        </TabsContent>

        <TabsContent value="activity">
          <div className="space-y-6">
          {stats?.summary && <><UsageAndCost summary={stats.summary} rangeLabel="Selected dates" /><ReconciliationNotice pending={stats.summary.reconciliation_pending} /></>}
          {activityError ? <LoadError subject="AI activity" onRetry={() => void refreshActivity()} /> : <ActivitySection
            calls={calls}
            isLoading={isLoading}
            total={total}
            pages={pages}
            filters={filters}
            reposById={reposById}
            expandedCallRowIds={expandedCallRowIds ?? []}
            onUpdateFilter={updateFilter}
            onExpandedRowToggle={handleExpandedRowToggle}
            onOpenSandboxHealth={handleOpenSandboxHealth}
            canOpenSandboxHealth={canOpenSandboxHealth}
          />}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default function ObservabilityPage() {
  return (
    <Suspense fallback={<div className="p-4"><div className="ui-meta">Loading…</div></div>}>
      <ObservabilityContent />
    </Suspense>
  )
}
