"use client"

import { cn } from "@/lib/utils"
import { LightBulb, WarningTriangle } from "iconoir-react"
import { flowAgentHarnessLabel } from "@/lib/flows/graph"
import type { FlowCanvasNode } from "@/lib/flows/editor"
import type { FlowAgentHarness, FlowNode } from "@/lib/types"
import {
  DEFAULT_AGENT_MAX_STEPS_PLACEHOLDER,
  DEFAULT_AGENT_TIMEOUT_LABEL,
  FLOW_AGENT_ROLE_OPTIONS,
  FLOW_AGENT_HARNESS_OPTIONS,
} from "./constants"
import type { AutomationHarnessesResponse } from "./types"
import {
  WorkflowSelect,
  InspectorField,
  InspectorCallout,
  InspectorSummaryItem,
} from "./inspector-shared"
import { FlowHarnessIcon } from "./node-shells"

type AgentNodeData = Extract<FlowNode, { type: "agent" }>["data"]

type UpdateNodeData = (
  nodeId: string,
  updater: (data: Record<string, unknown>) => Record<string, unknown>,
  options?: { mergeKey?: string | null },
) => void

export interface MogplexModelSectionProps {
  node: FlowCanvasNode & { data: AgentNodeData }
  updateNodeData: UpdateNodeData
  selectedAgentOverrideUsesUnavailableModel: boolean
  selectedAgentHasNoModel: boolean
  selectedAgentModelSelectValue: string
  availableModelOptions: Array<{ id: string; label: string }>
  quickReplaceFlowModelId: string
  quickReplaceFlowModelName: string
  canQuickReplaceFlowModel: boolean
}

export function MogplexModelSection({
  node,
  updateNodeData,
  selectedAgentOverrideUsesUnavailableModel,
  selectedAgentHasNoModel,
  selectedAgentModelSelectValue,
  availableModelOptions,
  quickReplaceFlowModelId,
  quickReplaceFlowModelName,
  canQuickReplaceFlowModel,
}: MogplexModelSectionProps) {
  return (
    <>
      {selectedAgentOverrideUsesUnavailableModel && (
        <InspectorCallout
          variant="warn"
          icon={<WarningTriangle />}
          testId="flows-legacy-model-warning"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-amber-500/40 dark:border-amber-300/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-amber-700 dark:text-amber-200">
              Model unavailable
            </span>
            <span>This node override is not enabled for this account.</span>
          </div>
          <div className="mt-2 font-mono text-[11px] break-all text-amber-800 dark:text-amber-100/90">{node.data.modelOverride}</div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="flows-legacy-model-replace"
              onClick={() => {
                if (!quickReplaceFlowModelId) return
                updateNodeData(node.id, (data) => ({
                  ...data,
                  modelOverride: quickReplaceFlowModelId,
                }), { mergeKey: `agent-model-replace-${node.id}` })
              }}
              disabled={!canQuickReplaceFlowModel}
              className="rounded border border-amber-500/30 bg-amber-500/10 dark:border-amber-200/30 dark:bg-amber-100/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-100 disabled:opacity-50"
            >
              Replace override with {quickReplaceFlowModelName || "enabled model"}
            </button>
            <span className="text-[11px] text-amber-800 dark:text-amber-100/80">Or choose another enabled model from the selector.</span>
          </div>
        </InspectorCallout>
      )}
      {selectedAgentHasNoModel && (
        <InspectorCallout
          variant="warn"
          icon={<WarningTriangle />}
          testId="flows-missing-model-warning"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-amber-500/40 dark:border-amber-300/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-amber-700 dark:text-amber-200">
              No model
            </span>
            <span>This step has no model selected and cannot run. Choose one below.</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="flows-missing-model-replace"
              onClick={() => {
                if (!quickReplaceFlowModelId) return
                updateNodeData(node.id, (data) => ({
                  ...data,
                  modelOverride: quickReplaceFlowModelId,
                }), { mergeKey: `agent-model-replace-${node.id}` })
              }}
              disabled={!canQuickReplaceFlowModel}
              className="rounded border border-amber-500/30 bg-amber-500/10 dark:border-amber-200/30 dark:bg-amber-100/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-100 disabled:opacity-50"
            >
              Use {quickReplaceFlowModelName || "an enabled model"}
            </button>
            <span className="text-[11px] text-amber-800 dark:text-amber-100/80">Or choose another enabled model from the selector.</span>
          </div>
        </InspectorCallout>
      )}
      <InspectorField label="Model">
        <WorkflowSelect
          ariaLabel="Model"
          value={selectedAgentModelSelectValue}
          onValueChange={(value) => updateNodeData(node.id, (data) => ({
            ...data,
            modelOverride: value || null,
          }), { mergeKey: `agent-model-${node.id}` })}
          contentClassName="min-w-[min(520px,calc(100vw-32px))]"
          options={[
            { value: "", label: "Select a model..." },
            ...availableModelOptions.map((model) => ({
              value: model.id,
              label: model.label,
            })),
          ]}
        />
      </InspectorField>
      <InspectorField label="Fallback model">
        <WorkflowSelect
          ariaLabel="Fallback model"
          value={node.data.fallbackModelOverride ?? ""}
          onValueChange={(value) => updateNodeData(node.id, (data) => ({
            ...data,
            fallbackModelOverride: value || null,
          }), { mergeKey: `agent-fallback-model-${node.id}` })}
          contentClassName="min-w-[min(520px,calc(100vw-32px))]"
          options={[
            { value: "", label: "Default fallback pool" },
            ...availableModelOptions.map((model) => ({
              value: model.id,
              label: model.label,
            })),
          ]}
        />
      </InspectorField>
      <InspectorCallout variant="info" icon={<LightBulb />}>
        If the primary model hits upstream issues during a run, the fallback model takes over. Leave unset to use the shared fallback pool.
      </InspectorCallout>
      <InspectorCallout variant="info" icon={<LightBulb />}>
        The model is set per step, here. Agents supply the prompt and role; each automation chooses what it runs on.
      </InspectorCallout>
    </>
  )
}

