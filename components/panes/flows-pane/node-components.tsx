"use client"

import {
  Bell,
  CheckCircle,
  Clock,
  CodeBrackets,
  GitBranch,
  GitFork,
  GitMerge,
  Github,
  Shuffle,
} from "iconoir-react"
import {
  conditionOperatorLabel,
  flowAgentHarnessLabel,
  flowAgentRoleLabel,
  VALUE_LESS_CONDITION_OPERATORS,
} from "@/lib/flows/graph"
import type {
  FlowActionNodeData,
  FlowAgentHarness,
  FlowAgentNodeRole,
  FlowAwaitEventConfig,
  FlowConditionOperator,
  FlowConditionRule,
  FlowConditionRuleMode,
  FlowStartFilter,
  FlowTransformOperation,
} from "@/lib/types"
import { CONDITION_OPERATOR_OPTIONS, FLOW_ACTION_OPTIONS } from "./constants"
import {
  getRoleTheme,
  FlowHarnessIcon,
  FlowNodeShell,
  FlowNodeDetail,
  FlowNodeChip,
  ConditionNodeShell,
} from "./node-shells"

// Re-export from node-shells for backward compatibility
export {
  getRoleTheme,
  FlowHarnessIcon,
  FlowNodeShell,
  FlowNodeDetail,
  FlowNodeChip,
  FlowLibraryNodeButton,
  ConditionNodeHandles,
  ConditionNodeShell,
} from "./node-shells"

export function StartNodeCard({
  data,
}: {
  data: {
    label?: string
    event?: string
    filter?: FlowStartFilter
    accountLabel?: string
  }
}) {
  const isMention = data.event === "mention"
  const repos = data.filter?.repos ?? []
  const repositoryScope = repos.length === 0
    ? "All repositories"
    : repos.length === 1
      ? repos[0]
      : `${repos[0]} +${repos.length - 1}`

  return (
    <FlowNodeShell
      tone="flows-node-type-trigger"
      title="Start"
      subtitle={isMention ? "@mogplex" : data.label || "GitHub event"}
      icon={<Github />}
      source
    >
      <FlowNodeDetail className="mt-1">
        {isMention ? "GitHub mention" : data.event || "event"}
      </FlowNodeDetail>
      <FlowNodeDetail className="mt-1 max-w-[190px] truncate">
        {data.accountLabel
          ? `${data.accountLabel} · ${repositoryScope}`
          : repositoryScope}
      </FlowNodeDetail>
    </FlowNodeShell>
  )
}

export function AgentNodeCard(props: {
  data: {
    label?: string
    agentId?: string | null
    harness?: FlowAgentHarness
    role?: FlowAgentNodeRole
    modelOverride?: string | null
    maxStepsOverride?: number | null
    timeoutMsOverride?: number | null
  }
}) {
  const role = props.data.role || "review"
  const harness = props.data.harness ?? "mogplex"
  const theme = getRoleTheme(role)

  return (
    <FlowNodeShell
      tone={theme.shell}
      title="Agent"
      subtitle={props.data.label || "Agent node"}
      icon={(
        <FlowHarnessIcon
          harness={harness}
          data-testid={`flow-canvas-harness-icon-${harness}`}
        />
      )}
      target
      source
      errorSource
    >
      <FlowNodeDetail className="mt-1">
        {flowAgentHarnessLabel(harness)}
      </FlowNodeDetail>
      <div className="mt-3 flex flex-wrap gap-1">
        <span className={theme.badge}>
          {flowAgentRoleLabel(role)}
        </span>
        {props.data.modelOverride && (
          <FlowNodeChip>model</FlowNodeChip>
        )}
        {typeof props.data.maxStepsOverride === "number" && (
          <FlowNodeChip>{props.data.maxStepsOverride} steps</FlowNodeChip>
        )}
        {typeof props.data.timeoutMsOverride === "number" && (
          <FlowNodeChip>{Math.round(props.data.timeoutMsOverride / 1000)}s timeout</FlowNodeChip>
        )}
      </div>
    </FlowNodeShell>
  )
}

