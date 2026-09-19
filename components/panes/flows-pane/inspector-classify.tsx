"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Trash } from "iconoir-react"
import {
  CLASSIFY_DEFAULT_LEVELS,
  CLASSIFY_MAX_LEVELS,
  CLASSIFY_MAX_OPTIONS,
} from "@/lib/flows/operators/classify"
import type {
  FlowClassifyNodeData,
  FlowClassifyOption,
  FlowClassifyOutput,
  FlowClassifyOutputKind,
} from "@/lib/types"
import type { FlowCanvasNode } from "@/lib/flows/editor"
import { ClassifyTestPanel } from "./inspector-classify-test"
import { InspectorField, WorkflowSelect } from "./inspector-shared"

export interface ClassifyInspectorProps {
  node: FlowCanvasNode & { data: FlowClassifyNodeData }
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
  onDelete: () => void
}

const KIND_OPTIONS: Array<{ value: FlowClassifyOutputKind; label: string }> = [
  { value: "boolean", label: "True / false" },
  { value: "choice", label: "Single choice" },
  { value: "scale", label: "Scale" },
]

function newOptionId(options: FlowClassifyOption[]) {
  const used = new Set(options.map((option) => option.id))
  let index = options.length + 1
  while (used.has(`option_${index}`)) index += 1
  return `option_${index}`
}

function defaultOutput(kind: FlowClassifyOutputKind): FlowClassifyOutput {
  if (kind === "choice") {
    return {
      kind,
      options: [
        { id: "option_1", label: "" },
        { id: "option_2", label: "" },
      ],
    }
  }
  if (kind === "scale") return { kind, levels: [...CLASSIFY_DEFAULT_LEVELS] }
  return { kind: "boolean" }
}

