import type { ComponentType, SVGProps } from "react"
import {
  Asterisk,
  Bell,
  Clock,
  CodeBrackets,
  GitBranch,
  GitFork,
  GitMerge,
  Github,
  Send,
  Shuffle,
  Terminal,
} from "iconoir-react"
import type {
  FlowActionOperation,
  FlowConditionOperator,
  FlowTransformOperation,
  TriggerEvent,
} from "@/lib/types"
import type { FlowStarterTemplateId } from "@/lib/flows/templates"
import { getEffectiveFlowAgentMaxSteps } from "@/lib/flows/agent-defaults"
import { getEffectiveAutomationTimeoutMs } from "@/lib/workflows/automation-model-defaults"
import { MogplexMark } from "@/components/brand/mogplex-mark"
import { ClaudeFill, OpenaiFill } from "@/components/icons/harness-icons"
import type {
  TriggerPreset,
  FlowAgentRoleOption,
  FlowAgentHarnessOption,
  FlowActionOption,
  FlowNodeLibraryItem,
} from "./types"

export const DEFAULT_AGENT_MAX_STEPS = getEffectiveFlowAgentMaxSteps(null)
export const DEFAULT_AGENT_TIMEOUT_SECONDS = Math.round(getEffectiveAutomationTimeoutMs(null) / 1000)
export const DEFAULT_AGENT_MAX_STEPS_PLACEHOLDER = `${DEFAULT_AGENT_MAX_STEPS} (default)`
export const DEFAULT_AGENT_TIMEOUT_SECONDS_PLACEHOLDER = `${DEFAULT_AGENT_TIMEOUT_SECONDS} (default)`
export const DEFAULT_AGENT_TIMEOUT_LABEL = `${DEFAULT_AGENT_TIMEOUT_SECONDS}s (default)`

export const FLOW_STARTER_TEMPLATE_ICONS = {
  blank: Asterisk,
  "pr-review": Github,
  "dependabot-autopilot": GitBranch,
  "issue-triage": Bell,
} satisfies Record<FlowStarterTemplateId, ComponentType<SVGProps<SVGSVGElement>>>

export const EVENT_OPTIONS: Array<{ value: TriggerEvent; label: string }> = [
  { value: "mention", label: "@mogplex" },
  { value: "pr_opened", label: "PR opened" },
  { value: "issue_opened", label: "Issue opened" },
  { value: "pr_comment", label: "PR comment" },
  { value: "issue_comment", label: "Issue comment" },
  { value: "push", label: "Push" },
  { value: "ci_failure", label: "CI failure" },
  { value: "labeled", label: "Label added" },
  { value: "tag_push", label: "Tag pushed" },
  { value: "schedule", label: "Schedule" },
  { value: "webhook", label: "Signed webhook" },
  { value: "slack_mention", label: "Slack mention" },
]

export const TRIGGER_PRESETS: TriggerPreset[] = [
  {
    id: "schedule",
    label: "Schedule",
    description: "Run on a cron",
    event: "schedule",
    icon: Clock,
  },
  {
    id: "github",
    label: "GitHub",
    description: "React to repository events",
    event: "pr_opened",
    icon: Github,
    canvasLabel: "GitHub",
  },
  {
    id: "slack-mention",
    label: "Slack mention",
    description: "Run from a channel",
    event: "slack_mention",
    icon: Bell,
  },
  {
    id: "dependabot",
    label: "Dependabot PR",
    description: "Review dependency updates",
    event: "pr_opened",
    icon: Github,
    authorFilter: "dependabot_only",
  },
]

export const CONDITION_OPERATOR_OPTIONS: FlowConditionOperator[] = [
  "exists",
  "is_empty",
  "is_not_empty",
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "greater_than",
  "less_than",
  "in",
  "not_in",
]

export const FLOW_FIT_VIEW_OPTIONS = {
  padding: 0.2,
  maxZoom: 1,
}

export const FLOW_CANVAS_BACKGROUND = {
  gap: 22,
  dotSize: 1.2,
  dotColor: "var(--flows-canvas-dot)",
  baseColor: "var(--background)",
} as const

export const FLOW_CANVAS_VIGNETTE = {
  ellipse: "90% 70%",
  position: "50% 45%",
  edgeColor: "var(--flows-canvas-vignette-edge)",
  edgeStop: "75%",
  baseColor: "var(--flows-canvas-vignette-base)",
} as const