export function ConditionNodeCard(props: {
  data: {
    label?: string
    mode?: FlowConditionRuleMode
    rules?: FlowConditionRule[]
  }
}) {
  const rules = Array.isArray(props.data.rules) ? props.data.rules : []
  const mode: FlowConditionRuleMode = props.data.mode === "any" ? "any" : "all"
  const firstRule = rules[0]
  const extraRuleCount = Math.max(rules.length - 1, 0)
  const summaryOperator: FlowConditionOperator = firstRule
    ? (CONDITION_OPERATOR_OPTIONS.includes(firstRule.operator) ? firstRule.operator : "equals")
    : "equals"
  return (
    <ConditionNodeShell>
      <div className="flows-node-head">
        <span className="flows-node-icon" aria-hidden>
          <GitFork />
        </span>
        <div className="min-w-0">
          <div className="flows-node-kicker">If</div>
          <div className="flows-node-title">{props.data.label || "Branch"}</div>
        </div>
      </div>
      {firstRule ? (
        <>
          <FlowNodeDetail className="mt-2">{firstRule.field || "metadata.source_type"}</FlowNodeDetail>
          <FlowNodeDetail className="mt-1">
            {conditionOperatorLabel(summaryOperator)}
            {!VALUE_LESS_CONDITION_OPERATORS.has(summaryOperator) && firstRule.value ? ` · ${firstRule.value}` : ""}
          </FlowNodeDetail>
          {extraRuleCount > 0 ? (
            <div className="flows-node-meta mt-1 text-[10px] uppercase tracking-[0.16em]">
              {mode === "any" ? "or " : "and "}
              {extraRuleCount} more
            </div>
          ) : null}
        </>
      ) : (
        <FlowNodeDetail className="mt-2">No rules configured</FlowNodeDetail>
      )}
      <div className="flows-node-meta mt-3 flex items-center justify-between text-[9px] font-medium uppercase tracking-[0.16em]">
        <span>Then</span>
        <span>Else</span>
      </div>
    </ConditionNodeShell>
  )
}

export function ParallelNodeCard({ data }: { data: { label?: string } }) {
  return (
    <FlowNodeShell
      tone="flows-node-type-violet"
      title="Parallel"
      subtitle={data.label || "Split work"}
      icon={<GitBranch />}
      target
      source
    >
      <FlowNodeDetail className="mt-2">Fan out into explicit branches, then merge later.</FlowNodeDetail>
    </FlowNodeShell>
  )
}

export function JoinNodeCard({ data }: { data: { label?: string; policy?: string; quorum?: number | null } }) {
  const policyLabel = data.policy === "wait_for_any"
    ? "Wait for any branch"
    : data.policy === "quorum"
      ? `Quorum (${data.quorum ?? "?"} of N)`
      : "Wait for all branches"
  return (
    <FlowNodeShell
      tone="flows-node-type-cyan"
      title="Join"
      subtitle={data.label || "Merge"}
      icon={<GitMerge />}
      target
      source
    >
      <FlowNodeDetail className="mt-2">{policyLabel}</FlowNodeDetail>
    </FlowNodeShell>
  )
}

export function DelayNodeCard({ data }: { data: { label?: string; duration?: number; unit?: string } }) {
  return (
    <FlowNodeShell
      tone="flows-node-type-cyan"
      title="Wait"
      subtitle={data.label || "Wait"}
      icon={<Clock />}
      target
      source
      errorSource
    >
      <FlowNodeDetail className="mt-2">
        {data.duration ?? 1} {data.unit || "seconds"}
      </FlowNodeDetail>
    </FlowNodeShell>
  )
}

export function AwaitEventNodeCard({
  data,
}: {
  data: {
    label?: string
    config?: FlowAwaitEventConfig
    timeout?: { value?: number; unit?: string } | null
  }
}) {
  const kind = data.config?.kind ?? "github_label_added"
  const subtitle = data.label || "Await"
  let detail: string
  switch (kind) {
    case "github_comment_added": {
      const config = data.config as Extract<
        FlowAwaitEventConfig,
        { kind: "github_comment_added" }
      >
      const filters = [
        config.authorLogin ? `@${config.authorLogin}` : null,
        config.bodyContains ? `contains "${config.bodyContains}"` : null,
      ].filter(Boolean)
      detail = `GitHub comment${filters.length > 0 ? ` · ${filters.join(" · ")}` : ""}`
      break
    }
    case "ci_workflow_completed": {
      const config = data.config as Extract<
        FlowAwaitEventConfig,
        { kind: "ci_workflow_completed" }
      >
      detail = `${config.workflowName || "(workflow unset)"} · ${config.conclusion}`
      break
    }
    case "vercel_preview_ready": {
      const config = data.config as Extract<
        FlowAwaitEventConfig,
        { kind: "vercel_preview_ready" }
      >
      detail = `Vercel · ${config.environment || "Preview"}`
      break
    }
    case "manual_approval": {
      const config = data.config as Extract<
        FlowAwaitEventConfig,
        { kind: "manual_approval" }
      >
      detail = config.prompt || "Approval request unset"
      break
    }
    case "github_label_added":
    default: {
      const config = data.config as
        | Extract<FlowAwaitEventConfig, { kind: "github_label_added" }>
        | undefined
      detail = `Label "${config?.labelName || "(unset)"}"${config?.prOnly ? " · PR only" : ""}`
      break
    }
  }
  return (
    <FlowNodeShell
      tone="flows-node-type-fuchsia"
      title="Await event"
      subtitle={subtitle}
      icon={<Bell />}
      target
      source
      errorSource
    >
      <FlowNodeDetail className="mt-2">{detail}</FlowNodeDetail>
      {data.timeout && data.timeout.value ? (
        <div className="flows-node-meta mt-1 text-[10px] uppercase tracking-[0.18em]">
          Timeout {data.timeout.value} {data.timeout.unit ?? "hours"}
        </div>
      ) : null}
    </FlowNodeShell>
  )
}