export function ClassifyInspector({
  node,
  updateNodeData,
  onDelete,
}: ClassifyInspectorProps) {
  const { data } = node
  const { output } = data
  const set = (patch: Partial<FlowClassifyNodeData>, mergeKey: string) =>
    updateNodeData(node.id, (current) => ({ ...current, ...patch }), {
      mergeKey: `classify-${mergeKey}-${node.id}`,
    })
  const floorPercent =
    data.minConfidence == null ? "" : String(Math.round(data.minConfidence * 100))

  return (
    <>
      <InspectorField label="Label">
        <Input
          aria-label="Label"
          value={data.label}
          onChange={(event) => set({ label: event.target.value }, "label")}
        />
      </InspectorField>
      <InspectorField label="State">
        <Textarea
          aria-label="State"
          rows={3}
          value={data.input}
          placeholder="{{previous_outputs}}"
          onChange={(event) => set({ input: event.target.value }, "input")}
        />
        <p className="text-[11px] text-muted-foreground">
          What gets judged. Use {"{{ }}"} for run data, such as{" "}
          {"{{metadata.title}}"}, {"{{outputs_by_label.Review}}"}, or{" "}
          {"{{state.my_variable}}"}.
        </p>
      </InspectorField>
      <InspectorField label="Question">
        <Textarea
          aria-label="Question"
          rows={3}
          value={data.question}
          placeholder="Does the state describe a bug in existing behavior?"
          onChange={(event) => set({ question: event.target.value }, "question")}
        />
        <p className="text-[11px] text-muted-foreground">
          The question is read literally. Ask one thing, phrase it positively,
          and avoid “and” or “or”.
        </p>
      </InspectorField>
      <InspectorField label="Answer type">
        <WorkflowSelect
          ariaLabel="Answer type"
          value={output.kind}
          onValueChange={(value) =>
            set({ output: defaultOutput(value as FlowClassifyOutputKind) }, "kind")
          }
          options={KIND_OPTIONS}
        />
      </InspectorField>

      {output.kind === "choice" && (
        <div className="space-y-2">
          {output.options.map((option, index) => (
            <div key={option.id} className="space-y-1.5 rounded-md border border-border/60 bg-background/40 p-3">
              <div className="flex items-center gap-2">
                <Input
                  aria-label={`Option ${index + 1}`}
                  value={option.label}
                  placeholder={`Option ${index + 1}`}
                  onChange={(event) =>
                    set({
                      output: {
                        kind: "choice",
                        options: output.options.map((item) =>
                          item.id === option.id ? { ...item, label: event.target.value } : item),
                      },
                    }, `option-label-${option.id}`)
                  }
                />
                {output.options.length > 2 && (
                  <button
                    type="button"
                    aria-label={`Remove option ${index + 1}`}
                    onClick={() =>
                      set({
                        output: {
                          kind: "choice",
                          options: output.options.filter((item) => item.id !== option.id),
                        },
                      }, `option-remove-${option.id}`)
                    }
                    className="text-[11px] text-muted-foreground hover:text-destructive"
                  >
                    Remove
                  </button>
                )}
              </div>
              <Input
                aria-label={`Option ${index + 1} description`}
                value={option.description ?? ""}
                placeholder="When this option applies (optional)"
                onChange={(event) =>
                  set({
                    output: {
                      kind: "choice",
                      options: output.options.map((item) =>
                        item.id === option.id ? { ...item, description: event.target.value } : item),
                    },
                  }, `option-description-${option.id}`)
                }
              />
            </div>
          ))}
          {output.options.length < CLASSIFY_MAX_OPTIONS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                set({
                  output: {
                    kind: "choice",
                    options: [...output.options, { id: newOptionId(output.options), label: "" }],
                  },
                }, `option-add-${output.options.length}`)
              }
            >
              Add option
            </Button>
          )}
        </div>
      )}

      {output.kind === "scale" && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Levels run from lowest to highest. The answer is the level’s
            position, starting at 1. Branch on it with an If node.
          </p>
          {output.levels.map((level, index) => (
            // Levels have no identity beyond their position on the scale.
            <div key={index} className="flex items-center gap-2">
              <span className="w-4 text-right text-[11px] text-muted-foreground">{index + 1}</span>
              <Input
                aria-label={`Level ${index + 1}`}
                value={level}
                onChange={(event) =>
                  set({
                    output: {
                      kind: "scale",
                      levels: output.levels.map((item, i) => (i === index ? event.target.value : item)),
                    },
                  }, `level-${index}`)
                }
              />
              {output.levels.length > 2 && (
                <button
                  type="button"
                  aria-label={`Remove level ${index + 1}`}
                  onClick={() =>
                    set({
                      output: { kind: "scale", levels: output.levels.filter((_, i) => i !== index) },
                    }, `level-remove-${index}-${output.levels.length}`)
                  }
                  className="text-[11px] text-muted-foreground hover:text-destructive"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {output.levels.length < CLASSIFY_MAX_LEVELS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                set({ output: { kind: "scale", levels: [...output.levels, ""] } }, `level-add-${output.levels.length}`)
              }
            >
              Add level
            </Button>
          )}
        </div>
      )}

      <InspectorField label="Result variable">
        <Input
          aria-label="Result variable"
          value={data.resultKey}
          onChange={(event) => set({ resultKey: event.target.value.trim() }, "result-key")}
        />
        <p className="text-[11px] text-muted-foreground">
          Later nodes read {`state.${data.resultKey || "name"}.answer`},{" "}
          <code>.confidence</code>, and <code>.probabilities</code>.
        </p>
      </InspectorField>
      <InspectorField label="Minimum confidence (%)">
        <Input
          aria-label="Minimum confidence"
          type="number"
          min={1}
          max={99}
          value={floorPercent}
          placeholder="Off"
          onChange={(event) => {
            const percent = Number(event.target.value)
            const valid = event.target.value.trim() !== "" && Number.isFinite(percent)
            set({ minConfidence: valid ? percent / 100 : null }, "min-confidence")
          }}
        />
        <p className="text-[11px] text-muted-foreground">
          Answers below this leave through the Uncertain branch. Leave empty to
          always take the answer.
        </p>
      </InspectorField>
      <ClassifyTestPanel data={data} />
      <div className="flex justify-end border-t border-border/60 pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash />
          Delete node
        </Button>
      </div>
    </>
  )
}
