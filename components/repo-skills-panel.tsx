"use client"

import { useState } from "react"
import useSWR from "swr"
import type { Repo } from "@/lib/types"
import { toast } from "@/hooks/use-toast"

type ResolvedSkill = {
  // For source==="global" this is the global skill id.
  // For source==="repo" this is the repo_skill_overrides row id (also the overrideId for DELETE).
  id: string
  name: string
  description: string | null
  source: "global" | "repo"
}

type ExcludedInherited = {
  id: string
  name: string
  description: string | null
}

type Payload = {
  skills: ResolvedSkill[]
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

export function RepoSkillsPanel({ repo }: Props) {
  const key = `/api/repos/${repo.id}/skills`
  const { data, error, isLoading, mutate } = useSWR<Payload>(key, fetcher)
  const [busy, setBusy] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [draftName, setDraftName] = useState("")
  const [draftDescription, setDraftDescription] = useState("")
  const [draftContent, setDraftContent] = useState("")

  const skills = data?.skills ?? []
  const excludedInherited = data?.excluded_inherited ?? []
  const inherited = skills.filter((s) => s.source === "global")
  const projectSpecific = skills.filter((s) => s.source === "repo")

  const setExclusion = async (skillId: string, excluded: boolean) => {
    setBusy(`g:${skillId}`)
    try {
      const res = await fetch(key, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill_id: skillId, excluded }),
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

  // overrideId comes from a repo-only ResolvedSkill.id, which the API maps
  // from repo_skill_overrides.id (see GET handler). DO NOT pass a global
  // skill's id here — there will be no override row to delete.
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
        body: JSON.stringify({
          name: draftName.trim(),
          description: draftDescription.trim() || null,
          content: draftContent,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      setDraftName("")
      setDraftDescription("")
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
        Inherited skills come from your global library at{" "}
        <span className="font-mono">/agents/skills</span>. Excluding one only affects this space.
        Project-specific skills live here and don&apos;t appear in other spaces.
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
              <div className="ui-meta py-2">No global skills yet.</div>
            ) : (
              <div className="space-y-1">
                {inherited.map((s) => (
                  <div
                    key={s.id}
                    className="group flex items-center justify-between border border-border px-2 py-1.5 focus-within:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-foreground truncate">{s.name}</div>
                      {s.description && (
                        <div className="text-[11px] text-muted-foreground truncate">
                          {s.description}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setExclusion(s.id, true)}
                      disabled={busy === `g:${s.id}`}
                      aria-label={`Exclude ${s.name} from this space`}
                      className="text-[11px] text-muted-foreground hover:text-destructive opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring disabled:opacity-40"
                    >
                      {busy === `g:${s.id}` ? "..." : "Exclude"}
                    </button>
                  </div>
                ))}
                {excludedInherited.map((s) => (
                  <div
                    key={s.id}
                    className="group flex items-center justify-between border border-dashed border-border/60 px-2 py-1.5 opacity-60 focus-within:opacity-100"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-muted-foreground truncate">
                        Excluded · {s.name}
                      </div>
                      {s.description && (
                        <div className="text-[11px] text-muted-foreground truncate">
                          {s.description}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setExclusion(s.id, false)}
                      disabled={busy === `g:${s.id}`}
                      aria-label={`Re-include ${s.name} in this space`}
                      className="text-[11px] text-accent-blue hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring disabled:opacity-40"
                    >
                      {busy === `g:${s.id}` ? "..." : "Re-include"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-1 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <div className="ui-label">Project-specific</div>
              {!showNew && (
                <button
                  onClick={() => setShowNew(true)}
                  className="text-[11px] text-accent-blue hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
                >
                  + Add project skill
                </button>
              )}
            </div>

            {showNew && (
              <div className="space-y-2 border border-border bg-muted/40 p-2">
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Skill name"
                  aria-label="Skill name"
                  className="w-full border border-border bg-input px-2 py-1 text-[11px] text-foreground"
                />
                <input
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  placeholder="Short description (optional)"
                  aria-label="Skill description"
                  className="w-full border border-border bg-input px-2 py-1 text-[11px] text-foreground"
                />
                <textarea
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  rows={6}
                  placeholder="Skill content..."
                  aria-label="Skill content"
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
                      setDraftDescription("")
                      setDraftContent("")
                    }}
                    className="border border-border px-3 py-1 text-[11px] text-muted-foreground hover:bg-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {projectSpecific.length === 0 ? (
              <div className="ui-meta py-2">None.</div>
            ) : (
              <div className="space-y-1">
                {projectSpecific.map((s) => (
                  <div
                    key={s.id}
                    className="group flex items-center justify-between border border-border px-2 py-1.5 focus-within:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] text-foreground truncate">{s.name}</div>
                      {s.description && (
                        <div className="text-[11px] text-muted-foreground truncate">
                          {s.description}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => removeRepoOnly(s.id)}
                      disabled={busy === `r:${s.id}`}
                      aria-label={`Delete project skill ${s.name}`}
                      className="text-[11px] text-destructive opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring disabled:opacity-40"
                    >
                      {busy === `r:${s.id}` ? "..." : "Delete"}
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
