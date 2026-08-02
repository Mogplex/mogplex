"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StructuredValueViewer } from "@/components/diffs/structured-value-viewer";
import { useAiCallEvents } from "@/hooks/use-observability";
import {
  formatAutomationTimeoutBudgetLabel,
  getAutomationCostPrimaryLabel,
  getAutomationCostSecondaryLabel,
  getAutomationCostState,
  getAutomationStatusPresentation,
  readAutomationFailureClass,
} from "@/lib/observability/automation-run-presentation";
import { presentSandboxDebug } from "@/lib/sandbox/debug-presenter";
import type { AiCall } from "@/lib/types";
import { CostSourceBadge } from "./badges";
import { formatTokens, hasPositiveTokenCount, timeAgo } from "./formatters";
import { GithubEventLinkPanel } from "./github-event-link-panel";

function readAiBillingSource(
  metadata: Record<string, unknown> | null | undefined
) {
  const value = metadata?.ai_billing_source;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = readText(value);
    if (text) return text;
  }
  return null;
}

function readSlackRunInfo(
  metadata: Record<string, unknown> | null | undefined
) {
  const root = metadata || {};
  const slack = readRecord(root.slack) || {};
  const mode = firstText(slack.mode, root.slack_mode);
  if (!mode) return null;

  return {
    mode,
    teamId: firstText(slack.teamId, root.slack_team_id),
    channelId: firstText(slack.channelId),
    slackUserId: firstText(slack.slackUserId, root.slack_user_id),
    slackEmail: firstText(slack.slackEmail),
    attributionMode: firstText(
      slack.attributionMode,
      root.slack_attribution_mode
    ),
  };
}

