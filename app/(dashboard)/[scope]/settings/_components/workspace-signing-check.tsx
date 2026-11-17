"use client"

import { useState } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { fetchJsonObject } from "@/lib/client-fetch"
import { getActiveTeamRequestHeaders } from "@/lib/active-team-request"
import type { SandboxListRecord } from "@/lib/sandbox/collection/_lib/types"

type SigningSandbox = Pick<SandboxListRecord, "id" | "working_branch" | "root_directory" | "runtime_summary" | "repo">

function sandboxLabel(sandbox: SigningSandbox) {
  const status = sandbox.runtime_summary.status
  return [sandbox.repo?.full_name || "Repository unavailable", sandbox.working_branch || "default branch", sandbox.root_directory, status.charAt(0).toUpperCase() + status.slice(1)].filter(Boolean).join(" · ")
}
type Verification = { status: string; message: string; fingerprint?: string; checkedAt?: string }

export function WorkspaceSigningCheck({ fingerprint }: { fingerprint: string | null }) {
  const [choosing, setChoosing] = useState(false)
  const [selected, setSelected] = useState("")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Verification | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { data, error: loadError, mutate } = useSWR(choosing ? "/api/sandbox" : null,
    url => fetchJsonObject<{ sandboxes: SigningSandbox[] }>(url, "Could not load sandboxes", { headers: getActiveTeamRequestHeaders() }))

  const options = data?.sandboxes.map(sandbox => ({ id: sandbox.id, label: sandboxLabel(sandbox) })) ?? []
  const labelCounts = new Map<string, number>()
  for (const option of options) labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1)

  async function verify() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const value = await fetchJsonObject<Verification>(`/api/sandbox/${selected}/commit-signing`, "Could not verify sandbox signing. Try again.", { method: "POST", headers: getActiveTeamRequestHeaders() })
      if (value.status === "verified" && value.fingerprint !== fingerprint) throw new Error("The saved key changed. Reload signing settings and try again.")
      setResult(value)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify sandbox signing. Try again.")
    } finally { setBusy(false) }
  }

  return <div className="space-y-3 border-t border-border pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-medium">Sandbox signing</h3><p className="text-xs text-muted-foreground">{result?.status === "verified" ? "Verified in the selected sandbox" : "Not verified in a sandbox"}</p></div>
      {!choosing && <Button variant="outline" onClick={() => setChoosing(true)}>Verify signing</Button>}
    </div>
    <p className="text-xs leading-5 text-muted-foreground">A sandbox is the environment where Git runs for a repository. Verify its signing setup with a temporary commit; your repository stays unchanged.</p>
    {choosing && <div className="space-y-3">
      {loadError ? <div role="alert" className="text-sm text-destructive">Could not load sandboxes. <Button variant="outline" onClick={() => void mutate()}>Try again</Button></div>
        : !data ? <p role="status" className="text-sm text-muted-foreground">Loading sandboxes…</p>
        : data.sandboxes.length === 0 ? <p className="text-sm text-muted-foreground">Launch a sandbox from a repository to verify signing.</p>
        : <><label className="block text-xs font-medium" htmlFor="signing-sandbox">Sandbox to check</label>
          <select id="signing-sandbox" className="w-full min-w-0 rounded-md border border-border bg-secondary px-3 py-2 text-sm" value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setResult(null); setError(null) }}>
            <option value="">Choose a sandbox</option>
            {options.map(({ id, label }) => <option key={id} value={id}>{label}{labelCounts.get(label)! > 1 ? ` · ${id.slice(0, 8)}` : ""}</option>)}
          </select>
          <Button variant="outline" disabled={!selected || busy} onClick={() => void verify()}>{busy ? "Verifying…" : "Verify selected sandbox"}</Button></>}
      {result && <div role="status" className="rounded-md border border-border bg-secondary p-3 text-sm leading-5">{result.message}{result.checkedAt && <p className="mt-1 text-xs text-muted-foreground">Checked {new Date(result.checkedAt).toLocaleString()}. Recheck after changing sandbox settings.</p>}</div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>}
  </div>
}