export interface HarnessSectionProps {
  node: FlowCanvasNode & { data: AgentNodeData }
  updateNodeData: UpdateNodeData
  selectedAgentHarness: FlowAgentHarness
  harnessesResponse: AutomationHarnessesResponse | undefined
}

export function HarnessSection({
  node,
  updateNodeData,
  selectedAgentHarness,
  harnessesResponse,
}: HarnessSectionProps) {
  return (
    <InspectorField label="Harness">
      <div
        role="radiogroup"
        aria-label="Harness"
        className="flex flex-col gap-2"
      >
        {FLOW_AGENT_HARNESS_OPTIONS.map((option) => {
          const availability = harnessesResponse?.harnesses[option.value]
          const isSelected = selectedAgentHarness === option.value
          const isAvailable = option.value === "mogplex" || availability?.available === true

          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={option.label}
              disabled={!isAvailable}
              onClick={() => updateNodeData(node.id, (data) => ({
                ...data,
                harness: option.value,
                ...(option.value === "mogplex"
                  ? {}
                  : {
                      agentId: null,
                      autofix: false,
                      autofixSandbox: false,
                      autoRevert: false,
                      requireApproval: false,
                    }),
              }), { mergeKey: `agent-harness-${node.id}` })}
              className={cn(
                "group relative flex min-w-0 items-center rounded-lg border px-3 py-3 text-left transition-colors",
                isSelected
                  ? "border-orange-400/60 bg-orange-400/[0.10] text-foreground"
                  : "border-border/70 bg-card/50 text-muted-foreground hover:border-border hover:bg-card/80",
                !isAvailable && "cursor-not-allowed opacity-45",
              )}
            >
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <span className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-md border [&_svg]:size-4",
                  isSelected
                    ? "border-orange-400/30 bg-orange-400/[0.12] text-orange-700 dark:text-orange-300"
                    : "border-border/70 bg-background/70 text-muted-foreground",
                )}>
                  <FlowHarnessIcon
                    harness={option.value}
                    className="size-4"
                    data-testid={`flow-harness-icon-${option.value}`}
                  />
                </span>
                <span className="min-w-0 max-w-full">
                  <span
                    data-testid={`flow-harness-label-${option.value}`}
                    className="block text-xs font-semibold leading-4 text-current"
                  >
                    {option.label}
                  </span>
                  <span
                    data-testid={`flow-harness-description-${option.value}`}
                    className="mt-0.5 block text-[10px] leading-4 text-muted-foreground"
                  >
                    {option.description}
                  </span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </InspectorField>
  )
}

export interface EffectiveConfigSectionProps {
  node: FlowCanvasNode & { data: AgentNodeData }
  selectedAgentHarness: FlowAgentHarness
  selectedAgentEffectiveModel: string
  selectedAgentRoleOption: (typeof FLOW_AGENT_ROLE_OPTIONS)[number]
  selectedAgentEffectivePrompt: string | null
}

export function EffectiveConfigSection({
  node,
  selectedAgentHarness,
  selectedAgentEffectiveModel,
  selectedAgentRoleOption,
  selectedAgentEffectivePrompt,
}: EffectiveConfigSectionProps) {
  return (
    <div className="rounded-lg border border-border/80 bg-card/60 p-4">
      <div className="ui-kicker">Effective config</div>
      <div className="mt-3 space-y-3">
        <InspectorSummaryItem label="Harness">
          {flowAgentHarnessLabel(selectedAgentHarness)}
        </InspectorSummaryItem>
        <div className="grid gap-3 @xs:grid-cols-2">
          <InspectorSummaryItem label={selectedAgentHarness === "mogplex" ? "Model" : "Runtime"}>
            {selectedAgentEffectiveModel}
          </InspectorSummaryItem>
          <InspectorSummaryItem label="Task">
            {selectedAgentRoleOption.label}
          </InspectorSummaryItem>
        </div>
        {selectedAgentHarness === "mogplex" && (
          <div className="grid gap-3 @xs:grid-cols-2">
            <InspectorSummaryItem label="Max steps">
              {typeof node.data.maxStepsOverride === "number"
                ? node.data.maxStepsOverride
                : DEFAULT_AGENT_MAX_STEPS_PLACEHOLDER}
            </InspectorSummaryItem>
            <InspectorSummaryItem label="Timeout">
              {typeof node.data.timeoutMsOverride === "number"
                ? `${Math.round(node.data.timeoutMsOverride / 1000)}s`
                : DEFAULT_AGENT_TIMEOUT_LABEL}
            </InspectorSummaryItem>
          </div>
        )}
        <InspectorSummaryItem label="Prompt mode">
          {selectedAgentEffectivePrompt ? "Node override or base prompt configured" : "No prompt configured"}
        </InspectorSummaryItem>
      </div>
    </div>
  )
}
