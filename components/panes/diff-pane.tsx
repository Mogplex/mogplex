"use client"
import { useState } from "react"
import useSWR from "swr"
import { PatchViewer } from "@/components/diffs/patch-viewer"
import { useRealtimeRouteRefresh } from "@/hooks/use-realtime-route-refresh"

const fetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`API error: ${r.status}`)
  return r.json()
}

interface PullRequest {
  number: number
  title: string
  state: string
  html_url: string
  user: { login: string }
  additions?: number
  deletions?: number
  changed_files?: number
}

interface PullsResponse {
  pulls: PullRequest[]
  diff: string | null
}

export function DiffPane() {
  const [selectedPr, setSelectedPr] = useState<number | null>(null)

  const { data: listData, isLoading: listLoading, mutate: mutatePullList } = useSWR<PullsResponse>(
    "/api/github/pulls",
    fetcher,
  )

  const activePrNumber = selectedPr ?? listData?.pulls?.[0]?.number ?? null

  const { data: prData, mutate: mutateSelectedPr } = useSWR<PullsResponse>(
    selectedPr && listData ? `/api/github/pulls?pr=${selectedPr}` : null,
    fetcher
  )

  useRealtimeRouteRefresh({
    channelName: "diff-pane-pulls",
    specs: [
      { table: "repos", filter: "user_id=eq.$USER_ID" },
    ],
    onInvalidate: async () => {
      await mutatePullList()
      if (selectedPr && listData) {
        await mutateSelectedPr()
      }
    },
  })

  const data = selectedPr ? prData : listData

  if (listLoading) {
    return <div className="flex-1 p-3 text-sm text-muted-foreground">Loading...</div>
  }

  const pulls = listData?.pulls || []

  if (pulls.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 text-sm text-muted-foreground">
        No open pull requests
      </div>
    )
  }

  const activePR = pulls.find(p => p.number === activePrNumber) || pulls[0]
  const diff = data?.diff ?? null

  return (
    <div className="flex flex-col h-full">
      {/* PR selector */}
      {pulls.length > 1 && (
        <div className="flex items-center gap-1 px-3 h-7 border-b border-border-dim overflow-x-auto">
          {pulls.map(pr => (
            <button
              key={pr.number}
              onClick={() => setSelectedPr(pr.number)}
              className={`shrink-0 px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                pr.number === activePrNumber
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-secondary-foreground hover:bg-muted"
              }`}
            >
              #{pr.number}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 px-3 h-7 border-b border-border-dim text-[11px]">
        <span className="text-accent-blue">#{activePR.number}</span>
        <span className="text-foreground truncate flex-1">{activePR.title}</span>
        <span className="text-muted-foreground">{activePR.user.login}</span>
        <button
          onClick={() => {
            void mutatePullList()
            if (selectedPr && listData) {
              void mutateSelectedPr()
            }
          }}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh pull requests"
        >
          refresh
        </button>
        <a
          href={activePR.html_url}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Open pull request on GitHub"
        >
          open
        </a>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {!diff && (
          <div className="p-3 text-sm text-muted-foreground">No diff available</div>
        )}
        {diff && <PatchViewer patch={diff} className="my-0" />}
      </div>
    </div>
  )
}
