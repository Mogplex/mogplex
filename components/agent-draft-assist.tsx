"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { getActiveTeamRequestHeaders } from "@/components/active-scope-provider"
import { scopedHref } from "@/lib/scoped-href"
import {
  buildAgentModelOptions,
  buildSelectableAgentModelCatalog,
  getDefaultNewAgentModel,
} from "@/lib/agents/model-options"
import { validateAgentInput } from "@/lib/agents/validation"
import type { AIModel } from "@/lib/types"
import type { AgentCategory } from "@/lib/agents/templates"

type AgentDraft = {
  name: string
  description: string
  category: AgentCategory
  system_prompt: string
}

type CurrentDraft = {
  name?: string
  description?: string | null
  category?: string | null
  system_prompt?: string | null
}

type ExistingAgentContext = {
  name?: string
  description?: string
  category?: string | null
}

type Props = {
  mode: "create" | "edit"
  enabledModels: AIModel[]
  modelCatalog: AIModel[]
  defaultModelId?: string | null
  currentDraft?: CurrentDraft
  onApplyDraft: (draft: AgentDraft) => void
}

const INVALID_DRAFT_ERROR =
  "The model returned an invalid draft. Try again with a more specific request."

function normalizeExistingDraft(
  currentDraft?: CurrentDraft,
): ExistingAgentContext | null {
  const name = currentDraft?.name?.trim()
  const description = currentDraft?.description?.trim()
  const category = currentDraft?.category?.trim()

  if (!name && !description && !category) {
    return null
  }

  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(category ? { category } : {}),
  }
}

function parseAgentDraftResponse(responseText: string) {
  const cleaned = responseText
    .replace(/^```json?\s*/, "")
    .replace(/\s*```$/, "")
    .trim()

  try {
    return JSON.parse(cleaned) as AgentDraft
  } catch {
    throw new Error(INVALID_DRAFT_ERROR)
  }
}

export function AgentDraftAssist({
  mode,
  enabledModels,
  modelCatalog,
  defaultModelId,
  currentDraft,
  onApplyDraft,
}: Props) {
  const { scope } = useParams<{ scope: string }>()
  const [request, setRequest] = useState("")
  const [generatorModel, setGeneratorModel] = useState("")
  const [generating, setGenerating] = useState(false)
  const [streamedText, setStreamedText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [appliedDraftName, setAppliedDraftName] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const requestVersionRef = useRef(0)

  const hasEnabledModels = enabledModels.length > 0
  const defaultModel = getDefaultNewAgentModel(enabledModels, defaultModelId)
  const generatorCatalog = buildSelectableAgentModelCatalog(
    enabledModels,
    modelCatalog,
    generatorModel,
  )
  const generatorModelOptions = buildAgentModelOptions(
    generatorCatalog,
    generatorModel,
  )

  useEffect(() => {
    if (defaultModel) {
      setGeneratorModel((previous) => previous || defaultModel)
    }
  }, [defaultModel])

  const generate = useCallback(async () => {
    if (!request.trim() || !generatorModel) return

    abortRef.current?.abort()

    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion

    setGenerating(true)
    setStreamedText("")
    setError(null)
    setAppliedDraftName(null)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const existingAgent =
        mode === "edit" ? normalizeExistingDraft(currentDraft) : null
      const response = await fetch("/api/agents/generate", {
        method: "POST",
        headers: getActiveTeamRequestHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          description: request.trim(),
          generatorModel,
          existingAgent,
        }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        if (requestVersion !== requestVersionRef.current) return
        const errorBody = await response.json().catch(() => null) as
          | { error?: string }
          | null
        setError(errorBody?.error || "Unable to draft the agent right now.")
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += decoder.decode(value, { stream: true })
        if (requestVersion === requestVersionRef.current) {
          setStreamedText(accumulated)
        }
      }

      const parsed = parseAgentDraftResponse(accumulated)
      const validationError = validateAgentInput({
        name: parsed.name,
        description: parsed.description,
        category: parsed.category,
        systemPrompt: parsed.system_prompt,
        requireName: true,
      })
      if (requestVersion !== requestVersionRef.current) return
      if (validationError) {
        setError(validationError)
        return
      }

      onApplyDraft(parsed)
      setAppliedDraftName(parsed.name)
      setStreamedText("")
    } catch (caughtError) {
      const error = caughtError as Error
      if (
        error.name !== "AbortError" &&
        requestVersion === requestVersionRef.current
      ) {
        setError(
          error.message === INVALID_DRAFT_ERROR
            ? error.message
            : "Unable to draft the agent right now.",
        )
      }
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setGenerating(false)
        if (abortRef.current === controller) {
          abortRef.current = null
        }
      }
    }
  }, [currentDraft, generatorModel, mode, onApplyDraft, request])

  useEffect(() => () => abortRef.current?.abort(), [])

  const title = mode === "create" ? "AI Assist" : "Customize with AI"
  const hint =
    mode === "create"
      ? "Describe the agent you want. A draft will fill the fields below."
      : "Describe what should change. A draft will update the fields below."
  const placeholder =
    mode === "create"
      ? "e.g. A PR reviewer that catches risky migrations, weak rollback plans, and missing tests"
      : "e.g. Make this agent stricter on Next.js caching mistakes and rollout risk"
  const buttonLabel = mode === "create" ? "Draft with AI" : "Update with AI"

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-sm text-muted-foreground">{hint}</div>
      </div>

      <div className="space-y-2">
        <label htmlFor="agent-ai-request" className="block text-sm font-medium text-foreground">
          Request
        </label>
        <textarea
          id="agent-ai-request"
          aria-label="AI request"
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          placeholder={placeholder}
          rows={3}
          maxLength={2000}
          disabled={generating}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              generate()
            }
          }}
          className="w-full min-h-[100px] resize-none rounded-sm border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60"
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <label htmlFor="agent-ai-model-select" className="block text-sm font-medium text-foreground">
            AI model
          </label>
          <select
            id="agent-ai-model-select"
            aria-label="AI model"
            value={generatorModel}
            onChange={(event) => setGeneratorModel(event.target.value)}
            disabled={generating || generatorModelOptions.length === 0}
            className="w-full h-11 rounded-sm border border-border bg-input px-3 text-sm text-foreground disabled:opacity-60"
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
            <div className="text-[11px] text-muted-foreground">
              Enable a model first in <a href={scopedHref(scope, "/settings?tab=models")} className="text-accent-blue hover:underline">Settings</a>.
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={generating || !request.trim() || !generatorModel}
          className="h-11 rounded-sm bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50"
        >
          {generating ? "Working..." : buttonLabel}
        </button>
      </div>

      {generating && streamedText && (
        <div className="rounded-sm border border-border bg-background/60 p-2">
          <div className="mb-1 text-[11px] text-muted-foreground">Working...</div>
          <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap font-mono text-xs text-foreground">
            {streamedText}
          </pre>
        </div>
      )}

      {error && <div className="text-sm text-destructive">{error}</div>}

      {appliedDraftName && !error && !generating && (
        <div className="text-[11px] text-muted-foreground">
          Draft applied to the fields below for <span className="text-foreground">{appliedDraftName}</span>.
        </div>
      )}
    </div>
  )
}
