"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { InfoCircle, Trash, WarningTriangle } from "iconoir-react"
import {
  flowAgentHarnessLabel,
  flowAgentRoleLabel,
  isCommentTriggerEvent,
  hasUpstreamAgentRole,
} from "@/lib/flows/graph"
import { draftToGraph, type FlowCanvasNode, type FlowDraftSnapshot } from "@/lib/flows/editor"
import type { Agent, FlowAgentHarness, FlowNode, Repo, TriggerEvent } from "@/lib/types"
import {
  DEFAULT_AGENT_MAX_STEPS_PLACEHOLDER,
  DEFAULT_AGENT_TIMEOUT_SECONDS_PLACEHOLDER,
  FLOW_AGENT_ROLE_OPTIONS,
} from "./constants"
import type { AutomationSandboxTestResult, AutomationHarnessesResponse } from "./types"
import {
  WorkflowSelect,
  InspectorField,
  InspectorCallout,
} from "./inspector-shared"
import { getRoleTheme } from "./node-shells"
import {
  MogplexModelSection,
  HarnessSection,
  EffectiveConfigSection,
} from "./inspector-agent-harness"
import { ReviewOptionsSection } from "./inspector-agent-review"

type AgentNodeData = Extract<FlowNode, { type: "agent" }>["data"]

export interface AgentInspectorProps {
  node: FlowCanvasNode & { data: AgentNodeData }
  draft: FlowDraftSnapshot | null
  agents: Agent[]
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
  onDelete: () => void
  selectedAgentDefinition: Agent | null
  availableModelOptions: Array<{ id: string; label: string }>
  enabledModelIds: Set<string>
  quickReplaceFlowModelId: string
  quickReplaceFlowModelName: string
  canQuickReplaceFlowModel: boolean
  harnessesResponse: AutomationHarnessesResponse | undefined
  harnessesLoading: boolean
  harnessesError: unknown
  apiKeysSettingsHref: string
  sandboxTestRepoId: string
  onSandboxTestRepoIdChange: (id: string) => void
  sandboxTestRepos: Repo[]
  sandboxTestResult: AutomationSandboxTestResult | null
  sandboxTestError: string | null
  sandboxTestRunning: boolean
  onRunSandboxTest: () => void
  onClearSandboxTest: () => void
  selectedStartConfig: {
    event: TriggerEvent
    filter?: { repos?: string[] }
  } | null
}