export const FLOW_CANVAS_VIGNETTE_BACKGROUND = `
  radial-gradient(
    ellipse ${FLOW_CANVAS_VIGNETTE.ellipse} at ${FLOW_CANVAS_VIGNETTE.position},
    transparent 0%,
    ${FLOW_CANVAS_VIGNETTE.edgeColor} ${FLOW_CANVAS_VIGNETTE.edgeStop},
    ${FLOW_CANVAS_VIGNETTE.baseColor} 100%
  )
`

export const FLOW_AGENT_ROLE_OPTIONS: FlowAgentRoleOption[] = [
  {
    value: "review",
    label: "Review",
    description: "Inspect the event context and report findings. On PR review flows, this can publish a GitHub review.",
  },
  {
    value: "edit",
    label: "Fix",
    description: "Apply code changes. Works as the first node in @mogplex mention or PR comment flows (the comment is the brief), or after a Review node that reports issues.",
  },
  {
    value: "triage",
    label: "Respond",
    description: "Reply to @mogplex mentions, PR comments, issues, and other event context without pushing code changes.",
  },
]

export const FLOW_AGENT_HARNESS_OPTIONS: FlowAgentHarnessOption[] = [
  {
    value: "mogplex",
    label: "Mogplex",
    description: "Managed agents",
    icon: MogplexMark,
  },
  {
    value: "claude-code",
    label: "Claude Code",
    description: "Anthropic CLI",
    icon: ClaudeFill,
  },
  {
    value: "codex",
    label: "Codex",
    description: "OpenAI CLI",
    icon: OpenaiFill,
  },
]

export const FLOW_ACTION_OPTIONS: FlowActionOption[] = [
  {
    value: "sandbox.run_command",
    label: "Run command",
    description: "Execute in a reusable sandbox",
    testId: "action-sandbox-run-command",
    icon: Terminal,
    tone: "flows-library-tone-cyan",
    provider: "Sandbox",
  },
  {
    value: "slack.send_message",
    label: "Send Slack message",
    description: "Post to a channel or trigger thread",
    testId: "action-slack-send-message",
    icon: Send,
    tone: "flows-library-tone-violet",
    provider: "Slack",
  },
  {
    value: "github.post_comment",
    label: "Post GitHub comment",
    description: "Reply on an issue or pull request",
    testId: "action-github-post-comment",
    icon: Github,
    tone: "flows-library-tone-indigo",
    provider: "GitHub",
  },
  {
    value: "github.create_issue",
    label: "Create GitHub issue",
    description: "Open a tracked follow-up",
    testId: "action-github-create-issue",
    icon: Github,
    tone: "flows-library-tone-indigo",
    provider: "GitHub",
  },
  {
    value: "github.update_labels",
    label: "Update GitHub labels",
    description: "Add or remove issue and PR labels",
    testId: "action-github-update-labels",
    icon: Github,
    tone: "flows-library-tone-indigo",
    provider: "GitHub",
  },
  {
    value: "github.set_status",
    label: "Set commit status",
    description: "Publish a named status on the commit",
    testId: "action-github-set-status",
    icon: Github,
    tone: "flows-library-tone-indigo",
    provider: "GitHub",
  },
  {
    value: "github.submit_review",
    label: "Submit PR review",
    description: "Comment, approve, or request changes",
    testId: "action-github-submit-review",
    icon: Github,
    tone: "flows-library-tone-indigo",
    provider: "GitHub",
  },
  {
    value: "github.merge_pull_request",
    label: "Request safe merge",
    description: "Merge safely after the workflow completes",
    testId: "action-github-merge-pull-request",
    icon: GitMerge,
    tone: "flows-library-tone-indigo",
    provider: "GitHub",
  },
]

export const FLOW_NODE_INSERTION_OPTIONS: Array<{
  type: Exclude<import("@/lib/types").FlowNodeType, "start" | "end">
  label: string
  operation?: FlowActionOperation
}> = [
  { type: "agent", label: "Agent" },
  ...FLOW_ACTION_OPTIONS.map(({ value, label }) => ({
    type: "action" as const,
    operation: value,
    label,
  })),
  { type: "condition", label: "If" },
  { type: "parallel", label: "Parallel split" },
  { type: "join", label: "Join" },
  { type: "delay", label: "Wait" },
  { type: "await_event", label: "Await event" },
  { type: "set_variable", label: "Set variable" },
  { type: "transform", label: "Transform" },
]

function FlowLibraryMogplexIcon({ className }: { className?: string }) {
  return (
    <MogplexMark
      className={className}
      data-testid="flow-library-icon-mogplex"
    />
  )
}

