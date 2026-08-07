"use client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Bell, Clock, Copy, InfoCircle, WarningTriangle } from "iconoir-react"
import type { Flow, FlowNode, TriggerEvent } from "@/lib/types"
import type { FlowCanvasNode } from "@/lib/flows/editor"
import { startDataForEvent } from "./canvas-utils"
import { EVENT_OPTIONS } from "./constants"
import type { Installation, SlackChannel, SlackInstallation } from "./types"
import {
  WorkflowSelect,
  WorkflowCombobox,
  InspectorField,
  InspectorCallout,
} from "./inspector-shared"
import { StartFilterFields, ExternalTriggerTestPanel } from "./start-filter-fields"

type StartNodeData = Extract<FlowNode, { type: "start" }>["data"]

export interface StartInspectorProps {
  node: FlowCanvasNode & { data: StartNodeData }
  selectedFlow: Flow
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
  installations: Installation[]
  effectiveInstallationId: number | null
  updateTriggerInstallation: (installationId: number) => void
  slackInstallations: SlackInstallation[]
  slackChannels: SlackChannel[]
  slackChannelsLoading: boolean
  slackChannelsLoadingMore: boolean
  slackChannelsHaveMore: boolean
  slackChannelPageCount: number
  setSlackChannelPageCount: (count: number) => void
  slackConnectionsHref: string
  selectedSlackTeamId: string
  generatedWebhookSecret: string | null
  webhookSecretGenerating: boolean
  generateWebhookSecret: () => Promise<void>
  copyWebhookValue: (value: string, label: string) => Promise<void>
  dirty: boolean
  triggerTestRunning: boolean
  runTriggerTest: (payload: Record<string, unknown>) => Promise<void>
}

