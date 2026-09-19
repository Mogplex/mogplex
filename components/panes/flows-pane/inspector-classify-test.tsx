"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider"
import type { FlowClassifyNodeData, FlowClassifyResult } from "@/lib/types"

function describeAnswer(result: FlowClassifyResult) {
  if (result.kind === "scale") return `${result.answer} · ${result.level}`
  if (result.kind === "boolean") return result.answer ? "True" : "False"
  return String(result.answer)
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

/** Try a node's question on sample state before the flow ever runs. */
export function ClassifyTestPanel({ data }: { data: FlowClassifyNodeData }) {
  const activeTeamId = useActiveTeamId()
  const [sample, setSample] = useState("")
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<FlowClassifyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ready = sample.trim().length > 0 && data.question.trim().length > 0

  const run = async () => {
    setRunning(true)
    setResult(null)
    setError(null)
    try {
      const response = await fetch("/api/flows/classify-test", {
        method: "POST",
        headers: getActiveTeamRequestHeaders(
          { "Content-Type": "application/json" },
          activeTeamId,
        ),
        body: JSON.stringify({
          question: data.question,
          output: data.output,
          state: sample,
          minConfidence: data.minConfidence ?? null,
        }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { result?: FlowClassifyResult; error?: string }
        | null
      if (!response.ok || !payload?.result) {
        throw new Error(payload?.error || `Test failed (${response.status})`)
      }
      setResult(payload.result)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Test failed")
    } finally {
      setRunning(false)
    }
  }

  const ranked = result
    ? Object.entries(result.probabilities).sort(([, a], [, b]) => b - a)
    : []

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-background/40 p-3">
      <div className="text-[11px] font-medium text-muted-foreground">Try it</div>
      <Textarea
        aria-label="Sample state"
        rows={3}
        value={sample}
        placeholder="Paste sample state, such as an issue title and body."
        onChange={(event) => setSample(event.target.value)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!ready || running}
        onClick={() => void run()}
        data-testid="classify-test-run"
      >
        {running ? "Testing…" : "Test question"}
      </Button>
      {error ? (
        <p role="alert" className="text-[11px] text-destructive">{error}</p>
      ) : null}
      {result ? (
        <div className="space-y-1 text-[11px]" data-testid="classify-test-result">
          <div className="text-foreground">
            <span className="font-medium">{describeAnswer(result)}</span>
            <span className="text-muted-foreground">
              {" "}· {percent(result.confidence)} confidence
              {result.uncertain ? " · would take the Uncertain branch" : ""}
            </span>
          </div>
          {ranked.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-2 font-mono text-muted-foreground">
              <span className="truncate">{label}</span>
              <span>{percent(value)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
