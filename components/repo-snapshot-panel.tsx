"use client"

import { useState, useEffect } from "react"
import type { Repo } from "@/lib/types"
import { toast } from "@/hooks/use-toast"

interface SnapshotInfo {
  id: string
  status: string
  sizeBytes: number
  createdAt: string
  expiresAt: string | null
  commitSha: string | null
  lockfileHash: string | null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function RepoSnapshotPanel({ repo }: { repo: Repo }) {
  const [snapshot, setSnapshot] = useState<SnapshotInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/repos/${repo.id}/snapshot`)
        if (!res.ok) throw new Error("Failed to load snapshot")
        const data = await res.json()
        if (!cancelled) setSnapshot(data.snapshot || null)
      } catch {
        if (!cancelled) setSnapshot(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [repo.id])

  const handleCreate = async () => {
    setCreating(true)
    try {
      const res = await fetch(`/api/repos/${repo.id}/snapshot`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Snapshot creation failed")
      setSnapshot(data.snapshot)
      toast({ title: "Snapshot created" })
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" })
    } finally {
      setCreating(false)
    }
  }

  const handleClear = async () => {
    setClearing(true)
    try {
      const res = await fetch(`/api/repos/${repo.id}/snapshot`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to clear snapshot")
      setSnapshot(null)
      toast({ title: "Snapshot cleared" })
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" })
    } finally {
      setClearing(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading snapshot info...</div>
  }

  return (
    <div className="p-6 space-y-4">
      <div className="ui-kicker">Sandbox Snapshot</div>
      <p className="ui-section-caption">
        Snapshots save the installed state of a sandbox so future launches skip dependency installation.
      </p>

      {snapshot ? (
        <div className="space-y-3">
          <div className="border border-border p-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="ui-meta">ID</span>
              <span className="text-foreground font-mono">{snapshot.id.slice(0, 16)}...</span>
            </div>
            <div className="flex justify-between">
              <span className="ui-meta">Status</span>
              <span className="text-foreground">{snapshot.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="ui-meta">Size</span>
              <span className="text-foreground">{formatBytes(snapshot.sizeBytes)}</span>
            </div>
            <div className="flex justify-between">
              <span className="ui-meta">Created</span>
              <span className="text-foreground">{new Date(snapshot.createdAt).toLocaleString()}</span>
            </div>
            {snapshot.expiresAt && (
              <div className="flex justify-between">
                <span className="ui-meta">Expires</span>
                <span className="text-foreground">{new Date(snapshot.expiresAt).toLocaleString()}</span>
              </div>
            )}
            {snapshot.commitSha && (
              <div className="flex justify-between">
                <span className="ui-meta">Commit</span>
                <span className="text-foreground font-mono">{snapshot.commitSha.slice(0, 8)}</span>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => void handleCreate()}
              disabled={creating}
              className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary disabled:opacity-50"
            >
              {creating ? "Creating..." : "Recreate Snapshot"}
            </button>
            <button
              onClick={() => void handleClear()}
              disabled={clearing}
              className="border border-border px-3 py-2 text-sm text-accent-red hover:bg-accent-red/10 disabled:opacity-50"
            >
              {clearing ? "Clearing..." : "Clear Snapshot"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="border border-border p-3 text-sm text-muted-foreground">
            No snapshot exists for this repo.
          </div>
          <button
            onClick={() => void handleCreate()}
            disabled={creating}
            className="border border-border px-3 py-2 text-sm text-foreground hover:bg-secondary disabled:opacity-50"
          >
            {creating ? "Creating snapshot... (this may take 1-3 min)" : "Create Snapshot"}
          </button>
        </div>
      )}
    </div>
  )
}