export function StartInspector({
  node,
  selectedFlow,
  updateNodeData,
  installations,
  effectiveInstallationId,
  updateTriggerInstallation,
  slackInstallations,
  slackChannels,
  slackChannelsLoading,
  slackChannelsLoadingMore,
  slackChannelsHaveMore,
  slackChannelPageCount,
  setSlackChannelPageCount,
  slackConnectionsHref,
  selectedSlackTeamId,
  generatedWebhookSecret,
  webhookSecretGenerating,
  generateWebhookSecret,
  copyWebhookValue,
  dirty,
  triggerTestRunning,
  runTriggerTest,
}: StartInspectorProps) {
  return (
    <>
      <InspectorField label="Canvas label">
        <Input
          value={String(node.data.label || "")}
          onChange={(event) => updateNodeData(node.id, (data) => ({
            ...data,
            label: event.target.value,
          }), { mergeKey: `start-label-${node.id}` })}
        />
      </InspectorField>
      <InspectorField label="Event">
        <WorkflowSelect
          testId="flow-trigger-event"
          ariaLabel="Event"
          value={String(node.data.event || "mention")}
          onValueChange={(value) => updateNodeData(
            node.id,
            (data) => startDataForEvent(
              data,
              value as TriggerEvent,
            ),
            { mergeKey: `start-config-${node.id}` },
          )}
          options={EVENT_OPTIONS}
        />
      </InspectorField>
      {node.data.event === "mention" && (
        <InspectorCallout variant="hint" icon={<InfoCircle />}>
          GitHub comments containing <span className="font-medium text-foreground">@mogplex</span> run this flow.
        </InspectorCallout>
      )}
      {node.data.event === "labeled" && (
        <>
          <InspectorField label="Label name (empty = any label)">
            <Input
              value={String(node.data.labelName || "")}
              onChange={(event) => updateNodeData(node.id, (data) => ({
                ...data,
                labelName: event.target.value,
              }), { mergeKey: `start-label-name-${node.id}` })}
              placeholder="ready-for-review"
            />
          </InspectorField>
          <InspectorField label="Label targets">
            <label className="flex items-center gap-2 text-xs text-foreground">
              <Checkbox
                checked={node.data.labelPrOnly === true}
                onCheckedChange={(checked) => updateNodeData(node.id, (data) => ({
                  ...data,
                  labelPrOnly: checked === true,
                }), { mergeKey: `start-label-pr-only-${node.id}` })}
              />
              Pull requests only
            </label>
          </InspectorField>
        </>
      )}
      {node.data.event === "tag_push" && (
        <InspectorField label="Tag pattern (empty = any tag, * = wildcard)">
          <Input
            value={String(node.data.tagPattern || "")}
            onChange={(event) => updateNodeData(node.id, (data) => ({
              ...data,
              tagPattern: event.target.value,
            }), { mergeKey: `start-tag-pattern-${node.id}` })}
            placeholder="v*"
          />
        </InspectorField>
      )}
      {node.data.event === "schedule" && (
        <>
          <InspectorField label="Cron schedule">
            <Input
              data-testid="flow-trigger-schedule-cron"
              value={node.data.scheduleCron ?? ""}
              onChange={(event) => updateNodeData(node.id, (data) => ({
                ...data,
                scheduleCron: event.target.value,
              }), { mergeKey: `start-schedule-cron-${node.id}` })}
              placeholder="0 9 * * 1-5"
              className="font-mono"
            />
          </InspectorField>
          <InspectorField label="Timezone">
            <WorkflowCombobox
              testId="flow-trigger-schedule-timezone"
              ariaLabel="Timezone"
              value={node.data.scheduleTimezone ?? "UTC"}
              onValueChange={(value) => updateNodeData(node.id, (data) => ({
                ...data,
                scheduleTimezone: value,
              }), { mergeKey: `start-schedule-timezone-${node.id}` })}
              placeholder="America/New_York"
              options={[
                { value: "UTC", label: "UTC" },
                { value: "America/New_York", label: "America/New_York" },
                { value: "America/Chicago", label: "America/Chicago" },
                { value: "America/Denver", label: "America/Denver" },
                { value: "America/Los_Angeles", label: "America/Los_Angeles" },
                { value: "Europe/London", label: "Europe/London" },
                { value: "Europe/Berlin", label: "Europe/Berlin" },
                { value: "Asia/Tokyo", label: "Asia/Tokyo" },
              ]}
            />
          </InspectorField>
          <InspectorCallout variant="hint" icon={<Clock />}>
            Five-field cron, evaluated by Trigger.dev in the selected timezone.
          </InspectorCallout>
        </>
      )}
      {node.data.event === "webhook" && (
        <>
          <InspectorField label="Endpoint">
            <div className="flex gap-2">
              <Input
                readOnly
                value={`/api/webhooks/flows/${selectedFlow?.id ?? ""}`}
                className="font-mono text-[11px]"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  const path = `/api/webhooks/flows/${selectedFlow?.id ?? ""}`
                  const value = typeof window === "undefined"
                    ? path
                    : `${window.location.origin}${path}`
                  void copyWebhookValue(value, "Endpoint")
                }}
                aria-label="Copy webhook endpoint"
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
          </InspectorField>
          <InspectorField label="Signing secret">
            {generatedWebhookSecret ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={generatedWebhookSecret}
                    className="font-mono text-[11px]"
                    data-testid="flow-webhook-secret-value"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => void copyWebhookValue(
                      generatedWebhookSecret,
                      "Signing secret",
                    )}
                    aria-label="Copy webhook signing secret"
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
                <InspectorCallout variant="warn" icon={<WarningTriangle />}>
                  Store this secret now. It will not be shown again.
                </InspectorCallout>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => void generateWebhookSecret()}
                disabled={webhookSecretGenerating}
                data-testid="flow-webhook-generate-secret"
                className="w-full"
              >
                {webhookSecretGenerating
                  ? "Generating…"
                  : selectedFlow?.webhook_configured
                  ? "Rotate signing secret"
                  : "Generate signing secret"}
              </Button>
            )}
          </InspectorField>
          <InspectorCallout variant="hint" icon={<InfoCircle />}>
            Send JSON with unique <span className="font-mono">x-mogplex-delivery</span> and
            HMAC-SHA256 <span className="font-mono">x-mogplex-signature</span> headers.
            Data is available under <span className="font-mono">metadata.webhook</span>.
          </InspectorCallout>
        </>
      )}
      {node.data.event === "slack_mention" && (
        <>
          {slackInstallations.length === 0 ? (
            <InspectorCallout variant="warn" icon={<WarningTriangle />}>
              Connect Slack in{" "}
              <a href={slackConnectionsHref} className="font-medium text-foreground underline">
                Settings
              </a>{" "}
              before publishing this trigger.
            </InspectorCallout>
          ) : (
            <>
              <InspectorField label="Slack workspace">
                <WorkflowSelect
                  ariaLabel="Slack workspace"
                  value={node.data.slackTeamId ?? ""}
                  testId="flow-trigger-slack-workspace"
                  onValueChange={(value) => updateNodeData(node.id, (data) => ({
                    ...data,
                    slackTeamId: value,
                    slackChannelId: "",
                    slackChannelName: null,
                  }), { mergeKey: `start-slack-workspace-${node.id}` })}
                  options={[
                    { value: "", label: "Select a workspace" },
                    ...slackInstallations.map((installation) => ({
                      value: installation.teamId,
                      label: installation.teamName || installation.teamId,
                    })),
                  ]}
                />
              </InspectorField>
              <InspectorField label="Slack channel">
                <WorkflowSelect
                  ariaLabel="Slack channel"
                  value={node.data.slackChannelId ?? ""}
                  testId="flow-trigger-slack-channel"
                  disabled={!selectedSlackTeamId || slackChannelsLoading}
                  onValueChange={(value) => {
                    const channel = slackChannels.find(
                      (candidate) => candidate.id === value,
                    )
                    updateNodeData(node.id, (data) => ({
                      ...data,
                      slackChannelId: value,
                      slackChannelName: channel?.name ?? null,
                    }), { mergeKey: `start-slack-channel-${node.id}` })
                  }}
                  options={[
                    {
                      value: "",
                      label: slackChannelsLoading
                        ? "Loading channels…"
                        : "Select a channel",
                    },
                    ...slackChannels.map((channel) => ({
                      value: channel.id,
                      label: `${channel.name ? `#${channel.name}` : channel.id}${channel.isPrivate ? " · private" : ""}`,
                    })),
                  ]}
                />
              </InspectorField>
              {slackChannelsHaveMore ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="flow-trigger-slack-load-more"
                  disabled={slackChannelsLoadingMore}
                  onClick={() => void setSlackChannelPageCount(
                    slackChannelPageCount + 1,
                  )}
                  className="w-full"
                >
                  {slackChannelsLoadingMore ? "Loading…" : "Load more channels"}
                </Button>
              ) : null}
            </>
          )}
          <InspectorCallout variant="hint" icon={<Bell />}>
            An <span className="font-medium text-foreground">@Mogplex</span> mention in this
            channel starts the workflow instead of the conversational assistant.
          </InspectorCallout>
        </>
      )}
      <StartFilterFields
        node={node}
        installations={installations || []}
        installationId={effectiveInstallationId}
        onInstallationChange={updateTriggerInstallation}
        singleRepo={["schedule", "webhook", "slack_mention"].includes(
          node.data.event,
        )}
        updateNodeData={updateNodeData}
      />
      {["schedule", "webhook", "slack_mention"].includes(
        node.data.event,
      ) ? (
        <ExternalTriggerTestPanel
          key={`${selectedFlow.id}:${node.id}:${node.data.event}`}
          node={node}
          dirty={dirty}
          flowActive={selectedFlow.status === "active"}
          flowPublished={Boolean(selectedFlow.published_version_id)}
          running={triggerTestRunning}
          onRun={(payload) => void runTriggerTest(payload)}
        />
      ) : null}
    </>
  )
}
