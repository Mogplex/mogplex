"use client"
import { useState } from "react"
import { useParams } from "next/navigation"
import type { Agent } from "@/lib/types"
import { useModels } from "@/hooks/use-models"
import { scopedHref } from "@/lib/scoped-href"
import { buildAgentModelOptions, buildSelectableAgentModelCatalog } from "@/lib/agents/model-options"
import { PRECONFIGURED_AGENTS } from "@/lib/agents/templates"

type Props = { agent: Agent | null; template?: string; onClose: () => void; onSave: () => void }

export function AgentEditor({ agent, template, onClose, onSave }: Props) {
  const { scope } = useParams<{ scope: string }>()
  const { models, catalog } = useModels()
  const tpl = template ? PRECONFIGURED_AGENTS.find(t => t.name === template) : null
  const [name, setName] = useState(agent?.name || tpl?.name || "")
  const currentModel = agent?.model || tpl?.model || null
  const [model, setModel] = useState(currentModel || "")
  const selectableCatalog = buildSelectableAgentModelCatalog(models, catalog, model || currentModel)
  const modelOptions = buildAgentModelOptions(selectableCatalog, model || currentModel)
  const [prompt, setPrompt] = useState(agent?.system_prompt || tpl?.system_prompt || "")
  const [saving, setSaving] = useState(false)

  const applyTemplate = (templateName: string) => {
    const tpl = PRECONFIGURED_AGENTS.find(t => t.name === templateName)
    if (tpl) {
      setName(tpl.name)
      setModel(tpl.model)
      setPrompt(tpl.system_prompt)
    }
  }

  const save = async () => {
    setSaving(true)
    const payload = { name, model, system_prompt: prompt }

    if (agent) {
      await fetch("/api/agents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: agent.id, ...payload }),
      })
    } else {
      await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    }
    setSaving(false)
    onSave()
    onClose()
  }

  const deleteAgent = async () => {
    if (!agent) return
    await fetch(`/api/agents?id=${agent.id}`, { method: "DELETE" })
    onSave()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-[600px] flex-col overflow-hidden rounded-lg border border-border bg-card" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs text-foreground">{agent ? "Edit Agent" : "New Agent"}</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xs">X</button>
        </div>
        <div className="p-3 space-y-3 flex-1 overflow-auto">
          {!agent && (
            <div>
              <label className="text-[10px] text-muted-foreground">Start from template</label>
              <select onChange={e => e.target.value && applyTemplate(e.target.value)} className="w-full px-2 py-1 bg-input border border-border rounded text-xs text-foreground mt-1" defaultValue="">
                <option value="">-- Select template --</option>
                {PRECONFIGURED_AGENTS.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-[10px] text-muted-foreground">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full px-2 py-1 bg-input border border-border rounded text-xs text-foreground mt-1" />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Model</label>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              disabled={modelOptions.length === 0}
              className="w-full px-2 py-1 bg-input border border-border rounded text-xs text-foreground mt-1 disabled:opacity-60"
            >
              {modelOptions.length === 0 && <option value="">No enabled models available</option>}
              {modelOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            {!model && (
              <div className="mt-1 text-[10px] text-muted-foreground">
                Enable a model first in <a href={scopedHref(scope, "/settings?tab=models")} className="text-accent-blue hover:underline">Settings</a>.
              </div>
            )}
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-muted-foreground">System Prompt (Markdown)</label>
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={12} placeholder="# Agent Instructions&#10;&#10;You are a code reviewer..." className="w-full px-2 py-1 bg-input border border-border rounded text-xs text-foreground mt-1 font-mono resize-none" />
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border p-3">
          {agent && <button onClick={deleteAgent} className="mr-auto px-2 py-1 bg-destructive text-destructive-foreground text-xs rounded">Delete</button>}
          <button onClick={onClose} className="px-2 py-1 bg-secondary text-foreground text-xs rounded">Cancel</button>
          <button onClick={save} disabled={saving || !name.trim() || !model} className="px-2 py-1 bg-primary text-primary-foreground text-xs rounded disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}
