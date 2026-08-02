"use client"
import { useCallback, useEffect, useState } from "react"
import type { WorkspaceEntry } from "@/lib/monorepo-detection"
import { toast } from "@/hooks/use-toast"

interface MonorepoWorkspace extends WorkspaceEntry {
  has_space: boolean
}

interface MonorepoResponse {
  is_monorepo: boolean
  marker?: string | null
  workspaces: MonorepoWorkspace[]
}

interface Props {
  repoId: string
  onSpaceAdded?: () => void
}

export function MonorepoBrowser({ repoId, onSpaceAdded }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<MonorepoResponse | null>(null)
  const [adding, setAdding] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/repos/${repoId}/monorepo`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d as MonorepoResponse | null))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [repoId])

  const handleAdd = useCallback(async (path: string) => {
    setAdding(path)
    try {
      const res = await fetch(`/api/repos/${repoId}/subproject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root_directory: path }),
      })
      if (!res.ok) {
        const err = await res.json()
        toast({ title: "Failed to add space", description: err.error, variant: "destructive" })
        return
      }
      setData((prev) =>
        prev
          ? {
              ...prev,
              workspaces: prev.workspaces.map((ws) =>
                ws.path === path ? { ...ws, has_space: true } : ws
              ),
            }
          : prev
      )
      toast({ title: "Space added", description: path })
      onSpaceAdded?.()
    } finally {
      setAdding(null)
    }
  }, [repoId, onSpaceAdded])

  if (loading) {
    return <div className="py-3 text-xs text-muted-foreground">Scanning...</div>
  }

  if (!data?.is_monorepo) {
    return (
      <div className="py-3 text-xs text-muted-foreground">
        No monorepo structure detected. Set root_directory manually in settings.
      </div>
    )
  }

  if (data.workspaces.length === 0) {
    return (
      <div className="py-3 text-xs text-muted-foreground">
        Monorepo detected{data.marker ? ` (${data.marker})` : ""} but no workspace directories found.
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between pb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {data.workspaces.length} workspaces{data.marker ? ` · ${data.marker}` : ""}
        </span>
      </div>
      {data.workspaces.map((ws) => (
        <div
          key={ws.path}
          className="flex items-center justify-between border border-border px-3 py-2"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{ws.name}</span>
              {ws.framework && (
                <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {ws.framework}
                </span>
              )}
            </div>
            <div className="text-[11px] font-mono text-muted-foreground">{ws.path}</div>
          </div>
          {ws.has_space ? (
            <span className="text-[11px] text-accent-green">Added</span>
          ) : (
            <button
              onClick={() => handleAdd(ws.path)}
              disabled={adding === ws.path}
              className="border border-border px-2 py-1 text-[11px] text-foreground hover:bg-secondary disabled:opacity-50"
            >
              {adding === ws.path ? "Adding..." : "Add space"}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
