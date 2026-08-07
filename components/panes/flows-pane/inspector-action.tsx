"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Github, Trash } from "iconoir-react"
import { createDefaultFlowActionData } from "@/lib/flows/operators/action"
import type { FlowActionOperation, FlowNode } from "@/lib/types"
import type { FlowCanvasNode } from "@/lib/flows/editor"
import { FLOW_ACTION_OPTIONS } from "./constants"
import type { SlackChannel, SlackInstallation } from "./types"
import { WorkflowSelect, InspectorField, InspectorCallout } from "./inspector-shared"
import {
  SandboxRunCommandFields,
  type SandboxRunCommandData,
} from "./inspector-action-sandbox"
import {
  SlackSendMessageFields,
  type SlackSendMessageData,
} from "./inspector-action-slack"
import {
  GitHubPostCommentFields,
  GitHubCreateIssueFields,
  GitHubUpdateLabelsFields,
  GitHubSetStatusFields,
  GitHubSubmitReviewFields,
  GitHubMergePullRequestFields,
  type GitHubPostCommentData,
  type GitHubCreateIssueData,
  type GitHubUpdateLabelsData,
  type GitHubSetStatusData,
  type GitHubSubmitReviewData,
  type GitHubMergePullRequestData,
} from "./inspector-action-github"

type ActionNodeData = Extract<FlowNode, { type: "action" }>["data"]

export interface ActionInspectorProps {
  node: FlowCanvasNode & { data: ActionNodeData }
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
  onDelete: () => void
  slackInstallations: SlackInstallation[]
  slackChannels: SlackChannel[]
  slackChannelsLoading: boolean
  slackChannelsLoadingMore: boolean
  slackChannelsHaveMore: boolean
  onLoadMoreSlackChannels: () => void
  slackConnectionsHref: string
  selectedSlackTeamId: string
}

export function ActionInspector({
  node,
  updateNodeData,
  onDelete,
  slackInstallations,
  slackChannels,
  slackChannelsLoading,
  slackChannelsLoadingMore,
  slackChannelsHaveMore,
  onLoadMoreSlackChannels,
  slackConnectionsHref,
  selectedSlackTeamId,
}: ActionInspectorProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="ui-kicker">Action node</div>
        <span className="rounded-full border border-accent-blue/25 bg-accent-blue/[0.08] px-3 py-1 text-[11px] text-accent-blue">
          {FLOW_ACTION_OPTIONS.find(
            (option) => option.value === node.data.operation,
          )?.provider ?? "Action"}
        </span>
      </div>
      <InspectorField label="Action">
        <WorkflowSelect
          testId="flow-action-operation"
          ariaLabel="Action"
          value={node.data.operation}
          onValueChange={(value) => {
            const operation = value as FlowActionOperation
            updateNodeData(
              node.id,
              () => createDefaultFlowActionData(
                operation,
                1,
                FLOW_ACTION_OPTIONS.find(
                  (option) => option.value === operation,
                )?.label,
              ),
              { mergeKey: `action-operation-${node.id}` },
            )
          }}
          options={FLOW_ACTION_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
      </InspectorField>
      <InspectorField label="Label">
        <Input
          value={node.data.label}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            label: event.target.value,
          }), { mergeKey: `action-label-${node.id}` })}
        />
      </InspectorField>

      {node.data.operation === "sandbox.run_command" && (
        <SandboxRunCommandFields
          node={node as FlowCanvasNode & { data: SandboxRunCommandData }}
          updateNodeData={updateNodeData}
        />
      )}

      {node.data.operation === "slack.send_message" && (
        <SlackSendMessageFields
          node={node as FlowCanvasNode & { data: SlackSendMessageData }}
          updateNodeData={updateNodeData}
          slackInstallations={slackInstallations}
          slackChannels={slackChannels}
          slackChannelsLoading={slackChannelsLoading}
          slackChannelsLoadingMore={slackChannelsLoadingMore}
          slackChannelsHaveMore={slackChannelsHaveMore}
          onLoadMoreSlackChannels={onLoadMoreSlackChannels}
          slackConnectionsHref={slackConnectionsHref}
          selectedSlackTeamId={selectedSlackTeamId}
        />
      )}

      {node.data.operation === "github.post_comment" && (
        <GitHubPostCommentFields node={node as FlowCanvasNode & { data: GitHubPostCommentData }} updateNodeData={updateNodeData} />
      )}

      {node.data.operation === "github.create_issue" && (
        <GitHubCreateIssueFields node={node as FlowCanvasNode & { data: GitHubCreateIssueData }} updateNodeData={updateNodeData} />
      )}

      {node.data.operation === "github.update_labels" && (
        <GitHubUpdateLabelsFields node={node as FlowCanvasNode & { data: GitHubUpdateLabelsData }} updateNodeData={updateNodeData} />
      )}

      {node.data.operation === "github.set_status" && (
        <GitHubSetStatusFields node={node as FlowCanvasNode & { data: GitHubSetStatusData }} updateNodeData={updateNodeData} />
      )}

      {node.data.operation === "github.submit_review" && (
        <GitHubSubmitReviewFields node={node as FlowCanvasNode & { data: GitHubSubmitReviewData }} updateNodeData={updateNodeData} />
      )}

      {node.data.operation === "github.merge_pull_request" && (
        <GitHubMergePullRequestFields node={node as FlowCanvasNode & { data: GitHubMergePullRequestData }} updateNodeData={updateNodeData} />
      )}

      {node.data.operation.startsWith("github.") && (
        <InspectorCallout variant="hint" icon={<Github />}>
          This action is limited to the workflow repository.
          Leave the target blank to use the triggering issue, pull request,
          or commit. Text fields support{" "}
          <span className="font-mono text-foreground">{"{{ path }}"}</span>{" "}
          templates.
        </InspectorCallout>
      )}

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
