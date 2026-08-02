"use client"
import { useState, useRef, useCallback, useEffect } from "react"
import { useParams } from "next/navigation"
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider"
import { useModels } from "@/hooks/use-models"
import { scopedHref } from "@/lib/scoped-href"
import {
  buildAgentModelOptions,
  buildSelectableAgentModelCatalog,
  getDefaultNewAgentModel,
} from "@/lib/agents/model-options"
import { AGENT_CATEGORIES, type AgentCategory } from "@/lib/agents/templates"
import {
  MAX_AGENT_SYSTEM_PROMPT_LENGTH,
  validateAgentInput,
} from "@/lib/agents/validation"

type GeneratedAgent = {
  name: string
  description: string
  category: AgentCategory
  system_prompt: string
}

type Props = {
  onClose: () => void
  onCreated: () => void
}

export function AgentCreatorDialog({ onClose, onCreated }: Props) {
  const { scope } = useParams<{ scope: string }>()
  const { models, catalog, defaultModelId } = useModels()
  const hasEnabledModels = models.length > 0

  const [description, setDescription] = useState("")
  const [generatorModel, setGeneratorModel] = useState("")
  const [generating, setGenerating] = useState(false)
  const [streamedText, setStreamedText] = useState("")
  const [generated, setGenerated] = useState<GeneratedAgent | null>(null)
  const [generatorError, setGeneratorError] = useState<string | null>(null)
  const [model, setModel] = useState("")
  const generatorCatalog = buildSelectableAgentModelCatalog(models, catalog, generatorModel)
  const selectedModelCatalog = buildSelectableAgentModelCatalog(models, catalog, model)
  const generatorModelOptions = buildAgentModelOptions(generatorCatalog, generatorModel)
  const modelOptions = buildAgentModelOptions(selectedModelCatalog, model)
  const defaultModel = getDefaultNewAgentModel(models, defaultModelId)

  useEffect(() => {
    if (defaultModel) {
      setModel(prev => prev || defaultModel)
      setGeneratorModel(prev => prev || defaultModel)
    }
  }, [defaultModel])
  const [saving, setSaving] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState(false)
  const [editedPrompt, setEditedPrompt] = useState("")
  const [saveError, setSaveError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const generate = useCallback(async () => {
    if (!description.trim() || !generatorModel) return
    setGenerating(true)
    setStreamedText("")
    setGenerated(null)
    setGeneratorError(null)
    setSaveError(null)
    setEditingPrompt(false)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch("/api/agents/generate", {
        method: "POST",
        headers: getActiveTeamRequestHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ description: description.trim(), generatorModel }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        const errorBody = await res.json().catch(() => null) as
          | { error?: string }
          | null
        setGeneratorError(
          errorBody?.error || "Failed to generate agent. Try again."
        )
        setGenerating(false)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        accumulated += chunk
        setStreamedText(accumulated)
      }

      // Parse the final JSON
      const cleaned = accumulated.replace(/^```json?\s*/, "").replace(/\s*```$/, "").trim()
      const parsed = JSON.parse(cleaned) as GeneratedAgent
      const generatedValidationError = validateAgentInput({
        name: parsed.name,
        description: parsed.description,
        category: parsed.category,
        systemPrompt: parsed.system_prompt,
        requireName: true,
        requireCategory: true,
      })
      if (generatedValidationError) {
        setGeneratorError(generatedValidationError)
        return
      }
      setGenerated(parsed)
      setEditedPrompt(parsed.system_prompt)
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setGeneratorError(
          "Failed to generate agent. Try again with a more specific description."
        )
      }
    } finally {
      setGenerating(false)
      abortRef.current = null
    }
  }, [description, generatorModel])

  const save = async () => {
    if (!generated || !model) return
    const validationError = validateAgentInput({
      name: generated.name,
      description: generated.description,
      category: generated.category,
      systemPrompt: editingPrompt ? editedPrompt : generated.system_prompt,
      model,
      requireName: true,
      requireModel: true,
      requireCategory: true,
    })
    if (validationError) {
      setSaveError(validationError)
      return
    }

    setSaving(true)
    setSaveError(null)

    try {
      const payload = {
        name: generated.name,
        description: generated.description,
        category: generated.category,
        model,
        system_prompt: editingPrompt ? editedPrompt : generated.system_prompt,
      }

      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        onCreated()
        onClose()
        return
      }

      const errorBody = await res.json().catch(() => null) as
        | { error?: string }
        | null
      setSaveError(errorBody?.error || "Failed to create agent")
    } catch {
      setSaveError("Network error while creating agent")
    } finally {
      setSaving(false)
    }
  }

  const cancel = () => {
    abortRef.current?.abort()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" onClick={cancel}>
      <div
        className="flex max-h-[85vh] w-full max-w-[640px] flex-col overflow-hidden rounded-lg border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs text-foreground">Create Agent with AI</span>
          <button onClick={cancel} className="text-muted-foreground hover:text-foreground text-xs">
            X
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-3 space-y-3">
          {/* Description input */}
          <div>
            <label className="text-[10px] text-muted-foreground">
              Describe the agent you want to create
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. An agent that reviews React components for accessibility issues and ARIA compliance"
              rows={3}
              maxLength={2000}
              disabled={generating}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  generate()
                }
              }}
              className="w-full px-2 py-1.5 bg-input border border-border rounded text-xs text-foreground mt-1 resize-none placeholder:text-muted-foreground/60"
            />
            {!generated && (
              <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="text-[10px] text-muted-foreground">Generator model</label>
                  <select
                    value={generatorModel}
                    onChange={(e) => setGeneratorModel(e.target.value)}
                    disabled={generating || generatorModelOptions.length === 0}
                    className="w-full px-2 py-1 bg-input border border-border rounded text-xs text-foreground mt-0.5"
                  >
                    {generatorModelOptions.length === 0 && (
                      <option value="">No enabled models available</option>
                    )}
                    {generatorModelOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {!hasEnabledModels && (
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      Enable a model first in <a href={scopedHref(scope, "/settings?tab=models")} className="text-accent-blue hover:underline">Settings</a>.
                    </div>
                  )}
                </div>
                <button
                  onClick={generate}
                  disabled={generating || !description.trim() || !generatorModel}
                  className="shrink-0 rounded bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50 sm:self-auto"
                >
                  {generating ? "Generating..." : "Generate"}
                </button>
              </div>
            )}
          </div>

          {/* Streaming preview */}
          {generating && streamedText && (
            <div className="bg-secondary/50 border border-border rounded p-2">
              <div className="text-[10px] text-muted-foreground mb-1">Generating...</div>
              <pre className="text-xs text-foreground whitespace-pre-wrap font-mono max-h-[200px] overflow-auto">
                {streamedText}
              </pre>
            </div>
          )}

          {/* Parse error */}
          {generatorError && (
            <div className="text-xs text-destructive">
              {generatorError}
            </div>
          )}

          {/* Generated result */}
          {generated && (
            <div className="space-y-3">
              <div className="bg-secondary/30 border border-border rounded p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-foreground font-medium">{generated.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-secondary rounded text-muted-foreground">
                    {AGENT_CATEGORIES[generated.category]?.label || generated.category}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground">{generated.description}</div>
              </div>
              {saveError && (
                <div className="text-xs text-destructive">{saveError}</div>
              )}

              {/* Model selector */}
              <div>
                <label className="text-[10px] text-muted-foreground">Model</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={modelOptions.length === 0}
                  className="w-full px-2 py-1 bg-input border border-border rounded text-xs text-foreground mt-1 disabled:opacity-60"
                >
                  {modelOptions.length === 0 && (
                    <option value="">No enabled models available</option>
                  )}
                  {modelOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {!model && (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Enable a model first in <a href={scopedHref(scope, "/settings?tab=models")} className="text-accent-blue hover:underline">Settings</a>.
                  </div>
                )}
              </div>

              {/* System prompt preview/edit */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[10px] text-muted-foreground">System Prompt</label>
                  <button
                    onClick={() => setEditingPrompt(!editingPrompt)}
                    className="text-[10px] text-accent-blue hover:underline"
                  >
                    {editingPrompt ? "Preview" : "Edit"}
                  </button>
                </div>
                {editingPrompt ? (
                  <textarea
                    value={editedPrompt}
                    onChange={(e) => setEditedPrompt(e.target.value)}
                    rows={14}
                    maxLength={MAX_AGENT_SYSTEM_PROMPT_LENGTH}
                    className="w-full px-2 py-1 bg-input border border-border rounded text-xs text-foreground mt-1 font-mono resize-none"
                  />
                ) : (
                  <pre className="mt-1 p-2 bg-secondary/30 border border-border rounded text-xs text-foreground whitespace-pre-wrap font-mono max-h-[250px] overflow-auto">
                    {editingPrompt ? editedPrompt : generated.system_prompt}
                  </pre>
                )}
              </div>

              {/* Regenerate */}
              <button
                onClick={generate}
                disabled={generating}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Regenerate
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border p-3">
          <button onClick={cancel} className="px-2 py-1 bg-secondary text-foreground text-xs rounded">
            Cancel
          </button>
          {generated && (
              <button
                onClick={save}
                disabled={saving || !model}
                className="px-2 py-1 bg-primary text-primary-foreground text-xs rounded disabled:opacity-50"
              >
                {saving ? "Creating..." : "Create Agent"}
              </button>
          )}
        </div>
      </div>
    </div>
  )
}
