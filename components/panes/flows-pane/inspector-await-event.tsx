"use client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Trash } from "iconoir-react"
import type {
  FlowAwaitEventConfig,
  FlowAwaitEventKind,
  FlowCiWorkflowConclusion,
  FlowNode,
} from "@/lib/types"
import type { FlowCanvasNode } from "@/lib/flows/editor"
import { WorkflowSelect, InspectorField } from "./inspector-shared"

type AwaitEventNodeData = Extract<FlowNode, { type: "await_event" }>["data"]

export interface AwaitEventInspectorProps {
  node: FlowCanvasNode & { data: AwaitEventNodeData }
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
  onDelete: () => void
}

export function AwaitEventInspector({
  node,
  updateNodeData,
  onDelete,
}: AwaitEventInspectorProps) {
  const awaitData = node.data
  const awaitConfig = awaitData.config
  const awaitTimeout = awaitData.timeout ?? null

  return (
    <>
      <InspectorField label="Label">
        <Input
          value={String(awaitData.label || "")}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            label: event.target.value,
          }), { mergeKey: `await-label-${node.id}` })}
        />
      </InspectorField>
      <InspectorField label="Wait kind">
        <WorkflowSelect
          ariaLabel="Wait kind"
          value={awaitConfig.kind}
          onValueChange={(value) => updateNodeData(node.id, (data) => {
            const kind = value as FlowAwaitEventKind
            const config: FlowAwaitEventConfig =
              kind === "github_comment_added"
                ? {
                    kind,
                    bodyContains: "",
                    authorLogin: "",
                    prOnly: true,
                    matchTriggerIssue: true,
                  }
                : kind === "ci_workflow_completed"
                ? {
                    kind,
                    workflowName: "",
                    conclusion: "success",
                    matchTriggerSha: true,
                  }
                : kind === "vercel_preview_ready"
                  ? {
                      kind,
                      environment: "Preview",
                      matchTriggerSha: true,
                    }
                  : kind === "manual_approval"
                    ? {
                        kind,
                        prompt: "",
                      }
                    : {
                        kind: "github_label_added",
                        labelName: "",
                        prOnly: true,
                      }
            return { ...data, config }
          }, { mergeKey: `await-kind-${node.id}` })}
          options={[
            {
              value: "github_label_added",
              label: "GitHub label added",
            },
            {
              value: "github_comment_added",
              label: "GitHub comment added",
            },
            {
              value: "ci_workflow_completed",
              label: "GitHub Actions / CI completed",
            },
            {
              value: "vercel_preview_ready",
              label: "Vercel preview ready",
            },
            {
              value: "manual_approval",
              label: "Manual approval",
            },
          ]}
        />
      </InspectorField>
      {awaitConfig.kind === "github_label_added" && (
        <GitHubLabelAddedFields
          config={awaitConfig}
          nodeId={node.id}
          updateNodeData={updateNodeData}
        />
      )}
      {awaitConfig.kind === "github_comment_added" && (
        <GitHubCommentAddedFields
          config={awaitConfig}
          nodeId={node.id}
          updateNodeData={updateNodeData}
        />
      )}
      {awaitConfig.kind === "ci_workflow_completed" && (
        <CiWorkflowCompletedFields
          config={awaitConfig}
          nodeId={node.id}
          updateNodeData={updateNodeData}
        />
      )}
      {awaitConfig.kind === "vercel_preview_ready" && (
        <VercelPreviewReadyFields
          config={awaitConfig}
          nodeId={node.id}
          updateNodeData={updateNodeData}
        />
      )}
      {awaitConfig.kind === "manual_approval" && (
        <ManualApprovalFields
          config={awaitConfig}
          nodeId={node.id}
          updateNodeData={updateNodeData}
        />
      )}
      <div className="grid gap-3 @xs:grid-cols-2">
        <InspectorField label="Timeout">
          <Input
            type="number"
            min={0}
            step={1}
            value={awaitTimeout?.value ?? ""}
            placeholder="No timeout"
            onChange={(event) => updateNodeData(node.id, (data) => {
              const value = Number(event.target.value)
              if (!Number.isFinite(value) || value <= 0) {
                return { ...data, timeout: null }
              }
              const current = (data.timeout ?? {}) as Record<string, unknown>
              const unit = current.unit === "minutes" || current.unit === "days" ? current.unit : "hours"
              return { ...data, timeout: { value, unit } }
            }, { mergeKey: `await-timeout-value-${node.id}` })}
          />
        </InspectorField>
        <InspectorField label="Timeout unit">
          <WorkflowSelect
            ariaLabel="Timeout unit"
            value={awaitTimeout?.unit ?? "hours"}
            onValueChange={(value) => updateNodeData(node.id, (data) => {
              const unit = value as "minutes" | "hours" | "days"
              const current = (data.timeout ?? null) as { value?: number } | null
              if (!current || typeof current.value !== "number") return data
              return { ...data, timeout: { value: current.value, unit } }
            }, { mergeKey: `await-timeout-unit-${node.id}` })}
            options={[
              { value: "minutes", label: "Minutes" },
              { value: "hours", label: "Hours" },
              { value: "days", label: "Days" },
            ]}
          />
        </InspectorField>
      </div>
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

