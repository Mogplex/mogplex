"use client"
import { useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { RepoDashboard } from "@/components/repo-dashboard"
import { scopedHref } from "@/lib/scoped-href"
import type { Repo } from "@/lib/types"
import { trackActivation } from "@/lib/activation-tracking"

export default function RepositoriesPage() {
  const router = useRouter()
  const { scope } = useParams<{ scope: string }>()

  const handleOpenChat = useCallback((repo: Repo) => {
    trackActivation("workspace_opened", { source: "spaces_page", repo_id: repo.id, repo_full_name: repo.full_name, preview_state: "not_requested" })
    router.push(scopedHref(scope, `/control?repo=${encodeURIComponent(repo.id)}`))
  }, [router, scope])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <RepoDashboard onOpenChat={handleOpenChat} />
    </div>
  )
}