export function AgentInspector({
  node,
  draft,
  agents,
  updateNodeData,
  onDelete,
  selectedAgentDefinition,
  availableModelOptions,
  enabledModelIds,
  quickReplaceFlowModelId,
  quickReplaceFlowModelName,
  canQuickReplaceFlowModel,
  harnessesResponse,
  harnessesLoading,
  harnessesError,
  apiKeysSettingsHref,
  sandboxTestRepoId,
  onSandboxTestRepoIdChange,
  sandboxTestRepos,
  sandboxTestResult,
  sandboxTestError,
  sandboxTestRunning,
  onRunSandboxTest,
  onClearSandboxTest,
  selectedStartConfig,
}: AgentInspectorProps) {
  const selectedAgentHarness: FlowAgentHarness = node.data.harness ?? "mogplex"
  const selectedHarnessAvailability = harnessesResponse?.harnesses[selectedAgentHarness] ?? null
  const selectedHarnessUnavailable = selectedAgentHarness !== "mogplex"
    && selectedHarnessAvailability?.available !== true
  const selectedAgentOverrideIsEnabled = Boolean(
    node.data.modelOverride
    && enabledModelIds.has(node.data.modelOverride),
  )
  const selectedAgentModelSelectValue = node.data.modelOverride ?? ""
  const selectedAgentOverrideUsesUnavailableModel = Boolean(
    selectedAgentHarness === "mogplex"
    && node.data.modelOverride
    && !selectedAgentOverrideIsEnabled
  )
  const selectedAgentHasNoModel = Boolean(
    selectedAgentHarness === "mogplex" && !node.data.modelOverride,
  )
  const selectedAgentRoleOption = FLOW_AGENT_ROLE_OPTIONS.find(
    (option) => option.value === (node.data.role || "review")
  ) || FLOW_AGENT_ROLE_OPTIONS[0]
  const selectedAgentNeedsReviewInput = (() => {
    if (!draft || node.data.role !== "edit") {
      return false
    }
    if (isCommentTriggerEvent(selectedStartConfig?.event)) {
      return false
    }
    return !hasUpstreamAgentRole(draftToGraph(draft), node.id, "review")
  })()
  const selectedAgentEffectiveModel = selectedAgentHarness === "mogplex"
    ? node.data.modelOverride || "No model selected"
    : flowAgentHarnessLabel(selectedAgentHarness)
  const selectedAgentEffectivePrompt = node.data.systemPromptOverride || selectedAgentDefinition?.system_prompt || null

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="ui-kicker">Agent node</div>
        <span className={`rounded-full border px-3 py-1 text-[11px] ${getRoleTheme(node.data.role || "review").badge}`}>
          {flowAgentRoleLabel(node.data.role || "review")}
        </span>
      </div>

      {selectedAgentHarness === "mogplex" && (
        <MogplexModelSection
          node={node}
          updateNodeData={updateNodeData}
          selectedAgentOverrideUsesUnavailableModel={selectedAgentOverrideUsesUnavailableModel}
          selectedAgentHasNoModel={selectedAgentHasNoModel}
          selectedAgentModelSelectValue={selectedAgentModelSelectValue}
          availableModelOptions={availableModelOptions}
          quickReplaceFlowModelId={quickReplaceFlowModelId}
          quickReplaceFlowModelName={quickReplaceFlowModelName}
          canQuickReplaceFlowModel={canQuickReplaceFlowModel}
        />
      )}

      <HarnessSection
        node={node}
        updateNodeData={updateNodeData}
        selectedAgentHarness={selectedAgentHarness}
        harnessesResponse={harnessesResponse}
      />

      {selectedHarnessUnavailable && (
        <InspectorCallout variant="warn" icon={<WarningTriangle />}>
          <span>
            {harnessesLoading
              ? `Checking ${flowAgentHarnessLabel(selectedAgentHarness)} access...`
              : selectedHarnessAvailability?.reason
                || (harnessesError instanceof Error
                  ? harnessesError.message
                  : `${flowAgentHarnessLabel(selectedAgentHarness)} needs a provider API key.`)}
          </span>{" "}
          <a href={apiKeysSettingsHref} className="font-medium text-amber-800 dark:text-amber-100 underline underline-offset-2">
            Open API Keys
          </a>
        </InspectorCallout>
      )}

      <EffectiveConfigSection
        node={node}
        selectedAgentHarness={selectedAgentHarness}
        selectedAgentEffectiveModel={selectedAgentEffectiveModel}
        selectedAgentRoleOption={selectedAgentRoleOption}
        selectedAgentEffectivePrompt={selectedAgentEffectivePrompt}
      />

      <InspectorField label="Label">
        <Input
          value={String(node.data.label || "")}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            label: event.target.value,
          }), { mergeKey: `agent-label-${node.id}` })}
        />
      </InspectorField>

      {selectedAgentHarness === "mogplex" ? (
        <InspectorField label="Mogplex agent">
          <WorkflowSelect
            ariaLabel="Mogplex agent"
            value={String(node.data.agentId || "")}
            onValueChange={(value) => {
              const nextAgent = (agents || []).find((agent) => agent.id === value) || null
              updateNodeData(node.id, (data) => ({
                ...data,
                agentId: value || null,
                label: nextAgent?.name || data.label,
              }), { mergeKey: `agent-binding-${node.id}` })
            }}
            options={[
              { value: "", label: "Select agent..." },
              ...(agents || []).map((agent) => ({
                value: agent.id,
                label: `${agent.name}${agent.slug ? ` (${agent.slug})` : ""}`,
              })),
            ]}
          />
        </InspectorField>
      ) : (
        <InspectorCallout variant="info" icon={<InfoCircle />}>
          {flowAgentHarnessLabel(selectedAgentHarness)} runs this node inside a fresh repo sandbox using the configured provider key.
        </InspectorCallout>
      )}

      <InspectorField label="Agent task">
        <WorkflowSelect
          ariaLabel="Agent task"
          value={node.data.role || "review"}
          onValueChange={(value) => updateNodeData(node.id, (data) => ({
            ...data,
            role: value,
          }), { mergeKey: `agent-role-${node.id}` })}
          options={FLOW_AGENT_ROLE_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
      </InspectorField>
      <InspectorCallout variant="hint" icon={<InfoCircle />}>
        {selectedAgentRoleOption.description}
      </InspectorCallout>
      {selectedAgentNeedsReviewInput && (
        <InspectorCallout variant="warn" icon={<WarningTriangle />}>
          Add a Review node before this fix node, or change the start trigger to a pull request comment event (@mogplex mention or PR comment) so the comment itself can drive the fix.
        </InspectorCallout>
      )}

      {(node.data.role || "review") === "review" && (
        <ReviewOptionsSection
          node={node}
          updateNodeData={updateNodeData}
          selectedAgentHarness={selectedAgentHarness}
          selectedStartConfig={selectedStartConfig}
          sandboxTestRepoId={sandboxTestRepoId}
          onSandboxTestRepoIdChange={onSandboxTestRepoIdChange}
          sandboxTestRepos={sandboxTestRepos}
          sandboxTestResult={sandboxTestResult}
          sandboxTestError={sandboxTestError}
          sandboxTestRunning={sandboxTestRunning}
          onRunSandboxTest={onRunSandboxTest}
          onClearSandboxTest={onClearSandboxTest}
        />
      )}

      {selectedAgentHarness === "mogplex" && (
        <div className="grid gap-3 @xs:grid-cols-2">
          <InspectorField label="Max steps override">
            <Input
              aria-label="Max steps override"
              type="number"
              min={1}
              step={1}
              placeholder={DEFAULT_AGENT_MAX_STEPS_PLACEHOLDER}
              value={node.data.maxStepsOverride ?? ""}
              onChange={(event) => updateNodeData(node.id, (data) => ({
                ...data,
                maxStepsOverride: event.target.value ? Number(event.target.value) : null,
              }), { mergeKey: `agent-max-steps-${node.id}` })}
            />
          </InspectorField>
          <InspectorField label="Timeout override (seconds)">
            <Input
              aria-label="Timeout override (seconds)"
              type="number"
              min={1}
              step={1}
              placeholder={DEFAULT_AGENT_TIMEOUT_SECONDS_PLACEHOLDER}
              value={typeof node.data.timeoutMsOverride === "number"
                ? Math.round(node.data.timeoutMsOverride / 1000)
                : ""}
              onChange={(event) => updateNodeData(node.id, (data) => ({
                ...data,
                timeoutMsOverride: event.target.value ? Number(event.target.value) * 1000 : null,
              }), { mergeKey: `agent-timeout-${node.id}` })}
            />
          </InspectorField>
        </div>
      )}

      <InspectorField label="Instructions / prompt">
        <Textarea
          aria-label="System prompt override"
          data-testid="flow-agent-instructions"
          value={node.data.systemPromptOverride ?? ""}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            systemPromptOverride: event.target.value || null,
          }), { mergeKey: `agent-system-prompt-${node.id}` })}
          rows={6}
          className="font-mono text-[12px]"
        />
      </InspectorField>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {selectedAgentHarness === "mogplex" ? "Base agent" : "Execution"}
          </span>
          <span className="truncate text-xs text-foreground">
            {selectedAgentHarness === "mogplex"
              ? selectedAgentDefinition?.name || "Unassigned"
              : `${flowAgentHarnessLabel(selectedAgentHarness)} sandbox`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => updateNodeData(node.id, (data) => ({
              ...data,
              modelOverride: null,
              maxStepsOverride: null,
              timeoutMsOverride: null,
              systemPromptOverride: null,
            }), { mergeKey: `agent-clear-overrides-${node.id}` })}
          >
            Clear overrides
          </Button>
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
      </div>
    </>
  )
}
