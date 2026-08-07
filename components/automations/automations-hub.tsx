"use client"

import { useCallback, useMemo } from "react"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import useSWR from "swr"
import { ArrowRight, Play, Plus, Flash } from "iconoir-react"
import { scopedHref } from "@/lib/scoped-href"
import { fetchJsonArray, fetchJsonObject } from "@/lib/client-fetch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Assignment, Flow } from "@/lib/types"

type AutomationsTab = "workflows" | "maintainers" | "triggers" | "history"

const TAB_PATHS: Record<AutomationsTab, string> = {
  workflows: "/automations",
  maintainers: "/automations/maintainers",
  triggers: "/automations/triggers",
  history: "/automations/history",
}

function getTabFromPath(pathname: string): AutomationsTab {
  if (pathname.includes("/maintainers")) return "maintainers"
  if (pathname.includes("/triggers")) return "triggers"
  if (pathname.includes("/history")) return "history"
  return "workflows"
}

export function AutomationsHub() {
  const { scope } = useParams<{ scope: string }>()
  const pathname = usePathname()
  const currentTab = getTabFromPath(pathname)

  const href = useCallback(
    (path: string) => scopedHref(scope, path),
    [scope]
  )

  return (
    <div className="p-3 space-y-4 md:p-4 md:space-y-6">
      <div>
        <h1 className="ui-page-title">Automations</h1>
        <p className="ui-page-subtitle">
          Deterministic workflows, persistent maintainers, and execution history.
        </p>
      </div>

      <Tabs value={currentTab} className="gap-4 md:gap-6">
        <TabsList className="h-8 inline-flex w-max bg-transparent p-0 gap-1">
          <TabsTrigger value="workflows" asChild className="px-3 h-7 text-[13px]">
            <Link href={href(TAB_PATHS.workflows)}>Workflows</Link>
          </TabsTrigger>
          <TabsTrigger value="maintainers" asChild className="px-3 h-7 text-[13px]">
            <Link href={href(TAB_PATHS.maintainers)}>Maintainers</Link>
          </TabsTrigger>
          <TabsTrigger value="triggers" asChild className="px-3 h-7 text-[13px]">
            <Link href={href(TAB_PATHS.triggers)}>Triggers</Link>
          </TabsTrigger>
          <TabsTrigger value="history" asChild className="px-3 h-7 text-[13px]">
            <Link href={href(TAB_PATHS.history)}>History</Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="workflows" className="mt-0">
          <WorkflowsTab />
        </TabsContent>

        <TabsContent value="maintainers" className="mt-0">
          <MaintainersTab />
        </TabsContent>

        <TabsContent value="triggers" className="mt-0">
          <TriggersTab />
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <HistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function WorkflowsTab() {
  const { scope } = useParams<{ scope: string }>()

  const { data: flowsData, isLoading } = useSWR<{ flows: Flow[] }>(
    "/api/flows",
    (url: string) => fetchJsonObject<{ flows: Flow[] }>(url, "Failed to load workflows"),
    { revalidateOnFocus: false }
  )

  const flows = flowsData?.flows ?? []
  const enabledFlows = flows.filter(f => f.status === "active")

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="ui-kicker">WORKFLOWS</div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Deterministic graphs of triggers, conditions, agent tasks, checks, and deploys.
          </p>
        </div>
        <Link
          href={scopedHref(scope, "/workflows")}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-md"
        >
          <Flash className="size-4" />
          Open workflow editor
        </Link>
      </div>

      {isLoading ? (
        <div className="ui-meta">Loading workflows...</div>
      ) : flows.length === 0 ? (
        <div className="border border-border rounded-md bg-card p-6 text-center">
          <div className="mx-auto mb-3 size-10 rounded-full bg-muted flex items-center justify-center">
            <Flash className="size-5 text-muted-foreground" />
          </div>
          <div className="text-sm font-medium text-foreground">No workflows yet</div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Create your first workflow to automate agent tasks, reviews, and deployments.
          </p>
          <Link
            href={scopedHref(scope, "/workflows")}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-md"
          >
            <Plus className="size-4" />
            Create workflow
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>{flows.length} workflow{flows.length === 1 ? "" : "s"}</span>
            <span className="text-border">|</span>
            <span>{enabledFlows.length} enabled</span>
          </div>

          <div className="border border-border rounded-md divide-y divide-border bg-card">
            {flows.slice(0, 5).map(flow => (
              <div
                key={flow.id}
                className="px-4 py-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`size-2 rounded-full shrink-0 ${
                        flow.status === "active" ? "bg-accent-green" : "bg-muted-foreground"
                      }`}
                    />
                    <span className="text-sm font-medium text-foreground truncate">
                      {flow.name}
                    </span>
                    {flow.source_kind && (
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {flow.source_kind}
                      </Badge>
                    )}
                  </div>
                  {flow.description && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                      {flow.description}
                    </p>
                  )}
                </div>
                <Link
                  href={scopedHref(scope, `/workflows?flow=${flow.id}`)}
                  className="text-[11px] text-accent-blue hover:underline shrink-0"
                >
                  Edit
                </Link>
              </div>
            ))}
          </div>

          {flows.length > 5 && (
            <Link
              href={scopedHref(scope, "/workflows")}
              className="inline-flex items-center gap-1 text-[11px] text-accent-blue hover:underline"
            >
              View all {flows.length} workflows
              <ArrowRight className="size-3" />
            </Link>
          )}
        </div>
      )}

      <div className="border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-foreground">Triggers</div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Events and schedules that start workflows and maintainers.
            </p>
          </div>
          <Link
            href={scopedHref(scope, "/triggers")}
            className="inline-flex items-center gap-1 text-[11px] text-accent-blue hover:underline"
          >
            Manage triggers
            <ArrowRight className="size-3" />
          </Link>
        </div>
      </div>
    </div>
  )
}

function MaintainersTab() {
  const { scope } = useParams<{ scope: string }>()

  const { data: assignments, isLoading } = useSWR<Assignment[]>(
    "/api/assignments",
    (url: string) => fetchJsonArray<Assignment>(url, "Failed to load assignments"),
    { revalidateOnFocus: false }
  )

  const maintainers = useMemo(() => {
    if (!assignments) return []
    return assignments.filter(a => a.type === "cron" || a.type === "cron_refactor")
  }, [assignments])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="ui-kicker">MAINTAINERS</div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Persistent agents with a standing goal that evaluate on a cadence or trigger.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled className="gap-1.5">
          <Plus className="size-4" />
          New maintainer
        </Button>
      </div>

      {isLoading ? (
        <div className="ui-meta">Loading maintainers...</div>
      ) : maintainers.length === 0 ? (
        <div className="border border-border rounded-md bg-card p-6 text-center">
          <div className="mx-auto mb-3 size-10 rounded-full bg-muted flex items-center justify-center">
            <Play className="size-5 text-muted-foreground" />
          </div>
          <div className="text-sm font-medium text-foreground">No maintainers yet</div>
          <p className="mt-1 text-[13px] text-muted-foreground max-w-md mx-auto">
            Maintainers are durable agents with a standing goal. Examples: dependency warden,
            flaky-test hunter, latency guardian. They evaluate on a cadence and open missions
            when their trigger conditions match.
          </p>
          <Button variant="outline" size="sm" disabled className="mt-4 gap-1.5">
            <Plus className="size-4" />
            Create maintainer
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {maintainers.map(m => (
            <MaintainerCard key={m.id} maintainer={m} />
          ))}
        </div>
      )}

      <div className="border border-dashed border-border rounded-md bg-muted/30 px-4 py-3">
        <div className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Note:</span> The legacy assignments
          system is being replaced by maintainers. View existing assignments at{" "}
          <Link
            href={scopedHref(scope, "/assignments")}
            className="text-accent-blue hover:underline"
          >
            /assignments
          </Link>
          .
        </div>
      </div>
    </div>
  )
}

function MaintainerCard({ maintainer }: { maintainer: Assignment }) {
  const healthColor = maintainer.last_run_status === "success"
    ? "bg-accent-green"
    : maintainer.last_run_status === "failed"
      ? "bg-accent-red"
      : "bg-muted-foreground"

  const healthLabel = maintainer.last_run_status === "success"
    ? "HEALTHY"
    : maintainer.last_run_status === "failed"
      ? "FAILED"
      : "UNKNOWN"

  return (
    <div className="border border-border rounded-md bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`size-2 rounded-full shrink-0 ${healthColor}`} />
            <span className="text-sm font-medium text-foreground truncate">
              {maintainer.type?.replace(/_/g, " ") || "Maintainer"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {maintainer.cron_schedule || "On-demand evaluation"}
          </p>
        </div>
        <Badge
          variant="outline"
          className={`text-[10px] shrink-0 ${
            healthLabel === "HEALTHY"
              ? "text-accent-green border-accent-green/20 bg-accent-green/[0.06]"
              : healthLabel === "FAILED"
                ? "text-accent-red border-accent-red/20 bg-accent-red/[0.06]"
                : ""
          }`}
        >
          {healthLabel}
        </Badge>
      </div>

      <div className="space-y-1.5 text-[11px]">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground font-mono">Cadence</span>
          <span className="text-foreground font-mono">
            {maintainer.cron_schedule || "manual"}
          </span>
        </div>
        {maintainer.last_run_started_at && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground font-mono">Last run</span>
            <span className="text-foreground font-mono">
              {new Date(maintainer.last_run_started_at).toLocaleDateString()}
            </span>
          </div>
        )}
        {typeof maintainer.running_count === "number" && maintainer.running_count > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground font-mono">Running</span>
            <span className="text-accent-blue font-mono">{maintainer.running_count}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button variant="outline" size="sm" disabled className="h-7 text-[11px]">
          Run now
        </Button>
        <Button variant="outline" size="sm" disabled className="h-7 text-[11px]">
          Configure
        </Button>
      </div>
    </div>
  )
}

function TriggersTab() {
  const { scope } = useParams<{ scope: string }>()

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="ui-kicker">TRIGGERS</div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Events, schedules, signals, and webhooks that start workflows and maintainers.
          </p>
        </div>
        <Link
          href={scopedHref(scope, "/triggers")}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-md"
        >
          Manage triggers
        </Link>
      </div>

      <div className="border border-border rounded-md bg-card p-4">
        <p className="text-[13px] text-muted-foreground">
          Triggers are managed in the dedicated triggers page. They are shared across
          workflows and maintainers.
        </p>
        <Link
          href={scopedHref(scope, "/triggers")}
          className="mt-3 inline-flex items-center gap-1 text-[11px] text-accent-blue hover:underline"
        >
          Open triggers page
          <ArrowRight className="size-3" />
        </Link>
      </div>
    </div>
  )
}

function HistoryTab() {
  const { scope } = useParams<{ scope: string }>()

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="ui-kicker">EXECUTION HISTORY</div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            History of automation runs with result, duration, cost, and output.
          </p>
        </div>
        <Link
          href={scopedHref(scope, "/observability")}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-md hover:bg-secondary"
        >
          Open in Observe
        </Link>
      </div>

      <div className="border border-border rounded-md bg-card p-6 text-center">
        <p className="text-[13px] text-muted-foreground">
          Execution history is available in the Observability dashboard. View runs,
          traces, activity, and costs in one place.
        </p>
        <Link
          href={scopedHref(scope, "/observability")}
          className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-md"
        >
          View execution history
          <ArrowRight className="size-4" />
        </Link>
      </div>
    </div>
  )
}
