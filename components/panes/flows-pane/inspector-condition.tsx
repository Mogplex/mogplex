"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Trash } from "iconoir-react"
import {
  conditionOperatorLabel,
  FLOW_CONDITION_FIELD_PRESETS,
  VALUE_LESS_CONDITION_OPERATORS,
} from "@/lib/flows/graph"
import type { FlowConditionOperator, FlowConditionRule, FlowConditionRuleMode, FlowNode } from "@/lib/types"
import type { FlowCanvasNode } from "@/lib/flows/editor"
import { CONDITION_OPERATOR_OPTIONS } from "./constants"
import { WorkflowSelect, WorkflowCombobox, InspectorField } from "./inspector-shared"

type ConditionNodeData = Extract<FlowNode, { type: "condition" }>["data"]

export interface ConditionInspectorProps {
  node: FlowCanvasNode & { data: ConditionNodeData }
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
  onDelete: () => void
}

export function ConditionInspector({
  node,
  updateNodeData,
  onDelete,
}: ConditionInspectorProps) {
  const conditionData = node.data
  const conditionRules: FlowConditionRule[] = Array.isArray(conditionData.rules) ? conditionData.rules : []
  const conditionMode: FlowConditionRuleMode = conditionData.mode === "any" ? "any" : "all"

  const updateRules = (next: FlowConditionRule[], mergeKey: string) => {
    updateNodeData(node.id, (data) => ({
      ...data,
      rules: next,
    }), { mergeKey })
  }

  return (
    <>
      <InspectorField label="Label">
        <Input
          aria-label="Label"
          value={String(conditionData.label || "")}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            label: event.target.value,
          }), { mergeKey: `condition-label-${node.id}` })}
        />
      </InspectorField>
      {conditionRules.length > 1 && (
        <InspectorField label="Match">
          <WorkflowSelect
            ariaLabel="Match"
            value={conditionMode}
            onValueChange={(value) => updateNodeData(node.id, (data) => ({
              ...data,
              mode: value === "any" ? "any" : "all",
            }), { mergeKey: `condition-mode-${node.id}` })}
            options={[
              { value: "all", label: "All rules (and)" },
              { value: "any", label: "Any rule (or)" },
            ]}
          />
        </InspectorField>
      )}
      <div className="space-y-3">
        {conditionRules.map((rule, ruleIndex) => {
          const ruleKey = `condition-rule-${node.id}-${ruleIndex}`
          return (
            <div key={ruleKey} className="space-y-2 rounded-md border border-border/60 bg-background/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {ruleIndex === 0 ? "Rule" : conditionMode === "any" ? "Or" : "And"}
                </span>
                {conditionRules.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = conditionRules.filter((_, i) => i !== ruleIndex)
                      updateRules(next, `${ruleKey}-remove`)
                    }}
                    className="text-[11px] text-muted-foreground hover:text-destructive"
                  >
                    Remove
                  </button>
                )}
              </div>
              <InspectorField label="Source field">
                <WorkflowCombobox
                  ariaLabel="Source field"
                  value={rule.field}
                  onValueChange={(value) => {
                    const next = conditionRules.map((r, i) => i === ruleIndex ? { ...r, field: value } : r)
                    updateRules(next, `${ruleKey}-field`)
                  }}
                  options={FLOW_CONDITION_FIELD_PRESETS.map((preset) => ({
                    value: preset.value,
                    label: preset.label,
                  }))}
                />
              </InspectorField>
              <InspectorField label="Operator">
                <WorkflowSelect
                  ariaLabel="Operator"
                  value={rule.operator}
                  onValueChange={(value) => {
                    const next = conditionRules.map((r, i) => i === ruleIndex
                      ? { ...r, operator: value as FlowConditionOperator }
                      : r)
                    updateRules(next, `${ruleKey}-operator`)
                  }}
                  options={CONDITION_OPERATOR_OPTIONS.map((operator) => ({
                    value: operator,
                    label: conditionOperatorLabel(operator),
                  }))}
                />
              </InspectorField>
              {!VALUE_LESS_CONDITION_OPERATORS.has(rule.operator) && (
                <InspectorField
                  label={
                    rule.operator === "in" || rule.operator === "not_in"
                      ? "Values (comma-separated)"
                      : "Compare value"
                  }
                >
                  <Input
                    value={rule.value}
                    onChange={(event) => {
                      const next = conditionRules.map((r, i) => i === ruleIndex ? { ...r, value: event.target.value } : r)
                      updateRules(next, `${ruleKey}-value`)
                    }}
                  />
                </InspectorField>
              )}
            </div>
          )
        })}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          const next: FlowConditionRule[] = [
            ...conditionRules,
            { field: "metadata.source_type", operator: "equals", value: "" },
          ]
          updateRules(next, `condition-rule-add-${node.id}-${next.length}`)
        }}
      >
        Add rule
      </Button>
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
