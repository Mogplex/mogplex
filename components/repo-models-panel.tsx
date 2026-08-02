"use client"

import { useState } from "react"
import useSWR from "swr"
import type { Repo } from "@/lib/types"
import { toast } from "@/hooks/use-toast"

type ResolvedModel = {
  id: string
  provider: string
  name: string
  context_length: number | null
  is_available: boolean
  is_enabled: boolean
}

type RepoModelOverride = {
  model_id: string
  excluded: boolean
}

type RepoPayload = { models: ResolvedModel[]; overrides: RepoModelOverride[] }

type CatalogModel = {
  id: string
  provider: string
  name: string
  is_enabled: boolean
  is_hidden?: boolean | null
}

type CatalogPayload = { catalog: CatalogModel[] }

interface Props {
  repo: Repo
}

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load (${res.status})`)
  return res.json() as Promise<T>
}

export function RepoModelsPanel({ repo }: Props) {
  const repoKey = `/api/repos/${repo.id}/models`
  const { data: repoData, error: repoErr, isLoading, mutate } = useSWR<RepoPayload>(
    repoKey,
    fetcher
  )
  const { data: catalogData } = useSWR<CatalogPayload>("/api/models", fetcher)

  const [busy, setBusy] = useState<string | null>(null)

  const resolved = repoData?.models ?? []
  const overrides = repoData?.overrides ?? []
  const excludedIds = overrides.filter((o) => o.excluded).map((o) => o.model_id)

  const catalog = catalogData?.catalog ?? []
  const catalogById = new Map(catalog.map((m) => [m.id, m]))

  const setExclusion = async (modelId: string, excluded: boolean) => {
    setBusy(modelId)
    try {
      const res = await fetch(repoKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: modelId, excluded }),
      })
      if (!res.ok) throw new Error(await res.text())
      await mutate()
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Could not update",
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="text-[11px] leading-5 text-muted-foreground">
        Models you&apos;ve enabled in your global preferences appear here. Excluding one only
        affects this space — the model stays available everywhere else.
      </div>

      {repoErr && (
        <div className="border border-destructive px-2 py-1.5 text-[11px] text-destructive">
          {repoErr instanceof Error ? repoErr.message : "Failed to load"}
        </div>
      )}

      {isLoading ? (
        <div className="ui-meta py-4 text-center">Loading...</div>
      ) : (
        <>
          <section className="space-y-1">
            <div className="ui-label">Active for this space ({resolved.length})</div>
            {resolved.length === 0 ? (
              <div className="ui-meta py-2">
                No models active. Enable some in{" "}
                <span className="font-mono">/settings</span> first.
              </div>
            ) : (
              <div className="space-y-1">
                {resolved.map((m) => (
                  <div
                    key={m.id}
                    className="group flex items-center justify-between border border-border px-2 py-1.5 focus-within:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-foreground truncate">
                        <span className="text-muted-foreground">{m.provider}</span> · {m.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">
                        {m.id}
                      </div>
                    </div>
                    <button
                      onClick={() => setExclusion(m.id, true)}
                      disabled={busy === m.id}
                      aria-label={`Exclude ${m.provider} ${m.name} from this space`}
                      className="text-[11px] text-muted-foreground hover:text-destructive opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring disabled:opacity-40"
                    >
                      {busy === m.id ? "..." : "Exclude"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {excludedIds.length > 0 && (
            <section className="space-y-1 border-t border-border pt-3">
              <div className="ui-label">Excluded for this space ({excludedIds.length})</div>
              <div className="space-y-1">
                {excludedIds.map((id) => {
                  const meta = catalogById.get(id)
                  const label = meta ? `${meta.provider} · ${meta.name}` : id
                  return (
                    <div
                      key={id}
                      className="group flex items-center justify-between border border-dashed border-border/60 px-2 py-1.5 opacity-60 focus-within:opacity-100"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-muted-foreground truncate">{label}</div>
                        <div className="text-[11px] text-muted-foreground font-mono truncate">
                          {id}
                        </div>
                      </div>
                      <button
                        onClick={() => setExclusion(id, false)}
                        disabled={busy === id}
                        aria-label={`Re-include ${label} in this space`}
                        className="text-[11px] text-accent-blue hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring disabled:opacity-40"
                      >
                        {busy === id ? "..." : "Re-include"}
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
