"use client"

import { useState } from "react"
import useSWR from "swr"
import { Check, NavArrowDown } from "iconoir-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { isCurrentControlSandbox } from "@/lib/control/sandbox-presentation"
import { Button } from "@/components/ui/button"
import { fetchJsonObject } from "@/lib/client-fetch"
import { getActiveTeamRequestHeaders } from "@/lib/active-team-request"
import type { SandboxListRecord } from "@/lib/sandbox/collection/_lib/types"

type SigningSandbox = Pick<SandboxListRecord, "id" | "working_branch" | "root_directory" | "runtime_summary" | "repo">

function sandboxLabel(sandbox: SigningSandbox) {
  const status = sandbox.runtime_summary.status
  return [sandbox.repo?.full_name || "Repository unavailable", sandbox.working_branch || "default branch", sandbox.root_directory, status.charAt(0).toUpperCase() + status.slice(1)].filter(Boolean).join(" · ")
}
type SandboxOption = { id: string; label: string }

function SandboxPicker({ options, selected, disabled, onSelect }: {
  options: SandboxOption[]; selected: string; disabled: boolean; onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selectedOption = options.find(option => option.id === selected)
  return <Popover open={open && !disabled} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button id="signing-sandbox" type="button" variant="outline" role="combobox" aria-label="Sandbox to check" aria-describedby="signing-sandbox-value" aria-expanded={open && !disabled} disabled={disabled} className="h-auto min-h-9 w-full min-w-0 justify-between gap-2 bg-secondary text-left">
        <span id="signing-sandbox-value" className="min-w-0 whitespace-normal break-words">{selectedOption?.label ?? "Choose a sandbox"}</span>
        <NavArrowDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </Button>
    </PopoverTrigger>
    <PopoverContent aria-label="Sandbox choices" align="start" collisionPadding={16} className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-32px)] p-0">
      <Command label="Search sandboxes" filter={(_value, search, keywords) => {
        const text = keywords?.join(" ").toLowerCase() ?? ""
        return search.trim().toLowerCase().split(/\s+/).every(term => text.includes(term)) ? 1 : 0
      }}>
        <CommandInput aria-label="Search sandboxes" placeholder="Search by repository or branch…" className="text-base md:text-sm" />
        <CommandList className="max-h-[min(300px,calc(var(--radix-popover-content-available-height)-48px))] overscroll-contain">
          <CommandEmpty>No sandboxes match your search.</CommandEmpty>
          <CommandGroup>
            {options.map(option => <CommandItem key={option.id} value={option.id} keywords={[option.label]} aria-label={option.label}
              onSelect={() => { onSelect(option.id); setOpen(false) }}>
              <span className="min-w-0 flex-1 break-words">{option.label}</span>
              {selected === option.id && <Check aria-hidden className="size-4 shrink-0" />}
            </CommandItem>)}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
}

type Verification = { status: string; message: string; fingerprint?: string; checkedAt?: string }

export function WorkspaceSigningCheck({ fingerprint }: { fingerprint: string | null }) {
  const [choosing, setChoosing] = useState(false)
  const [selected, setSelected] = useState("")
  const [selectionUnavailable, setSelectionUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Verification | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { data, error: loadError, mutate } = useSWR(choosing ? "/api/sandbox" : null,
    url => fetchJsonObject<{ sandboxes: SigningSandbox[] }>(url, "Could not load sandboxes", { headers: getActiveTeamRequestHeaders() }))

  const currentSandboxes = data?.sandboxes.filter(isCurrentControlSandbox) ?? []
  const options = currentSandboxes.map(sandbox => ({ id: sandbox.id, label: sandboxLabel(sandbox) }))
  const labelCounts = new Map<string, number>()
  for (const option of options) labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1)

  const selectedSandbox = currentSandboxes.find(sandbox => sandbox.id === selected)
  const visibleResult = selectedSandbox ? result : null
  // Forget unavailable selections so recovery cannot revive an old receipt.
  if (data && selected && !selectedSandbox) {
    setSelected("")
    setSelectionUnavailable(true)
    setResult(null)
    setError(null)
  }

  async function verify() {
    if (!selectedSandbox) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const value = await fetchJsonObject<Verification>(`/api/sandbox/${selectedSandbox.id}/commit-signing`, "Could not verify sandbox signing. Try again.", { method: "POST", headers: getActiveTeamRequestHeaders() })
      if (value.status === "verified" && value.fingerprint !== fingerprint) throw new Error("The saved key changed. Reload signing settings and try again.")
      setResult(value)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify sandbox signing. Try again.")
    } finally { setBusy(false) }
  }

  return <div className="space-y-3 border-t border-border pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-medium">Sandbox signing</h3><p className="text-xs text-muted-foreground">{visibleResult?.status === "verified" ? "Verified in the selected sandbox" : "Not verified in a sandbox"}</p></div>
      {!choosing && <Button variant="outline" onClick={() => setChoosing(true)}>Verify signing</Button>}
    </div>
    <p className="text-xs leading-5 text-muted-foreground">A sandbox is the environment where Git runs for a repository. Verify its signing setup with a temporary commit; your repository stays unchanged.</p>
    {choosing && <div className="space-y-3">
      {selectionUnavailable && <p role="status" className="text-sm text-muted-foreground">Your selected sandbox is no longer available. Choose another to verify.</p>}
      {loadError ? <div role="alert" className="text-sm text-destructive">Could not load sandboxes. <Button variant="outline" onClick={() => void mutate()}>Try again</Button></div>
        : !data ? <p role="status" className="text-sm text-muted-foreground">Loading sandboxes…</p>
        : currentSandboxes.length === 0 ? <p className="text-sm text-muted-foreground">No available sandboxes. Launch a sandbox from a repository to verify signing.</p>
        : <><label className="block text-xs font-medium" htmlFor="signing-sandbox">Sandbox to check</label>
          <SandboxPicker options={options.map(option => ({ ...option, label: option.label + (labelCounts.get(option.label)! > 1 ? ` · ${option.id.slice(0, 8)}` : "") }))} selected={selectedSandbox?.id ?? ""} disabled={busy}
            onSelect={id => { setSelected(id); setSelectionUnavailable(false); setResult(null); setError(null) }} />
          <Button variant="outline" disabled={!selectedSandbox || busy} onClick={() => void verify()}>{busy ? "Verifying…" : "Verify selected sandbox"}</Button></>}
      {visibleResult && <div role="status" className="rounded-md border border-border bg-secondary p-3 text-sm leading-5">{visibleResult.message}{visibleResult.checkedAt && <p className="mt-1 text-xs text-muted-foreground">Checked {new Date(visibleResult.checkedAt).toLocaleString()}. Recheck after changing sandbox settings.</p>}</div>}
      {error && selectedSandbox && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>}
  </div>
}
