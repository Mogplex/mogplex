"use client"

import { useEffect, useMemo, useState } from "react"
import type { Workspace } from "@/lib/types"
import { useUser } from "@/hooks/use-user"
import { toast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider"

type GithubOwnerTarget = {
  login: string
  kind: "personal" | "org"
  github_installation_id: number | null
  scope_label: string
  source: "oauth" | "installation" | "oauth+installation"
}

interface Props {
  workspace: Workspace
  onClose: () => void
  onCreated: () => void
}

export function CreateWorkspaceRepoDialog({ workspace, onClose, onCreated }: Props) {
  const { user } = useUser()
  const activeTeamId = useActiveTeamId()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [visibility, setVisibility] = useState<"private" | "public">("private")
  const [ownerLogin, setOwnerLogin] = useState("")
  const [ownerTargets, setOwnerTargets] = useState<GithubOwnerTarget[]>([])
  const [loadingOwners, setLoadingOwners] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadingOwners(true)
    fetch("/api/github/owners")
      .then(async (response) => response.ok ? response.json() : [])
      .then((data) => {
        if (cancelled) return
        const targets = Array.isArray(data) ? data as GithubOwnerTarget[] : []
        setOwnerTargets(targets)
        setOwnerLogin((current) => current || targets[0]?.login || "")
      })
      .catch(() => {
        if (!cancelled) setOwnerTargets([])
      })
      .finally(() => {
        if (!cancelled) setLoadingOwners(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const connectGithubLabel = user?.github_app_available ? "Install GitHub App" : "Connect GitHub"
  const selectedOwner = useMemo(
    () => ownerTargets.find((target) => target.login === ownerLogin) || null,
    [ownerLogin, ownerTargets],
  )

  const handleCreate = async () => {
    if (!name.trim() || !ownerLogin) return

    setSaving(true)
    try {
      const response = await fetch(`/api/workspaces/${workspace.id}/repos`, {
        method: "POST",
        headers: getActiveTeamRequestHeaders(
          { "Content-Type": "application/json" },
          activeTeamId
        ),
        body: JSON.stringify({
          name,
          description,
          visibility,
          owner_login: ownerLogin,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || "Failed to create repository")
      }
      toast({
        title: "Repository created",
        description: data.full_name || `${ownerLogin}/${name.trim()}`,
      })
      onCreated()
      onClose()
    } catch (error) {
      toast({
        title: "Repository creation failed",
        description: (error as Error).message,
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Repository</DialogTitle>
          <DialogDescription>
            Create a GitHub repo directly inside {workspace.name}.
          </DialogDescription>
        </DialogHeader>

        {!user?.github_connected ? (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-accent/60 p-3 text-sm text-muted-foreground">
              GitHub must be connected before Mogplex can create repositories.
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button asChild>
                <a href={user?.github_primary_action?.href || "/api/auth/github"} target="_blank" rel="noopener noreferrer">
                  {user?.github_primary_action?.label || connectGithubLabel}
                </a>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">Repository name</label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="new-product"
                  className="h-9"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">GitHub account</label>
                <select
                  value={ownerLogin}
                  onChange={(event) => setOwnerLogin(event.target.value)}
                  disabled={loadingOwners || ownerTargets.length === 0}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none"
                >
                  {loadingOwners ? (
                    <option>Loading accounts...</option>
                  ) : ownerTargets.length === 0 ? (
                    <option>No GitHub accounts available</option>
                  ) : (
                    ownerTargets.map((target) => (
                      <option key={target.login} value={target.login}>
                        {target.login} · {target.scope_label}
                      </option>
                    ))
                  )}
                </select>
                {selectedOwner && (
                  <div className="text-[11px] text-muted-foreground">
                    {selectedOwner.kind === "personal" ? "Creates under your personal GitHub account." : "Creates under your selected GitHub org."}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">Visibility</label>
                <select
                  value={visibility}
                  onChange={(event) => setVisibility(event.target.value === "public" ? "public" : "private")}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none"
                >
                  <option value="private">Private</option>
                  <option value="public">Public</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">Description</label>
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional repo description"
                  rows={4}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleCreate()}
                disabled={saving || !name.trim() || !ownerLogin || ownerTargets.length === 0}
              >
                {saving ? "Creating..." : "Create Repository"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