export function CallExpandedRow({
  call,
  canOpenSandboxHealth,
  onOpenSandboxHealth,
}: {
  call: AiCall;
  canOpenSandboxHealth: boolean;
  onOpenSandboxHealth: (call: AiCall) => void;
}) {
  const { events } = useAiCallEvents(call.id);
  const debug = presentSandboxDebug({
    sandboxContext: call.sandbox_context ?? null,
    aiBillingSource: readAiBillingSource(call.metadata),
  });
  const sandboxContext = call.sandbox_context ?? null;
  const statusPresentation = getAutomationStatusPresentation({
    status: call.status,
    metadata: call.metadata,
    error: call.error,
  });
  const timeoutBudget = formatAutomationTimeoutBudgetLabel(
    statusPresentation.timeoutBudgetMs
  );
  const costState = getAutomationCostState({
    status: call.status,
    costUsd: call.cost_usd,
    costSource: call.cost_source,
  });
  const costSecondaryLabel = getAutomationCostSecondaryLabel(costState);
  const costPrimaryLabel = getAutomationCostPrimaryLabel({
    costState,
    costUsd: call.cost_usd,
  });
  const failureClass = readAutomationFailureClass(call.metadata);
  const slackRunInfo = readSlackRunInfo(call.metadata);

  return (
    <div className="space-y-3 p-4 text-sm">
      <GithubEventLinkPanel
        sourceType={call.type}
        repoFullName={
          typeof call.metadata?.repo_full_name === "string"
            ? call.metadata.repo_full_name
            : null
        }
        metadata={call.metadata}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <div className="ui-label mb-0.5">Result</div>
          <div className="text-foreground">{statusPresentation.label}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Cost</div>
          <div className="text-foreground">{costPrimaryLabel}</div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Cost State</div>
          <div className="text-foreground">
            {costState === "known" || costState === "reconciled"
              ? "recorded"
              : (costSecondaryLabel ?? costState)}
          </div>
        </div>
        <div>
          <div className="ui-label mb-0.5">Timeout Budget</div>
          <div className="text-foreground">{timeoutBudget || "—"}</div>
        </div>
      </div>

      {(hasPositiveTokenCount(call.reasoning_tokens) ||
        call.gateway_generation_id ||
        call.cost_source) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          {hasPositiveTokenCount(call.reasoning_tokens) && (
            <div>
              <div className="ui-label mb-0.5">Reasoning Tokens</div>
              <div className="text-foreground tabular-nums">
                {formatTokens(call.reasoning_tokens)}
              </div>
            </div>
          )}
          {call.gateway_generation_id && (
            <div className="sm:col-span-2">
              <div className="ui-label mb-0.5">Generation ID</div>
              <div className="text-foreground font-mono break-all">
                {call.gateway_generation_id}
              </div>
            </div>
          )}
          {(call.cost_source || call.gateway_generation_id) && (
            <div>
              <div className="ui-label mb-0.5">Cost Source</div>
              <CostSourceBadge
                costSource={call.cost_source}
                hasGatewayGenerationId={Boolean(call.gateway_generation_id)}
              />
            </div>
          )}
        </div>
      )}

      {failureClass && (
        <div>
          <div className="ui-label mb-0.5">Failure Class</div>
          <div className="text-foreground">{failureClass}</div>
        </div>
      )}

      {slackRunInfo && (
        <div className="space-y-2">
          <div className="ui-label">Slack</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <div className="ui-label mb-0.5">Mode</div>
              <div className="text-foreground">
                {slackRunInfo.mode.replaceAll("_", " ")}
              </div>
            </div>
            <div>
              <div className="ui-label mb-0.5">Attribution</div>
              <div className="text-foreground">
                {slackRunInfo.attributionMode?.replaceAll("_", " ") ?? "—"}
              </div>
            </div>
            <div>
              <div className="ui-label mb-0.5">Slack User</div>
              <div className="text-foreground font-mono break-all">
                {slackRunInfo.slackUserId ?? "—"}
              </div>
            </div>
            <div>
              <div className="ui-label mb-0.5">Workspace</div>
              <div className="text-foreground font-mono break-all">
                {slackRunInfo.teamId ?? "—"}
              </div>
            </div>
            <div>
              <div className="ui-label mb-0.5">Channel</div>
              <div className="text-foreground font-mono break-all">
                {slackRunInfo.channelId ?? "—"}
              </div>
            </div>
            <div>
              <div className="ui-label mb-0.5">Slack Email</div>
              <div className="text-foreground break-all">
                {slackRunInfo.slackEmail ?? "—"}
              </div>
            </div>
          </div>
        </div>
      )}

      {(sandboxContext || debug.aiBillingLabel) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="ui-label">Sandbox Billing</div>
            {sandboxContext ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={!canOpenSandboxHealth}
                onClick={() => onOpenSandboxHealth(call)}
              >
                Open sandbox health
              </Button>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {sandboxContext && (
              <>
                <div>
                  <div className="ui-label mb-0.5">Compute Billing</div>
                  <div className="text-foreground">
                    {debug.computeBillingBadgeLabel}
                  </div>
                </div>
                <div>
                  <div className="ui-label mb-0.5">Vercel Project</div>
                  <div className="text-foreground font-mono break-all">
                    {debug.projectLabel}
                  </div>
                </div>
                <div>
                  <div className="ui-label mb-0.5">Vercel Team</div>
                  <div className="text-foreground">{debug.teamLabel}</div>
                </div>
                <div>
                  <div className="ui-label mb-0.5">Sandbox Record</div>
                  <div className="text-foreground font-mono break-all">
                    {debug.sandboxRecordId || "—"}
                  </div>
                </div>
                <div>
                  <div className="ui-label mb-0.5">Sandbox Runtime</div>
                  <div className="text-foreground font-mono break-all">
                    {debug.sandboxRuntimeId || "—"}
                  </div>
                </div>
                <div>
                  <div className="ui-label mb-0.5">Preview</div>
                  {debug.previewUrl ? (
                    <a
                      href={debug.previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground break-all hover:underline"
                    >
                      {debug.previewUrl}
                    </a>
                  ) : (
                    <div className="text-foreground">—</div>
                  )}
                </div>
              </>
            )}
            {debug.aiBillingLabel && (
              <div>
                <div className="ui-label mb-0.5">AI Billing Source</div>
                <div className="text-foreground">{debug.aiBillingLabel}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {call.runtime_command_id && (
        <div>
          <div className="ui-label mb-0.5">Runtime Command</div>
          <div className="text-foreground font-mono break-all">
            {call.runtime_command_id}
          </div>
        </div>
      )}

      {call.error && (
        <div>
          <div className="ui-label mb-0.5">Error</div>
          <div className="rounded bg-accent-red/5 px-2 py-1 font-mono text-accent-red">
            {call.error}
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div className="space-y-2">
          <div className="ui-label">Event Timeline</div>
          {events.map((event) => (
            <div key={event.id} className="bg-muted/50 rounded px-2 py-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[11px]">
                  {event.event_type.replaceAll("_", " ")}
                </Badge>
                {event.tool_name && (
                  <span className="text-muted-foreground font-mono text-[11px]">
                    {event.tool_name}
                  </span>
                )}
                <span className="text-muted-foreground ml-auto text-[11px]">
                  {timeAgo(event.created_at)}
                </span>
              </div>
              {event.message && (
                <div className="text-muted-foreground mt-2">
                  {event.message}
                </div>
              )}
              {event.payload && Object.keys(event.payload).length > 0 && (
                <div className="mt-2">
                  <StructuredValueViewer
                    value={event.payload}
                    className="my-0"
                    stringLanguage="language-json"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {call.tool_calls.length > 0 && (
        <div className="space-y-2">
          <div className="ui-label">Tool Calls ({call.tool_calls.length})</div>
          {call.tool_calls.map((toolCall, index) => (
            <div key={index} className="bg-muted/50 rounded px-2 py-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[11px]">
                  {toolCall.name}
                </Badge>
                {toolCall.input_preview && (
                  <span className="text-muted-foreground truncate font-mono text-[11px]">
                    {toolCall.input_preview}
                  </span>
                )}
              </div>
              {(toolCall.input ?? toolCall.input_preview) && (
                <div className="mt-2">
                  <div className="ui-label mb-1">Input</div>
                  <StructuredValueViewer
                    value={toolCall.input ?? toolCall.input_preview}
                    className="my-0"
                    stringLanguage="language-json"
                  />
                </div>
              )}
              {(toolCall.output ?? toolCall.output_preview) && (
                <div className="mt-2">
                  <div className="ui-label mb-1">Output</div>
                  <StructuredValueViewer
                    value={toolCall.output ?? toolCall.output_preview}
                    className="my-0"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="ui-label mb-1">Metadata</div>
        <StructuredValueViewer
          value={call.metadata || {}}
          className="my-0"
          stringLanguage="language-json"
        />
      </div>
    </div>
  );
}
