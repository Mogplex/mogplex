"use client"

import { useCallback, useMemo, useState } from "react"
import { Github, NavArrowDown, Play } from "iconoir-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { FlowNode, FlowStartAuthorFilter, FlowStartFilter } from "@/lib/types"
import { AUTHOR_FILTER_OPTIONS } from "./constants"
import type { Installation } from "./types"
import { WorkflowSelect, InspectorCallout, InspectorField } from "./inspector-shared"

export function installationAccountTypeLabel(accountType: string | null | undefined) {
  return accountType?.toLowerCase() === "organization"
    ? "Organization"
    : accountType?.toLowerCase() === "user"
      ? "Personal"
      : "GitHub account"
}

export function installationAccountLabel(installation: Installation) {
  return installation.account_login || `Installation ${installation.installation_id}`
}

export function buildFilter(
  installationId: number | null,
  repos: string[],
  authorFilter: FlowStartAuthorFilter,
): FlowStartFilter | undefined {
  if (installationId === null && repos.length === 0 && authorFilter === "any") {
    return undefined
  }
  return {
    scope: "all",
    ...(installationId !== null ? { installationIds: [installationId] } : {}),
    ...(repos.length > 0 ? { repos } : {}),
    ...(authorFilter !== "any" ? { authorFilter } : {}),
  }
}