interface GitHubLabelAddedFieldsProps {
  config: Extract<FlowAwaitEventConfig, { kind: "github_label_added" }>
  nodeId: string
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
}

function GitHubLabelAddedFields({
  config,
  nodeId,
  updateNodeData,
}: GitHubLabelAddedFieldsProps) {
  return (
    <>
      <InspectorField label="Label name">
        <Input
          value={config.labelName}
          placeholder="e.g. ready-to-merge"
          onChange={(event) => updateNodeData(nodeId, (data) => {
            const current = (data.config ?? {}) as Record<string, unknown>
            return {
              ...data,
              config: {
                kind: "github_label_added",
                labelName: event.target.value,
                prOnly: current.prOnly === true,
              },
            }
          }, { mergeKey: `await-label-name-${nodeId}` })}
        />
      </InspectorField>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          checked={config.prOnly === true}
          onCheckedChange={(checked) => updateNodeData(nodeId, (data) => {
            const current = (data.config ?? {}) as Record<string, unknown>
            return {
              ...data,
              config: {
                kind: "github_label_added",
                labelName: typeof current.labelName === "string" ? current.labelName : "",
                prOnly: checked === true,
              },
            }
          }, { mergeKey: `await-pr-only-${nodeId}` })}
        />
        Match pull request labels only (skip issue labels)
      </label>
    </>
  )
}

interface GitHubCommentAddedFieldsProps {
  config: Extract<FlowAwaitEventConfig, { kind: "github_comment_added" }>
  nodeId: string
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
}

function GitHubCommentAddedFields({
  config,
  nodeId,
  updateNodeData,
}: GitHubCommentAddedFieldsProps) {
  return (
    <>
      <InspectorField label="Comment contains">
        <Input
          data-testid="flow-await-comment-contains"
          value={config.bodyContains}
          placeholder="Optional text, e.g. approved"
          onChange={(event) => updateNodeData(nodeId, (data) => ({
            ...data,
            config: {
              ...(data.config as Extract<FlowAwaitEventConfig, { kind: "github_comment_added" }>),
              kind: "github_comment_added",
              bodyContains: event.target.value,
            },
          }), { mergeKey: `await-comment-contains-${nodeId}` })}
        />
      </InspectorField>
      <InspectorField label="Comment author">
        <Input
          data-testid="flow-await-comment-author"
          value={config.authorLogin}
          placeholder="Optional GitHub login"
          onChange={(event) => updateNodeData(nodeId, (data) => ({
            ...data,
            config: {
              ...(data.config as Extract<FlowAwaitEventConfig, { kind: "github_comment_added" }>),
              kind: "github_comment_added",
              authorLogin: event.target.value.replace(/^@/, ""),
            },
          }), { mergeKey: `await-comment-author-${nodeId}` })}
        />
      </InspectorField>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          data-testid="flow-await-comment-match-trigger"
          checked={config.matchTriggerIssue !== false}
          onCheckedChange={(checked) => updateNodeData(nodeId, (data) => ({
            ...data,
            config: {
              ...(data.config as Extract<FlowAwaitEventConfig, { kind: "github_comment_added" }>),
              kind: "github_comment_added",
              matchTriggerIssue: checked === true,
            },
          }), { mergeKey: `await-comment-trigger-${nodeId}` })}
        />
        Match the issue or pull request that started this run
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          data-testid="flow-await-comment-pr-only"
          checked={config.prOnly === true}
          onCheckedChange={(checked) => updateNodeData(nodeId, (data) => ({
            ...data,
            config: {
              ...(data.config as Extract<FlowAwaitEventConfig, { kind: "github_comment_added" }>),
              kind: "github_comment_added",
              prOnly: checked === true,
            },
          }), { mergeKey: `await-comment-pr-only-${nodeId}` })}
        />
        Match pull request comments only
      </label>
    </>
  )
}

