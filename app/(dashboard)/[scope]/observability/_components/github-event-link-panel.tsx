"use client"

import { Button } from "@/components/ui/button"
import { resolveGithubObservabilityLink } from "@/lib/observability/github-links"

export function GithubEventLinkPanel({
  sourceType,
  repoFullName,
  metadata,
}: {
  sourceType: string | null | undefined
  repoFullName?: string | null
  metadata?: Record<string, unknown> | null
}) {
  const githubLink = resolveGithubObservabilityLink({
    sourceType,
    repoFullName,
    metadata,
  })

  if (!githubLink) return null

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card/50 p-3">
      <div className="min-w-0">
        <div className="ui-label mb-0.5">GitHub</div>
        <div className="truncate text-foreground">{githubLink.label}</div>
      </div>
      <Button asChild variant="outline" size="sm" className="h-7 shrink-0 text-xs">
        <a href={githubLink.href} target="_blank" rel="noopener noreferrer">
          Open in GitHub
        </a>
      </Button>
    </div>
  )
}