export function RepositoryScopePicker({
  accountLabel,
  options,
  selected,
  onChange,
  ariaLabel = "Repository scope",
  compact = false,
  testId = "flow-trigger-repository-scope",
  optionTestIdPrefix = "flow-trigger-repository-option",
  menuLabel = "Repository scope",
  description = "Choose which repositories can start this workflow.",
}: {
  accountLabel: string
  options: string[]
  selected: string[]
  onChange: (repos: string[]) => void
  ariaLabel?: string
  compact?: boolean
  testId?: string
  optionTestIdPrefix?: string
  menuLabel?: string
  description?: string
}) {
  const [open, setOpen] = useState(false)
  const summary = selected.length === 0
    ? "All repositories"
    : selected.length === 1
      ? selected[0]
      : `${selected.length} repositories`
  const detail = selected.length === 0
    ? `Every repository in ${accountLabel}`
    : `Scoped within ${accountLabel}`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          data-testid={testId}
          data-value={selected.join(",")}
          className={cn(
            "flex w-full items-center justify-between gap-3 rounded-md border border-border bg-input/40 text-left text-foreground transition-colors hover:border-border/80 hover:bg-input/55",
            compact ? "h-8 px-2.5 text-[11px]" : "min-h-11 px-3 py-2",
          )}
        >
          <span className="min-w-0">
            <span className={cn("block truncate font-medium", !compact && "text-xs")}>
              {summary}
            </span>
            {!compact ? (
              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                {detail}
              </span>
            ) : null}
          </span>
          <NavArrowDown
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[280px] border-border bg-popover p-0 shadow-2xl"
      >
        <div className="border-b border-border px-3 py-2.5">
          <div className="text-[10px] font-semibold tracking-[0.15em] text-muted-foreground uppercase">
            {menuLabel}
          </div>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="max-h-60 overflow-y-auto p-1.5">
          <label
            data-testid={`${optionTestIdPrefix}-all`}
            className={cn(
              "flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-foreground/[0.05]",
              selected.length === 0 && "bg-foreground/[0.04]",
            )}
          >
            <Checkbox
              checked={selected.length === 0}
              onCheckedChange={() => onChange([])}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-foreground">
                All repositories
              </span>
              <span className="mt-0.5 block text-[10px] text-muted-foreground">
                Every repository in {accountLabel}
              </span>
            </span>
          </label>
          {options.length > 0 ? (
            <div className="my-1 border-t border-border" />
          ) : null}
          {options.map((repo) => {
            const checked = selected.includes(repo)
            return (
              <label
                key={repo}
                data-testid={`${optionTestIdPrefix}-${repo}`}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-left text-xs text-foreground transition-colors hover:bg-foreground/[0.05]"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() =>
                    onChange(
                      checked
                        ? selected.filter((candidate) => candidate !== repo)
                        : [...selected, repo],
                    )
                  }
                />
                <span className="truncate">{repo}</span>
              </label>
            )
          })}
          {options.length === 0 ? (
            <p className="px-2 py-3 text-center text-[10px] text-muted-foreground">
              No synced repositories in this account.
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function StartFilterFields({
  node,
  installations,
  installationId,
  onInstallationChange,
  singleRepo = false,
  updateNodeData,
}: {
  node: { id: string; data: { event?: string; filter?: FlowStartFilter } }
  installations: Installation[]
  installationId: number | null
  onInstallationChange: (installationId: number) => void
  singleRepo?: boolean
  updateNodeData: (
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => void
}) {
  const filter = node.data.filter
  const authorFilter: FlowStartAuthorFilter = filter?.authorFilter ?? "any"
  const showAuthorFilter = node.data.event === "pr_opened"
  const repos = useMemo(() => filter?.repos ?? [], [filter?.repos])
  const selectedInstallation = installations.find(
    (installation) => installation.installation_id === installationId,
  ) ?? null
  const repositoryOptions = useMemo(() => {
    const configured = selectedInstallation?.repositories.map(
      (repository) => repository.full_name,
    ) ?? []
    return Array.from(new Set([...repos, ...configured])).sort((left, right) =>
      left.localeCompare(right),
    )
  }, [repos, selectedInstallation])

  const commitFilter = useCallback(
    (next: FlowStartFilter | undefined) => {
      updateNodeData(
        node.id,
        (data) => {
          if (!next) {
            const { filter: _omit, ...rest } = data
            return rest
          }
          return { ...data, filter: next }
        },
        { mergeKey: `start-filter-${node.id}` },
      )
    },
    [node.id, updateNodeData],
  )

  const onReposChange = (nextRepos: string[]) => {
    commitFilter(buildFilter(installationId, nextRepos, authorFilter))
  }

  const onAuthorFilterChange = (next: FlowStartAuthorFilter) => {
    commitFilter(buildFilter(installationId, repos, next))
  }

  return (
    <>
      <InspectorField label="GitHub account">
        <WorkflowSelect
          testId="flow-trigger-account"
          ariaLabel="GitHub account"
          value={String(installationId ?? "")}
          onValueChange={(value) => onInstallationChange(Number(value))}
          disabled={installations.length === 0}
          options={
            installations.length === 0
              ? [{ value: "", label: "No GitHub accounts connected" }]
              : installations.map((installation) => ({
                  value: String(installation.installation_id),
                  label: `${installationAccountLabel(installation)} · ${installationAccountTypeLabel(installation.account_type)}`,
                }))
          }
        />
      </InspectorField>
      {singleRepo ? (
        <InspectorField label="Repository">
          <WorkflowSelect
            testId="flow-trigger-repository"
            ariaLabel="Repository"
            value={repos[0] ?? ""}
            onValueChange={(value) =>
              onReposChange(value ? [value] : [])
            }
            options={[
              { value: "", label: "Select a repository…" },
              ...repositoryOptions.map((repo) => ({ value: repo, label: repo })),
            ]}
          />
        </InspectorField>
      ) : (
        <InspectorField label="Repository scope">
          <RepositoryScopePicker
            accountLabel={
              selectedInstallation
                ? installationAccountLabel(selectedInstallation)
                : "this account"
            }
            options={repositoryOptions}
            selected={repos}
            onChange={onReposChange}
          />
        </InspectorField>
      )}
      <InspectorCallout variant="hint" icon={<Github />}>
        This scope controls which GitHub repositories can start the workflow.
        Use all repositories for the account baseline, then add repo-specific
        workflows where you need stricter checks.
      </InspectorCallout>
      {showAuthorFilter && (
        <InspectorField label="PR authors">
          <WorkflowSelect
            testId="flow-trigger-author-filter"
            ariaLabel="PR authors"
            value={authorFilter}
            onValueChange={(value) =>
              onAuthorFilterChange(value as FlowStartAuthorFilter)
            }
            options={AUTHOR_FILTER_OPTIONS}
          />
        </InspectorField>
      )}
    </>
  )
}

function buildExternalTriggerTestPayload(
  node: { data: Extract<FlowNode, { type: "start" }>["data"] }
) {
  switch (node.data.event) {
    case "schedule":
      return {
        test: true,
        timezone: node.data.scheduleTimezone ?? "UTC",
      };
    case "webhook":
      return {
        prompt: "Describe what this workflow should do.",
        event: "workflow.test",
        test: true,
      };
    case "slack_mention":
      return {
        team_id: node.data.slackTeamId ?? "",
        channel_id: node.data.slackChannelId ?? "",
        text: "@Mogplex run test workflow",
        test: true,
      };
    default:
      return { test: true };
  }
}

function parseWebhookTestPayload(value: string) {
  try {
    const payload = JSON.parse(value) as unknown
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {
        payload: null,
        error: "Webhook payload must be a JSON object.",
      }
    }
    return {
      payload: payload as Record<string, unknown>,
      error: null,
    }
  } catch {
    return {
      payload: null,
      error: "Enter valid JSON before sending the test event.",
    }
  }
}

export function ExternalTriggerTestPanel({
  node,
  dirty,
  flowActive,
  flowPublished,
  running,
  onRun,
}: {
  node: { id: string; data: Extract<FlowNode, { type: "start" }>["data"] }
  dirty: boolean
  flowActive: boolean
  flowPublished: boolean
  running: boolean
  onRun: (payload: Record<string, unknown>) => void
}) {
  const defaultPayload = useMemo(
    () => buildExternalTriggerTestPayload(node),
    [node],
  )
  const [webhookPayloadText, setWebhookPayloadText] = useState(() =>
    JSON.stringify(defaultPayload, null, 2)
  )
  const parsedWebhookPayload = useMemo(
    () => parseWebhookTestPayload(webhookPayloadText),
    [webhookPayloadText],
  )
  const isWebhook = node.data.event === "webhook"
  const testPayload = isWebhook
    ? parsedWebhookPayload.payload
    : defaultPayload
  const payloadError = isWebhook ? parsedWebhookPayload.error : null

  return (
    <>
      <InspectorCallout variant="hint" icon={<Github />}>
        External triggers run against the repository selected above.
        {isWebhook ? (
          <>
            {" "}Set each Agent node&apos;s behavior under
            <span className="font-medium text-foreground"> Instructions / prompt</span>.
          </>
        ) : null}
      </InspectorCallout>
      <InspectorField label={isWebhook ? "Test payload (JSON)" : "Test payload"}>
        {isWebhook ? (
          <Textarea
            data-testid="flow-trigger-test-payload"
            value={webhookPayloadText}
            onChange={(event) => setWebhookPayloadText(event.target.value)}
            rows={7}
            className="bg-input/40 font-mono text-[11px]"
            aria-invalid={Boolean(payloadError)}
          />
        ) : (
          <pre
            data-testid="flow-trigger-test-payload"
            className="max-h-40 overflow-auto rounded-md border border-border bg-background/70 px-3 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground"
          >
            {JSON.stringify(defaultPayload, null, 2)}
          </pre>
        )}
      </InspectorField>
      {payloadError ? (
        <p
          data-testid="flow-trigger-test-payload-error"
          className="text-[11px] text-accent-red"
        >
          {payloadError}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          if (testPayload) onRun(testPayload)
        }}
        disabled={
          running ||
          dirty ||
          !flowActive ||
          !flowPublished ||
          !testPayload
        }
        data-testid="flow-trigger-test"
        className="w-full"
      >
        <Play className="mr-2 size-3.5" />
        {running ? "Sending test…" : "Send test event"}
      </Button>
      {dirty ? (
        <p className="text-[11px] text-muted-foreground">
          Save and publish this trigger before testing it.
        </p>
      ) : null}
    </>
  )
}
