"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation"
import { useObservabilityActivity, type ActivityFilters } from "@/hooks/use-observability-activity"
import { useObservabilityJobs, useObservabilityStats, type JobsFilters } from "@/hooks/use-observability"
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
import type { AiCall } from "@/lib/types"
import { ActivityDateRangeFilter } from "./_components/activity-date-range-filter"
import { ActivitySection } from "./_components/activity-section"
import { ObservabilitySummary } from "./_components/observability-summary"
import { PendingApprovalsSection } from "./_components/pending-approvals-section"
import { RunsSection } from "./_components/runs-section"

const INITIAL_FILTERS: ActivityFilters = {
  page: 1,
  limit: 50,
  sort: "started_at",
  order: "desc",
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

  const dateRange = useMemo(() => {
    if (isCustomRangeIncomplete(dateRangeSelection)) return {}
    return resolveActivityDateRange(
      dateRangeSelection.preset,
      dateRangeSelection.custom
    )
  }, [dateRangeSelection])

  const { stats } = useObservabilityStats(dateRange)

  const handleDateRangeChange = useCallback(
    (next: ActivityDateRangeSelection) => {
      // Pass the scoped pathname: the builder's "/observability" default
      // depends on the proxy rescue redirect to recover the scope.
      router.replace(buildActivityDateRangeHref(searchParams, next, pathname))
    },
    [pathname, router, searchParams]
  )

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

  const { data, isLoading } = useObservabilityActivity(filters)
  const calls = useMemo(() => data?.calls ?? [], [data?.calls])
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / filters.limit))

  // Runs share the page-level date range, so the run-based cards above
  // (Failed, Start Failed, Run Success) and this table describe the same
  // window — a run that failed before making a model call has no Activity
  // row, and is only visible here.
  const { jobFilters, updateJobFilter } = useObservabilityJobFilters()
  // A range change shrinks or grows the result set, so a page index deep in
  // the old window can land on an empty page — reset to the first page.
  useEffect(() => {
    updateJobFilter("page", 1)
  }, [dateRange.from, dateRange.to, updateJobFilter])
  const jobsQuery = useMemo<JobsFilters>(() => ({
    ...jobFilters,
    from: dateRange.from,
    to: dateRange.to,
  }), [jobFilters, dateRange.from, dateRange.to])
  const { data: jobsData, isLoading: jobsLoading, refresh: refreshJobs } = useObservabilityJobs(jobsQuery)
  const jobs = jobsData?.jobs ?? []
  const jobsTotal = jobsData?.total ?? 0
  const jobsPages = Math.max(1, Math.ceil(jobsTotal / jobFilters.limit))
  const [jobActionId, setJobActionId] = useState<string | null>(null)
  // One action in flight at a time: jobActionId only disables the acting
  // row's buttons, so without this guard a second job's action could start
  // and then be re-enabled mid-flight by the first action's cleanup.
  const jobActionInFlight = useRef(false)

  const runJobAction = useCallback(async (jobId: string, action: "repair" | "requeue" | "cancel") => {
    if (jobActionInFlight.current) return
    jobActionInFlight.current = true
    setJobActionId(jobId)
    try {
      const res = await fetch(`/api/observability/jobs/${jobId}/${action}`, { method: "POST" })
      if (res.ok) {
        await refreshJobs()
      }
    } catch (error) {
      console.error(`Failed to ${action} job run`, error)
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
    <div className="p-3 space-y-4 md:p-4 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="ui-page-title">Observability</h1>
          <p className="ui-page-subtitle">Model activity across CLI, cloud, and automation — with tokens and cost.</p>
        </div>
        <ActivityDateRangeFilter
          selection={dateRangeSelection}
          onChange={handleDateRangeChange}
        />
      </div>

      <ObservabilitySummary
        summary={stats?.summary}
        rangePreset={dateRangeSelection.preset}
      />

      <PendingApprovalsSection />

      <RunsSection
        jobs={jobs}
        jobsLoading={jobsLoading}
        jobsTotal={jobsTotal}
        jobsPages={jobsPages}
        jobFilters={jobFilters}
        jobActionId={jobActionId}
        onUpdateJobFilter={updateJobFilter}
        onRunJobAction={runJobAction}
      />

      <ActivitySection
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
      />
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
