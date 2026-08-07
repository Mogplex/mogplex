"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import useSWR from "swr"
import { GitBranch, GitCommit, Packages, Rocket } from "iconoir-react"
import { scopedHref } from "@/lib/scoped-href"
import { fetchJsonObject } from "@/lib/client-fetch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { useRepos } from "@/hooks/use-repos"

type DeliveryTab = "queue" | "pulls" | "deployments" | "releases"

type PullRequest = {
  number: number
  title: string
  state: string
  html_url: string
  user: { login: string }
  additions: number
  deletions: number
  changed_files: number
}

type PullsResponse = {
  pulls: PullRequest[]
  diff: string | null
}

export function DeliveryHub() {
  const { scope } = useParams<{ scope: string }>()
  const searchParams = useSearchParams()
  const tabParam = searchParams?.get("tab") ?? "queue"
  const currentTab = ["queue", "pulls", "deployments", "releases"].includes(tabParam)
    ? (tabParam as DeliveryTab)
    : "queue"

  const href = useCallback(
    (path: string) => scopedHref(scope, path),
    [scope]
  )

  return (
    <div className="p-3 space-y-4 md:p-4 md:space-y-6">
      <div>
        <h1 className="ui-page-title">Delivery</h1>
        <p className="ui-page-subtitle">
          Agent output on its way to production. Integration queue, PRs, deployments, and releases.
        </p>
      </div>

      <Tabs value={currentTab} className="gap-4 md:gap-6">
        <TabsList className="h-8 inline-flex w-max bg-transparent p-0 gap-1">
          <TabsTrigger value="queue" asChild className="px-3 h-7 text-[13px]">
            <Link href={href("/delivery?tab=queue")}>Queue</Link>
          </TabsTrigger>
          <TabsTrigger value="pulls" asChild className="px-3 h-7 text-[13px]">
            <Link href={href("/delivery?tab=pulls")}>Pull requests</Link>
          </TabsTrigger>
          <TabsTrigger value="deployments" asChild className="px-3 h-7 text-[13px]">
            <Link href={href("/delivery?tab=deployments")}>Deployments</Link>
          </TabsTrigger>
          <TabsTrigger value="releases" asChild className="px-3 h-7 text-[13px]">
            <Link href={href("/delivery?tab=releases")}>Releases</Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-0">
          <QueueTab />
        </TabsContent>

        <TabsContent value="pulls" className="mt-0">
          <PullRequestsTab />
        </TabsContent>

        <TabsContent value="deployments" className="mt-0">
          <DeploymentsTab />
        </TabsContent>

        <TabsContent value="releases" className="mt-0">
          <ReleasesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function QueueTab() {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="ui-kicker">INTEGRATION QUEUE</div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Changes awaiting review, approval, and merge.
          </p>
        </div>
      </div>

      <div className="border border-border rounded-md bg-card p-6 text-center">
        <div className="mx-auto mb-3 size-10 rounded-full bg-muted flex items-center justify-center">
          <GitBranch className="size-5 text-muted-foreground" />
        </div>
        <div className="text-sm font-medium text-foreground">No changes queued</div>
        <p className="mt-1 text-[13px] text-muted-foreground max-w-md mx-auto">
          Change sets from agent worktrees appear here when ready for review and merge.
          The queue orders changes by readiness, with blocked items surfaced first.
        </p>
      </div>

      <div className="border border-dashed border-border rounded-md bg-muted/30 px-4 py-3">
        <div className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Integration queue structure:</span>{" "}
          Changes move through draft, queued, approved, merged, and deployed states.
          Conflicts and failed checks block progress until resolved.
        </div>
      </div>
    </div>
  )
}

function PullRequestsTab() {
  const { repos, isLoading: reposLoading } = useRepos()
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null)

  const repoId = selectedRepoId ?? repos[0]?.id

  const { data, isLoading } = useSWR<PullsResponse>(
    repoId ? `/api/github/pulls?repo_id=${repoId}` : null,
    (url: string) => fetchJsonObject<PullsResponse>(url, "Failed to load pull requests"),
    { revalidateOnFocus: false }
  )

  const pulls = data?.pulls ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="ui-kicker">PULL REQUESTS</div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Open pull requests across your connected repositories.
          </p>
        </div>
        {repos.length > 1 && (
          <select
            value={selectedRepoId ?? ""}
            onChange={e => setSelectedRepoId(e.target.value || null)}
            className="border border-border bg-input px-2 py-1 text-[11px] rounded-md"
          >
            {repos.map(repo => (
              <option key={repo.id} value={repo.id}>
                {repo.full_name}
              </option>
            ))}
          </select>
        )}
      </div>

      {reposLoading || isLoading ? (
        <div className="ui-meta">Loading pull requests...</div>
      ) : repos.length === 0 ? (
        <div className="border border-border rounded-md bg-card p-6 text-center">
          <div className="mx-auto mb-3 size-10 rounded-full bg-muted flex items-center justify-center">
            <GitCommit className="size-5 text-muted-foreground" />
          </div>
          <div className="text-sm font-medium text-foreground">No repositories connected</div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Connect a repository to see pull requests.
          </p>
        </div>
      ) : pulls.length === 0 ? (
        <div className="border border-border rounded-md bg-card p-6 text-center">
          <div className="mx-auto mb-3 size-10 rounded-full bg-muted flex items-center justify-center">
            <GitCommit className="size-5 text-muted-foreground" />
          </div>
          <div className="text-sm font-medium text-foreground">No open pull requests</div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Pull requests opened by agents or humans will appear here.
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-md divide-y divide-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-2 text-left font-medium">PR</th>
                <th className="px-4 py-2 text-left font-medium">Title</th>
                <th className="px-4 py-2 text-left font-medium">Author</th>
                <th className="px-4 py-2 text-right font-medium">Changes</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pulls.map(pr => (
                <tr
                  key={pr.number}
                  className="border-b border-border/40 hover:bg-secondary/50"
                >
                  <td className="px-4 py-2">
                    <span className="font-mono text-brand-accent">
                      #{pr.number}
                    </span>
                  </td>
                  <td className="px-4 py-2 max-w-xs truncate">
                    {pr.title}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px]">{pr.user.login}</span>
                      {pr.user.login.includes("bot") || pr.user.login.includes("[bot]") ? (
                        <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-400/20 bg-purple-400/[0.06]">
                          agent
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          human
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className="font-mono text-[11px]">
                      <span className="text-accent-green">+{pr.additions}</span>
                      {" "}
                      <span className="text-accent-red">-{pr.deletions}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <a
                      href={pr.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-accent-blue hover:underline"
                    >
                      View on GitHub
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function DeploymentsTab() {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="ui-kicker">DEPLOYMENTS</div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Live and past rollouts with progress and rollback controls.
          </p>
        </div>
      </div>

      <div className="border border-border rounded-md bg-card p-6 text-center">
        <div className="mx-auto mb-3 size-10 rounded-full bg-muted flex items-center justify-center">
          <Rocket className="size-5 text-muted-foreground" />
        </div>
        <div className="text-sm font-medium text-foreground">No deployments yet</div>
        <p className="mt-1 text-[13px] text-muted-foreground max-w-md mx-auto">
          Deployments track promoted artifacts across preview, staging, and production
          environments. Rollout progress, health checks, and rollback controls appear here.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <EnvironmentCard name="Preview" status="empty" />
        <EnvironmentCard name="Staging" status="empty" />
        <EnvironmentCard name="Production" status="empty" />
      </div>
    </div>
  )
}

function EnvironmentCard({
  name,
  status,
}: {
  name: string
  status: "healthy" | "degraded" | "empty"
}) {
  const statusColor = status === "healthy"
    ? "bg-accent-green"
    : status === "degraded"
      ? "bg-accent-amber"
      : "bg-muted-foreground"

  return (
    <div className="border border-border rounded-md bg-card p-4">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${statusColor}`} />
        <span className="text-sm font-medium text-foreground">{name}</span>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {status === "empty" ? "Nothing deployed" : `Last deploy: —`}
      </p>
    </div>
  )
}

function ReleasesTab() {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="ui-kicker">RELEASES</div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Tagged, versioned bundles of merged changes prepared for promotion.
          </p>
        </div>
      </div>

      <div className="border border-border rounded-md bg-card p-6 text-center">
        <div className="mx-auto mb-3 size-10 rounded-full bg-muted flex items-center justify-center">
          <Packages className="size-5 text-muted-foreground" />
        </div>
        <div className="text-sm font-medium text-foreground">No releases yet</div>
        <p className="mt-1 text-[13px] text-muted-foreground max-w-md mx-auto">
          Releases bundle merged change sets into versioned packages. They track
          what went into each deployment and support coordinated rollbacks.
        </p>
      </div>
    </div>
  )
}
