"use client"

import { useState } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { fetchJsonObject } from "@/lib/client-fetch"
import { getActiveTeamRequestHeaders } from "@/lib/active-team-request"

type Workspace = { id: string; working_branch: string | null; sandbox_id: string; repo?: { full_name?: string } | null }
type Verification = { status: string; message: string; fingerprint?: string; checkedAt?: string }

export function WorkspaceSigningCheck({ fingerprint }: { fingerprint: string | null }) {
  const [choosing, setChoosing] = useState(false)
  const [selected, setSelected] = useState("")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Verification | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { data, error: loadError, mutate } = useSWR(choosing ? "/api/sandbox" : null,
    url => fetchJsonObject<{ sandboxes: Workspace[] }>(url, "Could not load workspaces", { headers: getActiveTeamRequestHeaders() }))

  async function verify() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const value = await fetchJsonObject<Verification>(`/api/sandbox/${selected}/commit-signing`, "Could not verify workspace signing. Try again.", { method: "POST", headers: getActiveTeamRequestHeaders() })
      if (value.status === "verified" && value.fingerprint !== fingerprint) throw new Error("The saved key changed. Reload signing settings and try again.")
      setResult(value)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify workspace signing. Try again.")
    } finally { setBusy(false) }
  }

  return <div className="space-y-3 border-t border-border pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-medium">Workspace signing</h3><p className="text-xs text-muted-foreground">{result?.status === "verified" ? "Verified in the selected workspace" : "Not verified in a workspace"}</p></div>
      {!choosing && <Button variant="outline" onClick={() => setChoosing(true)}>Verify signing</Button>}
    </div>
    <p className="text-xs leading-5 text-muted-foreground">Saving a key does not prove an existing workspace uses it. Check a running workspace with a temporary signed commit; your repository stays unchanged.</p>
    {choosing && <div className="space-y-3">
      {loadError ? <div role="alert" className="text-sm text-destructive">Could not load workspaces. <Button variant="outline" onClick={() => void mutate()}>Try again</Button></div>
        : !data ? <p role="status" className="text-sm text-muted-foreground">Loading workspaces…</p>
        : data.sandboxes.length === 0 ? <p className="text-sm text-muted-foreground">Open a repository workspace to verify signing.</p>
        : <><label className="block text-xs font-medium" htmlFor="signing-workspace">Workspace to check</label>
          <select id="signing-workspace" className="w-full rounded-md border border-border px-3 py-2 text-sm" value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setResult(null); setError(null) }}>
            <option value="">Choose a workspace</option>
            {data.sandboxes.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.repo?.full_name ?? workspace.sandbox_id} · {workspace.working_branch ?? "default branch"}</option>)}
          </select>
          <Button variant="outline" disabled={!selected || busy} onClick={() => void verify()}>{busy ? "Verifying…" : "Verify selected workspace"}</Button></>}
      {result && <div role="status" className="rounded-md border border-border bg-secondary p-3 text-sm leading-5">{result.message}{result.checkedAt && <p className="mt-1 text-xs text-muted-foreground">Checked {new Date(result.checkedAt).toLocaleString()}. Recheck after changing workspace settings.</p>}</div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>}
  </div>
}
