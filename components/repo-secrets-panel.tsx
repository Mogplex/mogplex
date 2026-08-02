"use client"

import { useCallback, useEffect, useState } from "react"
import type { Repo } from "@/lib/types"

type GitHubSecret = {
  name: string
  created_at: string
  updated_at: string
}

interface Props {
  repo: Repo
}

export function RepoSecretsPanel({ repo }: Props) {
  const [ghSecrets, setGhSecrets] = useState<GitHubSecret[]>([])
  const [loadingGh, setLoadingGh] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newKey, setNewKey] = useState("")
  const [newValue, setNewValue] = useState("")
  const [saving, setSaving] = useState(false)

  const fetchGhSecrets = useCallback(async () => {
    setLoadingGh(true)
    setError(null)
    try {
      const res = await fetch(`/api/repos/${repo.id}/secrets`)
      if (!res.ok) {
        const data = await res.json()
        if (data.error === "NO_GITHUB_TOKEN") {
          throw new Error("Connect GitHub to manage secrets")
        }
        if (data.error === "GITHUB_API_ERROR") {
          const hint = data.detail?.includes("403")
            ? "The GitHub App may not have Secrets permission for this repo. Re-install or update the app permissions."
            : data.detail || "GitHub API request failed"
          throw new Error(hint)
        }
        throw new Error(data.error || "Failed to load secrets")
      }
      setGhSecrets(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load secrets")
    } finally {
      setLoadingGh(false)
    }
  }, [repo.id])

  useEffect(() => {
    void fetchGhSecrets()
  }, [fetchGhSecrets])

  const handleAddGhSecret = async () => {
    if (!newKey.trim() || !newValue) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/repos/${repo.id}/secrets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKey, value: newValue }),
      })
      if (!res.ok) throw new Error("Failed to save secret")
      setNewKey("")
      setNewValue("")
      await fetchGhSecrets()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save secret")
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteGhSecret = async (name: string) => {
    setError(null)
    try {
      const res = await fetch(`/api/repos/${repo.id}/secrets`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error("Failed to delete secret")
      setGhSecrets((prev) => prev.filter((secret) => secret.name !== name))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete secret")
    }
  }

  return (
    <div className="space-y-3 p-4">
      <div className="text-[11px] leading-5 text-muted-foreground">
        GitHub Actions secrets are managed here. Personal Vercel project linking now lives in repo and project settings.
      </div>

      {error && (
        <div className="border border-destructive px-2 py-1.5 text-[11px] text-destructive">{error}</div>
      )}

      {loadingGh ? (
        <div className="ui-meta py-4 text-center">Loading...</div>
      ) : (
        <>
          {ghSecrets.length > 0 ? (
            <div className="space-y-1">
              {ghSecrets.map((secret) => (
                <div key={secret.name} className="flex items-center justify-between border border-border px-2 py-1.5 group">
                  <div>
                    <span className="text-[11px] font-mono text-foreground">{secret.name}</span>
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      updated {new Date(secret.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeleteGhSecret(secret.name)}
                    className="text-[11px] text-destructive opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="ui-meta py-2">No secrets configured</div>
          )}

          <div className="space-y-2 border-t border-border pt-3">
            <div className="ui-label">Add or update a secret</div>
            <input
              value={newKey}
              onChange={(event) => setNewKey(event.target.value)}
              placeholder="SECRET_NAME"
              className="w-full border border-border bg-input px-2 py-1 font-mono text-[11px] text-foreground"
            />
            <input
              value={newValue}
              onChange={(event) => setNewValue(event.target.value)}
              type="password"
              placeholder="secret value"
              className="w-full border border-border bg-input px-2 py-1 text-[11px] text-foreground"
            />
            <button
              onClick={handleAddGhSecret}
              disabled={saving || !newKey.trim() || !newValue}
              className="border border-border bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Secret"}
            </button>
          </div>

          <div className="text-[11px] leading-5 text-muted-foreground">
            GitHub Actions secrets are encrypted and never exposed. Setting an existing name overwrites the value.
          </div>
        </>
      )}
    </div>
  )
}