export function SetVariableNodeCard({
  data,
}: {
  data: {
    label?: string
    assignments?: Array<{ key?: string; template?: string }>
  }
}) {
  const assignments = data.assignments ?? []
  const keys = assignments
    .map((a) => a.key)
    .filter((key): key is string => typeof key === "string" && key.length > 0)
  const detail =
    keys.length === 0 ? "No assignments" : keys.slice(0, 3).join(", ") + (keys.length > 3 ? ` +${keys.length - 3}` : "")
  return (
    <FlowNodeShell
      tone="flows-node-type-edit"
      title="Set variable"
      subtitle={data.label || "Set variable"}
      icon={<CodeBrackets />}
      target
      source
      errorSource
    >
      <FlowNodeDetail className="mt-2">{detail}</FlowNodeDetail>
    </FlowNodeShell>
  )
}

export function TransformNodeCard({
  data,
}: {
  data: {
    label?: string
    assignments?: Array<{
      key?: string
      operation?: FlowTransformOperation
    }>
  }
}) {
  const assignments = data.assignments ?? []
  const keys = assignments
    .map((assignment) => assignment.key)
    .filter((key): key is string => Boolean(key))
  const detail =
    keys.length === 0
      ? "No transformations"
      : keys.slice(0, 3).join(", ") +
        (keys.length > 3 ? ` +${keys.length - 3}` : "")
  return (
    <FlowNodeShell
      tone="flows-node-type-cyan"
      title="Transform"
      subtitle={data.label || "Transform"}
      icon={<Shuffle />}
      target
      source
      errorSource
    >
      <FlowNodeDetail className="mt-2">{detail}</FlowNodeDetail>
    </FlowNodeShell>
  )
}

export function ActionNodeCard({ data }: { data: FlowActionNodeData }) {
  const presentation =
    FLOW_ACTION_OPTIONS.find((option) => option.value === data.operation) ??
    FLOW_ACTION_OPTIONS[0]
  const Icon = presentation.icon
  let detail: string
  switch (data.operation) {
    case "slack.send_message":
      detail =
        data.destination === "trigger_thread"
          ? "Trigger thread"
          : data.channelName
            ? `#${data.channelName}`
            : data.channelId || "Choose a channel"
      break
    case "github.post_comment":
      detail = data.targetNumber || "Trigger issue or PR"
      break
    case "github.create_issue":
      detail = data.title || "Add an issue title"
      break
    case "github.update_labels":
      detail =
        [...data.addLabels, ...data.removeLabels].join(", ") || "Choose labels"
      break
    case "github.set_status":
      detail = `${data.state} · ${data.context}`
      break
    case "github.submit_review":
      detail = data.event.replace("_", " ").toLowerCase()
      break
    case "github.merge_pull_request":
      detail = data.pullRequestNumber
        ? `Pull request #${data.pullRequestNumber}`
        : "Trigger pull request"
      break
    default:
      detail = data.command || "Add a command"
  }
  return (
    <FlowNodeShell
      tone={
        presentation.provider === "Slack"
          ? "flows-node-type-violet"
          : presentation.provider === "GitHub"
            ? "flows-node-type-indigo"
            : "flows-node-type-cyan"
      }
      title={presentation.provider}
      subtitle={data.label}
      icon={<Icon />}
      target
      source
      errorSource
    >
      <FlowNodeDetail className="mt-2">{detail}</FlowNodeDetail>
    </FlowNodeShell>
  )
}

export function EndNodeCard({ data }: { data: { label?: string } }) {
  return (
    <FlowNodeShell
      tone="flows-node-type-muted"
      title="End"
      subtitle={data.label || "Done"}
      icon={<CheckCircle />}
      target
    />
  )
}

export const NODE_TYPES = {
  start: StartNodeCard,
  agent: AgentNodeCard,
  action: ActionNodeCard,
  condition: ConditionNodeCard,
  parallel: ParallelNodeCard,
  join: JoinNodeCard,
  delay: DelayNodeCard,
  await_event: AwaitEventNodeCard,
  set_variable: SetVariableNodeCard,
  transform: TransformNodeCard,
  end: EndNodeCard,
}
