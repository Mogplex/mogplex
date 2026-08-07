"use client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { InfoCircle, Send, WarningTriangle } from "iconoir-react"
import type { FlowNode } from "@/lib/types"
import type { FlowCanvasNode } from "@/lib/flows/editor"
import type { SlackChannel, SlackInstallation } from "./types"
import { WorkflowSelect, InspectorField, InspectorCallout } from "./inspector-shared"

type ActionNodeData = Extract<FlowNode, { type: "action" }>["data"]

export type SlackSendMessageData = Extract<ActionNodeData, { operation: "slack.send_message" }>

export type UpdateNodeData = (
  nodeId: string,
  updater: (data: Record<string, unknown>) => Record<string, unknown>,
  options?: { mergeKey?: string | null },
) => void

export interface SlackFieldsProps {
  node: FlowCanvasNode & { data: SlackSendMessageData }
  updateNodeData: UpdateNodeData
  slackInstallations: SlackInstallation[]
  slackChannels: SlackChannel[]
  slackChannelsLoading: boolean
  slackChannelsLoadingMore: boolean
  slackChannelsHaveMore: boolean
  onLoadMoreSlackChannels: () => void
  slackConnectionsHref: string
  selectedSlackTeamId: string
}

export function SlackSendMessageFields({
  node,
  updateNodeData,
  slackInstallations,
  slackChannels,
  slackChannelsLoading,
  slackChannelsLoadingMore,
  slackChannelsHaveMore,
  onLoadMoreSlackChannels,
  slackConnectionsHref,
  selectedSlackTeamId,
}: SlackFieldsProps) {
  return (
    <>
      {slackInstallations.length === 0 ? (
        <InspectorCallout variant="warn" icon={<WarningTriangle />}>
          Connect Slack before publishing this action.{" "}
          <a
            href={slackConnectionsHref}
            className="font-medium text-amber-800 dark:text-amber-100 underline underline-offset-2"
          >
            Open connections
          </a>
        </InspectorCallout>
      ) : null}
      <InspectorField label="Destination">
        <WorkflowSelect
          testId="flow-action-slack-destination"
          ariaLabel="Destination"
          value={node.data.destination ?? "channel"}
          onValueChange={(value) => updateNodeData(
            node.id,
            (data) => ({
              ...data,
              destination: value,
            }),
            { mergeKey: `action-slack-destination-${node.id}` },
          )}
          options={[
            { value: "channel", label: "Selected channel" },
            {
              value: "trigger_thread",
              label: "Triggering Slack thread",
            },
          ]}
        />
      </InspectorField>
      {node.data.destination === "trigger_thread" ? (
        <InspectorCallout variant="info" icon={<Send />}>
          This action replies in the thread that started the workflow.
          It requires a Slack mention trigger.
        </InspectorCallout>
      ) : (
        <>
          <InspectorField label="Workspace">
            <WorkflowSelect
              testId="flow-action-slack-workspace"
              ariaLabel="Workspace"
              value={node.data.teamId}
              onValueChange={(value) => updateNodeData(node.id, (data) => ({
                ...data,
                teamId: value,
                channelId: "",
                channelName: null,
              }), { mergeKey: `action-slack-workspace-${node.id}` })}
              options={[
                { value: "", label: "Select a workspace" },
                ...slackInstallations.map((installation) => ({
                  value: installation.teamId,
                  label: installation.teamName || installation.teamId,
                })),
              ]}
            />
          </InspectorField>
          <InspectorField label="Channel">
            <WorkflowSelect
              testId="flow-action-slack-channel"
              ariaLabel="Channel"
              value={node.data.channelId}
              disabled={!selectedSlackTeamId || slackChannelsLoading}
              onValueChange={(value) => {
                const channel = slackChannels.find(
                  (candidate) => candidate.id === value,
                )
                updateNodeData(node.id, (data) => ({
                  ...data,
                  channelId: value,
                  channelName: channel?.name ?? null,
                }), { mergeKey: `action-slack-channel-${node.id}` })
              }}
              options={[
                {
                  value: "",
                  label: slackChannelsLoading
                    ? "Loading channels..."
                    : "Select a channel",
                },
                ...slackChannels.map((channel) => ({
                  value: channel.id,
                  label: `${channel.name ? `#${channel.name}` : channel.id}${channel.isPrivate ? " · private" : ""}`,
                })),
              ]}
            />
            {slackChannelsHaveMore ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="flow-action-slack-load-more"
                disabled={slackChannelsLoadingMore}
                onClick={onLoadMoreSlackChannels}
                className="mt-2 w-full"
              >
                {slackChannelsLoadingMore
                  ? "Loading more channels..."
                  : "Load more channels"}
              </Button>
            ) : null}
          </InspectorField>
        </>
      )}
      <InspectorField label="Message">
        <Textarea
          data-testid="flow-action-slack-message"
          value={node.data.message}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            message: event.target.value,
          }), { mergeKey: `action-slack-message-${node.id}` })}
          rows={5}
          placeholder={"Workflow finished for {{ repo.full_name }}"}
        />
      </InspectorField>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          data-testid="flow-action-slack-unfurl-links"
          checked={node.data.unfurlLinks === true}
          onCheckedChange={(checked) => updateNodeData(
            node.id,
            (data) => ({
              ...data,
              unfurlLinks: checked === true,
            }),
            { mergeKey: `action-slack-unfurl-${node.id}` },
          )}
        />
        Unfurl links in Slack
      </label>
      <InspectorCallout variant="hint" icon={<InfoCircle />}>
        Message templates can read trigger metadata, prior node outputs,
        and workflow state using <span className="font-mono text-foreground">{"{{ path }}"}</span>.
      </InspectorCallout>
    </>
  )
}
