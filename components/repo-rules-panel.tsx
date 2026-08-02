"use client"

import { useState } from "react"
import useSWR from "swr"
import type { Repo } from "@/lib/types"
import { toast } from "@/hooks/use-toast"

type ResolvedRule = {
  // For source==="global" this is the global rule id.
  // For source==="repo" this is the repo_rule_overrides row id (also the overrideId for DELETE).
  id: string
  name: string
  content_preview: string
  source: "global" | "repo"
}

type ExcludedInherited = {
  id: string
  name: string
  content_preview: string
}

type Payload = {
  rules: ResolvedRule[]
  excluded_inherited?: ExcludedInherited[]
}

interface Props {
  repo: Repo
}

const fetcher = async (url: string): Promise<Payload> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load (${res.status})`)
  return res.json()
}

export function RepoRulesPanel({ repo }: Props) {
  const key = `/api/repos/${repo.id}/rules`
  const { data, error, isLoading, mutate } = useSWR<Payload>(key, fetcher)
  const [busy, setBusy] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [draftName, setDraftName] = useState("")
  const [draftContent, setDraftContent] = useState("")

  const rules = data?.rules ?? []
  const excludedInherited = data?.excluded_inherited ?? []
  const inherited = rules.filter((r) => r.source === "global")
  const repoOnly = rules.filter((r) => r.source === "repo")

  const setExclusion = async (ruleId: string, excluded: boolean) => {
    setBusy(`g:${ruleId}`)
    try {
      const res = await fetch(key, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule_id: ruleId, excluded }),
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

  // overrideId comes from a repo-only ResolvedRule.id, which the API maps
  // from repo_rule_overrides.id (see GET handler). DO NOT pass a global
  // rule's id here — there will be no override row to delete.
  const removeRepoOnly = async (overrideId: string) => {
    setBusy(`r:${overrideId}`)
    try {
      const res = await fetch(`${key}?overrideId=${overrideId}`, { method: "DELETE" })
      if (!res.ok) throw new Error(await res.text())
      await mutate()
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Could not delete",
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  const addRepoOnly = async () => {
    if (!draftName.trim() || !draftContent.trim()) return
    setBusy("new")
    try {
      const res = await fetch(key, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draftName.trim(), content: draftContent }),
      })
      if (!res.ok) throw new Error(await res.text())
      setDraftName("")
      setDraftContent("")
      setShowNew(false)
      await mutate()
    } catch (err) {
      toast({
        title: "Create failed",
        description: err instanceof Error ? err.message : "Could not create",
        variant: "destructive",
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="text-[11px] leading-5 text-muted-foreground">
        Inherited rules come from your global library at{" "}
        <span className="font-mono">/agents/rules</span>. Excluding one only affects this space.
      </div>

      {error && (
        <div className="border border-destructive px-2 py-1.5 text-[11px] text-destructive">
          {error instanceof Error ? error.message : "Failed to load"}
        </div>
      )}

      {isLoading ? (
        <div className="ui-meta py-4 text-center">Loading...</div>
      ) : (
        <>
          <section className="space-y-1">
            <div className="ui-label">Inherited from global</div>
            {inherited.length === 0 && excludedInherited.length === 0 ? (
              <div className="ui-meta py-2">No global rules yet.</div>
            ) : (
              <div className="space-y-1">
                {inherited.map((r) => (
                  <div
                    key={r.id}
                    className="group flex items-center justify-between border border-border px-2 py-1.5 focus-within:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-foreground truncate">{r.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {r.content_preview}
                      </div>
                    </div>
                    <button
                      onClick={() => setExclusion(r.id, true)}
                      disabled={busy === `g:${r.id}`}
                      aria-label={`Exclude ${r.name} from this space`}
                      className="text-[11px] text-muted-foreground hover:text-destructive opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring disabled:opacity-40"
                    >
                      {busy === `g:${r.id}` ? "..." : "Exclude"}
                    </button>
                  </div>
                ))}
                {excludedInherited.map((r) => (
                  <div
                    key={r.id}
                    className="group flex items-center justify-between border border-dashed border-border/60 px-2 py-1.5 opacity-60 focus-within:opacity-100"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-muted-foreground truncate">
                        Excluded · {r.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {r.content_preview}
                      </div>
                    </div>
                    <button
                      onClick={() => setExclusion(r.id, false)}
                      disabled={busy === `g:${r.id}`}
                      aria-label={`Re-include ${r.name} in this space`}
                      className="text-[11px] text-accent-blue hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring disabled:opacity-40"
                    >
                      {busy === `g:${r.id}` ? "..." : "Re-include"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-1 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <div className="ui-label">Repo-only</div>
              {!showNew && (
                <button
                  onClick={() => setShowNew(true)}
                  className="text-[11px] text-accent-blue hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
                >
                  + Add repo rule
                </button>
              )}
            </div>

            {showNew && (
              <div className="space-y-2 border border-border bg-muted/40 p-2">
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="rule-name.md"
                  aria-label="Rule name"
                  className="w-full border border-border bg-input px-2 py-1 text-[11px] text-foreground"
                />
                <textarea
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  rows={6}
                  placeholder="Rule content..."
                  aria-label="Rule content"
                  className="w-full border border-border bg-input px-2 py-1 text-[11px] font-mono text-foreground resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={addRepoOnly}
                    disabled={busy === "new" || !draftName.trim() || !draftContent.trim()}
                    className="border border-border bg-primary px-3 py-1 text-[11px] text-primary-foreground disabled:opacity-50"
                  >
                    {busy === "new" ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={() => {
                      setShowNew(false)
                      setDraftName("")
                      setDraftContent("")
                    }}
                    className="border border-border px-3 py-1 text-[11px] text-muted-foreground hover:bg-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {repoOnly.length === 0 ? (
              <div className="ui-meta py-2">None.</div>
            ) : (
              <div className="space-y-1">
                {repoOnly.map((r) => (
                  <div
                    key={r.id}
                    className="group flex items-center justify-between border border-border px-2 py-1.5 focus-within:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-foreground truncate">{r.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {r.content_preview}
                      </div>
                    </div>
                    <button
                      onClick={() => removeRepoOnly(r.id)}
                      disabled={busy === `r:${r.id}`}
                      aria-label={`Delete repo rule ${r.name}`}
                      className="text-[11px] text-destructive opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring disabled:opacity-40"
                    >
                      {busy === `r:${r.id}` ? "..." : "Delete"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