interface CiWorkflowCompletedFieldsProps {
  config: Extract<FlowAwaitEventConfig, { kind: "ci_workflow_completed" }>
  nodeId: string
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
}

function CiWorkflowCompletedFields({
  config,
  nodeId,
  updateNodeData,
}: CiWorkflowCompletedFieldsProps) {
  return (
    <>
      <InspectorField label="Workflow or check name">
        <Input
          value={config.workflowName}
          placeholder="e.g. CI / test"
          onChange={(event) => updateNodeData(nodeId, (data) => ({
            ...data,
            config: {
              ...(data.config as Extract<FlowAwaitEventConfig, { kind: "ci_workflow_completed" }>),
              kind: "ci_workflow_completed",
              workflowName: event.target.value,
            },
          }), { mergeKey: `await-workflow-name-${nodeId}` })}
        />
      </InspectorField>
      <InspectorField label="Conclusion">
        <WorkflowSelect
          ariaLabel="Conclusion"
          value={config.conclusion}
          onValueChange={(value) => updateNodeData(nodeId, (data) => ({
            ...data,
            config: {
              ...(data.config as Extract<FlowAwaitEventConfig, { kind: "ci_workflow_completed" }>),
              kind: "ci_workflow_completed",
              conclusion: value as FlowCiWorkflowConclusion,
            },
          }), { mergeKey: `await-workflow-conclusion-${nodeId}` })}
          options={[
            { value: "success", label: "Success" },
            { value: "failure", label: "Failure" },
            { value: "cancelled", label: "Cancelled" },
            { value: "any", label: "Any conclusion" },
          ]}
        />
      </InspectorField>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          checked={config.matchTriggerSha !== false}
          onCheckedChange={(checked) => updateNodeData(nodeId, (data) => ({
            ...data,
            config: {
              ...(data.config as Extract<FlowAwaitEventConfig, { kind: "ci_workflow_completed" }>),
              kind: "ci_workflow_completed",
              matchTriggerSha: checked === true,
            },
          }), { mergeKey: `await-workflow-sha-${nodeId}` })}
        />
        Match the commit that started this run when available
      </label>
    </>
  )
}

interface VercelPreviewReadyFieldsProps {
  config: Extract<FlowAwaitEventConfig, { kind: "vercel_preview_ready" }>
  nodeId: string
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
}

function VercelPreviewReadyFields({
  config,
  nodeId,
  updateNodeData,
}: VercelPreviewReadyFieldsProps) {
  return (
    <>
      <InspectorField label="Vercel environment">
        <Input
          value={config.environment}
          placeholder="Preview"
          onChange={(event) => updateNodeData(nodeId, (data) => ({
            ...data,
            config: {
              ...(data.config as Extract<FlowAwaitEventConfig, { kind: "vercel_preview_ready" }>),
              kind: "vercel_preview_ready",
              environment: event.target.value,
            },
          }), { mergeKey: `await-vercel-environment-${nodeId}` })}
        />
      </InspectorField>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          checked={config.matchTriggerSha !== false}
          onCheckedChange={(checked) => updateNodeData(nodeId, (data) => ({
            ...data,
            config: {
              ...(data.config as Extract<FlowAwaitEventConfig, { kind: "vercel_preview_ready" }>),
              kind: "vercel_preview_ready",
              matchTriggerSha: checked === true,
            },
          }), { mergeKey: `await-vercel-sha-${nodeId}` })}
        />
        Match the commit that started this run when available
      </label>
    </>
  )
}

interface ManualApprovalFieldsProps {
  config: Extract<FlowAwaitEventConfig, { kind: "manual_approval" }>
  nodeId: string
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
}

function ManualApprovalFields({
  config,
  nodeId,
  updateNodeData,
}: ManualApprovalFieldsProps) {
  return (
    <InspectorField label="Approval request">
      <Textarea
        value={config.prompt}
        placeholder="e.g. Approve production deployment"
        rows={3}
        onChange={(event) => updateNodeData(nodeId, (data) => ({
          ...data,
          config: {
            kind: "manual_approval",
            prompt: event.target.value,
          },
        }), { mergeKey: `await-approval-prompt-${nodeId}` })}
      />
    </InspectorField>
  )
}
