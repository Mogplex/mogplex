"use client"

import { useState } from "react"
import useSWR from "swr"
import { fetchJsonObject } from "@/lib/client-fetch"
import { MODEL_SURFACE_LABELS, type ModelSurface } from "@/lib/models/surface-defaults"
import type { ModelSettingsTargets } from "@/lib/models/settings-defaults"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export type DefaultModelSelection = { surfaces: ModelSurface[]; flowIds: string[] }

export function DefaultModelDialog({ model, onClose, onSave }: {
  model: string
  onClose: () => void
  onSave: (selection: DefaultModelSelection) => Promise<void>
}) {
  const [surfaces, setSurfaces] = useState<ModelSurface[]>([])
  const [flowIds, setFlowIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { data, error, mutate } = useSWR<ModelSettingsTargets>("/api/settings/model-targets",
    (url: string) => fetchJsonObject<ModelSettingsTargets>(url, "Unable to load model destinations"),
    { revalidateOnMount: true })
  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try { await onSave({ surfaces, flowIds }); onClose() }
    catch (error) { setSaveError(error instanceof Error ? error.message : "Unable to save model settings") }
    finally { setSaving(false) }
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
      <DialogContent data-testid="models-default-dialog" className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Change default model?</DialogTitle>
          <DialogDescription>
            Set <span className="break-all text-foreground">{model}</span> as your default for new automation nodes.
            Choose where else to apply it. Unchecked destinations keep their current models.
          </DialogDescription>
        </DialogHeader>
        {error ? <div role="alert" className="text-sm text-destructive">Unable to load destinations. <Button variant="outline" size="sm" onClick={() => void mutate()}>Retry</Button></div>
          : !data ? <p role="status" className="text-sm text-muted-foreground">Loading destinations…</p> : <>
            <fieldset disabled={saving} className="space-y-1">
              <legend className="mb-2 text-sm font-medium">Agent surfaces</legend>
              {data.surfaces.map(({ id, model: current }) => <label key={id} className="flex min-h-11 items-center justify-between gap-4 py-2">
                <span className="min-w-0 text-sm">{MODEL_SURFACE_LABELS[id]}<span className="block break-all text-xs text-muted-foreground">{current ?? "Account default"}</span></span>
                <Switch aria-label={MODEL_SURFACE_LABELS[id]} checked={surfaces.includes(id)} onCheckedChange={(checked) => setSurfaces((values) => checked ? [...values, id] : values.filter((value) => value !== id))} />
              </label>)}
              <p className="text-xs text-muted-foreground">Applies to new sessions and requests that use a default. Explicit chat, channel, CLI, and saved-agent model choices stay in place.</p>
            </fieldset>
            <fieldset disabled={saving} className="space-y-1 border-t pt-4">
              <legend className="text-sm font-medium">Automations</legend>
              <p className="pb-2 text-xs text-muted-foreground">Switch primary agent models in each selected automation, including its published version. Fallback models stay in place.</p>
              {data.automations.length === 0 ? <p className="text-sm text-muted-foreground">No automations yet.</p> : data.automations.map((flow) => <label key={flow.id} className="flex min-h-11 items-center justify-between gap-4 py-2 text-sm">
                <span className="min-w-0 break-words">{flow.name}{flow.team_id && <span className="block text-xs text-muted-foreground">Team automation</span>}</span>
                <Switch aria-label={`Apply to ${flow.name}`} checked={flowIds.includes(flow.id)} onCheckedChange={(checked) => setFlowIds((values) => checked ? [...values, flow.id] : values.filter((value) => value !== flow.id))} />
              </label>)}
            </fieldset>
          </>}
        {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
        <DialogFooter>
          <Button variant="outline" data-testid="models-default-cancel" disabled={saving} onClick={onClose}>Cancel</Button>
          <Button data-testid="models-default-confirm" disabled={saving || !data || Boolean(error)} onClick={() => void save()}>{saving ? "Saving…" : "Set default"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