export const FLOW_NODE_LIBRARY_GROUPS: Array<{
  label: string
  items: FlowNodeLibraryItem[]
}> = [
  {
    label: "Agents",
    items: [
      {
        type: "agent",
        testId: "agent",
        label: "Agent",
        description: "Review, fix, or respond",
        icon: FlowLibraryMogplexIcon,
        tone: "flows-library-tone-review",
      },
    ],
  },
  {
    label: "Flow control",
    items: [
      {
        type: "condition",
        testId: "condition",
        label: "If branch",
        description: "Route by event data",
        icon: GitFork,
        tone: "flows-library-tone-indigo",
      },
      {
        type: "parallel",
        testId: "parallel",
        label: "Parallel split",
        description: "Fan out work",
        icon: GitBranch,
        tone: "flows-library-tone-violet",
      },
      {
        type: "join",
        testId: "join",
        label: "Join",
        description: "Merge branches",
        icon: GitMerge,
        tone: "flows-library-tone-cyan",
      },
      {
        type: "delay",
        testId: "delay",
        label: "Wait",
        description: "Pause for a duration",
        icon: Clock,
        tone: "flows-library-tone-cyan",
      },
      {
        type: "await_event",
        testId: "await_event",
        label: "Await event",
        description: "CI, preview, or approval",
        icon: Bell,
        tone: "flows-library-tone-fuchsia",
      },
    ],
  },
  {
    label: "Data",
    items: [
      {
        type: "set_variable",
        testId: "set_variable",
        label: "Set variable",
        description: "Write workflow state",
        icon: CodeBrackets,
        tone: "flows-library-tone-edit",
      },
      {
        type: "transform",
        testId: "transform",
        label: "Transform",
        description: "Derive typed workflow state",
        icon: Shuffle,
        tone: "flows-library-tone-cyan",
      },
    ],
  },
  {
    label: "Actions",
    items: FLOW_ACTION_OPTIONS.map((option) => ({
      type: "action" as const,
      operation: option.value,
      testId: option.testId,
      label: option.label,
      description: option.description,
      icon: option.icon,
      tone: option.tone,
    })),
  },
]

export const FLOW_EDGE_INSERTION_OPTIONS: Array<{
  type:
    | "agent"
    | "action"
    | "delay"
    | "await_event"
    | "set_variable"
    | "transform"
  label: string
  operation?: FlowActionOperation
}> = [
  { type: "agent", label: "Insert agent" },
  ...FLOW_ACTION_OPTIONS.map(({ value, label }) => ({
    type: "action" as const,
    operation: value,
    label: `Insert ${label.toLowerCase()}`,
  })),
  { type: "delay", label: "Insert wait" },
  { type: "await_event", label: "Insert await event" },
  { type: "set_variable", label: "Insert set variable" },
  { type: "transform", label: "Insert transform" },
]

export const FLOW_TRANSFORM_OPERATION_OPTIONS: Array<{
  value: FlowTransformOperation
  label: string
  argumentLabel?: string
  argumentPlaceholder?: string
}> = [
  { value: "copy", label: "Copy value" },
  {
    value: "string_contains",
    label: "String contains",
    argumentLabel: "Substring",
    argumentPlaceholder: "fix:",
  },
  {
    value: "string_split",
    label: "Split string",
    argumentLabel: "Delimiter",
    argumentPlaceholder: ",",
  },
  {
    value: "array_join",
    label: "Join array",
    argumentLabel: "Delimiter",
    argumentPlaceholder: ", ",
  },
  { value: "array_length", label: "Array length" },
  {
    value: "array_includes",
    label: "Array includes",
    argumentLabel: "Value",
    argumentPlaceholder: "ready",
  },
  {
    value: "files_match_glob",
    label: "Files match glob",
    argumentLabel: "Glob",
    argumentPlaceholder: "**/*.test.ts",
  },
  { value: "cast_boolean", label: "Cast to boolean" },
  { value: "cast_number", label: "Cast to number" },
]

export const AUTHOR_FILTER_OPTIONS: Array<{
  value: import("@/lib/types").FlowStartAuthorFilter
  label: string
}> = [
  { value: "any", label: "All authors" },
  { value: "humans_only", label: "Humans only (skip bot PRs)" },
  { value: "exclude_dependabot", label: "Skip Dependabot PRs" },
  { value: "dependabot_only", label: "Dependabot PRs only" },
]

export const HISTORY_LIMIT = 100
export const HISTORY_MERGE_WINDOW_MS = 500
export const AUTOSAVE_DELAY_MS = 900
export const PUBLISH_SUCCESS_STATE_MS = 2200

export const INSPECTOR_SELECT_CLASS = "border-input dark:bg-input/30 h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-sm text-foreground shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
export const EMPTY_SELECT_VALUE = "__mogplex_workflow_empty__"
