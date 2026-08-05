"use client"
import "@xyflow/react/dist/style.css"

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type MouseEvent as ReactMouseEvent, type ReactNode, type SVGProps } from "react"
import { createPortal } from "react-dom"
import { useParams } from "next/navigation"
import { useTheme } from "next-themes"
import useSWR from "swr"
import useSWRInfinite from "swr/infinite"
import {
  addEdge,
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  useStore as useReactFlowStore,
  type ColorMode,
  type Connection,
  type EdgeProps,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
} from "@xyflow/react"
import { toast } from "@/hooks/use-toast"
import { useAgents } from "@/hooks/use-agents"
import { useModels } from "@/hooks/use-models"
import { useRepos } from "@/hooks/use-repos"
import { cn } from "@/lib/utils"
import {
  getActiveTeamRequestHeaders,
  useActiveTeamId,
} from "@/components/active-scope-provider"
import { buildAgentModelOptions, getDefaultNewAgentModel } from "@/lib/agents/model-options"
import { shouldHydrateFlowDraftFromServer } from "@/lib/flows/draft-sync"
import { getEffectiveFlowAgentMaxSteps } from "@/lib/flows/agent-defaults"
import { shouldIgnoreCanvasShortcut } from "@/lib/flows/canvas-shortcuts"
import {
  flowSaveStatusAnnouncement,
  type FlowSaveStatus,
} from "@/lib/flows/save-presentation"
import { isHiddenCatalogModelId } from "@/lib/models/catalog-visibility"
import { getEffectiveAutomationTimeoutMs } from "@/lib/workflows/automation-model-defaults"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Asterisk,
  Bell,
  CheckCircle,
  Clock,
  CodeBrackets,
  Copy,
  CursorPointer,
  GitBranch,
  GitFork,
  GitMerge,
  Github,
  InfoCircle,
  LightBulb,
  NavArrowDown,
  Play,
  Plus,
  Redo,
  Search,
  Send,
  Settings,
  Shuffle,
  SidebarCollapse,
  SidebarExpand,
  Trash,
  Terminal,
  Undo,
  WarningTriangle,
  Xmark,
} from "iconoir-react"
import {
  CONDITION_HANDLE_IDS,
  conditionOperatorLabel,
  eventLabel,
  FAILURE_HANDLE_ID,
  flowAgentHarnessLabel,
  flowAgentRoleLabel,
  hasUpstreamAgentRole,
  getStartConfig,
  isCommentTriggerEvent,
  getDefaultFlowAgentRole,
  FLOW_CONDITION_FIELD_PRESETS,
  VALUE_LESS_CONDITION_OPERATORS,
} from "@/lib/flows/graph"
import {
  clearFlowDraftSelection,
  cloneFlowDraftSnapshot,
  copySelectedFlowDraftItems,
  createFlowDraftSnapshot,
  deleteSelectedFlowDraftItems,
  draftToGraph,
  duplicateSelectedFlowDraftAgents,
  graphToCanvas,
  insertFlowDraftAgent,
  insertFlowDraftNodeOnEdge,
  insertFlowDraftNode,
  pasteFlowDraftItems,
  selectFlowDraftEdge,
  selectAllFlowDraftAgents,
  selectFlowDraftNode,
  straightenSelectedFlowDraftNodes,
  serializePersistedFlowDraft,
  serializePersistedFlowGraph,
  tidyFlowDraftLayout,
  type FlowCanvasEdge,
  type FlowCanvasNode,
  type FlowDraftClipboard,
  type FlowDraftSnapshot,
} from "@/lib/flows/editor"
import {
  dispatchOutcomeLabel,
  flowRunStatusLabel,
  formatRunSourceType,
  getRunLatestReason,
  isRecord,
  nodeRunStatusTone,
  readNodeRunRole,
  readNodeRunSummary,
  runStatusTone,
  type FlowRunAction,
} from "@/lib/flows/run-presentation"
import { getOrganicEdgePath } from "@/lib/flows/organic-edge-path"
import { getMinimapSize } from "@/lib/flows/minimap-size"
import type {
  Flow,
  FlowActionNodeData,
  FlowActionOperation,
  FlowAgentHarness,
  FlowAwaitEventConfig,
  FlowAwaitEventKind,
  FlowCiWorkflowConclusion,
  FlowGraph,
  FlowAgentNodeRole,
  FlowNode,
  PersonalFlowTemplate,
  PersonalFlowTemplatePage,
  FlowConditionOperator,
  FlowConditionRule,
  FlowConditionRuleMode,
  FlowNodeType,
  Repo,
  FlowRunDetail,
  FlowRunRecord,
  FlowStartAuthorFilter,
  FlowStartFilter,
  FlowTransformAssignment,
  FlowTransformOperation,
  TriggerEvent,
} from "@/lib/types"
import {
  FlowRunDetailsDialog,
  RunActionButtons,
  type ActiveRunActions,
} from "./flow-run-details"
import { FlowAssistantPanel } from "@/components/flows/flow-assistant-panel"
import { useFlowAssistantPanel } from "@/hooks/use-flow-assistant-panel"
import { ClaudeFill, OpenaiFill } from "@/components/icons/harness-icons"
import { MogplexMark } from "@/components/brand/mogplex-mark"
import { scopedHref } from "@/lib/scoped-href"
import { createDefaultFlowActionData } from "@/lib/flows/operators/action"
import {
  FLOW_STARTER_TEMPLATES,
  type FlowStarterTemplateId,
} from "@/lib/flows/templates"

const fetcher = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.error || `API error: ${response.status}`)
  }
  return response.json()
}

const DEFAULT_AGENT_MAX_STEPS = getEffectiveFlowAgentMaxSteps(null)
const DEFAULT_AGENT_TIMEOUT_SECONDS = Math.round(getEffectiveAutomationTimeoutMs(null) / 1000)
const DEFAULT_AGENT_MAX_STEPS_PLACEHOLDER = `${DEFAULT_AGENT_MAX_STEPS} (default)`
const DEFAULT_AGENT_TIMEOUT_SECONDS_PLACEHOLDER = `${DEFAULT_AGENT_TIMEOUT_SECONDS} (default)`
const DEFAULT_AGENT_TIMEOUT_LABEL = `${DEFAULT_AGENT_TIMEOUT_SECONDS}s (default)`
const FLOW_STARTER_TEMPLATE_ICONS = {
  blank: Asterisk,
  "pr-review": Github,
  "dependabot-autopilot": GitBranch,
  "issue-triage": Bell,
} satisfies Record<FlowStarterTemplateId, ComponentType<SVGProps<SVGSVGElement>>>

type Installation = {
  id: string
  installation_id: number
  account_login: string | null
  account_type?: string | null
  repositories: Array<{ id: string; full_name: string }>
}

type AutomationSandboxTestResult = {
  ok: boolean
  error?: string
  repo?: { id: string; full_name: string }
  env?: {
    configured: boolean
    count: number
    mode: string
    source: string
    warning: string | null
  }
  sandbox?: {
    billingSource: string
    credentialSource: string
    projectId: string
    teamId: string | null
  }
}

type AutomationHarnessAvailability = {
  available: boolean
  billingSource: string | null
  reason: string | null
}

type AutomationHarnessesResponse = {
  harnesses: Record<FlowAgentHarness, AutomationHarnessAvailability>
}

type SlackInstallation = {
  teamId: string
  teamName: string | null
}

type SlackChannel = {
  id: string
  name: string | null
  isPrivate: boolean
}

type SlackChannelsPage = {
  channels: SlackChannel[]
  nextCursor: string | null
}

type FlowTab = "editor" | "runs"

function readFlowTabFromLocation(): FlowTab {
  if (typeof window === "undefined") return "editor"
  return new URL(window.location.href).searchParams.get("tab") === "runs" ? "runs" : "editor"
}

const EVENT_OPTIONS: Array<{ value: TriggerEvent; label: string }> = [
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

const TRIGGER_PRESETS: Array<{
  id: string
  label: string
  description: string
  event: TriggerEvent
  icon: ComponentType<{ className?: string }>
  authorFilter?: FlowStartAuthorFilter
  canvasLabel?: string
}> = [
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

const CONDITION_OPERATOR_OPTIONS: FlowConditionOperator[] = [
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

const FLOW_FIT_VIEW_OPTIONS = {
  padding: 0.2,
  maxZoom: 1,
}

// Colors resolve from the `.flows-pane` scope in globals.css, which carries a
// light and a dark value for each token — React Flow passes these straight
// through to CSS custom properties, so `var()` works here.
// The wider 22px grid matches the builder's control-room look.
const FLOW_CANVAS_BACKGROUND = {
  gap: 22,
  dotSize: 1.2,
  dotColor: "var(--flows-canvas-dot)",
  baseColor: "var(--background)",
} as const

const FLOW_CANVAS_VIGNETTE = {
  ellipse: "90% 70%",
  position: "50% 45%",
  edgeColor: "var(--flows-canvas-vignette-edge)",
  edgeStop: "75%",
  baseColor: "var(--flows-canvas-vignette-base)",
} as const

/**
 * The minimap has to track the canvas, not the window — docking the inspector
 * narrows the canvas without the window changing at all.
 *
 * It gets an explicit `style` rather than a CSS rule because React Flow reads
 * `style.width`/`style.height` to build its pan scale; see `getMinimapSize`.
 */
function ResponsiveMiniMap() {
  const canvasWidth = useReactFlowStore((state) => state.width)
  const canvasHeight = useReactFlowStore((state) => state.height)
  const size = useMemo(
    () => getMinimapSize(canvasWidth, canvasHeight),
    [canvasWidth, canvasHeight]
  )
  return (
    <MiniMap
      pannable
      zoomable
      position="bottom-right"
      className="hidden xl:block"
      style={size}
    />
  )
}

const FLOW_CANVAS_VIGNETTE_BACKGROUND = `
  radial-gradient(
    ellipse ${FLOW_CANVAS_VIGNETTE.ellipse} at ${FLOW_CANVAS_VIGNETTE.position},
    transparent 0%,
    ${FLOW_CANVAS_VIGNETTE.edgeColor} ${FLOW_CANVAS_VIGNETTE.edgeStop},
    ${FLOW_CANVAS_VIGNETTE.baseColor} 100%
  )
`

const FLOW_AGENT_ROLE_OPTIONS: Array<{ value: FlowAgentNodeRole; label: string; description: string }> = [
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

const FLOW_AGENT_HARNESS_OPTIONS: Array<{
  value: FlowAgentHarness
  label: string
  description: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}> = [
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

function FlowHarnessIcon({
  harness,
  ...props
}: SVGProps<SVGSVGElement> & { harness: FlowAgentHarness }) {
  const option =
    FLOW_AGENT_HARNESS_OPTIONS.find((candidate) => candidate.value === harness)
    ?? FLOW_AGENT_HARNESS_OPTIONS[0]
  const Icon = option.icon
  return <Icon {...props} />
}

function FlowLibraryMogplexIcon({ className }: { className?: string }) {
  return (
    <MogplexMark
      className={className}
      data-testid="flow-library-icon-mogplex"
    />
  )
}

const FLOW_ACTION_OPTIONS: Array<{
  value: FlowActionOperation
  label: string
  description: string
  testId: string
  icon: ComponentType<{ className?: string }>
  tone: string
  provider: "Sandbox" | "Slack" | "GitHub"
}> = [
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

const FLOW_NODE_INSERTION_OPTIONS: Array<{
  type: Exclude<FlowNodeType, "start" | "end">
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

type FlowNodeLibraryItem = {
  type: Exclude<FlowNodeType, "start" | "end">
  operation?: FlowActionOperation
  testId: string
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
  tone: string
}

const FLOW_NODE_LIBRARY_GROUPS: Array<{
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

const FLOW_EDGE_INSERTION_OPTIONS: Array<{
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

const FLOW_TRANSFORM_OPERATION_OPTIONS: Array<{
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

type FlowRenderableEdgeData = {
  label?: string | null
  tone?: "default" | "success" | "danger" | "condition" | "alternate" | "parallel" | "join"
  edgeId: string
  onInsertMenu?: (edgeId: string, clientX: number, clientY: number) => void
}

function getRoleTheme(role: FlowAgentNodeRole) {
  switch (role) {
    case "edit":
      return {
        shell: "flows-node-type-edit",
        badge: "flows-node-chip flows-node-chip-accent",
      }
    case "triage":
      return {
        shell: "flows-node-type-violet",
        badge: "flows-node-chip flows-node-chip-accent",
      }
    case "review":
    default:
      return {
        shell: "flows-node-type-review",
        badge: "flows-node-chip flows-node-chip-accent",
      }
  }
}

function edgeToneClass(tone: FlowRenderableEdgeData["tone"]) {
  switch (tone) {
    case "success":
      return "flows-edge-tone-success"
    case "danger":
      return "flows-edge-tone-danger"
    case "condition":
      return "flows-edge-tone-condition"
    case "alternate":
      return "flows-edge-tone-alternate"
    case "parallel":
      return "flows-edge-tone-parallel"
    case "join":
      return "flows-edge-tone-join"
    case "default":
    default:
      return "flows-edge-tone-default"
  }
}

function FlowSemanticEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd,
  data,
}: EdgeProps) {
  const edgeData = isRecord(data) ? data as FlowRenderableEdgeData : undefined
  const toneClass = edgeToneClass(edgeData?.tone)
  const [edgePath, labelX, labelY] = getOrganicEdgePath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <>
      <BaseEdge
        id={`${id}-underlay`}
        path={edgePath}
        className="flows-edge-path-underlay"
        style={{
          strokeWidth: selected ? 8 : 6,
          opacity: selected ? 0.16 : 0.08,
        }}
      />
      <BaseEdge
        id={`${id}-foreground`}
        path={edgePath}
        markerEnd={markerEnd}
        className={cn("flows-edge-path-foreground", toneClass)}
        style={{
          strokeWidth: selected ? 2.8 : 1.9,
          opacity: selected ? 1 : 0.84,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-none absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <div className="pointer-events-auto flex items-center gap-2">
            {edgeData?.label ? (
              <span className={`flows-edge-label ${toneClass}`}>
                {edgeData.label}
              </span>
            ) : null}
            {edgeData?.onInsertMenu ? (
              <button
                type="button"
                data-testid={`flow-edge-insert-${id}`}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  edgeData.onInsertMenu?.(edgeData.edgeId, event.clientX, event.clientY)
                }}
                className="rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground shadow-lg transition-colors hover:border-accent-blue hover:bg-secondary hover:text-accent-blue"
                aria-label="Insert node on edge"
                title="Insert node on edge"
              >
                +
              </button>
            ) : null}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

function FlowNodeShell(props: {
  tone: string
  title: string
  subtitle: string
  icon?: ReactNode
  children?: ReactNode
  target?: boolean
  source?: boolean
  errorSource?: boolean
  sourceHandleId?: string | null
  sourceHandlePosition?: Position
  targetHandleId?: string | null
  targetHandlePosition?: Position
}) {
  return (
    <div className={cn("flows-node-card", props.tone)}>
      {props.target && (
        <Handle
          id={props.targetHandleId ?? undefined}
          type="target"
          position={props.targetHandlePosition ?? Position.Left}
          className="flows-node-handle flows-node-handle-target"
        />
      )}
      {props.source && (
        <Handle
          id={props.sourceHandleId ?? undefined}
          type="source"
          position={props.sourceHandlePosition ?? Position.Right}
          style={props.errorSource ? { top: "38%" } : undefined}
          className="flows-node-handle flows-node-handle-source"
        />
      )}
      {props.errorSource && (
        <Handle
          id={FAILURE_HANDLE_ID}
          type="source"
          position={Position.Right}
          style={{ top: "72%" }}
          className="flows-node-handle flows-node-handle-danger"
        />
      )}
      <div className="flows-node-inner">
        <div className="flows-node-head">
          {props.icon ? (
            <span className="flows-node-icon" aria-hidden>
              {props.icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="flows-node-kicker">{props.title}</div>
            <div className="flows-node-title">{props.subtitle}</div>
          </div>
        </div>
        {props.children}
        {props.errorSource && (
          <div className="flows-node-error-label mt-3">
            On error
          </div>
        )}
      </div>
    </div>
  )
}

function FlowNodeDetail({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flows-node-meta", className)}>
      {children}
    </div>
  )
}

function FlowNodeChip({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return (
    <span className={cn("flows-node-chip", accent && "flows-node-chip-accent")}>
      {children}
    </span>
  )
}

function FlowLibraryNodeButton({
  item,
  onAdd,
}: {
  item: FlowNodeLibraryItem
  onAdd: (
    type: FlowNodeLibraryItem["type"],
    position?: { x: number; y: number },
    operation?: FlowActionOperation,
  ) => void
}) {
  const Icon = item.icon

  return (
    <button
      type="button"
      data-testid={`flow-library-add-${item.testId}`}
      onClick={() => onAdd(item.type, undefined, item.operation)}
      className="flows-library-item group"
    >
      <span className={cn("flows-library-icon", item.tone)} aria-hidden>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-foreground">
          {item.label}
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
          {item.description}
        </span>
      </span>
      <Plus className="ml-auto size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
    </button>
  )
}

function ConditionNodeHandles() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="flows-node-handle flows-node-handle-target"
      />
      <Handle
        id={CONDITION_HANDLE_IDS.true}
        type="source"
        position={Position.Right}
        style={{ top: "38%" }}
        className="flows-node-handle flows-node-handle-branch-primary"
      />
      <Handle
        id={CONDITION_HANDLE_IDS.false}
        type="source"
        position={Position.Right}
        style={{ top: "72%" }}
        className="flows-node-handle flows-node-handle-branch-secondary"
      />
    </>
  )
}

function ConditionNodeShell({ children }: { children: ReactNode }) {
  return (
    <div className="flows-node-card flows-node-type-indigo min-w-[220px]">
      <ConditionNodeHandles />
      <div className="flows-node-inner">
        {children}
      </div>
    </div>
  )
}

function StartNodeCard({
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

function AgentNodeCard(props: {
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

function ConditionNodeCard(props: {
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

function ParallelNodeCard({ data }: { data: { label?: string } }) {
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

function JoinNodeCard({ data }: { data: { label?: string; policy?: string; quorum?: number | null } }) {
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

function DelayNodeCard({ data }: { data: { label?: string; duration?: number; unit?: string } }) {
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

function AwaitEventNodeCard({
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

function SetVariableNodeCard({
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

function TransformNodeCard({
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

function ActionNodeCard({ data }: { data: FlowActionNodeData }) {
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

function EndNodeCard({ data }: { data: { label?: string } }) {
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

const NODE_TYPES = {
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

type FlowDraftHistory = {
  past: FlowDraftSnapshot[]
  present: FlowDraftSnapshot
  future: FlowDraftSnapshot[]
}

type FlowContextMenuState = {
  kind: "canvas" | "node" | "edge"
  x: number
  y: number
  flowPosition: { x: number; y: number } | null
  nodeId: string | null
  nodeType: FlowCanvasNode["type"] | null
  edgeId: string | null
}

const HISTORY_LIMIT = 100
const HISTORY_MERGE_WINDOW_MS = 500
const AUTOSAVE_DELAY_MS = 900
const PUBLISH_SUCCESS_STATE_MS = 2200

type PersistFlowOptions = {
  reason?: "manual" | "autosave" | "publish" | "template"
  silentSuccess?: boolean
  snapshot?: FlowDraftSnapshot
}

function createDraftHistory(snapshot: FlowDraftSnapshot): FlowDraftHistory {
  return {
    past: [],
    present: snapshot,
    future: [],
  }
}

function isMacPrimaryModifier() {
  if (typeof navigator === "undefined") return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}

const INSPECTOR_SELECT_CLASS = "border-input dark:bg-input/30 h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-sm text-foreground shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
const EMPTY_SELECT_VALUE = "__mogplex_workflow_empty__"

type WorkflowSelectOption = {
  value: string
  label: string
  disabled?: boolean
  // When set, renders an active/inactive status dot before the label so the
  // open dropdown doubles as a status overview of every workflow.
  active?: boolean
}

function WorkflowSelect({
  value,
  options,
  onValueChange,
  ariaLabel,
  className,
  contentClassName,
  disabled,
  id,
  testId,
}: {
  value: string
  options: WorkflowSelectOption[]
  onValueChange: (value: string) => void
  ariaLabel: string
  className?: string
  contentClassName?: string
  disabled?: boolean
  id?: string
  testId?: string
}) {
  const normalizedValue = value || EMPTY_SELECT_VALUE

  return (
    <Select
      value={normalizedValue}
      onValueChange={(nextValue) =>
        onValueChange(nextValue === EMPTY_SELECT_VALUE ? "" : nextValue)
      }
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        data-testid={testId}
        data-value={value}
        className={cn(INSPECTOR_SELECT_CLASS, className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        position="popper"
        className={cn(
          "max-h-72 border-border bg-popover shadow-2xl",
          contentClassName,
        )}
      >
        {options.map((option) => (
          <SelectItem
            key={`${option.value}:${option.label}`}
            value={option.value || EMPTY_SELECT_VALUE}
            data-value={option.value}
            disabled={option.disabled}
          >
            {option.active === undefined ? (
              option.label
            ) : (
              <span className="inline-flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    option.active ? "bg-accent-green" : "bg-muted-foreground",
                  )}
                />
                <span className="truncate">{option.label}</span>
                <span className="sr-only">
                  {option.active ? " (active)" : " (inactive)"}
                </span>
              </span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function WorkflowCombobox({
  value,
  options,
  onValueChange,
  ariaLabel,
  placeholder,
  testId,
}: {
  value: string
  options: WorkflowSelectOption[]
  onValueChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  testId?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <Input
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            data-testid={testId}
            value={value}
            onFocus={() => setOpen(true)}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder={placeholder}
            className="pr-9"
          />
          <button
            type="button"
            aria-label="Open suggestions"
            aria-haspopup="listbox"
            aria-expanded={open}
            data-state={open ? "open" : "closed"}
            onClick={() => setOpen((current) => !current)}
            className="absolute inset-y-0 right-0 grid w-9 place-items-center text-muted-foreground transition-colors hover:text-foreground"
          >
            <NavArrowDown
              className={cn("size-3.5 transition-transform", open && "rotate-180")}
            />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-[var(--radix-popover-anchor-width)] border-border bg-popover p-1.5 shadow-2xl"
      >
        <div className="max-h-60 overflow-y-auto">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={value === option.value}
              onClick={() => {
                onValueChange(option.value)
                setOpen(false)
              }}
              className={cn(
                "flex w-full items-center rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-foreground/[0.05]",
                value === option.value && "bg-foreground/[0.06] text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

type InspectorCalloutVariant = "hint" | "warn" | "info"

function InspectorCallout({
  variant,
  icon,
  children,
  className,
  testId,
}: {
  variant: InspectorCalloutVariant
  icon?: ReactNode
  children: ReactNode
  className?: string
  testId?: string
}) {
  const styles: Record<InspectorCalloutVariant, string> = {
    hint: "border-border/60 bg-muted/30 text-muted-foreground",
    warn: "border-amber-400/30 bg-amber-400/[0.08] text-amber-700 dark:text-amber-200/90",
    info: "border-accent-blue/20 bg-accent-blue/[0.06] text-foreground/80",
  }
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex items-start gap-2.5 rounded-md border p-3 text-xs leading-5",
        styles[variant],
        className,
      )}
    >
      {icon ? (
        <span className="mt-0.5 shrink-0 [&_svg]:size-3.5">{icon}</span>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function InspectorField({
  label,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="text-[11px] font-medium text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  )
}

/**
 * One label/value pair in the inspector's read-only "Effective config" card.
 * `min-w-0` stops the cell from claiming its content's intrinsic width inside a
 * grid track, and `break-words` lets long model ids (minimax/minimax-m3) wrap
 * instead of bleeding into the neighbouring column.
 */
function InspectorSummaryItem({
  label,
  children,
}: {
  label: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="ui-label">{label}</div>
      <div className="mt-1 text-sm break-words text-foreground">{children}</div>
    </div>
  )
}

const AUTHOR_FILTER_OPTIONS: Array<{ value: FlowStartAuthorFilter; label: string }> = [
  { value: "any", label: "All authors" },
  { value: "humans_only", label: "Humans only (skip bot PRs)" },
  { value: "exclude_dependabot", label: "Skip Dependabot PRs" },
  { value: "dependabot_only", label: "Dependabot PRs only" },
]

function installationAccountTypeLabel(accountType: string | null | undefined) {
  return accountType?.toLowerCase() === "organization"
    ? "Organization"
    : accountType?.toLowerCase() === "user"
      ? "Personal"
      : "GitHub account"
}

function installationAccountLabel(installation: Installation) {
  return installation.account_login || `Installation ${installation.installation_id}`
}

function buildFilter(
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

function startDataForEvent(
  data: Record<string, unknown>,
  nextEvent: TriggerEvent,
): Record<string, unknown> {
  const filtered = stripAuthorFilterForEvent(data, nextEvent)
  const {
    labelName: _labelName,
    labelPrOnly: _labelPrOnly,
    tagPattern: _tagPattern,
    scheduleCron: _scheduleCron,
    scheduleTimezone: _scheduleTimezone,
    slackTeamId: _slackTeamId,
    slackChannelId: _slackChannelId,
    slackChannelName: _slackChannelName,
    ...rest
  } = filtered

  return {
    ...rest,
    event: nextEvent,
    label: EVENT_OPTIONS.find((option) => option.value === nextEvent)?.label || data.label,
    ...(nextEvent === "schedule"
      ? { scheduleCron: "0 9 * * 1-5", scheduleTimezone: "UTC" }
      : {}),
  }
}

// The "PR authors" control only renders for pr_opened, so switching to another
// event must also drop authorFilter from the node data — a hidden
// dependabot_only fails closed on events without PR-author context and would
// silently stop the flow from routing.
function stripAuthorFilterForEvent(
  data: Record<string, unknown>,
  nextEvent: string,
): Record<string, unknown> {
  if (nextEvent === "pr_opened") return data
  const filter = data.filter as FlowStartFilter | undefined
  if (!filter?.authorFilter) return data
  const { authorFilter: _omit, ...restFilter } = filter
  const isEmpty =
    (restFilter.scope ?? "all") === "all" &&
    !restFilter.installationIds?.length &&
    !restFilter.repos?.length
  if (isEmpty) {
    const { filter: _omitFilter, ...restData } = data
    return restData
  }
  return { ...data, filter: restFilter }
}

function RepositoryScopePicker({
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

function StartFilterFields({
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

function ExternalTriggerTestPanel({
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

export function FlowsPane() {
  const { scope } = useParams<{ scope: string }>()
  const { resolvedTheme } = useTheme()
  // React Flow needs an explicit mode — "system" would read the OS preference
  // and drift from the app theme the user picked. The pane renders client-only
  // (dynamic ssr:false), so there is no hydration mismatch to guard against.
  const canvasColorMode: ColorMode = resolvedTheme === "dark" ? "dark" : "light"
  const activeTeamId = useActiveTeamId()
  const harnessesKey = activeTeamId
    ? `/api/automations/harnesses?team=${encodeURIComponent(activeTeamId)}`
    : "/api/automations/harnesses"
  const {
    data: harnessesResponse,
    error: harnessesError,
    isLoading: harnessesLoading,
  } = useSWR<AutomationHarnessesResponse>(
    harnessesKey,
    async (url: string) => {
      const response = await fetch(url, {
        headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || `API error: ${response.status}`)
      }
      return response.json()
    },
  )
  const { data: flows, mutate: mutateFlows, isLoading } = useSWR<Flow[]>("/api/flows", fetcher)
  const {
    data: personalTemplatePages,
    isValidating: personalTemplatesValidating,
    size: personalTemplatePageCount,
    setSize: setPersonalTemplatePageCount,
    mutate: mutatePersonalTemplates,
  } = useSWRInfinite<PersonalFlowTemplatePage>(
    (_pageIndex, previousPage) => {
      if (previousPage && !previousPage.next_cursor) return null
      return previousPage?.next_cursor
        ? `/api/flows/templates?cursor=${encodeURIComponent(previousPage.next_cursor)}`
        : "/api/flows/templates"
    },
    fetcher,
  )
  const {
    data: teamTemplatePages,
    isValidating: teamTemplatesValidating,
    size: teamTemplatePageCount,
    setSize: setTeamTemplatePageCount,
    mutate: mutateTeamTemplates,
  } = useSWRInfinite<PersonalFlowTemplatePage>(
    (_pageIndex, previousPage) => {
      if (!activeTeamId || (previousPage && !previousPage.next_cursor)) {
        return null
      }
      const scopeQuery = `team_scope=${encodeURIComponent(activeTeamId)}`
      return previousPage?.next_cursor
        ? `/api/flows/templates?${scopeQuery}&cursor=${encodeURIComponent(previousPage.next_cursor)}`
        : `/api/flows/templates?${scopeQuery}`
    },
    async (url: string) => {
      const response = await fetch(url, {
        headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || `API error: ${response.status}`)
      }
      return response.json()
    },
  )
  const personalTemplates = useMemo(() => {
    const templatesById = new Map<string, PersonalFlowTemplate>()
    for (const page of personalTemplatePages ?? []) {
      for (const template of page.templates) {
        templatesById.set(template.id, template)
      }
    }
    return [...templatesById.values()]
  }, [personalTemplatePages])
  const personalTemplatesHaveMore = Boolean(
    personalTemplatePages?.at(-1)?.next_cursor,
  )
  const personalTemplatesLoadingMore =
    personalTemplatesValidating && Boolean(personalTemplatePages?.length)
  const teamTemplates = useMemo(() => {
    const templatesById = new Map<string, PersonalFlowTemplate>()
    for (const page of teamTemplatePages ?? []) {
      for (const template of page.templates) {
        templatesById.set(template.id, template)
      }
    }
    return [...templatesById.values()]
  }, [teamTemplatePages])
  const teamTemplatesHaveMore = Boolean(
    teamTemplatePages?.at(-1)?.next_cursor,
  )
  const teamTemplatesLoadingMore =
    teamTemplatesValidating && Boolean(teamTemplatePages?.length)
  const teamTemplatesCanWrite = teamTemplatePages?.[0]?.can_write !== false
  const { data: installations } = useSWR<Installation[]>("/api/github/installations", fetcher)
  const { data: slackInstallationsResponse } = useSWR<{
    installations: SlackInstallation[]
  }>("/api/integrations/slack/installations", fetcher)
  const { agents } = useAgents()
  const { repos, isLoading: reposLoading } = useRepos()
  const { models, defaultModelId, hiddenModelIds, isLoading: modelsLoading } = useModels()
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null)
  const { data: selectedFlow, mutate: mutateSelectedFlow } = useSWR<Flow>(
    selectedFlowId ? `/api/flows/${selectedFlowId}` : null,
    fetcher,
  )
  const { data: flowRunsResponse, mutate: mutateFlowRuns } = useSWR<{ runs: FlowRunRecord[] }>(
    selectedFlowId ? `/api/flows/${selectedFlowId}/runs?limit=12` : null,
    fetcher,
  )
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [activeFlowTab, setActiveFlowTabState] = useState<FlowTab>(readFlowTabFromLocation)
  useEffect(() => {
    const syncFlowTabFromLocation = () => setActiveFlowTabState(readFlowTabFromLocation())
    window.addEventListener("popstate", syncFlowTabFromLocation)
    return () => window.removeEventListener("popstate", syncFlowTabFromLocation)
  }, [])
  const setActiveFlowTab = useCallback(
    (value: string) => {
      const nextTab: FlowTab = value === "runs" ? "runs" : "editor"
      const url = new URL(window.location.href)
      const currentUrlTab: FlowTab = url.searchParams.get("tab") === "runs" ? "runs" : "editor"

      if (nextTab !== currentUrlTab) {
        if (nextTab === "runs") {
          url.searchParams.set("tab", "runs")
        } else {
          url.searchParams.delete("tab")
        }

        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
      }

      setActiveFlowTabState((current) => (current === nextTab ? current : nextTab))
    },
    [],
  )
  const {
    data: selectedRunDetailResponse,
    error: selectedRunDetailError,
    isLoading: selectedRunDetailLoading,
    mutate: mutateSelectedRunDetail,
  } = useSWR<{ run: FlowRunDetail }>(
    selectedFlowId && selectedRunId ? `/api/flows/${selectedFlowId}/runs/${selectedRunId}` : null,
    fetcher,
  )

  const [createInstallationId, setCreateInstallationId] = useState("")
  const [createRepository, setCreateRepository] = useState("all")
  const [browseInstallationId, setBrowseInstallationId] = useState("all")
  const [browseRepositories, setBrowseRepositories] = useState<string[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState("")
  const [saveTemplateScope, setSaveTemplateScope] = useState<"personal" | "team">("personal")
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [templateDeleteTarget, setTemplateDeleteTarget] = useState<{
    template: PersonalFlowTemplate
    scope: "personal" | "team"
  } | null>(null)
  const [deletingTemplate, setDeletingTemplate] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // Hydrate once on mount; persist on every subsequent change. Splitting these
  // avoids the race where a fast toggle during hydration could clobber the
  // stored value with the pre-hydration default.
  const sidebarHydratedRef = useRef(false)
  useEffect(() => {
    const stored = window.localStorage.getItem("mplex.flows.sidebarCollapsed")
    if (stored === "true") setSidebarCollapsed(true)
    sidebarHydratedRef.current = true
  }, [])
  useEffect(() => {
    if (!sidebarHydratedRef.current) return
    window.localStorage.setItem("mplex.flows.sidebarCollapsed", String(sidebarCollapsed))
  }, [sidebarCollapsed])
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const inspectorHydratedRef = useRef(false)
  useEffect(() => {
    const stored = window.localStorage.getItem("mplex.flows.inspectorCollapsed")
    if (stored === "true") setInspectorCollapsed(true)
    inspectorHydratedRef.current = true
  }, [])
  useEffect(() => {
    if (!inspectorHydratedRef.current) return
    window.localStorage.setItem("mplex.flows.inspectorCollapsed", String(inspectorCollapsed))
  }, [inspectorCollapsed])

  const [history, setHistory] = useState<FlowDraftHistory | null>(null)
  const [baselineDraft, setBaselineDraft] = useState<FlowDraftSnapshot | null>(null)
  const [reviewFindingIssueActionId, setReviewFindingIssueActionId] = useState<string | null>(null)
  const assistantPanelOpen = useFlowAssistantPanel((s) => s.open)
  const toggleAssistantPanel = useFlowAssistantPanel((s) => s.toggleOpen)
  const setAssistantPanelOpen = useFlowAssistantPanel((s) => s.setOpen)
  // Ref prevents async double-fires before React flushes state; state drives disabled UI.
  const activeRunActionsRef = useRef<ActiveRunActions>({})
  const [activeRunActions, setActiveRunActions] = useState<ActiveRunActions>({})
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishSucceeded, setPublishSucceeded] = useState(false)
  const [saveStatus, setSaveStatus] = useState<FlowSaveStatus>("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedInSessionFlowId, setSavedInSessionFlowId] = useState<string | null>(null)
  const [sandboxTestRepoId, setSandboxTestRepoId] = useState("")
  const [sandboxTestNodeId, setSandboxTestNodeId] = useState<string | null>(null)
  const [sandboxTestResult, setSandboxTestResult] = useState<AutomationSandboxTestResult | null>(null)
  const [sandboxTestError, setSandboxTestError] = useState<string | null>(null)
  const [sandboxTestRunning, setSandboxTestRunning] = useState(false)
  const [triggerTestRunning, setTriggerTestRunning] = useState(false)
  const webhookSecretGeneratingRef = useRef(false)
  const [webhookSecretGenerating, setWebhookSecretGenerating] = useState(false)
  const [generatedWebhookSecretState, setGeneratedWebhookSecretState] = useState<{
    flowId: string
    secret: string
  } | null>(null)
  const generatedWebhookSecret = generatedWebhookSecretState?.flowId === selectedFlowId
    ? generatedWebhookSecretState.secret
    : null
  const historyMergeRef = useRef<{ mergeKey: string | null; lastAt: number }>({ mergeKey: null, lastAt: 0 })
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const publishStateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autosaveAttemptSignatureRef = useRef<string | null>(null)
  const hydratedFlowIdRef = useRef<string | null>(null)
  const editorRef = useRef<HTMLElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const reactFlowRef = useRef<ReactFlowInstance<FlowCanvasNode, FlowCanvasEdge> | null>(null)
  const fittedFlowIdRef = useRef<string | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const canvasClipboardRef = useRef<FlowDraftClipboard | null>(null)
  const canvasPasteCountRef = useRef(0)
  const [contextMenu, setContextMenu] = useState<FlowContextMenuState | null>(null)
  const [flowSearch, setFlowSearch] = useState("")
  // Canvas is locked by default; holding Space turns the pointer into a grab handle
  // and enables left-button panning (Figma/tldraw-style). Released → back to locked.
  const [spacePanActive, setSpacePanActive] = useState(false)

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      if (target.isContentEditable) return true
      const tag = target.tagName
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return
      if (isTypingTarget(event.target)) return
      // Stop Space from scrolling the page or activating a focused button — must
      // run on auto-repeat keydowns too, otherwise a held Space still scrolls.
      event.preventDefault()
      if (event.repeat) return
      setSpacePanActive(true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return
      setSpacePanActive(false)
    }
    const reset = () => setSpacePanActive(false)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", reset)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", reset)
    }
  }, [])

  const browseRepositoryOptions = useMemo(() => {
    const candidates = (installations || []).filter(
      (installation) =>
        browseInstallationId === "all"
        || String(installation.installation_id) === browseInstallationId,
    )
    return candidates
      .flatMap((installation) =>
        installation.repositories.map((repository) => ({
          ...repository,
          installationId: installation.installation_id,
        })),
      )
      .sort((left, right) => left.full_name.localeCompare(right.full_name))
  }, [browseInstallationId, installations])
  const browseAccountLabel = useMemo(() => {
    if (browseInstallationId === "all") return "all connected accounts"
    const installation = (installations || []).find(
      (candidate) =>
        String(candidate.installation_id) === browseInstallationId,
    )
    return installation ? installationAccountLabel(installation) : "this account"
  }, [browseInstallationId, installations])

  const createRepositoryOptions = useMemo(() => {
    const installation = (installations || []).find(
      (candidate) =>
        String(candidate.installation_id) === createInstallationId,
    )
    return [...(installation?.repositories ?? [])].sort((left, right) =>
      left.full_name.localeCompare(right.full_name)
    )
  }, [createInstallationId, installations])

  useEffect(() => {
    if (
      createRepository !== "all" &&
      !createRepositoryOptions.some(
        (repository) => repository.full_name === createRepository,
      )
    ) {
      setCreateRepository("all")
    }
  }, [createRepository, createRepositoryOptions])

  const visibleFlows = useMemo(() => {
    const selectedRepositoryKeys = new Set(
      browseRepositories.map((repository) => repository.toLowerCase()),
    )
    const selectedRepositories = browseRepositoryOptions.filter((repository) =>
      selectedRepositoryKeys.has(repository.full_name.toLowerCase()),
    )

    return (flows || []).filter((flow) => {
      if (
        browseInstallationId !== "all"
        && String(flow.installation_id) !== browseInstallationId
      ) {
        return false
      }
      if (selectedRepositories.length === 0) return true
      const selectedForInstallation = selectedRepositories.filter(
        (repository) => repository.installationId === flow.installation_id,
      )
      if (selectedForInstallation.length === 0) return false
      const scopedRepos = getStartConfig(flow.draft_graph)?.filter?.repos ?? []
      if (scopedRepos.length === 0) return true
      const scopedRepositoryKeys = new Set(
        scopedRepos.map((repository) => repository.toLowerCase()),
      )
      return selectedForInstallation.some((repository) =>
        scopedRepositoryKeys.has(repository.full_name.toLowerCase()),
      )
    })
  }, [browseInstallationId, browseRepositories, browseRepositoryOptions, flows])

  useEffect(() => {
    const available = new Set(
      browseRepositoryOptions.map((repository) => repository.full_name),
    )
    setBrowseRepositories((current) => {
      const next = current.filter((repository) => available.has(repository))
      return next.length === current.length ? current : next
    })
  }, [browseRepositoryOptions])

  useEffect(() => {
    if (
      selectedFlowId
      && visibleFlows.some((flow) => flow.id === selectedFlowId)
    ) {
      return
    }
    setSelectedFlowId(visibleFlows[0]?.id ?? null)
  }, [selectedFlowId, visibleFlows])

  useEffect(() => {
    if (!createInstallationId && installations && installations.length > 0) {
      setCreateInstallationId(String(installations[0].installation_id))
    }
  }, [createInstallationId, installations])

  useEffect(() => {
    setSelectedRunId(null)
  }, [selectedFlowId])

  const draft = history?.present ?? null
  const dirty = useMemo(() => {
    return draft && baselineDraft
      ? serializePersistedFlowDraft(draft) !== serializePersistedFlowDraft(baselineDraft)
      : false
  }, [baselineDraft, draft])
  const baselineDraftSignature = useMemo(
    () => (baselineDraft ? serializePersistedFlowDraft(baselineDraft) : null),
    [baselineDraft],
  )
  const canUndo = (history?.past.length ?? 0) > 0
  const canRedo = (history?.future.length ?? 0) > 0
  const primaryModifierLabel = useMemo(
    () => (isMacPrimaryModifier() ? "⌘" : "Ctrl+"),
    [],
  )

  // Refs mirror local draft state so the hydration effect can read the latest values
  // without re-running on every keystroke or on intermediate renders during persistFlow
  // (e.g. after setBaselineDraft() but before mutateSelectedFlow() refreshes selectedFlow).
  const dirtyRef = useRef(dirty)
  const historyRef = useRef(history)
  const baselineDraftRef = useRef(baselineDraft)
  const baselineDraftSignatureRef = useRef(baselineDraftSignature)
  // ⚠️ Declaration order is load-bearing: this ref-sync effect MUST stay above the
  // hydration effect below. React fires effects in declaration order within a commit,
  // so if a render updates both `selectedFlow` and the mirrored draft state in the same
  // commit, the hydration effect would read stale ref values if this block were moved
  // or hoisted beneath it. (First render is safe because `useRef(value)` captures the
  // current value, but any subsequent co-change would race.)
  useEffect(() => {
    dirtyRef.current = dirty
    historyRef.current = history
    baselineDraftRef.current = baselineDraft
    baselineDraftSignatureRef.current = baselineDraftSignature
  })

  useEffect(() => {
    if (!selectedFlow) return
    const nextDraft = createFlowDraftSnapshot(selectedFlow)
    const flowChanged = hydratedFlowIdRef.current !== selectedFlow.id
    const shouldHydrate = shouldHydrateFlowDraftFromServer({
      currentFlowId: hydratedFlowIdRef.current,
      incomingFlowId: selectedFlow.id,
      hasDraftHistory: Boolean(historyRef.current),
      hasBaselineDraft: Boolean(baselineDraftRef.current),
      dirty: dirtyRef.current,
      currentBaselineSignature: baselineDraftSignatureRef.current,
      incomingSignature: serializePersistedFlowDraft(nextDraft),
    })
    hydratedFlowIdRef.current = selectedFlow.id
    if (flowChanged) {
      setSavedInSessionFlowId(null)
    }
    if (!shouldHydrate) {
      return
    }

    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
      autosaveTimeoutRef.current = null
    }
    if (publishStateTimeoutRef.current) {
      clearTimeout(publishStateTimeoutRef.current)
      publishStateTimeoutRef.current = null
    }
    setHistory(createDraftHistory(nextDraft))
    setBaselineDraft(cloneFlowDraftSnapshot(nextDraft))
    setContextMenu(null)
    setSaving(false)
    setPublishing(false)
    setPublishSucceeded(false)
    setSaveStatus("saved")
    setSaveError(null)
    autosaveAttemptSignatureRef.current = null
    historyMergeRef.current = { mergeKey: null, lastAt: 0 }
  }, [selectedFlow])
  const saveStatusLabel = useMemo(() => {
    switch (saveStatus) {
      case "pending":
        return "Autosave queued"
      case "saving":
        return "Autosaving..."
      case "error":
        return "Save failed"
      default:
        return dirty ? "Unsaved changes" : "Saved"
    }
  }, [dirty, saveStatus])
  const saveStatusTitle = saveError ?? saveStatusLabel
  const quietSaveStatus = !dirty && (saveStatus === "saved" || saveStatus === "idle")
  const saveStatusTone = useMemo(() => {
    if (quietSaveStatus) {
      return { container: "text-muted-foreground" }
    }

    switch (saveStatus) {
      case "pending":
        return {
          container: "border-accent-amber/25 bg-accent-amber/[0.10] text-accent-amber",
          dot: "bg-accent-amber",
        }
      case "saving":
        return {
          container: "border-accent-blue/25 bg-accent-blue/[0.10] text-accent-blue",
          dot: "bg-accent-blue",
        }
      case "error":
        return {
          container: "border-accent-red/30 bg-accent-red/[0.08] text-accent-red",
          dot: "bg-accent-red",
        }
      case "saved":
      default:
        // Idle or saved can reach this branch only while the draft is dirty.
        return {
          container: "border-accent-amber/25 bg-accent-amber/[0.10] text-accent-amber",
          dot: "bg-accent-amber",
        }
    }
  }, [quietSaveStatus, saveStatus])
  const saveStatusAnnouncement = flowSaveStatusAnnouncement({
    status: saveStatus,
    error: saveError,
    dirty,
    savedInSession: savedInSessionFlowId === selectedFlowId,
  })
  const hasUnpublishedGraphChanges = useMemo(() => {
    if (
      dirty
      || !draft
      || !selectedFlow?.published_version_id
    ) {
      return false
    }
    if (!selectedFlow.published_version) return true
    return serializePersistedFlowGraph(draftToGraph(draft))
      !== serializePersistedFlowGraph(selectedFlow.published_version.graph)
  }, [dirty, draft, selectedFlow?.published_version, selectedFlow?.published_version_id])
  const shouldPublishLatestDraft = dirty
    || hasUnpublishedGraphChanges
    || !selectedFlow?.published_version_id
  const primaryActionLabel = useMemo(() => {
    if (publishSucceeded && !dirty) {
      return "Published"
    }
    if (publishing) {
      return shouldPublishLatestDraft ? "Publishing..." : "Activating..."
    }
    if (selectedFlow?.status === "active") {
      return "Publish changes"
    }
    return shouldPublishLatestDraft
      ? "Publish & activate"
      : "Activate"
  }, [dirty, publishSucceeded, publishing, selectedFlow?.status, shouldPublishLatestDraft])
  const primaryActionClassName = useMemo(() => cn(
    "h-8 min-w-[92px] whitespace-nowrap rounded-md px-3 text-xs font-semibold shadow-lg sm:min-w-[96px]",
    publishSucceeded && !dirty
      ? "bg-accent-green text-white shadow-accent-green/25 hover:bg-accent-green/90"
      : "bg-primary text-primary-foreground shadow-primary/20 hover:bg-primary/90 hover:shadow-primary/30",
  ), [dirty, publishSucceeded])

  const selectedNode = useMemo(
    () => draft?.nodes.find((node) => node.id === draft.selectedNodeId) || null,
    [draft],
  )
  const inspectorOpen = Boolean(selectedFlow && selectedNode)
  const rightSheetOpen = assistantPanelOpen || inspectorOpen
  // Minimizing only applies to the idle docked panel; selecting a node or
  // opening the assistant always brings the inspector back.
  const inspectorDockCollapsed = inspectorCollapsed && !rightSheetOpen
  const [rightSheetAnimateOpen, setRightSheetAnimateOpen] = useState(false)
  useEffect(() => {
    if (!rightSheetOpen) {
      setRightSheetAnimateOpen(false)
      return
    }
    // Defer the "open" state by one frame so the slide transition runs
    // after the panel has flipped from display:none to display:block.
    const raf = requestAnimationFrame(() => setRightSheetAnimateOpen(true))
    return () => cancelAnimationFrame(raf)
  }, [rightSheetOpen])
  useEffect(() => {
    if (!rightSheetAnimateOpen || !selectedFlowId) return
    const flowId = selectedFlowId
    let fitRaf: number | null = null
    const layoutRaf = requestAnimationFrame(() => {
      fitRaf = requestAnimationFrame(() => {
        if (hydratedFlowIdRef.current === flowId) {
          void reactFlowRef.current?.fitView(FLOW_FIT_VIEW_OPTIONS)
        }
      })
    })
    return () => {
      cancelAnimationFrame(layoutRaf)
      if (fitRaf !== null) cancelAnimationFrame(fitRaf)
    }
  }, [rightSheetAnimateOpen, selectedFlowId])
  const selectedAgentDefinition = useMemo(
    () => (
      selectedNode?.type === "agent"
        ? (agents || []).find((agent) => agent.id === selectedNode.data.agentId) || null
        : null
    ),
    [agents, selectedNode],
  )
  const selectedStartNode = selectedNode?.type === "start"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "start" }>["data"] }
    : null
  const selectedStartConfig = useMemo(
    () => (draft ? getStartConfig(draftToGraph(draft)) : null),
    [draft],
  )
  const scopedInstallationIds = selectedStartConfig?.filter?.installationIds
  const effectiveInstallationId = scopedInstallationIds?.length === 1
    ? scopedInstallationIds[0]
    : selectedFlow?.installation_id ?? null
  const selectedFlowInstallation = (installations || []).find(
    (installation) => installation.installation_id === effectiveInstallationId,
  ) ?? null
  const selectedAgentNode = selectedNode?.type === "agent"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "agent" }>["data"] }
    : null
  const selectedActionNode = selectedNode?.type === "action"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "action" }>["data"] }
    : null
  const selectedSlackTeamId = selectedActionNode?.data.operation === "slack.send_message"
    && selectedActionNode.data.destination !== "trigger_thread"
    ? selectedActionNode.data.teamId
    : selectedStartNode?.data.event === "slack_mention"
      ? selectedStartNode.data.slackTeamId ?? ""
      : ""
  const {
    data: slackChannelPages,
    isLoading: slackChannelsLoading,
    isValidating: slackChannelsValidating,
    size: slackChannelPageCount,
    setSize: setSlackChannelPageCount,
  } = useSWRInfinite<SlackChannelsPage>(
    (_pageIndex, previousPage) => {
      if (!selectedSlackTeamId || (previousPage && !previousPage.nextCursor)) {
        return null
      }
      const base = `/api/integrations/slack/installations/${encodeURIComponent(selectedSlackTeamId)}/channels`
      return previousPage?.nextCursor
        ? `${base}?cursor=${encodeURIComponent(previousPage.nextCursor)}`
        : base
    },
    fetcher,
  )
  const slackInstallations = slackInstallationsResponse?.installations ?? []
  const slackChannels = useMemo(() => {
    const channelsById = new Map<string, SlackChannel>()
    for (const page of slackChannelPages ?? []) {
      for (const channel of page.channels) {
        channelsById.set(channel.id, channel)
      }
    }
    return [...channelsById.values()]
  }, [slackChannelPages])
  const slackChannelsHaveMore = Boolean(
    slackChannelPages?.at(-1)?.nextCursor
  )
  const slackChannelsLoadingMore =
    slackChannelsValidating && Boolean(slackChannelPages?.length)
  const slackConnectionsHref = scope
    ? scopedHref(scope, "/settings?tab=connections")
    : "/settings?tab=connections"
  const selectedAgentHarness: FlowAgentHarness = selectedAgentNode?.data.harness ?? "mogplex"
  const selectedHarnessAvailability = harnessesResponse?.harnesses[selectedAgentHarness] ?? null
  const selectedHarnessUnavailable = selectedAgentHarness !== "mogplex"
    && selectedHarnessAvailability?.available !== true
  const apiKeysSettingsHref = scope
    ? scopedHref(scope, "/settings?tab=keys")
    : "/settings?tab=keys"
  const selectedConditionNode = selectedNode?.type === "condition"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "condition" }>["data"] }
    : null
  const selectedParallelNode = selectedNode?.type === "parallel"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "parallel" }>["data"] }
    : null
  const selectedJoinNode = selectedNode?.type === "join"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "join" }>["data"] }
    : null
  const selectedDelayNode = selectedNode?.type === "delay"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "delay" }>["data"] }
    : null
  const selectedAwaitEventNode = selectedNode?.type === "await_event"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "await_event" }>["data"] }
    : null
  const selectedSetVariableNode = selectedNode?.type === "set_variable"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "set_variable" }>["data"] }
    : null
  const selectedTransformNode = selectedNode?.type === "transform"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "transform" }>["data"] }
    : null
  const selectedEndNode = selectedNode?.type === "end"
    ? selectedNode as FlowCanvasNode & { data: Extract<FlowNode, { type: "end" }>["data"] }
    : null
  // Pass the node's current model so a since-retired pin still renders as a
  // "Legacy · <id>" option. Without it the select has no matching option and
  // silently shows blank while the node keeps running the retired model.
  const availableModelOptions = useMemo(
    () => buildAgentModelOptions(models, selectedAgentNode?.data.modelOverride).map((option) => ({
      id: option.id,
      label: option.label,
    })),
    [models, selectedAgentNode?.data.modelOverride],
  )
  const enabledModelIds = useMemo(
    () => new Set(models.map((model) => model.id)),
    [models],
  )
  const quickReplaceFlowModelId = useMemo(
    () => getDefaultNewAgentModel(models, defaultModelId),
    [defaultModelId, models],
  )
  const quickReplaceFlowModelName = useMemo(
    () => models.find((model) => model.id === quickReplaceFlowModelId)?.name ?? quickReplaceFlowModelId,
    [models, quickReplaceFlowModelId],
  )
  const flowRuns = useMemo(
    () => flowRunsResponse?.runs ?? [],
    [flowRunsResponse?.runs],
  )
  const filteredNodeLibraryGroups = useMemo(() => {
    const query = flowSearch.trim().toLowerCase()
    if (!query) return FLOW_NODE_LIBRARY_GROUPS

    return FLOW_NODE_LIBRARY_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const searchable = `${item.label} ${item.description} ${group.label}`.toLowerCase()
        return searchable.includes(query)
      }),
    })).filter((group) => group.items.length > 0)
  }, [flowSearch])
  const filteredTriggerPresets = useMemo(() => {
    const query = flowSearch.trim().toLowerCase()
    if (!query) return TRIGGER_PRESETS
    return TRIGGER_PRESETS.filter((preset) =>
      `${preset.label} ${preset.description} trigger`
        .toLowerCase()
        .includes(query),
    )
  }, [flowSearch])
  const latestFlowRun = useMemo(() => flowRuns[0] ?? null, [flowRuns])
  const latestFlowRunStatus = latestFlowRun
    ? flowRunStatusLabel(latestFlowRun)
    : null
  const selectedRunSummary = useMemo(
    () => flowRuns.find((run) => run.id === selectedRunId) || null,
    [flowRuns, selectedRunId],
  )
  const selectedRunDetail = selectedRunDetailResponse?.run ?? null
  const flowSuccessRateLabel = useMemo(() => {
    if (flowRuns.length === 0) return null
    const completedRuns = flowRuns.filter((run) => run.status === "success" || run.status === "failed")
    if (completedRuns.length === 0) return null
    const successfulRuns = completedRuns.filter((run) => run.status === "success").length
    return `${Math.round((successfulRuns / completedRuns.length) * 100)}%`
  }, [flowRuns])

  const renderedCanvasNodes = useMemo(() => {
    if (!draft) return []
    const accountLabel = selectedFlowInstallation
      ? installationAccountLabel(selectedFlowInstallation)
      : undefined
    return draft.nodes.map((node) => node.type === "start"
      ? {
          ...node,
          data: {
            ...node.data,
            accountLabel,
          },
        }
      : node)
  }, [draft, selectedFlowInstallation])
  const currentTriggerNode = useMemo(() => {
    return draft?.nodes.find((node) => node.type === "start") ?? null
  }, [draft])
  const currentTriggerLabel = useMemo(() => {
    return selectedStartConfig ? eventLabel(selectedStartConfig.event) : "Trigger"
  }, [selectedStartConfig])
  const currentTriggerProvider = useMemo(() => {
    switch (selectedStartConfig?.event) {
      case "schedule":
        return "Cron"
      case "webhook":
        return "Signed webhook"
      case "slack_mention":
        return "Slack"
      default:
        return "GitHub"
    }
  }, [selectedStartConfig?.event])
  const sandboxTestRepos = useMemo<Repo[]>(() => {
    const scopedRepoNames = new Set(
      (selectedStartConfig?.filter?.repos || []).map((repo) => repo.toLowerCase()),
    )
    if (scopedRepoNames.size === 0) return repos
    const filtered = repos.filter((repo) => scopedRepoNames.has(repo.full_name.toLowerCase()))
    return filtered.length > 0 ? filtered : repos
  }, [repos, selectedStartConfig?.filter?.repos])
  useEffect(() => {
    if (!selectedAgentNode || selectedAgentNode.data.autofixSandbox !== true) {
      setSandboxTestNodeId(null)
      setSandboxTestResult(null)
      setSandboxTestError(null)
      return
    }

    if (sandboxTestNodeId !== selectedAgentNode.id) {
      setSandboxTestNodeId(selectedAgentNode.id)
      setSandboxTestResult(null)
      setSandboxTestError(null)
    }

    if (
      sandboxTestRepos.length > 0 &&
      (!sandboxTestRepoId || !sandboxTestRepos.some((repo) => repo.id === sandboxTestRepoId))
    ) {
      setSandboxTestRepoId(sandboxTestRepos[0]?.id ?? "")
    }
  }, [
    sandboxTestNodeId,
    sandboxTestRepoId,
    sandboxTestRepos,
    selectedAgentNode,
  ])
  const runAutomationSandboxTest = useCallback(async () => {
    if (!sandboxTestRepoId) return
    setSandboxTestRunning(true)
    setSandboxTestResult(null)
    setSandboxTestError(null)

    try {
      const response = await fetch("/api/automations/sandbox-test", {
        method: "POST",
        headers: getActiveTeamRequestHeaders(
          { "Content-Type": "application/json" },
          activeTeamId,
        ),
        body: JSON.stringify({ repoId: sandboxTestRepoId }),
      })
      const payload = await response.json().catch(() => null) as AutomationSandboxTestResult | { error?: string } | null
      if (!response.ok) {
        throw new Error(payload?.error || `Sandbox test failed (${response.status})`)
      }
      setSandboxTestResult(payload as AutomationSandboxTestResult)
    } catch (error) {
      setSandboxTestError(error instanceof Error ? error.message : "Sandbox test failed")
    } finally {
      setSandboxTestRunning(false)
    }
  }, [activeTeamId, sandboxTestRepoId])
  const generateWebhookSecret = useCallback(async () => {
    if (!selectedFlow || webhookSecretGeneratingRef.current) return
    webhookSecretGeneratingRef.current = true
    setWebhookSecretGenerating(true)
    try {
      const response = await fetch(`/api/flows/${selectedFlow.id}/webhook-secret`, {
        method: "POST",
      })
      const payload = await response.json().catch(() => null) as {
        secret?: string
        error?: string
      } | null
      if (!response.ok || !payload?.secret) {
        throw new Error(payload?.error || "Failed to generate webhook secret")
      }
      setGeneratedWebhookSecretState({
        flowId: selectedFlow.id,
        secret: payload.secret,
      })
      await Promise.all([mutateSelectedFlow(), mutateFlows()])
      toast({
        title: selectedFlow.webhook_configured
          ? "Webhook secret rotated"
          : "Webhook secret generated",
        description: "Copy it now. The signing secret is only shown once.",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to generate webhook secret",
        variant: "destructive",
      })
    } finally {
      webhookSecretGeneratingRef.current = false
      setWebhookSecretGenerating(false)
    }
  }, [mutateFlows, mutateSelectedFlow, selectedFlow])

  const copyWebhookValue = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast({ title: `${label} copied` })
    } catch {
      toast({
        title: "Copy failed",
        description: "Select and copy the value manually.",
        variant: "destructive",
      })
    }
  }, [])

  const runTriggerTest = useCallback(async (
    payload: Record<string, unknown>,
  ) => {
    if (!selectedFlow) return
    setTriggerTestRunning(true)
    try {
      const response = await fetch(`/api/flows/${selectedFlow.id}/test-trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      })
      const resultPayload = await response.json().catch(() => null) as {
        error?: string
        jobRunId?: string | null
        outcome?: string
      } | null
      if (!response.ok) {
        throw new Error(resultPayload?.error || "Failed to send test event")
      }
      await mutateFlowRuns()
      toast({
        title: resultPayload?.outcome === "queued" ? "Test event queued" : "Test event received",
        description: resultPayload?.jobRunId
          ? `Run ${resultPayload.jobRunId.slice(0, 8)} started from the published trigger.`
          : "The event was deduplicated or suppressed.",
      })
    } catch (error) {
      toast({
        title: "Test event failed",
        description: error instanceof Error ? error.message : "Failed to send test event",
        variant: "destructive",
      })
    } finally {
      setTriggerTestRunning(false)
    }
  }, [mutateFlowRuns, selectedFlow])
  const hasCanvasSelection = Boolean(
    draft?.selectedNodeId
    || draft?.nodes.some((node) => node.selected)
    || draft?.edges.some((edge) => edge.selected),
  )
  const contextMenuPosition = useMemo(() => {
    if (!contextMenu) return null
    const width = 240
    const height = contextMenu.kind === "node" ? 220 : contextMenu.kind === "edge" ? 180 : 480
    const padding = 12
    const rawX = Number.isFinite(contextMenu.x) ? contextMenu.x : padding
    const rawY = Number.isFinite(contextMenu.y) ? contextMenu.y : padding
    const maxLeft = typeof window === "undefined" ? rawX : window.innerWidth - width - padding
    const maxTop = typeof window === "undefined" ? rawY : window.innerHeight - height - padding
    return {
      left: Math.max(padding, Math.min(rawX, maxLeft)),
      top: Math.max(padding, Math.min(rawY, maxTop)),
    }
  }, [contextMenu])
  const edgeTypes = useMemo(() => ({
    semantic: FlowSemanticEdge,
  }), [])
  const selectedAgentRoleOption = useMemo(
    () => FLOW_AGENT_ROLE_OPTIONS.find((option) => option.value === (selectedAgentNode?.data.role || "review")) || FLOW_AGENT_ROLE_OPTIONS[0],
    [selectedAgentNode],
  )
  const selectedAgentNeedsReviewInput = useMemo(() => {
    if (!draft || !selectedAgentNode || selectedAgentNode.data.role !== "edit") {
      return false
    }

    if (isCommentTriggerEvent(selectedStartConfig?.event)) {
      return false
    }

    return !hasUpstreamAgentRole(draftToGraph(draft), selectedAgentNode.id, "review")
  }, [draft, selectedAgentNode, selectedStartConfig?.event])
  // The node's model is the only model — agents no longer carry one, so there
  // is no "base model" to fall back to.
  const selectedAgentEffectiveModel = selectedAgentHarness === "mogplex"
    ? selectedAgentNode?.data.modelOverride || "No model selected"
    : flowAgentHarnessLabel(selectedAgentHarness)
  const selectedAgentOverrideIsEnabled = Boolean(
    selectedAgentNode?.data.modelOverride
    && enabledModelIds.has(selectedAgentNode.data.modelOverride),
  )
  // Keep a retired model as the select's value so it renders its "Legacy ·"
  // option rather than snapping to blank and misreporting what will run.
  const selectedAgentModelSelectValue = selectedAgentNode?.data.modelOverride ?? ""
  const selectedAgentOverrideUsesUnavailableModel = Boolean(
    selectedAgentHarness === "mogplex"
    &&
    selectedAgentNode?.data.modelOverride
    && !selectedAgentOverrideIsEnabled
    && (!modelsLoading || isHiddenCatalogModelId(selectedAgentNode.data.modelOverride, hiddenModelIds)),
  )
  // A mogplex node with no model at all is now a validation error, not a
  // fall-back-to-the-agent case, so it gets the same prominent warning.
  const selectedAgentHasNoModel = Boolean(
    selectedAgentHarness === "mogplex" && !selectedAgentNode?.data.modelOverride,
  )
  const canQuickReplaceFlowModel = quickReplaceFlowModelId.length > 0
  // Flag any agent node whose effective model isn't in the enabled set (covers both
  // hidden-from-catalog and disabled-but-visible models). Mirrors the per-node
  // `selectedAgentOverrideUsesUnavailableModel` / `selectedAgentBaseUsesUnavailableModel`
  // criterion so the top-of-page banner count stays consistent with per-node warnings.
  // While `/api/models` is still loading we fall back to the legacy hidden-only check
  // to avoid flagging every node as unavailable on initial render.
  const effectiveLegacyAgentNodes = useMemo(() => {
    if (!draft) return []

    const isUnavailableModelId = (modelId: string | null | undefined): modelId is string => {
      if (typeof modelId !== "string" || modelId.length === 0) return false
      if (modelsLoading) {
        return isHiddenCatalogModelId(modelId, hiddenModelIds)
      }
      return !enabledModelIds.has(modelId)
    }

    return draft.nodes.reduce<Array<{ nodeId: string; label: string; modelId: string; source: "override" | "missing" }>>((issues, node) => {
      if (node.type !== "agent") return issues
      const agentNode = node as Extract<FlowNode, { type: "agent" }>
      if ((agentNode.data.harness ?? "mogplex") !== "mogplex") return issues
      const label = typeof agentNode.data.label === "string" && agentNode.data.label.length > 0 ? agentNode.data.label : agentNode.id
      // Checked before the availability guard: that guard reports false for an
      // empty id, which would otherwise let a model-less node pass. There is no
      // agent fallback to consider any more — publish rejects this outright.
      const nodeModelId = agentNode.data.modelOverride?.trim() ?? ""
      if (!nodeModelId) {
        issues.push({ nodeId: agentNode.id, label, modelId: "", source: "missing" })
        return issues
      }
      if (isUnavailableModelId(nodeModelId)) {
        issues.push({ nodeId: agentNode.id, label, modelId: nodeModelId, source: "override" })
      }
      return issues
    }, [])
  }, [draft, enabledModelIds, hiddenModelIds, modelsLoading])
  const selectedAgentEffectivePrompt = selectedAgentNode?.data.systemPromptOverride || selectedAgentDefinition?.system_prompt || null

  const updateDraft = useCallback((
    updater: (current: FlowDraftSnapshot) => FlowDraftSnapshot,
    options?: { recordHistory?: boolean; mergeKey?: string | null },
  ) => {
    const recordHistory = options?.recordHistory ?? true

    setHistory((current) => {
      if (!current) return current

      const nextPresent = updater(cloneFlowDraftSnapshot(current.present))
      if (!recordHistory) {
        return {
          ...current,
          present: nextPresent,
        }
      }

      const now = Date.now()
      const shouldMerge = Boolean(
        options?.mergeKey
          && historyMergeRef.current.mergeKey === options.mergeKey
          && now - historyMergeRef.current.lastAt < HISTORY_MERGE_WINDOW_MS,
      )

      historyMergeRef.current = {
        mergeKey: options?.mergeKey ?? null,
        lastAt: now,
      }

      return {
        past: shouldMerge
          ? current.past
          : [...current.past, cloneFlowDraftSnapshot(current.present)].slice(-HISTORY_LIMIT),
        present: nextPresent,
        future: [],
      }
    })
  }, [])

  const resetHistoryMerge = useCallback(() => {
    historyMergeRef.current = { mergeKey: null, lastAt: 0 }
  }, [])

  const handleFlowNameChange = useCallback((name: string) => {
    updateDraft((current) => ({
      ...current,
      name,
    }), { mergeKey: "flow-name" })
  }, [updateDraft])

  const undoDraft = useCallback(() => {
    resetHistoryMerge()
    setHistory((current) => {
      if (!current || current.past.length === 0) return current
      const previous = current.past[current.past.length - 1]
      return {
        past: current.past.slice(0, -1),
        present: cloneFlowDraftSnapshot(previous),
        future: [cloneFlowDraftSnapshot(current.present), ...current.future].slice(0, HISTORY_LIMIT),
      }
    })
  }, [resetHistoryMerge])

  const redoDraft = useCallback(() => {
    resetHistoryMerge()
    setHistory((current) => {
      if (!current || current.future.length === 0) return current
      const [next, ...rest] = current.future
      return {
        past: [...current.past, cloneFlowDraftSnapshot(current.present)].slice(-HISTORY_LIMIT),
        present: cloneFlowDraftSnapshot(next),
        future: rest,
      }
    })
  }, [resetHistoryMerge])

  const onNodesChange = useCallback((changes: NodeChange<FlowCanvasNode>[]) => {
    const flowId = selectedFlow?.id ?? null
    const shouldFitMeasuredGraph =
      Boolean(flowId) &&
      fittedFlowIdRef.current !== flowId &&
      changes.some((change) => change.type === "dimensions")
    const recordHistory = changes.some(
      (change) => change.type !== "select" && change.type !== "dimensions",
    )
    const mergeKey = changes.some((change) => change.type === "position")
      ? "node-position"
      : changes.some((change) => change.type === "remove")
        ? "node-remove"
        : changes.some((change) => change.type === "add")
          ? "node-add"
          : changes.some((change) => change.type === "replace")
            ? "node-replace"
            : changes.some((change) => change.type === "dimensions")
              ? "node-dimensions"
              : null

    updateDraft((current) => ({
      ...current,
      nodes: applyNodeChanges(changes, current.nodes),
    }), { recordHistory, mergeKey })
    if (shouldFitMeasuredGraph && flowId) {
      requestAnimationFrame(() => {
        const measuredNodes = reactFlowRef.current?.getNodes() ?? []
        if (
          hydratedFlowIdRef.current === flowId &&
          measuredNodes.length > 0 &&
          measuredNodes.every((node) => node.measured?.width && node.measured?.height)
        ) {
          fittedFlowIdRef.current = flowId
          void reactFlowRef.current?.fitView(FLOW_FIT_VIEW_OPTIONS)
        }
      })
    }
  }, [selectedFlow?.id, updateDraft])

  const onEdgesChange = useCallback((changes: EdgeChange<FlowCanvasEdge>[]) => {
    const recordHistory = changes.some((change) => change.type !== "select")
    const mergeKey = changes.some((change) => change.type === "remove")
      ? "edge-remove"
      : changes.some((change) => change.type === "add")
        ? "edge-add"
        : changes.some((change) => change.type === "replace")
          ? "edge-replace"
          : null

    updateDraft((current) => ({
      ...current,
      edges: applyEdgeChanges(changes, current.edges),
    }), { recordHistory, mergeKey })
  }, [updateDraft])

  const onConnect = useCallback((connection: Connection) => {
    updateDraft((current) => ({
      ...current,
      edges: addEdge(
        { ...connection, id: `${connection.source}-${connection.target}-${crypto.randomUUID().slice(0, 6)}` },
        current.edges,
      ),
    }), { mergeKey: "edge-add" })
  }, [updateDraft])

  const onSelectionChange = useCallback((selection: OnSelectionChangeParams) => {
    const node = selection.nodes?.[0]
    updateDraft((current) => ({
      ...current,
      selectedNodeId: node?.id ?? null,
    }), { recordHistory: false })
  }, [updateDraft])

  const updateNodeData = useCallback((
    nodeId: string,
    updater: (data: Record<string, unknown>) => Record<string, unknown>,
    options?: { mergeKey?: string | null },
  ) => {
    updateDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: updater(node.data) }
          : node,
      ),
    }), { mergeKey: options?.mergeKey ?? `node-data-${nodeId}` })
  }, [updateDraft])

  const updateTriggerInstallation = useCallback((installationId: number) => {
    if (
      !selectedStartNode
      || !(installations || []).some(
        (installation) => installation.installation_id === installationId,
      )
    ) {
      return
    }
    const accountChanged = effectiveInstallationId !== installationId
    updateNodeData(
      selectedStartNode.id,
      (data) => {
        const filter = data.filter as FlowStartFilter | undefined
        return {
          ...data,
          filter: buildFilter(
            installationId,
            accountChanged ? [] : (filter?.repos ?? []),
            filter?.authorFilter ?? "any",
          ),
        }
      },
      { mergeKey: `start-account-${selectedStartNode.id}` },
    )
  }, [effectiveInstallationId, installations, selectedStartNode, updateNodeData])

  const getDefaultInsertionPosition = useCallback(() => {
    const instance = reactFlowRef.current
    if (!instance) {
      return { x: 320, y: 200 }
    }
    const bounds = instance.getViewport()
    return instance.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: Math.max(200, window.innerHeight / 2),
    }) ?? { x: -bounds.x + 240, y: -bounds.y + 180 }
  }, [])

  const addNode = useCallback((
    type: Exclude<FlowNodeType, "start" | "end">,
    position?: { x: number; y: number },
    operation?: FlowActionOperation,
  ) => {
    const fallbackAgent = agents?.[0] || null
    const insertionPosition = position ?? getDefaultInsertionPosition()
    const defaultAgentRole = getDefaultFlowAgentRole(selectedStartConfig?.event)

    updateDraft((current) => {
      const result = type === "agent"
        ? insertFlowDraftAgent(current, {
            position: insertionPosition,
            label: fallbackAgent?.name || null,
            agentId: fallbackAgent?.id ?? null,
            role: defaultAgentRole,
          })
        : insertFlowDraftNode(current, type, {
            position: insertionPosition,
            operation,
          })
      return result.snapshot
    }, { mergeKey: "node-add" })
  }, [agents, getDefaultInsertionPosition, selectedStartConfig?.event, updateDraft])

  const selectCanvasNode = useCallback((nodeId: string) => {
    updateDraft((current) => selectFlowDraftNode(current, nodeId), {
      recordHistory: false,
    })
  }, [updateDraft])

  const applyTriggerPreset = useCallback((preset: (typeof TRIGGER_PRESETS)[number]) => {
    if (!currentTriggerNode) return
    updateNodeData(
      currentTriggerNode.id,
      (data) => {
        const eventData = startDataForEvent(data, preset.event)
        const next = preset.canvasLabel
          ? { ...eventData, label: preset.canvasLabel }
          : eventData
        if (!preset.authorFilter) return next
        const filter = (next.filter as FlowStartFilter | undefined) ?? { scope: "all" }
        return {
          ...next,
          filter: { ...filter, authorFilter: preset.authorFilter },
        }
      },
      { mergeKey: `trigger-preset-${preset.id}` },
    )
    selectCanvasNode(currentTriggerNode.id)
  }, [currentTriggerNode, selectCanvasNode, updateNodeData])

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNode || selectedNode.type === "start" || selectedNode.type === "end") return
    const result = draft ? deleteSelectedFlowDraftItems(draft) : null
    if (!result?.changed) return
    updateDraft(() => result.snapshot, { mergeKey: "node-remove" })
  }, [draft, selectedNode, updateDraft])

  const persistFlow = useCallback(async (options?: PersistFlowOptions) => {
    if (!selectedFlow || !draft) return false
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
      autosaveTimeoutRef.current = null
    }

    const snapshot = cloneFlowDraftSnapshot(options?.snapshot ?? draft)
    const snapshotSignature = serializePersistedFlowDraft(snapshot)
    autosaveAttemptSignatureRef.current = snapshotSignature

    setSaving(true)
    setSaveStatus("saving")
    setSaveError(null)
    try {
      // Saving a draft can fork preset agents server-side; send the active
      // team scope so the fork's model matches what the canvas displayed.
      const response = await fetch(`/api/flows/${selectedFlow.id}`, {
        method: "PUT",
        headers: getActiveTeamRequestHeaders(
          { "Content-Type": "application/json" },
          activeTeamId,
        ),
        body: JSON.stringify({
          name: snapshot.name,
          description: snapshot.description,
          notes: snapshot.notes,
          draft_graph: draftToGraph(snapshot),
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save flow")
      }

      setBaselineDraft(cloneFlowDraftSnapshot(snapshot))
      setSavedInSessionFlowId(selectedFlow.id)
      setSaveStatus("saved")
      autosaveAttemptSignatureRef.current = null
      await Promise.all([mutateSelectedFlow(), mutateFlows()])
      if (!options?.silentSuccess) {
        toast({
          title: "Draft saved",
          description: "The latest workflow changes are stored.",
        })
      }
      return true
    } catch (error) {
      const description = error instanceof Error ? error.message : "Failed to save flow"
      setSaveStatus("error")
      setSaveError(description)
      toast({
        title: "Error",
        description,
        variant: "destructive",
      })
      return false
    } finally {
      setSaving(false)
    }
  }, [
    activeTeamId,
    draft,
    mutateFlows,
    mutateSelectedFlow,
    selectedFlow,
  ])

  const createFlow = useCallback(async (
    templateId: FlowStarterTemplateId | null,
    savedTemplate?: PersonalFlowTemplate,
    savedTemplateScope: "personal" | "team" = "personal",
  ) => {
    if (!createInstallationId) return
    if (savedTemplate?.requires_repository && createRepository === "all") {
      toast({
        title: "Choose a repository",
        description: "This template uses a trigger that must target one repository.",
        variant: "destructive",
      })
      return
    }
    setIsCreating(true)
    try {
      const response = await fetch("/api/flows", {
        method: "POST",
        headers: savedTemplateScope === "team"
          ? getActiveTeamRequestHeaders(
              { "Content-Type": "application/json" },
              activeTeamId,
            )
          : { "Content-Type": "application/json" },
        body: JSON.stringify({
          installation_id: Number(createInstallationId),
          template_id: templateId,
          personal_template_id:
            savedTemplateScope === "personal" ? savedTemplate?.id ?? null : null,
          team_template_id:
            savedTemplateScope === "team" ? savedTemplate?.id ?? null : null,
          repo_full_name: createRepository === "all" ? null : createRepository,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create flow")
      }
      await mutateFlows()
      setBrowseInstallationId(createInstallationId)
      setBrowseRepositories(
        createRepository === "all" ? [] : [createRepository],
      )
      setSelectedFlowId(payload.id)
      setTemplatePickerOpen(false)
      const template = savedTemplate ?? FLOW_STARTER_TEMPLATES.find(
        (entry) => entry.id === templateId,
      )
      toast({
        title: "Workflow created",
        description: template ? `Started from ${template.name}.` : undefined,
      })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create flow",
        variant: "destructive",
      })
    } finally {
      setIsCreating(false)
    }
  }, [activeTeamId, createInstallationId, createRepository, mutateFlows])

  const saveSelectedFlowAsTemplate = useCallback(async () => {
    if (!selectedFlow || !saveTemplateName.trim() || savingTemplate) return
    setSavingTemplate(true)
    try {
      const saved = dirty
        ? await persistFlow({
            reason: "template",
            silentSuccess: true,
            snapshot: draft ? cloneFlowDraftSnapshot(draft) : undefined,
          })
        : true
      if (!saved) return

      const savingToTeam = saveTemplateScope === "team"
      const response = await fetch("/api/flows/templates", {
        method: "POST",
        headers: savingToTeam
          ? getActiveTeamRequestHeaders(
              { "Content-Type": "application/json" },
              activeTeamId,
            )
          : { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow_id: selectedFlow.id,
          name: saveTemplateName.trim(),
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save workflow template")
      }
      if (savingToTeam) {
        await setTeamTemplatePageCount(1)
        await mutateTeamTemplates()
      } else {
        await setPersonalTemplatePageCount(1)
        await mutatePersonalTemplates()
      }
      setSaveTemplateOpen(false)
      setTemplatePickerOpen(true)
      toast({
        title: savingToTeam ? "Team template saved" : "Template saved",
        description: payload.reconnect?.length
          ? savingToTeam
            ? "Private agents and connection-specific settings were removed and will be requested when reused."
            : "Connection-specific settings were removed and will be requested when reused."
          : savingToTeam
            ? "This workflow is now available to your active team."
            : "This workflow can now be reused from Quick start.",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error
          ? error.message
          : "Failed to save workflow template",
        variant: "destructive",
      })
    } finally {
      setSavingTemplate(false)
    }
  }, [
    activeTeamId,
    dirty,
    draft,
    mutatePersonalTemplates,
    mutateTeamTemplates,
    persistFlow,
    saveTemplateName,
    saveTemplateScope,
    savingTemplate,
    selectedFlow,
    setPersonalTemplatePageCount,
    setTeamTemplatePageCount,
  ])

  const deleteSavedTemplate = useCallback(async () => {
    if (!templateDeleteTarget || deletingTemplate) return
    setDeletingTemplate(true)
    try {
      const response = await fetch(
        `/api/flows/templates/${encodeURIComponent(templateDeleteTarget.template.id)}`,
        {
          method: "DELETE",
          headers: templateDeleteTarget.scope === "team"
            ? getActiveTeamRequestHeaders(undefined, activeTeamId)
            : undefined,
        },
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete workflow template")
      }
      if (templateDeleteTarget.scope === "team") {
        await mutateTeamTemplates()
      } else {
        await mutatePersonalTemplates()
      }
      toast({
        title: "Template deleted",
        description: `"${templateDeleteTarget.template.name}" was permanently deleted.`,
        variant: "destructive",
      })
      setTemplateDeleteTarget(null)
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error
          ? error.message
          : "Failed to delete workflow template",
        variant: "destructive",
      })
    } finally {
      setDeletingTemplate(false)
    }
  }, [
    activeTeamId,
    deletingTemplate,
    mutatePersonalTemplates,
    mutateTeamTemplates,
    templateDeleteTarget,
  ])

  const publishFlow = useCallback(async () => {
    if (!selectedFlow || publishing || saving) return
    const wasActive = selectedFlow.status === "active"
    setPublishing(true)
    setPublishSucceeded(false)
    try {
      const saved = dirty
        ? await persistFlow({
            reason: "publish",
            silentSuccess: true,
            snapshot: draft ? cloneFlowDraftSnapshot(draft) : undefined,
          })
        : true
      if (!saved) return
      // Publish can fork legacy preset agents — carry the active team scope.
      const response = await fetch(`/api/flows/${selectedFlow.id}/publish`, {
        method: "POST",
        headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to publish flow")
      }
      await Promise.all([mutateSelectedFlow(), mutateFlows()])
      setPublishSucceeded(true)
      if (publishStateTimeoutRef.current) {
        clearTimeout(publishStateTimeoutRef.current)
      }
      publishStateTimeoutRef.current = setTimeout(() => {
        setPublishSucceeded(false)
        publishStateTimeoutRef.current = null
      }, PUBLISH_SUCCESS_STATE_MS)
      toast({
        title: wasActive ? "Published to live workflow" : "Flow published and activated",
        description: wasActive
          ? "Webhook routing now points at the newest saved draft."
          : "This workflow is now live and will receive matching events.",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to publish flow",
        variant: "destructive",
      })
    } finally {
      setPublishing(false)
    }
  }, [activeTeamId, dirty, draft, mutateFlows, mutateSelectedFlow, persistFlow, publishing, saving, selectedFlow])

  const toggleFlowStatus = useCallback(async () => {
    if (!selectedFlow) return
    try {
      const nextStatus = selectedFlow.status === "active" ? "inactive" : "active"
      const response = await fetch(`/api/flows/${selectedFlow.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update flow status")
      }
      await Promise.all([mutateSelectedFlow(), mutateFlows()])
      toast({
        title: nextStatus === "active" ? "Flow activated" : "Flow deactivated",
        description: nextStatus === "active"
          ? "Webhook routing is live for the current published version."
          : "Webhook routing is paused until you reactivate this flow.",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update flow status",
        variant: "destructive",
      })
    }
  }, [mutateFlows, mutateSelectedFlow, selectedFlow])

  useEffect(() => {
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current)
      }
      if (publishStateTimeoutRef.current) {
        clearTimeout(publishStateTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!publishSucceeded || !dirty) return
    setPublishSucceeded(false)
    if (publishStateTimeoutRef.current) {
      clearTimeout(publishStateTimeoutRef.current)
      publishStateTimeoutRef.current = null
    }
  }, [dirty, publishSucceeded])

  useEffect(() => {
    if (!selectedFlow || !draft || !dirty || saving || publishing) return

    const snapshot = cloneFlowDraftSnapshot(draft)
    const snapshotSignature = serializePersistedFlowDraft(snapshot)
    if (autosaveAttemptSignatureRef.current === snapshotSignature) return

    setSaveStatus("pending")
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
    }

    autosaveTimeoutRef.current = setTimeout(() => {
      autosaveTimeoutRef.current = null
      void persistFlow({
        reason: "autosave",
        silentSuccess: true,
        snapshot,
      })
    }, AUTOSAVE_DELAY_MS)

    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current)
        autosaveTimeoutRef.current = null
      }
    }
  }, [dirty, draft, persistFlow, publishing, saving, selectedFlow])

  const duplicateSelectedFlow = useCallback(async () => {
    if (!selectedFlow) return
    try {
      // Duplication can fork legacy preset agents — carry the active team scope.
      const response = await fetch(`/api/flows/${selectedFlow.id}/duplicate`, {
        method: "POST",
        headers: getActiveTeamRequestHeaders(undefined, activeTeamId),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to duplicate flow")
      }
      await mutateFlows()
      setSelectedFlowId(payload.id)
      toast({ title: "Flow duplicated" })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to duplicate flow",
        variant: "destructive",
      })
    }
  }, [activeTeamId, mutateFlows, selectedFlow])

  const setRunActionState = useCallback((jobId: string, action: FlowRunAction | null) => {
    const next = { ...activeRunActionsRef.current }

    if (action) {
      next[jobId] = action
    } else {
      delete next[jobId]
    }

    activeRunActionsRef.current = next
    setActiveRunActions(next)
  }, [])

  const runFlowJobAction = useCallback(async (jobId: string, action: FlowRunAction) => {
    if (activeRunActionsRef.current[jobId]) return

    setRunActionState(jobId, action)

    try {
      const response = await fetch(`/api/observability/jobs/${jobId}/${action}`, { method: "POST" })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || `Failed to ${action} flow run`)
      }
      await Promise.all([mutateFlowRuns(), mutateFlows(), mutateSelectedRunDetail()])
      toast({
        title: action === "repair"
          ? "Repair queued"
          : action === "requeue"
            ? "Retry queued"
            : "Run cancelled",
        description: action === "cancel"
          ? (payload.cancelError ? `Cancellation completed with warnings: ${payload.cancelError}` : "Run cancelled.")
          : (payload.jobRunId ? `Job ${payload.jobRunId} queued.` : undefined),
      })
    } catch (error) {
      toast({
        title: action === "repair"
          ? "Repair failed"
          : action === "requeue"
            ? "Retry failed"
            : "Cancel failed",
        description: error instanceof Error ? error.message : `Failed to ${action} flow run`,
        variant: "destructive",
      })
    } finally {
      setRunActionState(jobId, null)
    }
  }, [mutateFlowRuns, mutateFlows, mutateSelectedRunDetail, setRunActionState])

  const createReviewFindingIssue = useCallback(async (findingId: string) => {
    if (reviewFindingIssueActionId) return
    if (!selectedRunDetail) {
      toast({
        title: "No run selected",
        description: "Reload the run details and try again.",
        variant: "destructive",
      })
      return
    }

    setReviewFindingIssueActionId(findingId)

    try {
      const response = await fetch(
        `/api/observability/jobs/${selectedRunDetail.id}/review-findings/${findingId}/issue`,
        { method: "POST" },
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to create GitHub issue")
      }

      await mutateSelectedRunDetail()

      toast({
        title: payload?.created === false ? "Issue already linked" : "Issue created",
        description: typeof payload?.issueNumber === "number"
          ? `GitHub issue #${payload.issueNumber}`
          : undefined,
      })
    } catch (error) {
      toast({
        title: "Issue creation failed",
        description: error instanceof Error ? error.message : "Failed to create GitHub issue",
        variant: "destructive",
      })
    } finally {
      setReviewFindingIssueActionId(null)
    }
  }, [mutateSelectedRunDetail, reviewFindingIssueActionId, selectedRunDetail])

  const deleteSelectedFlow = useCallback(async () => {
    if (!selectedFlow) return
    if (!window.confirm(`Delete "${selectedFlow.name}"?`)) return

    try {
      const response = await fetch(`/api/flows/${selectedFlow.id}`, { method: "DELETE" })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to delete flow")
      }
      await mutateFlows()
      setSelectedFlowId((current) => (current === selectedFlow.id ? null : current))
      toast({
        title: "Workflow deleted",
        description: `"${selectedFlow.name}" was permanently deleted.`,
        variant: "destructive",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete flow",
        variant: "destructive",
      })
    }
  }, [mutateFlows, selectedFlow])

  const deleteSelectedCanvasItems = useCallback(() => {
    if (!draft) return false
    const result = deleteSelectedFlowDraftItems(draft)
    if (!result.changed) return false
    updateDraft(() => result.snapshot, { mergeKey: "graph-delete" })
    return true
  }, [draft, updateDraft])

  const duplicateSelectedCanvasItems = useCallback(() => {
    if (!draft) return false
    const result = duplicateSelectedFlowDraftAgents(draft)
    if (!result.changed) return false
    updateDraft(() => result.snapshot, { mergeKey: "graph-duplicate" })
    return true
  }, [draft, updateDraft])

  const duplicateContextMenuNode = useCallback((nodeId: string) => {
    updateDraft((current) => {
      const selected = selectFlowDraftNode(current, nodeId)
      return duplicateSelectedFlowDraftAgents(selected).snapshot
    }, { mergeKey: "graph-duplicate" })
  }, [updateDraft])

  const deleteContextMenuNode = useCallback((nodeId: string) => {
    updateDraft((current) => {
      const selected = selectFlowDraftNode(current, nodeId)
      return deleteSelectedFlowDraftItems(selected).snapshot
    }, { mergeKey: "graph-delete" })
  }, [updateDraft])

  const copySelectedCanvasItems = useCallback(() => {
    if (!draft) return false
    const clipboard = copySelectedFlowDraftItems(draft)
    if (!clipboard) return false
    canvasClipboardRef.current = clipboard
    canvasPasteCountRef.current = 0
    return true
  }, [draft])

  const cutSelectedCanvasItems = useCallback(() => {
    if (!draft) return false
    const clipboard = copySelectedFlowDraftItems(draft)
    if (!clipboard) return false
    const result = deleteSelectedFlowDraftItems(draft)
    if (!result.changed) return false
    canvasClipboardRef.current = clipboard
    canvasPasteCountRef.current = 0
    updateDraft(() => result.snapshot)
    return true
  }, [draft, updateDraft])

  const pasteCanvasItems = useCallback(() => {
    const clipboard = canvasClipboardRef.current
    if (!draft || !clipboard) return false
    const pasteCount = canvasPasteCountRef.current + 1
    const result = pasteFlowDraftItems(draft, clipboard, {
      offset: { x: 48 * pasteCount, y: 48 * pasteCount },
    })
    if (!result.changed) return false
    canvasPasteCountRef.current = pasteCount
    updateDraft(() => result.snapshot)
    return true
  }, [draft, updateDraft])

  const clearCanvasSelection = useCallback(() => {
    if (!draft) return false
    const hasSelection = Boolean(
      draft.selectedNodeId
      || draft.nodes.some((node) => node.selected)
      || draft.edges.some((edge) => edge.selected),
    )
    if (!hasSelection) return false
    updateDraft(() => clearFlowDraftSelection(draft), { recordHistory: false })
    return true
  }, [draft, updateDraft])

  const selectAllCanvasAgents = useCallback(() => {
    if (!draft || !draft.nodes.some((node) => node.type !== "start" && node.type !== "end")) return false
    updateDraft(() => selectAllFlowDraftAgents(draft), { recordHistory: false })
    return true
  }, [draft, updateDraft])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const resolveContextMenuPoint = useCallback((clientX: number, clientY: number) => {
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
      return { x: clientX, y: clientY }
    }

    const rect = editorRef.current?.getBoundingClientRect()
    if (!rect) {
      return { x: 24, y: 96 }
    }

    return {
      x: Math.min(rect.left + 320, rect.right - 24),
      y: Math.min(rect.top + 96, rect.bottom - 24),
    }
  }, [])

  const openCanvasContextMenu = useCallback((clientX: number, clientY: number) => {
    const point = resolveContextMenuPoint(clientX, clientY)
    setContextMenu({
      kind: "canvas",
      x: point.x,
      y: point.y,
      flowPosition: reactFlowRef.current?.screenToFlowPosition(point) ?? null,
      nodeId: null,
      nodeType: null,
      edgeId: null,
    })
  }, [resolveContextMenuPoint])

  const openNodeContextMenu = useCallback((node: FlowCanvasNode, clientX: number, clientY: number) => {
    const point = resolveContextMenuPoint(clientX, clientY)
    updateDraft((current) => selectFlowDraftNode(current, node.id), { recordHistory: false })
    setContextMenu({
      kind: "node",
      x: point.x,
      y: point.y,
      flowPosition: reactFlowRef.current?.screenToFlowPosition(point) ?? null,
      nodeId: node.id,
      nodeType: node.type,
      edgeId: null,
    })
  }, [resolveContextMenuPoint, updateDraft])

  const openEdgeContextMenu = useCallback((edgeId: string, clientX: number, clientY: number) => {
    const point = resolveContextMenuPoint(clientX, clientY)
    updateDraft((current) => selectFlowDraftEdge(current, edgeId), { recordHistory: false })
    setContextMenu({
      kind: "edge",
      x: point.x,
      y: point.y,
      flowPosition: reactFlowRef.current?.screenToFlowPosition(point) ?? null,
      nodeId: null,
      nodeType: null,
      edgeId,
    })
  }, [resolveContextMenuPoint, updateDraft])

  const renderedEdges = useMemo<FlowCanvasEdge[]>(() => {
    if (!draft) return []

    return draft.edges.map((edge) => {
      const sourceNode = draft.nodes.find((node) => node.id === edge.source)
      const targetNode = draft.nodes.find((node) => node.id === edge.target)

      let label: string | null = null
      let tone: FlowRenderableEdgeData["tone"] = "default"

      if (edge.sourceHandle === FAILURE_HANDLE_ID) {
        label = "Error"
        tone = "danger"
      } else if (sourceNode?.type === "condition") {
        if (edge.sourceHandle === CONDITION_HANDLE_IDS.true) {
          label = "Then"
          tone = "condition"
        } else if (edge.sourceHandle === CONDITION_HANDLE_IDS.false) {
          label = "Else"
          tone = "alternate"
        }
      } else if (sourceNode?.type === "parallel") {
        label = "Branch"
        tone = "parallel"
      } else if (targetNode?.type === "join") {
        label = "Merge"
        tone = "join"
      } else if (sourceNode?.type === "delay") {
        label = "Resume"
      }

      return {
        ...edge,
        type: "semantic",
        data: {
          label,
          tone,
          edgeId: edge.id,
          onInsertMenu: openEdgeContextMenu,
        } as Record<string, unknown>,
      }
    })
  }, [draft, openEdgeContextMenu])

  const insertNodeOnEdge = useCallback((
    edgeId: string,
    type:
      | "agent"
      | "action"
      | "delay"
      | "await_event"
      | "set_variable"
      | "transform",
    position?: { x: number; y: number },
    operation?: FlowActionOperation,
  ) => {
    if (!draft) return false
    const fallbackAgent = agents?.[0] || null
    const defaultAgentRole = getDefaultFlowAgentRole(selectedStartConfig?.event)
    const result = insertFlowDraftNodeOnEdge(draft, edgeId, type, type === "agent"
      ? {
          position,
          label: fallbackAgent?.name || null,
          agentId: fallbackAgent?.id ?? null,
          role: defaultAgentRole,
        }
      : { position, operation })

    if (!result.changed) return false
    updateDraft(() => result.snapshot, { mergeKey: "edge-insert-node" })
    return true
  }, [agents, draft, selectedStartConfig?.event, updateDraft])

  const tidyCanvasLayout = useCallback(() => {
    if (!draft) return false
    const result = tidyFlowDraftLayout(draft)
    if (!result.changed) return false
    updateDraft(() => result.snapshot, { mergeKey: "graph-tidy" })
    return true
  }, [draft, updateDraft])

  const straightenCanvasSelection = useCallback(() => {
    if (!draft) return false
    const result = straightenSelectedFlowDraftNodes(draft)
    if (!result.changed) return false
    updateDraft(() => result.snapshot, { mergeKey: "graph-straighten" })
    return true
  }, [draft, updateDraft])

  const handlePaneContextMenu = useCallback((event: MouseEvent | ReactMouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest(".react-flow__node, .react-flow__edge")) return

    event.preventDefault()
    if ("stopPropagation" in event) {
      event.stopPropagation()
    }
    canvasRef.current?.focus()
    openCanvasContextMenu(event.clientX, event.clientY)
  }, [openCanvasContextMenu])

  const runContextMenuAction = useCallback((action: () => void | Promise<unknown>) => {
    closeContextMenu()
    const result = action()
    if (result instanceof Promise) {
      void result
    }
  }, [closeContextMenu])

  const applyAssistantGraph = useCallback((graph: FlowGraph) => {
    updateDraft((current) => ({
      ...current,
      ...graphToCanvas(graph),
      selectedNodeId: null,
    }), { mergeKey: "assistant-apply" })
  }, [updateDraft])

  const draftGraph = useMemo(() => (draft ? draftToGraph(draft) : null), [draft])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedFlow) return
      if (selectedRunId) return

      const isMac = isMacPrimaryModifier()
      const hasPrimaryModifier = isMac ? event.metaKey : event.ctrlKey
      const key = event.key.toLowerCase()

      if (hasPrimaryModifier && key === "s") {
        event.preventDefault()
        void persistFlow()
        return
      }

      // No menu action leaves this state set while another keyboard-owned surface is open.
      if (contextMenu && event.key === "Escape") {
        closeContextMenu()
        return
      }

      const activeElement = document.activeElement
      const eventElement = event.target instanceof Element ? event.target : null
      if (shouldIgnoreCanvasShortcut(activeElement, eventElement, document)) {
        return
      }

      if (contextMenu) {
        // Destructive canvas shortcuts dismiss the menu without reaching the
        // current selection. Editable fields retain their native behavior via
        // the guard above.
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault()
          closeContextMenu()
        }
        return
      }

      if (hasPrimaryModifier && !event.shiftKey && key === "z") {
        event.preventDefault()
        undoDraft()
        return
      }

      if (
        (hasPrimaryModifier && event.shiftKey && key === "z")
        || (!isMac && event.ctrlKey && !event.shiftKey && key === "y")
      ) {
        event.preventDefault()
        redoDraft()
        return
      }

      if (hasPrimaryModifier && key === "d") {
        event.preventDefault()
        duplicateSelectedCanvasItems()
        return
      }

      const canvasOwnsFocus = activeFlowTab === "editor"
        && Boolean(activeElement && canvasRef.current?.contains(activeElement))
      const documentSelectionIsActive = window.getSelection()?.isCollapsed === false

      if (hasPrimaryModifier && key === "c") {
        if (canvasOwnsFocus && !documentSelectionIsActive && copySelectedCanvasItems()) {
          event.preventDefault()
        }
        return
      }

      if (hasPrimaryModifier && key === "x") {
        if (canvasOwnsFocus && !documentSelectionIsActive && cutSelectedCanvasItems()) {
          event.preventDefault()
        }
        return
      }

      if (hasPrimaryModifier && key === "v") {
        if (canvasOwnsFocus && pasteCanvasItems()) {
          event.preventDefault()
        }
        return
      }

      if (hasPrimaryModifier && key === "a") {
        event.preventDefault()
        selectAllCanvasAgents()
        return
      }

      if (event.key === "Escape") {
        event.preventDefault()
        clearCanvasSelection()
        return
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault()
        deleteSelectedCanvasItems()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    clearCanvasSelection,
    closeContextMenu,
    contextMenu,
    activeFlowTab,
    copySelectedCanvasItems,
    cutSelectedCanvasItems,
    deleteSelectedCanvasItems,
    duplicateSelectedCanvasItems,
    pasteCanvasItems,
    persistFlow,
    redoDraft,
    selectAllCanvasAgents,
    selectedFlow,
    selectedRunId,
    undoDraft,
  ])

  useEffect(() => {
    if (!contextMenu) return

    const handlePointerDown = (event: MouseEvent | PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (!target) return
      if (contextMenuRef.current?.contains(target)) return
      closeContextMenu()
    }

    const handleWindowContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return
      const target = event.target instanceof Node ? event.target : null
      if (!target) return
      if (contextMenuRef.current?.contains(target)) return
      closeContextMenu()
    }

    const handleWindowChange = () => {
      closeContextMenu()
    }

    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("contextmenu", handleWindowContextMenu)
    window.addEventListener("resize", handleWindowChange)
    window.addEventListener("scroll", handleWindowChange, true)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("contextmenu", handleWindowContextMenu)
      window.removeEventListener("resize", handleWindowChange)
      window.removeEventListener("scroll", handleWindowChange, true)
    }
  }, [closeContextMenu, contextMenu])

  return (
    <div className="flows-pane relative flex h-full min-h-0 flex-col bg-background">
      <div
        data-testid="flow-browser-filters"
        className="flex h-12 min-h-12 min-w-[760px] items-center gap-2 border-b border-border bg-card px-3"
      >
        <div className="mr-1 hidden shrink-0 items-center gap-2 lg:flex">
          <Github className="size-3.5 text-muted-foreground" />
          <span className="text-[9px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            Viewing
          </span>
        </div>
        <WorkflowSelect
          testId="flow-browser-account"
          ariaLabel="Filter workflows by GitHub account"
          value={browseInstallationId}
          onValueChange={(value) => {
            setBrowseInstallationId(value)
            setBrowseRepositories([])
          }}
          className="h-8 max-w-[220px] rounded-md border border-border bg-input px-2.5 text-[11px] font-medium text-foreground"
          options={[
            { value: "all", label: "All GitHub accounts" },
            ...(installations || []).map((installation) => ({
              value: String(installation.installation_id),
              label: `${installationAccountLabel(installation)} · ${installationAccountTypeLabel(installation.account_type)}`,
            })),
          ]}
        />
        <div className="min-w-0 max-w-[260px] flex-1">
          <RepositoryScopePicker
            accountLabel={browseAccountLabel}
            options={browseRepositoryOptions.map(
              (repository) => repository.full_name,
            )}
            selected={browseRepositories}
            onChange={setBrowseRepositories}
            ariaLabel="Filter workflows by repository"
            compact
            testId="flow-browser-repository"
            optionTestIdPrefix="flow-browser-repository-option"
            menuLabel="Repository filter"
            description="Choose which repositories are visible in the workflow list."
          />
        </div>
        <span
          className="ml-auto shrink-0 text-[10px] text-muted-foreground"
          title="These filters change what is visible, not when a workflow runs."
        >
          {visibleFlows.length} of {(flows || []).length} workflows
        </span>
      </div>
      {sidebarCollapsed && (
        <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          // z-30 sits above the editor section's z-20 sticky header, which
          // otherwise paints over the button because the section comes later
          // in the DOM. Inspector overlay at z-40 still wins.
          className="absolute left-3 top-[60px] z-30 grid size-8 place-items-center rounded-md border border-border bg-card/95 text-muted-foreground shadow-sm transition-colors hover:border-foreground/25 hover:text-foreground"
        >
          <SidebarExpand className="size-4" />
        </button>
      )}
      {inspectorDockCollapsed && (
        <button
          type="button"
          onClick={() => setInspectorCollapsed(false)}
          aria-label="Expand inspector"
          title="Expand inspector"
          className="flows-inspector-dock-toggle absolute right-3 top-[60px] z-30 size-8 place-items-center rounded-md border border-border bg-card/95 text-muted-foreground shadow-sm transition-colors hover:border-foreground/25 hover:text-foreground"
        >
          <SidebarExpand className="size-4 rotate-180" />
        </button>
      )}
      <div
        className={cn(
          "flows-pane-grid grid min-h-0 flex-1",
          inspectorOpen && "flows-pane-grid-inspector-open",
          assistantPanelOpen && "flows-pane-grid-assistant-open",
          sidebarCollapsed && "flows-pane-grid-sidebar-collapsed",
          inspectorDockCollapsed && "flows-pane-grid-inspector-collapsed",
        )}
      >
      {!sidebarCollapsed && (
        <aside
          data-testid="flow-node-library"
          className="flex min-h-0 flex-col overflow-hidden border-r border-border bg-sidebar"
        >
          <div className="border-b border-border px-3 pt-4 pb-3">
            <div className="flex items-center justify-between gap-3">
              <span className="rounded border border-border px-2 py-0.5 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
                Nodes
              </span>
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
              >
                <SidebarCollapse className="size-3.5" />
              </button>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <label
                  htmlFor="flow-library-workflow"
                  className="block text-[9px] font-semibold tracking-[0.18em] text-muted-foreground uppercase"
                >
                  Workflow
                </label>
                {visibleFlows.length > 0 ? (
                  <span
                    data-testid="flow-active-count"
                    className="text-[9px] text-muted-foreground"
                  >
                    {visibleFlows.filter((flow) => flow.status === "active").length}
                    /{visibleFlows.length} active
                  </span>
                ) : null}
              </div>
              <div className="flex gap-1.5">
                <WorkflowSelect
                  id="flow-library-workflow"
                  ariaLabel="Select workflow"
                  value={selectedFlowId ?? ""}
                  onValueChange={(value) => setSelectedFlowId(value || null)}
                  disabled={isLoading || visibleFlows.length === 0}
                  className="min-w-0 flex-1 rounded-md border border-border bg-input px-2.5 py-2 text-xs font-medium text-foreground"
                  options={
                    visibleFlows.length === 0
                      ? [{
                          value: "",
                          label: isLoading
                            ? "Loading workflows…"
                            : "No matching workflows",
                        }]
                      : visibleFlows.map((flow) => ({
                          value: flow.id,
                          label: flow.name,
                          active: flow.status === "active",
                        }))
                  }
                />
                <Popover
                  open={templatePickerOpen}
                  onOpenChange={(open) => {
                    if (isCreating) return
                    if (
                      open
                      && browseInstallationId !== "all"
                      && browseInstallationId !== createInstallationId
                    ) {
                      setCreateInstallationId(browseInstallationId)
                    }
                    setTemplatePickerOpen(open)
                  }}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={!createInstallationId || isCreating}
                      className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-input text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground disabled:opacity-40"
                      aria-label={isCreating ? "Creating workflow" : "New workflow"}
                      title={isCreating ? "Creating…" : "New workflow"}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="right"
                    align="start"
                    sideOffset={10}
                    data-testid="flow-template-picker"
                    className="flex max-h-[min(720px,calc(100vh-32px))] w-[min(360px,calc(100vw-32px))] flex-col overflow-hidden border-border bg-popover p-0 shadow-2xl"
                  >
                    <div className="shrink-0 border-b border-border px-4 py-3">
                      <div className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                        Quick start
                      </div>
                      <div className="mt-1 text-sm font-semibold text-foreground">
                        Start from a working graph
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                        Every starter is an editable draft. Nothing runs until you publish it.
                      </p>
                      {installations && installations.length > 1 ? (
                        <label className="mt-3 block">
                          <span className="mb-1.5 block text-[9px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                            Create in
                          </span>
                          <WorkflowSelect
                            value={createInstallationId}
                            onValueChange={(value) => {
                              setCreateInstallationId(value)
                              setCreateRepository("all")
                            }}
                            className="h-8 w-full rounded-md border border-border bg-input px-2.5 text-[11px] text-foreground"
                            ariaLabel="New workflow GitHub account"
                            options={installations.map((installation) => ({
                              value: String(installation.installation_id),
                              label: `${installationAccountLabel(installation)} · ${installationAccountTypeLabel(installation.account_type)}`,
                            }))}
                          />
                        </label>
                      ) : null}
                      {createRepositoryOptions.length > 0 ? (
                        <label className="mt-3 block">
                          <span className="mb-1.5 block text-[9px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                            Target repository
                          </span>
                          <WorkflowSelect
                            value={createRepository}
                            onValueChange={setCreateRepository}
                            className="h-8 w-full rounded-md border border-border bg-input px-2.5 text-[11px] text-foreground"
                            ariaLabel="New workflow repository"
                            options={[
                              { value: "all", label: "All repositories" },
                              ...createRepositoryOptions.map((repository) => ({
                                value: repository.full_name,
                                label: repository.full_name,
                              })),
                            ]}
                          />
                        </label>
                      ) : null}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      {teamTemplates.length ? (
                        <div className="border-b border-border p-2">
                          <div className="flex items-center justify-between px-3 pt-1 pb-1.5">
                            <span className="text-[9px] font-semibold tracking-[0.17em] text-sky-700 dark:text-sky-300/75 uppercase">
                              Team templates
                            </span>
                            <span className="text-[9px] text-muted-foreground">Shared</span>
                          </div>
                          <div className="space-y-1">
                            {teamTemplates.map((template) => (
                              <div
                                key={template.id}
                                className="group flex items-stretch rounded-lg border border-transparent transition-colors hover:border-sky-400/20 hover:bg-sky-400/[0.045]"
                              >
                                <button
                                  type="button"
                                  data-testid={`flow-team-template-${template.id}`}
                                  onClick={() => void createFlow(null, template, "team")}
                                  disabled={
                                    isCreating ||
                                    (template.requires_repository && createRepository === "all")
                                  }
                                  className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left disabled:opacity-45"
                                >
                                  <span className="grid size-9 shrink-0 place-items-center rounded-md border border-sky-400/20 bg-sky-400/[0.06] text-sky-700 dark:text-sky-300">
                                    <GitMerge className="size-4" />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-center justify-between gap-3">
                                      <span className="truncate text-xs font-semibold text-foreground">
                                        {template.name}
                                      </span>
                                      <span className="shrink-0 text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
                                        {eventLabel(template.trigger_event)}
                                      </span>
                                    </span>
                                    <span className="mt-1 block text-[10.5px] leading-4 text-muted-foreground">
                                      {template.description || "Reusable team workflow"}
                                    </span>
                                    {template.reconnect.length > 0 ? (
                                      <span className="mt-1.5 block text-[9px] font-medium tracking-[0.08em] text-amber-700 dark:text-amber-300/75 uppercase">
                                        Reconnect {template.reconnect.join(" + ")}
                                      </span>
                                    ) : template.requires_repository && createRepository === "all" ? (
                                      <span className="mt-1.5 block text-[9px] font-medium tracking-[0.08em] text-amber-700 dark:text-amber-300/75 uppercase">
                                        Choose a repository
                                      </span>
                                    ) : null}
                                  </span>
                                </button>
                                {teamTemplatesCanWrite ? (
                                  <button
                                    type="button"
                                    aria-label={`Delete ${template.name} template`}
                                    onClick={() => {
                                      setTemplatePickerOpen(false)
                                      setTemplateDeleteTarget({ template, scope: "team" })
                                    }}
                                    className="mr-1 grid w-8 shrink-0 place-items-center self-stretch text-muted-foreground/60 transition-colors hover:text-red-600 dark:hover:text-red-300"
                                  >
                                    <Trash className="size-3.5" />
                                  </button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                          {teamTemplatesHaveMore ? (
                            <button
                              type="button"
                              onClick={() => void setTeamTemplatePageCount(
                                teamTemplatePageCount + 1,
                              )}
                              disabled={teamTemplatesLoadingMore}
                              className="mt-1 w-full rounded-md px-3 py-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.035] hover:text-foreground disabled:opacity-50"
                            >
                              {teamTemplatesLoadingMore
                                ? "Loading templates…"
                                : "Load more templates"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {personalTemplates.length ? (
                        <div className="border-b border-border p-2">
                          <div className="px-3 pt-1 pb-1.5 text-[9px] font-semibold tracking-[0.17em] text-orange-700 dark:text-orange-300/70 uppercase">
                            Your templates
                          </div>
                          <div className="space-y-1">
                            {personalTemplates.map((template) => (
                              <div
                                key={template.id}
                                className="group flex items-stretch rounded-lg border border-transparent transition-colors hover:border-orange-400/20 hover:bg-orange-400/[0.045]"
                              >
                                <button
                                  type="button"
                                  data-testid={`flow-personal-template-${template.id}`}
                                  onClick={() => void createFlow(null, template)}
                                  disabled={
                                    isCreating ||
                                    (template.requires_repository && createRepository === "all")
                                  }
                                  className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left disabled:opacity-45"
                                >
                                  <span className="grid size-9 shrink-0 place-items-center rounded-md border border-orange-400/20 bg-orange-400/[0.06] text-orange-700 dark:text-orange-300">
                                    <Asterisk className="size-4" />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-center justify-between gap-3">
                                      <span className="truncate text-xs font-semibold text-foreground">
                                        {template.name}
                                      </span>
                                      <span className="shrink-0 text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
                                        {eventLabel(template.trigger_event)}
                                      </span>
                                    </span>
                                    <span className="mt-1 block text-[10.5px] leading-4 text-muted-foreground">
                                      {template.description || "Reusable personal workflow"}
                                    </span>
                                    {template.reconnect.length > 0 ? (
                                      <span className="mt-1.5 block text-[9px] font-medium tracking-[0.08em] text-amber-700 dark:text-amber-300/75 uppercase">
                                        Reconnect {template.reconnect.join(" + ")}
                                      </span>
                                    ) : template.requires_repository && createRepository === "all" ? (
                                      <span className="mt-1.5 block text-[9px] font-medium tracking-[0.08em] text-amber-700 dark:text-amber-300/75 uppercase">
                                        Choose a repository
                                      </span>
                                    ) : null}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Delete ${template.name} template`}
                                  onClick={() => {
                                    setTemplatePickerOpen(false)
                                    setTemplateDeleteTarget({ template, scope: "personal" })
                                  }}
                                  className="mr-1 grid w-8 shrink-0 place-items-center self-stretch text-muted-foreground/60 transition-colors hover:text-red-600 dark:hover:text-red-300"
                                >
                                  <Trash className="size-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                          {personalTemplatesHaveMore ? (
                            <button
                              type="button"
                              onClick={() => void setPersonalTemplatePageCount(
                                personalTemplatePageCount + 1,
                              )}
                              disabled={personalTemplatesLoadingMore}
                              className="mt-1 w-full rounded-md px-3 py-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.035] hover:text-foreground disabled:opacity-50"
                            >
                              {personalTemplatesLoadingMore
                                ? "Loading templates…"
                                : "Load more templates"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="space-y-1 p-2">
                        <div className="px-3 pt-1 pb-1.5 text-[9px] font-semibold tracking-[0.17em] text-muted-foreground uppercase">
                          Built-in starters
                        </div>
                        {FLOW_STARTER_TEMPLATES.map((template) => {
                          const TemplateIcon = FLOW_STARTER_TEMPLATE_ICONS[template.id]
                          return (
                            <button
                              key={template.id}
                              type="button"
                              data-testid={`flow-template-${template.id}`}
                              onClick={() => void createFlow(template.id)}
                              disabled={isCreating}
                              className="group flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-foreground/[0.045] disabled:opacity-50"
                            >
                              <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-foreground/[0.035] text-muted-foreground transition-colors group-hover:border-orange-400/25 group-hover:text-orange-700 dark:group-hover:text-orange-300">
                                <TemplateIcon className="size-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center justify-between gap-3">
                                  <span className="text-xs font-semibold text-foreground">
                                    {template.name}
                                  </span>
                                  <span className="shrink-0 text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
                                    {template.trigger}
                                  </span>
                                </span>
                                <span className="mt-1 block text-[10.5px] leading-4 text-muted-foreground">
                                  {template.description}
                                </span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <div className="shrink-0 border-t border-border p-2">
                      <button
                        type="button"
                        data-testid="flow-save-personal-template"
                        disabled={!selectedFlow || savingTemplate}
                        onClick={() => {
                          if (!selectedFlow) return
                          setSaveTemplateName(selectedFlow.name)
                          setSaveTemplateScope(
                            activeTeamId && teamTemplatesCanWrite ? "team" : "personal",
                          )
                          setTemplatePickerOpen(false)
                          setSaveTemplateOpen(true)
                        }}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-muted-foreground transition-colors hover:bg-foreground/[0.045] hover:text-foreground disabled:opacity-40"
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-dashed border-border">
                          <Plus className="size-4" />
                        </span>
                        <span>
                          <span className="block text-xs font-semibold">
                            Save current as template
                          </span>
                          <span className="mt-0.5 block text-[10px] text-muted-foreground">
                            {activeTeamId && teamTemplatesCanWrite
                              ? "Choose personal or team ownership before saving"
                              : "Connections and repository scope are removed"}
                          </span>
                        </span>
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <label className="mt-3 flex items-center gap-2 rounded-md border border-border bg-input px-2.5 py-2 text-muted-foreground focus-within:border-ring focus-within:text-foreground">
              <Search className="size-3.5 shrink-0" />
              <input
                value={flowSearch}
                onChange={(event) => setFlowSearch(event.target.value)}
                placeholder="Search nodes…"
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs text-foreground shadow-none outline-none placeholder:text-muted-foreground"
              />
            </label>
          </div>

          <div className="flex-1 overflow-y-auto pb-3">
            {!flowSearch.trim() ||
            `trigger github schedule webhook slack dependabot ${currentTriggerLabel}`
              .toLowerCase()
              .includes(flowSearch.trim().toLowerCase()) ||
            filteredTriggerPresets.length > 0 ? (
              <div className="border-b border-border pb-2">
                <div className="flows-library-group-label">Trigger</div>
                <button
                  type="button"
                  data-testid="flow-library-current-trigger"
                  onClick={() => {
                    if (currentTriggerNode) selectCanvasNode(currentTriggerNode.id)
                  }}
                  disabled={!currentTriggerNode}
                  className="flows-library-item group"
                >
                  <span className="flows-library-icon flows-library-tone-trigger" aria-hidden>
                    <Github className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {currentTriggerLabel}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                      {currentTriggerProvider} trigger · configured
                    </span>
                  </span>
                  <Settings className="ml-auto size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
                </button>
                {filteredTriggerPresets.length > 0 ? (
                  <>
                    <div className="mx-3 my-1.5 border-t border-border" />
                    {filteredTriggerPresets.map((preset) => {
                      const Icon = preset.icon
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          data-testid={`flow-trigger-preset-${preset.id}`}
                          onClick={() => applyTriggerPreset(preset)}
                          disabled={!currentTriggerNode}
                          className="flows-library-item group"
                        >
                          <span className="flows-library-icon flows-library-tone-trigger" aria-hidden>
                            <Icon className="size-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium text-foreground">
                              {preset.label}
                            </span>
                            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                              {preset.description}
                            </span>
                          </span>
                          <Plus className="ml-auto size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
                        </button>
                      )
                    })}
                  </>
                ) : null}
              </div>
            ) : null}

            {filteredNodeLibraryGroups.map((group) => (
              <div
                key={group.label}
                className="border-b border-border pb-2 last:border-b-0"
              >
                <div className="flows-library-group-label">{group.label}</div>
                {group.items.map((item) => (
                  <FlowLibraryNodeButton
                    key={item.testId}
                    item={item}
                    onAdd={addNode}
                  />
                ))}
              </div>
            ))}

            {filteredNodeLibraryGroups.length === 0 && (
              <div className="mx-3 mt-3 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                No nodes match “{flowSearch.trim()}”.
              </div>
            )}
          </div>

          <div className="border-t border-border px-3 py-2.5 text-[10px] text-muted-foreground">
            <div className="flex items-center justify-between gap-3">
              <span>{draft?.nodes.length ?? 0} nodes</span>
              <span>{draft?.edges.length ?? 0} connections</span>
            </div>
            <div className="mt-1.5 truncate text-muted-foreground">
              Click to add · right-click canvas for more
            </div>
          </div>
        </aside>
      )}

      <section
        ref={editorRef}
        tabIndex={0}
        onMouseDownCapture={() => editorRef.current?.focus()}
        className="min-w-0 min-h-0 flex flex-col bg-transparent outline-none"
      >
        {!selectedFlow || !draft ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select or create a flow to begin.
          </div>
        ) : (
          <Tabs
            value={activeFlowTab}
            onValueChange={setActiveFlowTab}
            className="relative flex min-h-0 flex-1 flex-col gap-0"
          >
            <div
              className={cn(
                "relative z-20 border-b border-border bg-card/92 py-2 pr-3",
                sidebarCollapsed ? "pl-14" : "pl-3",
              )}
            >
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 lg:flex lg:h-9 lg:justify-between">
                <div className="col-start-1 row-start-1 flex min-w-0 items-center lg:col-auto lg:row-auto">
                  <span
                    role={saveStatus === "error" ? "alert" : "status"}
                    data-testid="flow-save-status-live"
                    className="sr-only"
                  >
                    {saveStatusAnnouncement}
                  </span>
                  <div
                    data-testid="flow-save-status"
                    title={saveStatusTitle}
                    className={cn(
                      "hidden items-center text-[11px] font-medium md:inline-flex",
                      quietSaveStatus
                        ? "gap-1.5 px-1 py-1"
                        : "gap-2 rounded-full border px-2.5 py-1.5",
                      saveStatusTone.container,
                    )}
                  >
                    {quietSaveStatus ? (
                      <CheckCircle aria-hidden="true" className="size-3.5" />
                    ) : (
                      <span className={cn("size-1.5 rounded-full", saveStatusTone.dot)} />
                    )}
                    <span aria-hidden="true">{saveStatusLabel}</span>
                    {(dirty || saveStatus === "error") && !saving && (
                      <button
                        type="button"
                        onClick={() => void persistFlow({ reason: "manual" })}
                        title={`Save (${primaryModifierLabel}S)`}
                        className="rounded-full border border-current/15 px-2 py-0.5 text-[10px] text-inherit hover:bg-black/10 dark:hover:bg-white/10"
                      >
                        Save
                      </button>
                    )}
                  </div>
                </div>
                <TabsList
                  data-testid="flow-view-tabs"
                  className="col-span-2 row-start-2 h-8 shrink-0 justify-self-start gap-1 border border-border bg-card/80 p-1 shadow-sm lg:col-auto lg:row-auto lg:justify-self-auto"
                >
                  <TabsTrigger value="editor" className="h-6 rounded-sm px-2.5 py-1 text-[11px]">
                    Canvas
                  </TabsTrigger>
                  <TabsTrigger
                    value="runs"
                    data-testid="flows-runs-tab"
                    className="h-6 rounded-sm px-2.5 py-1 text-[11px]"
                  >
                    Runs{flowRuns.length > 0 && <span className="ml-1.5 text-muted-foreground">({flowRuns.length})</span>}
                  </TabsTrigger>
                </TabsList>

                <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 xl:block">
                  <div className="pointer-events-auto flex max-w-[520px] items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 shadow-lg">
                    <span className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      selectedFlow.status === "active" ? "bg-accent-green" : "bg-muted-foreground",
                    )} />
                    <input
                      aria-label="Flow name"
                      data-testid="flow-name-input-desktop"
                      value={draft.name}
                      onChange={(event) => handleFlowNameChange(event.target.value)}
                      className="h-5 min-w-0 max-w-[220px] border-0 bg-transparent p-0 text-center text-sm font-semibold text-foreground shadow-none outline-none"
                    />
                    <span className="text-xs text-muted-foreground">
                      {selectedFlow.published_version?.version_number ? `v${selectedFlow.published_version.version_number}` : "draft"}
                    </span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {flowRuns.length} run{flowRuns.length === 1 ? "" : "s"}
                    </span>
                    {flowSuccessRateLabel && (
                      <>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">{flowSuccessRateLabel}</span>
                      </>
                    )}
                  </div>
                </div>

                <div
                  data-testid="flow-header-actions"
                  className="col-start-2 row-start-1 ml-auto flex min-w-0 items-center justify-end gap-1.5 lg:col-auto lg:row-auto"
                >
                  <button
                    type="button"
                    onClick={() => addNode("agent")}
                    className="grid size-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
                    title="Add agent"
                    aria-label="Add agent"
                  >
                    <Plus className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => undoDraft()}
                    disabled={!canUndo}
                    title={`Undo (${primaryModifierLabel}Z)`}
                    aria-label="Undo"
                    className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-40"
                  >
                    <Undo className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => redoDraft()}
                    disabled={!canRedo}
                    title={`Redo (${primaryModifierLabel}Shift+Z${primaryModifierLabel === "Ctrl+" ? " / Ctrl+Y" : ""})`}
                    aria-label="Redo"
                    className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-40"
                  >
                    <Redo className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void duplicateSelectedFlow()}
                    title="Duplicate flow"
                    aria-label="Duplicate flow"
                    className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                  >
                    <Copy className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteSelectedFlow()}
                    title="Delete flow"
                    aria-label="Delete flow"
                    className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent-red/[0.08] hover:text-accent-red"
                  >
                    <Trash className="size-4" />
                  </button>
                  <div className="mx-1 h-5 w-px bg-border" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled
                    className="h-8 gap-1.5 border-border bg-foreground/[0.035] px-3 text-xs text-muted-foreground"
                  >
                    <Play className="size-3.5" />
                    Test run
                  </Button>
                  <Button
                    type="button"
                    data-testid="flow-publish-button"
                    onClick={() => void (
                      selectedFlow.status === "active" || shouldPublishLatestDraft
                        ? publishFlow()
                        : toggleFlowStatus()
                    )}
                    disabled={
                      publishing
                      || saving
                      || (selectedFlow.status === "active" && !shouldPublishLatestDraft)
                    }
                    className={primaryActionClassName}
                  >
                    {primaryActionLabel}
                  </Button>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-card/80 px-3 py-2 shadow-sm xl:hidden">
                <span className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  selectedFlow.status === "active" ? "bg-accent-green" : "bg-muted-foreground",
                )} />
                <input
                  aria-label="Flow name"
                  data-testid="flow-name-input-compact"
                  value={draft.name}
                  onChange={(event) => handleFlowNameChange(event.target.value)}
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-semibold text-foreground shadow-none outline-none"
                />
                <span className="shrink-0 text-xs text-muted-foreground">
                  {selectedFlow.published_version?.version_number ? `v${selectedFlow.published_version.version_number}` : "draft"}
                </span>
              </div>
              {effectiveLegacyAgentNodes.length > 0 && (
                <div
                  data-testid="flows-legacy-model-banner"
                  className="mt-2 rounded-md border border-amber-400/25 bg-amber-400/[0.08] px-3 py-2 text-xs text-amber-800 dark:text-amber-100"
                >
                  {effectiveLegacyAgentNodes.length} node{effectiveLegacyAgentNodes.length === 1 ? "" : "s"} use models that are not enabled for this account.
                </div>
              )}
            </div>

              <TabsContent value="editor" forceMount className="flex-1 min-h-0 relative data-[state=inactive]:hidden">
                <div
                  data-testid="flow-insert-toolbar"
                  className="absolute left-3 right-3 top-3 z-10 flex justify-center"
                >
                  <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-md border border-border bg-card/80 px-1.5 py-1.5 shadow-lg backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <button
                      type="button"
                      onClick={() => tidyCanvasLayout()}
                      className="shrink-0 whitespace-nowrap rounded-sm px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                    >
                      Tidy graph
                    </button>
                    <button
                      type="button"
                      onClick={() => straightenCanvasSelection()}
                      className="shrink-0 whitespace-nowrap rounded-sm px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                    >
                      Straighten
                    </button>
                    <div className="mx-1 h-4 w-px shrink-0 bg-border/60" />
                    <button
                      type="button"
                      data-testid="flow-assistant-toggle"
                      onClick={() => toggleAssistantPanel()}
                      className={cn(
                        "shrink-0 whitespace-nowrap rounded-sm px-2 py-1 text-[10px] font-medium transition-colors hover:bg-foreground/[0.06] hover:text-foreground",
                        assistantPanelOpen ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground",
                      )}
                    >
                      Assistant
                    </button>
                  </div>
                </div>
                <div
                  ref={canvasRef}
                  tabIndex={-1}
                  onMouseDownCapture={() => canvasRef.current?.focus()}
                  className="relative h-full outline-none"
                >
                <ReactFlow
                  nodes={renderedCanvasNodes}
                  edges={renderedEdges}
                  nodeTypes={NODE_TYPES}
                  edgeTypes={edgeTypes}
                  colorMode={canvasColorMode}
                  // Canvas is fully locked unless Space is held. `false` (not an
                  // empty/partial button array) is what blocks pointer *and* touch
                  // panning — array forms like `[1]` still let middle-click / touch
                  // drags pan the viewport.
                  panOnDrag={spacePanActive ? [0, 1] : false}
                  selectionOnDrag={!spacePanActive}
                  panActivationKeyCode={null}
                  deleteKeyCode={null}
                  onPaneContextMenu={handlePaneContextMenu}
                  onPaneClick={() => {
                    closeContextMenu()
                    clearCanvasSelection()
                  }}
                  onInit={(instance) => {
                    reactFlowRef.current = instance
                  }}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onSelectionChange={onSelectionChange}
                  onMoveStart={(event) => {
                    if (event) closeContextMenu()
                  }}
                  onMoveEnd={(_event, nextViewport) => {
                    updateDraft((current) => ({
                      ...current,
                      viewport: nextViewport,
                    }), { recordHistory: false })
                  }}
                  defaultViewport={draft.viewport}
                  onNodeContextMenu={(event, node) => {
                    event.preventDefault()
                    event.stopPropagation()
                    canvasRef.current?.focus()
                    openNodeContextMenu(node as FlowCanvasNode, event.clientX, event.clientY)
                  }}
                  onEdgeContextMenu={(event, edge) => {
                    event.preventDefault()
                    event.stopPropagation()
                    canvasRef.current?.focus()
                    openEdgeContextMenu(edge.id, event.clientX, event.clientY)
                  }}
                  minZoom={0.1}
                  fitView
                  fitViewOptions={FLOW_FIT_VIEW_OPTIONS}
                  proOptions={{ hideAttribution: true }}
                  className={cn("flows-canvas bg-transparent", spacePanActive && "flows-canvas-pan")}
                >
                  <Background
                    variant={BackgroundVariant.Dots}
                    gap={FLOW_CANVAS_BACKGROUND.gap}
                    size={FLOW_CANVAS_BACKGROUND.dotSize}
                    color={FLOW_CANVAS_BACKGROUND.dotColor}
                    bgColor={FLOW_CANVAS_BACKGROUND.baseColor}
                  />
                  <div
                    aria-hidden="true"
                    data-testid="flow-canvas-vignette"
                    className="pointer-events-none absolute inset-0 z-[1]"
                    style={{ background: FLOW_CANVAS_VIGNETTE_BACKGROUND }}
                  />
                  <ResponsiveMiniMap />
                  <Controls />
                </ReactFlow>
                <div
                  data-testid="flow-execution-log"
                  className="flows-execution-log"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-[9px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
                        Execution
                      </span>
                      {latestFlowRun ? (
                        <span
                          className={cn(
                            "rounded border px-1.5 py-0.5 text-[9px] font-medium tracking-[0.12em] uppercase",
                            runStatusTone(
                              latestFlowRunStatus ?? latestFlowRun.status,
                            ),
                          )}
                        >
                          {latestFlowRunStatus}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          No runs yet
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveFlowTab("runs")}
                      className="shrink-0 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      View runs
                    </button>
                  </div>
                  <div className="flex min-h-9 items-center gap-2 overflow-hidden px-3 py-2">
                    {latestFlowRun ? (
                      <>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {new Date(
                            latestFlowRun.started_at || latestFlowRun.created_at,
                          ).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {formatRunSourceType(latestFlowRun.source_type)}
                        </span>
                        {latestFlowRun.node_runs.slice(-4).map((nodeRun) => (
                          <span
                            key={nodeRun.id}
                            className={cn(
                              "shrink-0 rounded border px-1.5 py-0.5 text-[9px]",
                              nodeRunStatusTone(nodeRun.status),
                            )}
                          >
                            {nodeRun.node_label || nodeRun.node_id} · {nodeRun.status}
                          </span>
                        ))}
                      </>
                    ) : (
                      <>
                        <CheckCircle className="size-3.5 shrink-0 text-accent-green" />
                        <span className="truncate text-[10px] text-muted-foreground">
                          Canvas ready · publish and activate to begin receiving events
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {contextMenu && contextMenuPosition && typeof document !== "undefined" && createPortal(
                  <div
                    ref={contextMenuRef}
                    data-testid="flow-context-menu"
                    data-canvas-shortcuts="ignore"
                    className="flows-theme fixed z-50 min-w-[240px] rounded-lg border border-border/80 bg-popover/96 p-1.5 shadow-2xl backdrop-blur-xl"
                    style={{
                      position: "fixed",
                      maxHeight: "calc(100vh - 24px)",
                      overflowY: "auto",
                      ...contextMenuPosition,
                    }}
                    onContextMenu={(event) => event.preventDefault()}
                  >
                    {contextMenu.kind === "canvas" ? (
                      <div className="space-y-1">
                        {FLOW_NODE_INSERTION_OPTIONS.map((option) => (
                          <button
                            key={`${option.type}-${option.operation ?? "default"}`}
                            data-testid={`flow-context-add-${option.type}${option.operation ? `-${option.operation}` : ""}`}
                            type="button"
                            onClick={() => runContextMenuAction(() => addNode(
                              option.type,
                              contextMenu.flowPosition ?? undefined,
                              option.operation,
                            ))}
                            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            Add {option.label.toLowerCase()}
                          </button>
                        ))}
                        <div className="my-1 h-px bg-border" />
                        <button
                          type="button"
                          onClick={() => runContextMenuAction(() => {
                            tidyCanvasLayout()
                          })}
                          className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          Tidy graph
                        </button>
                        <button
                          type="button"
                          onClick={() => runContextMenuAction(() => {
                            straightenCanvasSelection()
                          })}
                          className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          Straighten selection
                        </button>
                        <div className="my-1 h-px bg-border" />
                        <button
                          data-testid="flow-context-undo"
                          type="button"
                          onClick={() => runContextMenuAction(undoDraft)}
                          disabled={!canUndo}
                          className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                        >
                          Undo
                        </button>
                        <button
                          data-testid="flow-context-redo"
                          type="button"
                          onClick={() => runContextMenuAction(redoDraft)}
                          disabled={!canRedo}
                          className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                        >
                          Redo
                        </button>
                        <button
                          data-testid="flow-context-save"
                          type="button"
                          onClick={() => runContextMenuAction(persistFlow)}
                          disabled={saving || !dirty}
                          className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                        >
                          Save
                        </button>
                        <div className="my-1 h-px bg-border" />
                        <button
                          data-testid="flow-context-duplicate-selection"
                          type="button"
                          onClick={() => runContextMenuAction(() => {
                            duplicateSelectedCanvasItems()
                          })}
                          disabled={!draft?.nodes.some((node) => node.type !== "start" && node.type !== "end" && node.selected)}
                          className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                        >
                          Duplicate selection
                        </button>
                        <button
                          data-testid="flow-context-delete-selection"
                          type="button"
                          onClick={() => runContextMenuAction(() => {
                            deleteSelectedCanvasItems()
                          })}
                          disabled={!hasCanvasSelection}
                          className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-accent-red transition-colors hover:bg-accent hover:text-accent-red disabled:pointer-events-none disabled:opacity-50"
                        >
                          Delete selection
                        </button>
                        <button
                          data-testid="flow-context-select-all"
                          type="button"
                          onClick={() => runContextMenuAction(() => {
                            selectAllCanvasAgents()
                          })}
                          disabled={!draft?.nodes.some((node) => node.type !== "start" && node.type !== "end")}
                          className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                        >
                          Select all editable nodes
                        </button>
                        <button
                          data-testid="flow-context-clear-selection"
                          type="button"
                          onClick={() => runContextMenuAction(() => {
                            clearCanvasSelection()
                          })}
                          disabled={!hasCanvasSelection}
                          className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                        >
                          Clear selection
                        </button>
                      </div>
                    ) : contextMenu.kind === "edge" ? (
                      <div className="space-y-1">
                        {FLOW_EDGE_INSERTION_OPTIONS.map((option) => (
                          <button
                            key={`${option.type}-${option.operation ?? "default"}`}
                            data-testid={`flow-context-edge-add-${option.type}${option.operation ? `-${option.operation}` : ""}`}
                            type="button"
                            onClick={() => runContextMenuAction(() => {
                              if (contextMenu.edgeId) {
                                insertNodeOnEdge(
                                  contextMenu.edgeId,
                                  option.type,
                                  contextMenu.flowPosition ?? undefined,
                                  option.operation,
                                )
                              }
                            })}
                            className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                          >
                            {option.label}
                          </button>
                        ))}
                        <div className="my-1 h-px bg-border" />
                        <button
                          data-testid="flow-context-edge-clear-selection"
                          type="button"
                          onClick={() => runContextMenuAction(() => {
                            clearCanvasSelection()
                          })}
                          className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          Clear selection
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {contextMenu.nodeType && contextMenu.nodeType !== "start" && contextMenu.nodeType !== "end" && (
                          <>
                            <button
                              data-testid="flow-context-node-duplicate"
                              type="button"
                              onClick={() => runContextMenuAction(() => {
                                if (contextMenu.nodeId) {
                                  duplicateContextMenuNode(contextMenu.nodeId)
                                }
                              })}
                              className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                            >
                              Duplicate
                            </button>
                            <button
                              data-testid="flow-context-node-delete"
                              type="button"
                              onClick={() => runContextMenuAction(() => {
                                if (contextMenu.nodeId) {
                                  deleteContextMenuNode(contextMenu.nodeId)
                                }
                              })}
                              className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-accent-red transition-colors hover:bg-accent hover:text-accent-red"
                            >
                              Delete
                            </button>
                            <div className="my-1 h-px bg-border" />
                          </>
                        )}
                        <button
                          data-testid="flow-context-node-clear-selection"
                          type="button"
                          onClick={() => runContextMenuAction(() => {
                            clearCanvasSelection()
                          })}
                          className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          Clear selection
                        </button>
                      </div>
                    )}
                  </div>,
                  document.body,
                )}
              </div>
              </TabsContent>

              <TabsContent value="runs" className="flex-1 min-h-0 overflow-y-auto">
                <div className="px-4 pb-4 pt-14 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="ui-kicker">Execution rail</div>
                      <div className="mt-1 text-sm font-medium text-foreground">Run history</div>
                      <div className="text-xs text-muted-foreground">See which reviewer, editor, and operator nodes executed, skipped, or failed.</div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {flowRuns.length > 0 ? `${flowRuns.length} recent run${flowRuns.length === 1 ? "" : "s"}` : "No runs yet"}
                    </div>
                  </div>
                  {flowRuns.length === 0 ? (
                    <div className="rounded-sm border border-dashed border-border p-4 text-sm text-muted-foreground">
                      No runs recorded for this flow yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {flowRuns.map((run) => {
                        const reason = getRunLatestReason(run)
                        const isSelectedRun = run.id === selectedRunId
                        const statusLabel = flowRunStatusLabel(run)
                        return (
                          <div
                            key={run.id}
                            data-testid={`flow-run-card-${run.id}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedRunId(run.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault()
                                setSelectedRunId(run.id)
                              }
                            }}
                            className={`cursor-pointer rounded-sm border p-4 transition-all ${
                              isSelectedRun
                                ? "border-accent-blue/35 bg-linear-to-br from-accent-blue/14 to-accent-green/5"
                                : "border-border/80 bg-background/80 hover:bg-secondary/50"
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${runStatusTone(statusLabel)}`}>
                                    {statusLabel}
                                  </span>
                                  <span className="text-xs text-muted-foreground">{formatRunSourceType(run.source_type)}</span>
                                  <span className="text-xs text-muted-foreground" title={run.created_at}>
                                    {new Date(run.started_at || run.created_at).toLocaleString()}
                                  </span>
                                  {run.repo?.full_name && (
                                    <span className="truncate text-xs text-muted-foreground">{run.repo.full_name}</span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                  <span>{run.start_attempts} start attempt{run.start_attempts === 1 ? "" : "s"}</span>
                                  {run.latest_dispatch_event && (
                                    <span>{dispatchOutcomeLabel(run.latest_dispatch_event.outcome)}</span>
                                  )}
                                </div>
                                {run.cancel_requested_at && (
                                  <div className="text-xs text-muted-foreground">
                                    {run.cancelled_at
                                      ? "Cancelled"
                                      : run.cancel_error
                                        ? "Cancel failed"
                                        : "Cancel requested"}
                                  </div>
                                )}
                                {reason && (
                                  <div className="text-xs text-muted-foreground">
                                    Reason: <span className="text-foreground">{reason}</span>
                                  </div>
                                )}
                              </div>
                              <RunActionButtons
                                run={run}
                                activeRunActions={activeRunActions}
                                onRunAction={(jobId, action) => {
                                  void runFlowJobAction(jobId, action)
                                }}
                                className="justify-end"
                              />
                            </div>
                            {run.node_runs.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {run.node_runs.map((nodeRun) => {
                                  const nodeRole = readNodeRunRole(nodeRun.output)
                                  const summary = readNodeRunSummary(nodeRun.output)
                                  return (
                                    <span
                                      key={nodeRun.id}
                                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${nodeRunStatusTone(nodeRun.status)}`}
                                      title={nodeRun.error || summary || nodeRun.node_id}
                                    >
                                      {nodeRole && (
                                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
                                          getRoleTheme(nodeRole).badge
                                        }`}>
                                          {flowAgentRoleLabel(nodeRole)}
                                        </span>
                                      )}
                                      <span>{nodeRun.node_label || nodeRun.node_id}</span>
                                      <span className="text-current/70">· {nodeRun.status}</span>
                                    </span>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
        )}
      </section>

      <FlowRunDetailsDialog
        open={Boolean(selectedRunId)}
        runDetail={selectedRunDetail}
        runSummary={selectedRunSummary}
        loading={selectedRunDetailLoading}
        error={selectedRunDetailError}
        activeRunActions={activeRunActions}
        reviewFindingIssueActionId={reviewFindingIssueActionId}
        onOpenChange={(open) => {
          if (!open) setSelectedRunId(null)
        }}
        onRunAction={(jobId, action) => {
          void runFlowJobAction(jobId, action)
        }}
        onCreateReviewFindingIssue={(findingId) => {
          void createReviewFindingIssue(findingId)
        }}
      />

      {rightSheetOpen && (
        <div
          className="flows-inspector-backdrop fixed inset-0 z-30 bg-black/40"
          onClick={() => {
            if (assistantPanelOpen) {
              setAssistantPanelOpen(false)
            } else {
              clearCanvasSelection()
            }
          }}
        />
      )}
      <aside
        data-testid="flows-right-sheet"
        data-state={rightSheetAnimateOpen ? "open" : "closed"}
        className={cn(
          "flows-inspector min-h-0 flex-col overflow-hidden border-l border-border bg-background p-2",
          rightSheetOpen && "flows-inspector-open",
        )}
      >
        {assistantPanelOpen && selectedFlow && draftGraph ? (
          <FlowAssistantPanel
            key={selectedFlow.id}
            flowId={selectedFlow.id}
            graph={draftGraph}
            onApplyGraph={applyAssistantGraph}
          />
        ) : !selectedFlow || !selectedNode ? (
          <div
            data-testid="flows-inspector-empty"
            className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card"
          >
            <div className="border-b border-border px-4 py-4">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg border border-border bg-input text-muted-foreground">
                  <Settings className="size-4" />
                </span>
                <div>
                  <div className="text-[11px] font-semibold tracking-[0.16em] text-foreground uppercase">
                    Inspector
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    Workflow configuration
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectorCollapsed(true)}
                  aria-label="Minimize inspector"
                  title="Minimize inspector"
                  className="flows-inspector-dock-toggle ml-auto size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
                >
                  <SidebarCollapse className="size-3.5 rotate-180" />
                </button>
              </div>
            </div>
            {/* `min-h-0` is what makes this scroll: a flex child defaults to
                min-height:auto, so without it this refuses to shrink below its
                content and spills out of the card, which the overflow-hidden
                aside then clips with no way to reach the rest.
                `justify-center-safe` degrades to start alignment once the
                content overflows; plain `justify-center` would center the
                overflow and push the top out of reach too. */}
            <div
              data-testid="flows-inspector-empty-body"
              className="flex min-h-0 flex-1 flex-col items-center justify-center-safe overflow-y-auto px-6 py-10 text-center"
            >
              <div className="grid size-12 place-items-center rounded-full border border-dashed border-border bg-muted text-muted-foreground">
                <CursorPointer className="size-5" />
              </div>
              <div className="mt-4 text-sm font-medium text-foreground">
                Select a node
              </div>
              <p className="mt-1.5 max-w-[220px] text-[11px] leading-5 text-muted-foreground">
                Choose a canvas node or its library trigger to edit configuration,
                inputs, and runtime behavior.
              </p>
              {selectedFlow && draft ? (
                <div className="mt-6 grid w-full grid-cols-2 gap-2">
                  <div className="rounded-lg border border-border bg-muted px-3 py-2.5 text-left">
                    <div className="text-[9px] tracking-[0.16em] text-muted-foreground uppercase">
                      Nodes
                    </div>
                    <div className="mt-1 text-sm font-semibold text-foreground">
                      {draft.nodes.length}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border bg-muted px-3 py-2.5 text-left">
                    <div className="text-[9px] tracking-[0.16em] text-muted-foreground uppercase">
                      Connections
                    </div>
                    <div className="mt-1 text-sm font-semibold text-foreground">
                      {draft.edges.length}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
            <div
              data-testid="flows-inspector-header"
              className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-card px-4 py-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <span className="grid size-7 place-items-center rounded-md border border-accent-violet/20 bg-accent-violet/[0.08] text-accent-violet">
                    <Settings className="size-3.5" />
                  </span>
                  <span className="truncate">{selectedNode.type} · {selectedNode.id}</span>
                </div>
                <div className="mt-1.5 truncate text-base font-semibold text-foreground">
                  {selectedNode.type === "agent"
                    ? flowAgentRoleLabel(selectedAgentNode?.data.role || "review")
                    : selectedNode.type === "action"
                      ? FLOW_ACTION_OPTIONS.find(
                          (option) => option.value === selectedActionNode?.data.operation,
                        )?.label ?? "Action"
                    : selectedNode.type === "condition"
                      ? "If branch"
                      : selectedNode.type === "parallel"
                        ? "Parallel operator"
                        : selectedNode.type === "join"
                          ? "Merge operator"
                          : selectedNode.type === "delay"
                            ? "Wait operator"
                            : selectedNode.type === "await_event"
                              ? "Await event operator"
                              : selectedNode.type === "set_variable"
                                ? "Set variable operator"
                                : selectedNode.type === "transform"
                                  ? "Transform operator"
                                : selectedNode.type === "start"
                                  ? "Entry point"
                                : "Exit point"}
                </div>
              </div>
              <button
                type="button"
                data-testid="flows-inspector-close"
                onClick={() => {
                  clearCanvasSelection()
                }}
                className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                aria-label="Close node sheet"
                title="Close"
              >
                <Xmark className="size-4" />
              </button>
            </div>
            <div
              data-testid="flows-inspector-scroll"
              className="@container min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5"
            >
              <section className="space-y-3">
                <Textarea
                  value={draft?.description ?? ""}
                  onChange={(event) => {
                    updateDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }), { mergeKey: "flow-description" })
                  }}
                  rows={3}
                  placeholder="Describe what this flow should accomplish."
                  className="bg-input/40"
                />

              {selectedNode ? (
                <div className="space-y-4 rounded-lg border border-border/80 bg-background/60 p-4 shadow-sm">
                  {selectedAgentNode && (
                    <div className="flex items-center justify-between gap-3">
                      <div className="ui-kicker">Agent node</div>
                      <span className={`rounded-full border px-3 py-1 text-[11px] ${getRoleTheme(selectedAgentNode.data.role || "review").badge}`}>
                        {flowAgentRoleLabel(selectedAgentNode.data.role || "review")}
                      </span>
                    </div>
                  )}

                  {selectedStartNode && (
                    <>
                      <InspectorField label="Canvas label">
                        <Input
                          value={String(selectedStartNode.data.label || "")}
                          onChange={(event) => updateNodeData(selectedStartNode.id, (data) => ({
                            ...data,
                            label: event.target.value,
                          }), { mergeKey: `start-label-${selectedStartNode.id}` })}
                        />
                      </InspectorField>
                      <InspectorField label="Event">
                        <WorkflowSelect
                          testId="flow-trigger-event"
                          ariaLabel="Event"
                          value={String(selectedStartNode.data.event || "mention")}
                          onValueChange={(value) => updateNodeData(
                            selectedStartNode.id,
                            (data) => startDataForEvent(
                              data,
                              value as TriggerEvent,
                            ),
                            { mergeKey: `start-config-${selectedStartNode.id}` },
                          )}
                          options={EVENT_OPTIONS}
                        />
                      </InspectorField>
                      {selectedStartNode.data.event === "mention" && (
                        <InspectorCallout variant="hint" icon={<InfoCircle />}>
                          GitHub comments containing <span className="font-medium text-foreground">@mogplex</span> run this flow.
                        </InspectorCallout>
                      )}
                      {selectedStartNode.data.event === "labeled" && (
                        <>
                          <InspectorField label="Label name (empty = any label)">
                            <Input
                              value={String(selectedStartNode.data.labelName || "")}
                              onChange={(event) => updateNodeData(selectedStartNode.id, (data) => ({
                                ...data,
                                labelName: event.target.value,
                              }), { mergeKey: `start-label-name-${selectedStartNode.id}` })}
                              placeholder="ready-for-review"
                            />
                          </InspectorField>
                          <InspectorField label="Label targets">
                            <label className="flex items-center gap-2 text-xs text-foreground">
                              <Checkbox
                                checked={selectedStartNode.data.labelPrOnly === true}
                                onCheckedChange={(checked) => updateNodeData(selectedStartNode.id, (data) => ({
                                  ...data,
                                  labelPrOnly: checked === true,
                                }), { mergeKey: `start-label-pr-only-${selectedStartNode.id}` })}
                              />
                              Pull requests only
                            </label>
                          </InspectorField>
                        </>
                      )}
                      {selectedStartNode.data.event === "tag_push" && (
                        <InspectorField label="Tag pattern (empty = any tag, * = wildcard)">
                          <Input
                            value={String(selectedStartNode.data.tagPattern || "")}
                            onChange={(event) => updateNodeData(selectedStartNode.id, (data) => ({
                              ...data,
                              tagPattern: event.target.value,
                            }), { mergeKey: `start-tag-pattern-${selectedStartNode.id}` })}
                            placeholder="v*"
                          />
                        </InspectorField>
                      )}
                      {selectedStartNode.data.event === "schedule" && (
                        <>
                          <InspectorField label="Cron schedule">
                            <Input
                              data-testid="flow-trigger-schedule-cron"
                              value={selectedStartNode.data.scheduleCron ?? ""}
                              onChange={(event) => updateNodeData(selectedStartNode.id, (data) => ({
                                ...data,
                                scheduleCron: event.target.value,
                              }), { mergeKey: `start-schedule-cron-${selectedStartNode.id}` })}
                              placeholder="0 9 * * 1-5"
                              className="font-mono"
                            />
                          </InspectorField>
                          <InspectorField label="Timezone">
                            <WorkflowCombobox
                              testId="flow-trigger-schedule-timezone"
                              ariaLabel="Timezone"
                              value={selectedStartNode.data.scheduleTimezone ?? "UTC"}
                              onValueChange={(value) => updateNodeData(selectedStartNode.id, (data) => ({
                                ...data,
                                scheduleTimezone: value,
                              }), { mergeKey: `start-schedule-timezone-${selectedStartNode.id}` })}
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
                      {selectedStartNode.data.event === "webhook" && (
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
                      {selectedStartNode.data.event === "slack_mention" && (
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
                                  value={selectedStartNode.data.slackTeamId ?? ""}
                                  testId="flow-trigger-slack-workspace"
                                  onValueChange={(value) => updateNodeData(selectedStartNode.id, (data) => ({
                                    ...data,
                                    slackTeamId: value,
                                    slackChannelId: "",
                                    slackChannelName: null,
                                  }), { mergeKey: `start-slack-workspace-${selectedStartNode.id}` })}
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
                                  value={selectedStartNode.data.slackChannelId ?? ""}
                                  testId="flow-trigger-slack-channel"
                                  disabled={!selectedSlackTeamId || slackChannelsLoading}
                                  onValueChange={(value) => {
                                    const channel = slackChannels.find(
                                      (candidate) => candidate.id === value,
                                    )
                                    updateNodeData(selectedStartNode.id, (data) => ({
                                      ...data,
                                      slackChannelId: value,
                                      slackChannelName: channel?.name ?? null,
                                    }), { mergeKey: `start-slack-channel-${selectedStartNode.id}` })
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
                        node={selectedStartNode}
                        installations={installations || []}
                        installationId={effectiveInstallationId}
                        onInstallationChange={updateTriggerInstallation}
                        singleRepo={["schedule", "webhook", "slack_mention"].includes(
                          selectedStartNode.data.event,
                        )}
                        updateNodeData={updateNodeData}
                      />
                      {["schedule", "webhook", "slack_mention"].includes(
                        selectedStartNode.data.event,
                      ) ? (
                        <ExternalTriggerTestPanel
                          key={`${selectedFlow.id}:${selectedStartNode.id}:${selectedStartNode.data.event}`}
                          node={selectedStartNode}
                          dirty={dirty}
                          flowActive={selectedFlow.status === "active"}
                          flowPublished={Boolean(selectedFlow.published_version_id)}
                          running={triggerTestRunning}
                          onRun={(payload) => void runTriggerTest(payload)}
                        />
                      ) : null}
                    </>
                  )}

                  {selectedActionNode && (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div className="ui-kicker">Action node</div>
                        <span className="rounded-full border border-accent-blue/25 bg-accent-blue/[0.08] px-3 py-1 text-[11px] text-accent-blue">
                          {FLOW_ACTION_OPTIONS.find(
                            (option) => option.value === selectedActionNode.data.operation,
                          )?.provider ?? "Action"}
                        </span>
                      </div>
                      <InspectorField label="Action">
                        <WorkflowSelect
                          testId="flow-action-operation"
                          ariaLabel="Action"
                          value={selectedActionNode.data.operation}
                          onValueChange={(value) => {
                            const operation = value as FlowActionOperation
                            updateNodeData(
                              selectedActionNode.id,
                              () => createDefaultFlowActionData(
                                operation,
                                1,
                                FLOW_ACTION_OPTIONS.find(
                                  (option) => option.value === operation,
                                )?.label,
                              ),
                              { mergeKey: `action-operation-${selectedActionNode.id}` },
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
                          value={selectedActionNode.data.label}
                          onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                            ...data,
                            label: event.target.value,
                          }), { mergeKey: `action-label-${selectedActionNode.id}` })}
                        />
                      </InspectorField>

                      {selectedActionNode.data.operation === "sandbox.run_command" && (
                        <>
                          <InspectorField label="Command">
                            <Textarea
                              data-testid="flow-action-command"
                              value={selectedActionNode.data.command}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                command: event.target.value,
                              }), { mergeKey: `action-command-${selectedActionNode.id}` })}
                              rows={5}
                              placeholder="pnpm test"
                              className="font-mono text-xs"
                            />
                          </InspectorField>
                          <InspectorCallout variant="hint" icon={<InfoCircle />}>
                            Command text is static. Workflow templates are disabled here
                            so untrusted trigger data cannot become shell source.
                          </InspectorCallout>
                          <InspectorField label="Working directory (optional)">
                            <Input
                              data-testid="flow-action-working-directory"
                              value={selectedActionNode.data.workingDirectory ?? ""}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                workingDirectory: event.target.value.trim()
                                  ? event.target.value
                                  : null,
                              }), { mergeKey: `action-working-directory-${selectedActionNode.id}` })}
                              placeholder="apps/web"
                              className="font-mono"
                            />
                          </InspectorField>
                          <InspectorCallout variant="info" icon={<InfoCircle />}>
                            Commands run against the trigger branch in an isolated sandbox.
                            Consecutive command actions reuse that workflow workspace.
                          </InspectorCallout>
                        </>
                      )}

                      {selectedActionNode.data.operation === "slack.send_message" && (
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
                              value={selectedActionNode.data.destination ?? "channel"}
                              onValueChange={(value) => updateNodeData(
                                selectedActionNode.id,
                                (data) => ({
                                  ...data,
                                  destination: value,
                                }),
                                { mergeKey: `action-slack-destination-${selectedActionNode.id}` },
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
                          {selectedActionNode.data.destination === "trigger_thread" ? (
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
                                  value={selectedActionNode.data.teamId}
                                  onValueChange={(value) => updateNodeData(selectedActionNode.id, (data) => ({
                                    ...data,
                                    teamId: value,
                                    channelId: "",
                                    channelName: null,
                                  }), { mergeKey: `action-slack-workspace-${selectedActionNode.id}` })}
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
                                  value={selectedActionNode.data.channelId}
                                  disabled={!selectedSlackTeamId || slackChannelsLoading}
                                  onValueChange={(value) => {
                                    const channel = slackChannels.find(
                                      (candidate) => candidate.id === value,
                                    )
                                    updateNodeData(selectedActionNode.id, (data) => ({
                                      ...data,
                                      channelId: value,
                                      channelName: channel?.name ?? null,
                                    }), { mergeKey: `action-slack-channel-${selectedActionNode.id}` })
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
                                {slackChannelsHaveMore ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    data-testid="flow-action-slack-load-more"
                                    disabled={slackChannelsLoadingMore}
                                    onClick={() => {
                                      void setSlackChannelPageCount(
                                        slackChannelPageCount + 1
                                      )
                                    }}
                                    className="mt-2 w-full"
                                  >
                                    {slackChannelsLoadingMore
                                      ? "Loading more channels…"
                                      : "Load more channels"}
                                  </Button>
                                ) : null}
                              </InspectorField>
                            </>
                          )}
                          <InspectorField label="Message">
                            <Textarea
                              data-testid="flow-action-slack-message"
                              value={selectedActionNode.data.message}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                message: event.target.value,
                              }), { mergeKey: `action-slack-message-${selectedActionNode.id}` })}
                              rows={5}
                              placeholder={"Workflow finished for {{ repo.full_name }}"}
                            />
                          </InspectorField>
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Checkbox
                              data-testid="flow-action-slack-unfurl-links"
                              checked={selectedActionNode.data.unfurlLinks === true}
                              onCheckedChange={(checked) => updateNodeData(
                                selectedActionNode.id,
                                (data) => ({
                                  ...data,
                                  unfurlLinks: checked === true,
                                }),
                                { mergeKey: `action-slack-unfurl-${selectedActionNode.id}` },
                              )}
                            />
                            Unfurl links in Slack
                          </label>
                          <InspectorCallout variant="hint" icon={<InfoCircle />}>
                            Message templates can read trigger metadata, prior node outputs,
                            and workflow state using <span className="font-mono text-foreground">{"{{ path }}"}</span>.
                          </InspectorCallout>
                        </>
                      )}

                      {selectedActionNode.data.operation === "github.post_comment" && (
                        <>
                          <InspectorField label="Issue or PR number">
                            <Input
                              data-testid="flow-action-github-target-number"
                              value={selectedActionNode.data.targetNumber ?? ""}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                targetNumber: event.target.value.trim()
                                  ? event.target.value
                                  : null,
                              }), { mergeKey: `action-github-target-${selectedActionNode.id}` })}
                              placeholder="Use triggering issue or PR"
                            />
                          </InspectorField>
                          <InspectorField label="Comment">
                            <Textarea
                              data-testid="flow-action-github-comment"
                              value={selectedActionNode.data.body}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                body: event.target.value,
                              }), { mergeKey: `action-github-comment-${selectedActionNode.id}` })}
                              rows={6}
                              placeholder={"Completed for {{ repo.full_name }}"}
                            />
                          </InspectorField>
                        </>
                      )}

                      {selectedActionNode.data.operation === "github.create_issue" && (
                        <>
                          <InspectorField label="Issue title">
                            <Input
                              data-testid="flow-action-github-issue-title"
                              value={selectedActionNode.data.title}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                title: event.target.value,
                              }), { mergeKey: `action-github-issue-title-${selectedActionNode.id}` })}
                              placeholder={"Follow up: {{ repo.full_name }}"}
                            />
                          </InspectorField>
                          <InspectorField label="Issue body">
                            <Textarea
                              data-testid="flow-action-github-issue-body"
                              value={selectedActionNode.data.body}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                body: event.target.value,
                              }), { mergeKey: `action-github-issue-body-${selectedActionNode.id}` })}
                              rows={6}
                              placeholder={"Created by workflow for {{ repo.full_name }}"}
                            />
                          </InspectorField>
                          <InspectorField label="Labels (comma separated)">
                            <Input
                              data-testid="flow-action-github-issue-labels"
                              value={selectedActionNode.data.labels.join(", ")}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                labels: event.target.value
                                  .split(",")
                                  .map((label) => label.trim())
                                  .filter(Boolean),
                              }), { mergeKey: `action-github-issue-labels-${selectedActionNode.id}` })}
                              placeholder="automation, follow-up"
                            />
                          </InspectorField>
                        </>
                      )}

                      {selectedActionNode.data.operation === "github.update_labels" && (
                        <>
                          <InspectorField label="Issue or PR number">
                            <Input
                              data-testid="flow-action-github-label-target"
                              value={selectedActionNode.data.targetNumber ?? ""}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                targetNumber: event.target.value.trim()
                                  ? event.target.value
                                  : null,
                              }), { mergeKey: `action-github-label-target-${selectedActionNode.id}` })}
                              placeholder="Use triggering issue or PR"
                            />
                          </InspectorField>
                          <InspectorField label="Add labels">
                            <Input
                              data-testid="flow-action-github-add-labels"
                              value={selectedActionNode.data.addLabels.join(", ")}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                addLabels: event.target.value
                                  .split(",")
                                  .map((label) => label.trim())
                                  .filter(Boolean),
                              }), { mergeKey: `action-github-add-labels-${selectedActionNode.id}` })}
                              placeholder="ready, reviewed"
                            />
                          </InspectorField>
                          <InspectorField label="Remove labels">
                            <Input
                              data-testid="flow-action-github-remove-labels"
                              value={selectedActionNode.data.removeLabels.join(", ")}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                removeLabels: event.target.value
                                  .split(",")
                                  .map((label) => label.trim())
                                  .filter(Boolean),
                              }), { mergeKey: `action-github-remove-labels-${selectedActionNode.id}` })}
                              placeholder="needs-review"
                            />
                          </InspectorField>
                        </>
                      )}

                      {selectedActionNode.data.operation === "github.set_status" && (
                        <>
                          <InspectorField label="Commit SHA">
                            <Input
                              data-testid="flow-action-github-status-sha"
                              value={selectedActionNode.data.commitSha ?? ""}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                commitSha: event.target.value.trim()
                                  ? event.target.value
                                  : null,
                              }), { mergeKey: `action-github-status-sha-${selectedActionNode.id}` })}
                              placeholder="Use triggering commit"
                              className="font-mono"
                            />
                          </InspectorField>
                          <InspectorField label="State">
                            <WorkflowSelect
                              testId="flow-action-github-status-state"
                              ariaLabel="State"
                              value={selectedActionNode.data.state}
                              onValueChange={(value) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                state: value,
                              }), { mergeKey: `action-github-status-state-${selectedActionNode.id}` })}
                              options={[
                                { value: "pending", label: "Pending" },
                                { value: "success", label: "Success" },
                                { value: "failure", label: "Failure" },
                                { value: "error", label: "Error" },
                              ]}
                            />
                          </InspectorField>
                          <InspectorField label="Status context">
                            <Input
                              data-testid="flow-action-github-status-context"
                              value={selectedActionNode.data.context}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                context: event.target.value,
                              }), { mergeKey: `action-github-status-context-${selectedActionNode.id}` })}
                              placeholder="mogplex/workflow"
                            />
                          </InspectorField>
                          <InspectorField label="Description (optional)">
                            <Input
                              data-testid="flow-action-github-status-description"
                              value={selectedActionNode.data.description ?? ""}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                description: event.target.value.trim()
                                  ? event.target.value
                                  : null,
                              }), { mergeKey: `action-github-status-description-${selectedActionNode.id}` })}
                              placeholder="Workflow completed"
                            />
                          </InspectorField>
                          <InspectorField label="Details URL (optional)">
                            <Input
                              data-testid="flow-action-github-status-url"
                              value={selectedActionNode.data.targetUrl ?? ""}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                targetUrl: event.target.value.trim()
                                  ? event.target.value
                                  : null,
                              }), { mergeKey: `action-github-status-url-${selectedActionNode.id}` })}
                              placeholder={"{{ outputs_by_label.Deploy.url }}"}
                            />
                          </InspectorField>
                        </>
                      )}

                      {selectedActionNode.data.operation === "github.submit_review" && (
                        <>
                          <InspectorField label="Pull request number">
                            <Input
                              data-testid="flow-action-github-review-target"
                              value={selectedActionNode.data.pullRequestNumber ?? ""}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                pullRequestNumber: event.target.value.trim()
                                  ? event.target.value
                                  : null,
                              }), { mergeKey: `action-github-review-target-${selectedActionNode.id}` })}
                              placeholder="Use triggering pull request"
                            />
                          </InspectorField>
                          <InspectorField label="Review decision">
                            <WorkflowSelect
                              testId="flow-action-github-review-event"
                              ariaLabel="Review decision"
                              value={selectedActionNode.data.event}
                              onValueChange={(value) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                event: value,
                              }), { mergeKey: `action-github-review-event-${selectedActionNode.id}` })}
                              options={[
                                { value: "COMMENT", label: "Comment" },
                                { value: "APPROVE", label: "Approve" },
                                {
                                  value: "REQUEST_CHANGES",
                                  label: "Request changes",
                                },
                              ]}
                            />
                          </InspectorField>
                          <InspectorField label="Review body">
                            <Textarea
                              data-testid="flow-action-github-review-body"
                              value={selectedActionNode.data.body}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                body: event.target.value,
                              }), { mergeKey: `action-github-review-body-${selectedActionNode.id}` })}
                              rows={6}
                              placeholder={"Reviewed by {{ outputs_by_label.Review }}"}
                            />
                          </InspectorField>
                        </>
                      )}

                      {selectedActionNode.data.operation === "github.merge_pull_request" && (
                        <>
                          <InspectorField label="Pull request number">
                            <Input
                              data-testid="flow-action-github-merge-target"
                              value={selectedActionNode.data.pullRequestNumber ?? ""}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                pullRequestNumber: event.target.value.trim()
                                  ? event.target.value
                                  : null,
                              }), { mergeKey: `action-github-merge-target-${selectedActionNode.id}` })}
                              placeholder="Use triggering pull request"
                            />
                          </InspectorField>
                          <InspectorField label="Squash commit title (optional)">
                            <Input
                              data-testid="flow-action-github-merge-title"
                              value={selectedActionNode.data.commitTitle ?? ""}
                              onChange={(event) => updateNodeData(selectedActionNode.id, (data) => ({
                                ...data,
                                commitTitle: event.target.value.trim()
                                  ? event.target.value
                                  : null,
                              }), { mergeKey: `action-github-merge-title-${selectedActionNode.id}` })}
                              placeholder={"Merge after {{ outputs_by_label.Review }}"}
                            />
                          </InspectorField>
                          <InspectorCallout variant="info" icon={<GitMerge />}>
                            The merge runs after this workflow and its review check complete.
                            Mogplex only squash-merges an open, non-draft pull request
                            that GitHub reports conflict-free and clean under branch protection.
                            PR-review flows also require an explicit no-issues verdict.
                            A changed triggering head or failed gate refuses the merge.
                          </InspectorCallout>
                        </>
                      )}

                      {selectedActionNode.data.operation.startsWith("github.") && (
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
                          onClick={() => deleteSelectedNode()}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash />
                          Delete node
                        </Button>
                      </div>
                    </>
                  )}

                  {selectedAgentNode && (
                    <>
                      {/* The model decides what this step actually runs, so it leads the
                          inspector. Its warnings sit directly above the selector they
                          tell you to use. */}
                      {selectedAgentHarness === "mogplex" && (
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
                              <div className="mt-2 font-mono text-[11px] break-all text-amber-800 dark:text-amber-100/90">{selectedAgentNode.data.modelOverride}</div>
                              <div className="mt-3 flex flex-wrap items-center gap-3">
                                <button
                                  type="button"
                                  data-testid="flows-legacy-model-replace"
                                  onClick={() => {
                                    if (!quickReplaceFlowModelId) return
                                    updateNodeData(selectedAgentNode.id, (data) => ({
                                      ...data,
                                      modelOverride: quickReplaceFlowModelId,
                                    }), { mergeKey: `agent-model-replace-${selectedAgentNode.id}` })
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
                                    updateNodeData(selectedAgentNode.id, (data) => ({
                                      ...data,
                                      modelOverride: quickReplaceFlowModelId,
                                    }), { mergeKey: `agent-model-replace-${selectedAgentNode.id}` })
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
                              onValueChange={(value) => updateNodeData(selectedAgentNode.id, (data) => ({
                                ...data,
                                modelOverride: value || null,
                              }), { mergeKey: `agent-model-${selectedAgentNode.id}` })}
                              contentClassName="min-w-[min(520px,calc(100vw-32px))]"
                              options={[
                                { value: "", label: "Select a model…" },
                                ...availableModelOptions.map((model) => ({
                                  value: model.id,
                                  label: model.label,
                                })),
                              ]}
                            />
                          </InspectorField>
                          <InspectorCallout variant="info" icon={<LightBulb />}>
                            The model is set per step, here. Agents supply the prompt and role; each automation chooses what it runs on.
                          </InspectorCallout>
                        </>
                      )}
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
                                onClick={() => updateNodeData(selectedAgentNode.id, (data) => ({
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
                                }), { mergeKey: `agent-harness-${selectedAgentNode.id}` })}
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
                                {typeof selectedAgentNode.data.maxStepsOverride === "number"
                                  ? selectedAgentNode.data.maxStepsOverride
                                  : DEFAULT_AGENT_MAX_STEPS_PLACEHOLDER}
                              </InspectorSummaryItem>
                              <InspectorSummaryItem label="Timeout">
                                {typeof selectedAgentNode.data.timeoutMsOverride === "number"
                                  ? `${Math.round(selectedAgentNode.data.timeoutMsOverride / 1000)}s`
                                  : DEFAULT_AGENT_TIMEOUT_LABEL}
                              </InspectorSummaryItem>
                            </div>
                          )}
                          <InspectorSummaryItem label="Prompt mode">
                            {selectedAgentEffectivePrompt ? "Node override or base prompt configured" : "No prompt configured"}
                          </InspectorSummaryItem>
                        </div>
                      </div>
                      <InspectorField label="Label">
                        <Input
                          value={String(selectedAgentNode.data.label || "")}
                          onChange={(event) => updateNodeData(selectedAgentNode.id, (data) => ({
                            ...data,
                            label: event.target.value,
                          }), { mergeKey: `agent-label-${selectedAgentNode.id}` })}
                        />
                      </InspectorField>
                      {selectedAgentHarness === "mogplex" ? (
                        <InspectorField label="Mogplex agent">
                          <WorkflowSelect
                            ariaLabel="Mogplex agent"
                            value={String(selectedAgentNode.data.agentId || "")}
                            onValueChange={(value) => {
                              const nextAgent = (agents || []).find((agent) => agent.id === value) || null
                              updateNodeData(selectedAgentNode.id, (data) => ({
                                ...data,
                                agentId: value || null,
                                label: nextAgent?.name || data.label,
                              }), { mergeKey: `agent-binding-${selectedAgentNode.id}` })
                            }}
                            options={[
                              { value: "", label: "Select agent…" },
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
                          value={selectedAgentNode.data.role || "review"}
                          onValueChange={(value) => updateNodeData(selectedAgentNode.id, (data) => ({
                            ...data,
                            role: value,
                          }), { mergeKey: `agent-role-${selectedAgentNode.id}` })}
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
                      {(selectedAgentNode.data.role || "review") === "review" && (
                        <div className="space-y-2">
                          {selectedAgentHarness === "mogplex" && (
                            <>
                              <label
                                htmlFor={`agent-autofix-${selectedAgentNode.id}`}
                                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/80 bg-card/60 px-3 py-3 transition-colors hover:border-primary/30 hover:bg-card/80"
                              >
                                <Checkbox
                                  id={`agent-autofix-${selectedAgentNode.id}`}
                                  checked={selectedAgentNode.data.autofix === true}
                                  onCheckedChange={(checked) => {
                                    const enabled = checked === true
                                    updateNodeData(selectedAgentNode.id, (data) => ({
                                      ...data,
                                      autofix: enabled,
                                      autofixSandbox: enabled ? data.autofixSandbox === true : false,
                                    }), { mergeKey: `agent-autofix-${selectedAgentNode.id}` })
                                  }}
                                  className="mt-0.5"
                                />
                                <span className="space-y-1">
                                  <span className="block text-sm font-medium text-foreground">Auto-fix issues</span>
                                  <span className="block text-xs leading-5 text-muted-foreground">
                                    Allow this reviewer node to push follow-up fixes when it reports material PR findings.
                                  </span>
                                </span>
                              </label>

                              {selectedAgentNode.data.autofix === true && (
                                <div className="space-y-3 border-l border-border/70 pl-4">
                                  <label
                                    htmlFor={`agent-autofix-sandbox-${selectedAgentNode.id}`}
                                    className="flex cursor-pointer items-start gap-3 py-1"
                                  >
                                    <Checkbox
                                      id={`agent-autofix-sandbox-${selectedAgentNode.id}`}
                                      checked={selectedAgentNode.data.autofixSandbox === true}
                                      onCheckedChange={(checked) => updateNodeData(selectedAgentNode.id, (data) => ({
                                        ...data,
                                        autofixSandbox: checked === true,
                                      }), { mergeKey: `agent-autofix-sandbox-${selectedAgentNode.id}` })}
                                      className="mt-0.5"
                                    />
                                    <span className="space-y-1">
                                      <span className="block text-sm font-medium text-foreground">Use sandbox for autofix</span>
                                      <span className="block text-xs leading-5 text-muted-foreground">
                                        Launch an isolated repo sandbox, inject configured sandbox env vars, and push fixes from that checkout.
                                      </span>
                                    </span>
                                  </label>

                                  {selectedAgentNode.data.autofixSandbox === true && (
                                    <div className="space-y-2">
                                      <div className="flex items-center gap-2">
                                        <WorkflowSelect
                                          ariaLabel="Sandbox test repository"
                                          value={sandboxTestRepoId}
                                          onValueChange={(value) => {
                                            setSandboxTestRepoId(value)
                                            setSandboxTestResult(null)
                                            setSandboxTestError(null)
                                          }}
                                          disabled={reposLoading || sandboxTestRunning || sandboxTestRepos.length === 0}
                                          className={cn(INSPECTOR_SELECT_CLASS, "min-w-0 flex-1")}
                                          options={
                                            sandboxTestRepos.length === 0
                                              ? [{
                                                  value: "",
                                                  label: reposLoading
                                                    ? "Loading repos…"
                                                    : "No repos available",
                                                }]
                                              : sandboxTestRepos.map((repo) => ({
                                                  value: repo.id,
                                                  label: repo.full_name,
                                                }))
                                          }
                                        />
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          onClick={runAutomationSandboxTest}
                                          disabled={!sandboxTestRepoId || sandboxTestRunning}
                                          className="h-8 shrink-0 px-3 text-xs"
                                        >
                                          {sandboxTestRunning ? "Testing..." : "Test"}
                                        </Button>
                                      </div>

                                      {sandboxTestResult && (
                                        <div
                                          className={cn(
                                            "rounded-md border px-3 py-2 text-xs leading-5",
                                            sandboxTestResult.ok
                                              ? "border-accent-green/30 bg-accent-green/[0.08] text-accent-green"
                                              : "border-accent-red/30 bg-accent-red/[0.08] text-accent-red",
                                          )}
                                        >
                                          <div className="font-medium">
                                            {sandboxTestResult.ok ? "Sandbox setup ready" : sandboxTestResult.error || "Sandbox setup needs attention"}
                                          </div>
                                          {sandboxTestResult.env && (
                                            <div className="mt-1 text-muted-foreground">
                                              Env: {sandboxTestResult.env.count} vars from {sandboxTestResult.env.source}
                                              {sandboxTestResult.env.configured ? "" : " (no repo env configured)"}
                                              {sandboxTestResult.env.warning ? `; ${sandboxTestResult.env.warning}` : ""}
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {sandboxTestError && (
                                        <div className="rounded-md border border-accent-red/30 bg-accent-red/[0.08] px-3 py-2 text-xs leading-5 text-accent-red">
                                          {sandboxTestError}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          )}

                          <label
                            htmlFor={`agent-automerge-${selectedAgentNode.id}`}
                            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/80 bg-card/60 px-3 py-3 transition-colors hover:border-primary/30 hover:bg-card/80"
                          >
                            <Checkbox
                              id={`agent-automerge-${selectedAgentNode.id}`}
                              checked={selectedAgentNode.data.autoMerge === true}
                              onCheckedChange={(checked) => updateNodeData(selectedAgentNode.id, (data) => ({
                                ...data,
                                autoMerge: checked === true,
                              }), { mergeKey: `agent-automerge-${selectedAgentNode.id}` })}
                              className="mt-0.5"
                            />
                            <span className="space-y-1">
                              <span className="block text-sm font-medium text-foreground">Auto-merge when review passes</span>
                              <span className="block text-xs leading-5 text-muted-foreground">
                                You do not need to rerun the review when CI finishes. GitHub waits for required checks and branch protection, then squash-merges the pull request.
                              </span>
                            </span>
                          </label>

                          {selectedAgentHarness === "mogplex" && selectedStartConfig?.event === "ci_failure" && (
                            <label
                              htmlFor={`agent-autorevert-${selectedAgentNode.id}`}
                              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/80 bg-card/60 px-3 py-3 transition-colors hover:border-primary/30 hover:bg-card/80"
                            >
                              <Checkbox
                                id={`agent-autorevert-${selectedAgentNode.id}`}
                                checked={selectedAgentNode.data.autoRevert === true}
                                onCheckedChange={(checked) => updateNodeData(selectedAgentNode.id, (data) => ({
                                  ...data,
                                  autoRevert: checked === true,
                                }), { mergeKey: `agent-autorevert-${selectedAgentNode.id}` })}
                                className="mt-0.5"
                              />
                              <span className="space-y-1">
                                <span className="block text-sm font-medium text-foreground">Allow revert PRs</span>
                                <span className="block text-xs leading-5 text-muted-foreground">
                                  Let this agent open a revert PR when the pushed commit broke CI. Only works while that commit is still the branch head, and never pushes to the branch directly.
                                </span>
                              </span>
                            </label>
                          )}

                          {selectedAgentHarness === "mogplex" && (
                            <label
                              htmlFor={`agent-require-approval-${selectedAgentNode.id}`}
                              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/80 bg-card/60 px-3 py-3 transition-colors hover:border-primary/30 hover:bg-card/80"
                            >
                              <Checkbox
                                id={`agent-require-approval-${selectedAgentNode.id}`}
                                checked={selectedAgentNode.data.requireApproval === true}
                                onCheckedChange={(checked) => updateNodeData(selectedAgentNode.id, (data) => ({
                                  ...data,
                                  requireApproval: checked === true,
                                }), { mergeKey: `agent-require-approval-${selectedAgentNode.id}` })}
                                className="mt-0.5"
                              />
                              <span className="space-y-1">
                                <span className="block text-sm font-medium text-foreground">Require approval for tool calls</span>
                                <span className="block text-xs leading-5 text-muted-foreground">
                                  Pause before each tool call until you approve or deny it from Observability, with an optional note to steer the agent. Waits share a 10-minute window per run; unanswered calls are denied and the run continues.
                                </span>
                              </span>
                            </label>
                          )}
                        </div>
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
                              value={selectedAgentNode.data.maxStepsOverride ?? ""}
                              onChange={(event) => updateNodeData(selectedAgentNode.id, (data) => ({
                                ...data,
                                maxStepsOverride: event.target.value ? Number(event.target.value) : null,
                              }), { mergeKey: `agent-max-steps-${selectedAgentNode.id}` })}
                            />
                          </InspectorField>
                          <InspectorField label="Timeout override (seconds)">
                            <Input
                              aria-label="Timeout override (seconds)"
                              type="number"
                              min={1}
                              step={1}
                              placeholder={DEFAULT_AGENT_TIMEOUT_SECONDS_PLACEHOLDER}
                              value={typeof selectedAgentNode.data.timeoutMsOverride === "number"
                                ? Math.round(selectedAgentNode.data.timeoutMsOverride / 1000)
                                : ""}
                              onChange={(event) => updateNodeData(selectedAgentNode.id, (data) => ({
                                ...data,
                                timeoutMsOverride: event.target.value ? Number(event.target.value) * 1000 : null,
                              }), { mergeKey: `agent-timeout-${selectedAgentNode.id}` })}
                            />
                          </InspectorField>
                        </div>
                      )}
                      <InspectorField label="Instructions / prompt">
                        <Textarea
                          aria-label="System prompt override"
                          data-testid="flow-agent-instructions"
                          value={selectedAgentNode.data.systemPromptOverride ?? ""}
                          onChange={(event) => updateNodeData(selectedAgentNode.id, (data) => ({
                            ...data,
                            systemPromptOverride: event.target.value || null,
                          }), { mergeKey: `agent-system-prompt-${selectedAgentNode.id}` })}
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
                            onClick={() => updateNodeData(selectedAgentNode.id, (data) => ({
                              ...data,
                              modelOverride: null,
                              maxStepsOverride: null,
                              timeoutMsOverride: null,
                              systemPromptOverride: null,
                            }), { mergeKey: `agent-clear-overrides-${selectedAgentNode.id}` })}
                          >
                            Clear overrides
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteSelectedNode()}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash />
                            Delete node
                          </Button>
                        </div>
                      </div>
                    </>
                  )}

                  {selectedConditionNode && (() => {
                    const conditionData = selectedConditionNode.data
                    const conditionRules: FlowConditionRule[] = Array.isArray(conditionData.rules) ? conditionData.rules : []
                    const conditionMode: FlowConditionRuleMode = conditionData.mode === "any" ? "any" : "all"
                    const updateRules = (next: FlowConditionRule[], mergeKey: string) => {
                      updateNodeData(selectedConditionNode.id, (data) => ({
                        ...data,
                        rules: next,
                      }), { mergeKey })
                    }
                    return (
                      <>
                        <InspectorField label="Label">
                          <Input
                            aria-label="Label"
                            value={String(conditionData.label || "")}
                            onChange={(event) => updateNodeData(selectedConditionNode.id, (data) => ({
                              ...data,
                              label: event.target.value,
                            }), { mergeKey: `condition-label-${selectedConditionNode.id}` })}
                          />
                        </InspectorField>
                        {conditionRules.length > 1 && (
                          <InspectorField label="Match">
                            <WorkflowSelect
                              ariaLabel="Match"
                              value={conditionMode}
                              onValueChange={(value) => updateNodeData(selectedConditionNode.id, (data) => ({
                                ...data,
                                mode: value === "any" ? "any" : "all",
                              }), { mergeKey: `condition-mode-${selectedConditionNode.id}` })}
                              options={[
                                { value: "all", label: "All rules (and)" },
                                { value: "any", label: "Any rule (or)" },
                              ]}
                            />
                          </InspectorField>
                        )}
                        <div className="space-y-3">
                          {conditionRules.map((rule, ruleIndex) => {
                            const ruleKey = `condition-rule-${selectedConditionNode.id}-${ruleIndex}`
                            return (
                              <div key={ruleKey} className="space-y-2 rounded-md border border-border/60 bg-background/40 p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                    {ruleIndex === 0 ? "Rule" : conditionMode === "any" ? "Or" : "And"}
                                  </span>
                                  {conditionRules.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const next = conditionRules.filter((_, i) => i !== ruleIndex)
                                        updateRules(next, `${ruleKey}-remove`)
                                      }}
                                      className="text-[11px] text-muted-foreground hover:text-destructive"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                                <InspectorField label="Source field">
                                  <WorkflowCombobox
                                    ariaLabel="Source field"
                                    value={rule.field}
                                    onValueChange={(value) => {
                                      const next = conditionRules.map((r, i) => i === ruleIndex ? { ...r, field: value } : r)
                                      updateRules(next, `${ruleKey}-field`)
                                    }}
                                    options={FLOW_CONDITION_FIELD_PRESETS.map((preset) => ({
                                      value: preset.value,
                                      label: preset.label,
                                    }))}
                                  />
                                </InspectorField>
                                <InspectorField label="Operator">
                                  <WorkflowSelect
                                    ariaLabel="Operator"
                                    value={rule.operator}
                                    onValueChange={(value) => {
                                      const next = conditionRules.map((r, i) => i === ruleIndex
                                        ? { ...r, operator: value as FlowConditionOperator }
                                        : r)
                                      updateRules(next, `${ruleKey}-operator`)
                                    }}
                                    options={CONDITION_OPERATOR_OPTIONS.map((operator) => ({
                                      value: operator,
                                      label: conditionOperatorLabel(operator),
                                    }))}
                                  />
                                </InspectorField>
                                {!VALUE_LESS_CONDITION_OPERATORS.has(rule.operator) && (
                                  <InspectorField
                                    label={
                                      rule.operator === "in" || rule.operator === "not_in"
                                        ? "Values (comma-separated)"
                                        : "Compare value"
                                    }
                                  >
                                    <Input
                                      value={rule.value}
                                      onChange={(event) => {
                                        const next = conditionRules.map((r, i) => i === ruleIndex ? { ...r, value: event.target.value } : r)
                                        updateRules(next, `${ruleKey}-value`)
                                      }}
                                    />
                                  </InspectorField>
                                )}
                              </div>
                            )
                          })}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const next: FlowConditionRule[] = [
                              ...conditionRules,
                              { field: "metadata.source_type", operator: "equals", value: "" },
                            ]
                            updateRules(next, `condition-rule-add-${selectedConditionNode.id}-${next.length}`)
                          }}
                        >
                          Add rule
                        </Button>
                        <div className="flex justify-end border-t border-border/60 pt-3">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteSelectedNode()}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash />
                            Delete node
                          </Button>
                        </div>
                      </>
                    )
                  })()}

                  {selectedParallelNode && (
                    <>
                      <InspectorField label="Label">
                        <Input
                          value={String(selectedParallelNode.data.label || "")}
                          onChange={(event) => updateNodeData(selectedParallelNode.id, (data) => ({
                            ...data,
                            label: event.target.value,
                          }), { mergeKey: `parallel-label-${selectedParallelNode.id}` })}
                        />
                      </InspectorField>
                      <InspectorCallout variant="hint" icon={<InfoCircle />}>
                        Wire at least two outgoing branches from this split, then merge them with a Join node.
                      </InspectorCallout>
                      <div className="flex justify-end border-t border-border/60 pt-3">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteSelectedNode()}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash />
                          Delete node
                        </Button>
                      </div>
                    </>
                  )}

                  {selectedJoinNode && (
                    <>
                      <InspectorField label="Label">
                        <Input
                          value={String(selectedJoinNode.data.label || "")}
                          onChange={(event) => updateNodeData(selectedJoinNode.id, (data) => ({
                            ...data,
                            label: event.target.value,
                          }), { mergeKey: `join-label-${selectedJoinNode.id}` })}
                        />
                      </InspectorField>
                      <InspectorField label="Policy">
                        <WorkflowSelect
                          ariaLabel="Policy"
                          value={selectedJoinNode.data.policy ?? "wait_for_all"}
                          onValueChange={(value) => {
                            const nextPolicy = value as "wait_for_all" | "wait_for_any" | "quorum"
                            updateNodeData(selectedJoinNode.id, (data) => ({
                              ...data,
                              policy: nextPolicy,
                              quorum: nextPolicy === "quorum"
                                ? (typeof data.quorum === "number" && data.quorum >= 2 ? data.quorum : 2)
                              : null,
                            }), { mergeKey: `join-policy-${selectedJoinNode.id}` })
                          }}
                          options={[
                            {
                              value: "wait_for_all",
                              label: "Wait for all branches",
                            },
                            {
                              value: "wait_for_any",
                              label: "Wait for any branch",
                            },
                            {
                              value: "quorum",
                              label: "Quorum (N of branches)",
                            },
                          ]}
                        />
                      </InspectorField>
                      {selectedJoinNode.data.policy === "quorum" && (
                        <InspectorField label="Quorum">
                          <Input
                            type="number"
                            min={2}
                            step={1}
                            value={typeof selectedJoinNode.data.quorum === "number" ? selectedJoinNode.data.quorum : 2}
                            onChange={(event) => {
                              const parsed = Number(event.target.value)
                              updateNodeData(selectedJoinNode.id, (data) => ({
                                ...data,
                                quorum: Number.isFinite(parsed) && parsed >= 2 ? Math.trunc(parsed) : 2,
                              }), { mergeKey: `join-quorum-${selectedJoinNode.id}` })
                            }}
                          />
                        </InspectorField>
                      )}
                      <div className="flex justify-end border-t border-border/60 pt-3">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteSelectedNode()}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash />
                          Delete node
                        </Button>
                      </div>
                    </>
                  )}

                  {selectedDelayNode && (
                    <>
                      <InspectorField label="Label">
                        <Input
                          value={String(selectedDelayNode.data.label || "")}
                          onChange={(event) => updateNodeData(selectedDelayNode.id, (data) => ({
                            ...data,
                            label: event.target.value,
                          }), { mergeKey: `delay-label-${selectedDelayNode.id}` })}
                        />
                      </InspectorField>
                      <div className="grid gap-3 @xs:grid-cols-2">
                        <InspectorField label="Duration">
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            value={selectedDelayNode.data.duration}
                            onChange={(event) => updateNodeData(selectedDelayNode.id, (data) => ({
                              ...data,
                              duration: Number(event.target.value || 1),
                            }), { mergeKey: `delay-duration-${selectedDelayNode.id}` })}
                          />
                        </InspectorField>
                        <InspectorField label="Unit">
                          <WorkflowSelect
                            ariaLabel="Unit"
                            value={selectedDelayNode.data.unit}
                            onValueChange={(value) => updateNodeData(selectedDelayNode.id, (data) => ({
                              ...data,
                              unit: value,
                            }), { mergeKey: `delay-unit-${selectedDelayNode.id}` })}
                            options={[
                              { value: "seconds", label: "Seconds" },
                              { value: "minutes", label: "Minutes" },
                              { value: "hours", label: "Hours" },
                            ]}
                          />
                        </InspectorField>
                      </div>
                      <div className="flex justify-end border-t border-border/60 pt-3">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteSelectedNode()}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash />
                          Delete node
                        </Button>
                      </div>
                    </>
                  )}

                  {selectedAwaitEventNode && (() => {
                    const awaitData = selectedAwaitEventNode.data
                    const awaitConfig = awaitData.config
                    const awaitTimeout = awaitData.timeout ?? null
                    return (
                      <>
                        <InspectorField label="Label">
                          <Input
                            value={String(awaitData.label || "")}
                            onChange={(event) => updateNodeData(selectedAwaitEventNode.id, (data) => ({
                              ...data,
                              label: event.target.value,
                            }), { mergeKey: `await-label-${selectedAwaitEventNode.id}` })}
                          />
                        </InspectorField>
                        <InspectorField label="Wait kind">
                          <WorkflowSelect
                            ariaLabel="Wait kind"
                            value={awaitConfig.kind}
                            onValueChange={(value) => updateNodeData(selectedAwaitEventNode.id, (data) => {
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
                            }, { mergeKey: `await-kind-${selectedAwaitEventNode.id}` })}
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
                          <>
                            <InspectorField label="Label name">
                              <Input
                                value={awaitConfig.labelName}
                                placeholder="e.g. ready-to-merge"
                                onChange={(event) => updateNodeData(selectedAwaitEventNode.id, (data) => {
                                  const current = (data.config ?? {}) as Record<string, unknown>
                                  return {
                                    ...data,
                                    config: {
                                      kind: "github_label_added",
                                      labelName: event.target.value,
                                      prOnly: current.prOnly === true,
                                    },
                                  }
                                }, { mergeKey: `await-label-name-${selectedAwaitEventNode.id}` })}
                              />
                            </InspectorField>
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Checkbox
                                checked={awaitConfig.prOnly === true}
                                onCheckedChange={(checked) => updateNodeData(selectedAwaitEventNode.id, (data) => {
                                  const current = (data.config ?? {}) as Record<string, unknown>
                                  return {
                                    ...data,
                                    config: {
                                      kind: "github_label_added",
                                      labelName: typeof current.labelName === "string" ? current.labelName : "",
                                      prOnly: checked === true,
                                    },
                                  }
                                }, { mergeKey: `await-pr-only-${selectedAwaitEventNode.id}` })}
                              />
                              Match pull request labels only (skip issue labels)
                            </label>
                          </>
                        )}
                        {awaitConfig.kind === "github_comment_added" && (
                          <>
                            <InspectorField label="Comment contains">
                              <Input
                                data-testid="flow-await-comment-contains"
                                value={awaitConfig.bodyContains}
                                placeholder="Optional text, e.g. approved"
                                onChange={(event) => updateNodeData(selectedAwaitEventNode.id, (data) => ({
                                  ...data,
                                  config: {
                                    ...(data.config as Extract<FlowAwaitEventConfig, { kind: "github_comment_added" }>),
                                    kind: "github_comment_added",
                                    bodyContains: event.target.value,
                                  },
                                }), { mergeKey: `await-comment-contains-${selectedAwaitEventNode.id}` })}
                              />
                            </InspectorField>
                            <InspectorField label="Comment author">
                              <Input
                                data-testid="flow-await-comment-author"
                                value={awaitConfig.authorLogin}
                                placeholder="Optional GitHub login"
                                onChange={(event) => updateNodeData(selectedAwaitEventNode.id, (data) => ({
                                  ...data,
                                  config: {
                                    ...(data.config as Extract<FlowAwaitEventConfig, { kind: "github_comment_added" }>),
                                    kind: "github_comment_added",
                                    authorLogin: event.target.value.replace(/^@/, ""),
                                  },
                                }), { mergeKey: `await-comment-author-${selectedAwaitEventNode.id}` })}
                              />
                            </InspectorField>
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Checkbox
                                data-testid="flow-await-comment-match-trigger"
                                checked={awaitConfig.matchTriggerIssue !== false}
                                onCheckedChange={(checked) => updateNodeData(selectedAwaitEventNode.id, (data) => ({
                                  ...data,
                                  config: {
                                    ...(data.config as Extract<FlowAwaitEventConfig, { kind: "github_comment_added" }>),
                                    kind: "github_comment_added",
                                    matchTriggerIssue: checked === true,
                                  },
                                }), { mergeKey: `await-comment-trigger-${selectedAwaitEventNode.id}` })}
                              />
                              Match the issue or pull request that started this run
                            </label>
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Checkbox
                                data-testid="flow-await-comment-pr-only"
                                checked={awaitConfig.prOnly === true}
                                onCheckedChange={(checked) => updateNodeData(selectedAwaitEventNode.id, (data) => ({
                                  ...data,
                                  config: {
                                    ...(data.config as Extract<FlowAwaitEventConfig, { kind: "github_comment_added" }>),
                                    kind: "github_comment_added",
                                    prOnly: checked === true,
                                  },
                                }), { mergeKey: `await-comment-pr-only-${selectedAwaitEventNode.id}` })}
                              />
                              Match pull request comments only
                            </label>
                          </>
                        )}
                        {awaitConfig.kind === "ci_workflow_completed" && (
                          <>
                            <InspectorField label="Workflow or check name">
                              <Input
                                value={awaitConfig.workflowName}
                                placeholder="e.g. CI / test"
                                onChange={(event) => updateNodeData(selectedAwaitEventNode.id, (data) => ({
                                  ...data,
                                  config: {
                                    ...(data.config as Extract<FlowAwaitEventConfig, { kind: "ci_workflow_completed" }>),
                                    kind: "ci_workflow_completed",
                                    workflowName: event.target.value,
                                  },
                                }), { mergeKey: `await-workflow-name-${selectedAwaitEventNode.id}` })}
                              />
                            </InspectorField>
                            <InspectorField label="Conclusion">
                              <WorkflowSelect
                                ariaLabel="Conclusion"
                                value={awaitConfig.conclusion}
                                onValueChange={(value) => updateNodeData(selectedAwaitEventNode.id, (data) => ({
                                  ...data,
                                  config: {
                                    ...(data.config as Extract<FlowAwaitEventConfig, { kind: "ci_workflow_completed" }>),
                                    kind: "ci_workflow_completed",
                                    conclusion: value as FlowCiWorkflowConclusion,
                                  },
                                }), { mergeKey: `await-workflow-conclusion-${selectedAwaitEventNode.id}` })}
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
                                checked={awaitConfig.matchTriggerSha !== false}
                                onCheckedChange={(checked) => updateNodeData(selectedAwaitEventNode.id, (data) => ({
                                  ...data,
                                  config: {
                                    ...(data.config as Extract<FlowAwaitEventConfig, { kind: "ci_workflow_completed" }>),
                                    kind: "ci_workflow_completed",
                                    matchTriggerSha: checked === true,
                                  },
                                }), { mergeKey: `await-workflow-sha-${selectedAwaitEventNode.id}` })}
                              />
                              Match the commit that started this run when available
                            </label>
                          </>
                        )}
                        {awaitConfig.kind === "vercel_preview_ready" && (
                          <>
                            <InspectorField label="Vercel environment">
                              <Input
                                value={awaitConfig.environment}
                                placeholder="Preview"
                                onChange={(event) => updateNodeData(selectedAwaitEventNode.id, (data) => ({
                                  ...data,
                                  config: {
                                    ...(data.config as Extract<FlowAwaitEventConfig, { kind: "vercel_preview_ready" }>),
                                    kind: "vercel_preview_ready",
                                    environment: event.target.value,
                                  },
                                }), { mergeKey: `await-vercel-environment-${selectedAwaitEventNode.id}` })}
                              />
                            </InspectorField>
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Checkbox
                                checked={awaitConfig.matchTriggerSha !== false}
                                onCheckedChange={(checked) => updateNodeData(selectedAwaitEventNode.id, (data) => ({
                                  ...data,
                                  config: {
                                    ...(data.config as Extract<FlowAwaitEventConfig, { kind: "vercel_preview_ready" }>),
                                    kind: "vercel_preview_ready",
                                    matchTriggerSha: checked === true,
                                  },
                                }), { mergeKey: `await-vercel-sha-${selectedAwaitEventNode.id}` })}
                              />
                              Match the commit that started this run when available
                            </label>
                          </>
                        )}
                        {awaitConfig.kind === "manual_approval" && (
                          <InspectorField label="Approval request">
                            <Textarea
                              value={awaitConfig.prompt}
                              placeholder="e.g. Approve production deployment"
                              rows={3}
                              onChange={(event) => updateNodeData(selectedAwaitEventNode.id, (data) => ({
                                ...data,
                                config: {
                                  kind: "manual_approval",
                                  prompt: event.target.value,
                                },
                              }), { mergeKey: `await-approval-prompt-${selectedAwaitEventNode.id}` })}
                            />
                          </InspectorField>
                        )}
                        <div className="grid gap-3 @xs:grid-cols-2">
                          <InspectorField label="Timeout">
                            <Input
                              type="number"
                              min={0}
                              step={1}
                              value={awaitTimeout?.value ?? ""}
                              placeholder="No timeout"
                              onChange={(event) => updateNodeData(selectedAwaitEventNode.id, (data) => {
                                const value = Number(event.target.value)
                                if (!Number.isFinite(value) || value <= 0) {
                                  return { ...data, timeout: null }
                                }
                                const current = (data.timeout ?? {}) as Record<string, unknown>
                                const unit = current.unit === "minutes" || current.unit === "days" ? current.unit : "hours"
                                return { ...data, timeout: { value, unit } }
                              }, { mergeKey: `await-timeout-value-${selectedAwaitEventNode.id}` })}
                            />
                          </InspectorField>
                          <InspectorField label="Timeout unit">
                            <WorkflowSelect
                              ariaLabel="Timeout unit"
                              value={awaitTimeout?.unit ?? "hours"}
                              onValueChange={(value) => updateNodeData(selectedAwaitEventNode.id, (data) => {
                                const unit = value as "minutes" | "hours" | "days"
                                const current = (data.timeout ?? null) as { value?: number } | null
                                if (!current || typeof current.value !== "number") return data
                                return { ...data, timeout: { value: current.value, unit } }
                              }, { mergeKey: `await-timeout-unit-${selectedAwaitEventNode.id}` })}
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
                            onClick={() => deleteSelectedNode()}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash />
                            Delete node
                          </Button>
                        </div>
                      </>
                    )
                  })()}

                  {selectedSetVariableNode && (() => {
                    const stateNode = selectedSetVariableNode
                    const assignments = stateNode.data.assignments ?? []
                    const readAssignments = (data: Record<string, unknown>) =>
                      Array.isArray(data.assignments)
                        ? (data.assignments as Array<{ key: string; template: string }>)
                        : []
                    return (
                      <>
                        <InspectorField label="Label">
                          <Input
                            value={String(stateNode.data.label || "")}
                            onChange={(event) => updateNodeData(stateNode.id, (data) => ({
                              ...data,
                              label: event.target.value,
                            }), { mergeKey: `set-variable-label-${stateNode.id}` })}
                          />
                        </InspectorField>
                        <div className="space-y-3">
                          <div className="ui-label">Assignments</div>
                          {assignments.map((assignment, index) => (
                            <div key={index} className="space-y-2 rounded-lg border border-border/60 bg-card/40 p-3">
                              <InspectorField label="Key">
                                <Input
                                  value={String(assignment.key || "")}
                                  placeholder="e.g. has_tests_changed"
                                  onChange={(event) => updateNodeData(stateNode.id, (data) => ({
                                    ...data,
                                    assignments: readAssignments(data).map((entry, i) =>
                                      i === index ? { ...entry, key: event.target.value } : entry
                                    ),
                                  }), { mergeKey: `set-variable-key-${stateNode.id}-${index}` })}
                                />
                              </InspectorField>
                              <InspectorField label="Value template">
                                <Input
                                  value={String(assignment.template || "")}
                                  placeholder='{{ metadata.pr_number }} or PR #{{ metadata.pr_number }}'
                                  onChange={(event) => updateNodeData(stateNode.id, (data) => ({
                                    ...data,
                                    assignments: readAssignments(data).map((entry, i) =>
                                      i === index ? { ...entry, template: event.target.value } : entry
                                    ),
                                  }), { mergeKey: `set-variable-template-${stateNode.id}-${index}` })}
                                />
                              </InspectorField>
                              <div className="flex justify-end">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => updateNodeData(stateNode.id, (data) => ({
                                    ...data,
                                    assignments: readAssignments(data).filter((_, i) => i !== index),
                                  }), { mergeKey: `set-variable-remove-${stateNode.id}-${index}` })}
                                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                          ))}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => updateNodeData(stateNode.id, (data) => ({
                              ...data,
                              assignments: [...readAssignments(data), { key: "", template: "" }],
                            }), { mergeKey: `set-variable-add-${stateNode.id}` })}
                          >
                            Add assignment
                          </Button>
                        </div>
                        <InspectorCallout variant="hint" icon={<InfoCircle />}>
                          A whole-string template like <span className="font-mono text-foreground">{"{{ metadata.pr_number }}"}</span> preserves the source type. Mixed text interpolates as a string. Read downstream as <span className="font-mono text-foreground">state.&lt;key&gt;</span>.
                        </InspectorCallout>
                        <div className="flex justify-end border-t border-border/60 pt-3">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteSelectedNode()}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash />
                            Delete node
                          </Button>
                        </div>
                      </>
                    )
                  })()}

                  {selectedTransformNode && (() => {
                    const transformNode = selectedTransformNode
                    const assignments = transformNode.data.assignments ?? []
                    const readAssignments = (data: Record<string, unknown>) =>
                      Array.isArray(data.assignments)
                        ? (data.assignments as FlowTransformAssignment[])
                        : []
                    const updateAssignment = (
                      index: number,
                      updater: (
                        assignment: FlowTransformAssignment
                      ) => FlowTransformAssignment,
                      mergeKey: string,
                    ) => updateNodeData(transformNode.id, (data) => ({
                      ...data,
                      assignments: readAssignments(data).map((assignment, assignmentIndex) =>
                        assignmentIndex === index ? updater(assignment) : assignment
                      ),
                    }), { mergeKey })

                    return (
                      <>
                        <InspectorField label="Label">
                          <Input
                            data-testid="flow-transform-label"
                            value={transformNode.data.label}
                            onChange={(event) => updateNodeData(transformNode.id, (data) => ({
                              ...data,
                              label: event.target.value,
                            }), { mergeKey: `transform-label-${transformNode.id}` })}
                          />
                        </InspectorField>
                        <div className="space-y-3">
                          <div className="ui-label">Transformations</div>
                          {assignments.map((assignment, index) => {
                            const operation = FLOW_TRANSFORM_OPERATION_OPTIONS.find(
                              (option) => option.value === assignment.operation
                            ) ?? FLOW_TRANSFORM_OPERATION_OPTIONS[0]
                            return (
                              <div
                                key={index}
                                data-testid={`flow-transform-assignment-${index}`}
                                className="space-y-2 rounded-lg border border-border/60 bg-card/40 p-3"
                              >
                                <InspectorField label="Write to state">
                                  <Input
                                    data-testid={`flow-transform-key-${index}`}
                                    value={assignment.key}
                                    placeholder="has_tests_changed"
                                    onChange={(event) => updateAssignment(
                                      index,
                                      (current) => ({ ...current, key: event.target.value }),
                                      `transform-key-${transformNode.id}-${index}`,
                                    )}
                                  />
                                </InspectorField>
                                <InspectorField label="Source path">
                                  <Input
                                    data-testid={`flow-transform-source-${index}`}
                                    value={assignment.source}
                                    placeholder="metadata.changed_files"
                                    onChange={(event) => updateAssignment(
                                      index,
                                      (current) => ({ ...current, source: event.target.value }),
                                      `transform-source-${transformNode.id}-${index}`,
                                    )}
                                  />
                                </InspectorField>
                                <InspectorField label="Operation">
                                  <WorkflowSelect
                                    testId={`flow-transform-operation-${index}`}
                                    ariaLabel="Operation"
                                    value={assignment.operation}
                                    onValueChange={(value) => {
                                      const nextOperation = value as FlowTransformOperation
                                      const nextOption = FLOW_TRANSFORM_OPERATION_OPTIONS.find(
                                        (option) => option.value === nextOperation
                                      )
                                      updateAssignment(
                                        index,
                                        (current) => ({
                                          ...current,
                                          operation: nextOperation,
                                          ...(nextOption?.argumentLabel
                                            ? { argument: current.argument ?? "" }
                                            : { argument: undefined }),
                                        }),
                                        `transform-operation-${transformNode.id}-${index}`,
                                      )
                                    }}
                                    options={FLOW_TRANSFORM_OPERATION_OPTIONS.map((option) => ({
                                      value: option.value,
                                      label: option.label,
                                    }))}
                                  />
                                </InspectorField>
                                {operation.argumentLabel ? (
                                  <InspectorField label={operation.argumentLabel}>
                                    <Input
                                      data-testid={`flow-transform-argument-${index}`}
                                      value={assignment.argument ?? ""}
                                      placeholder={operation.argumentPlaceholder}
                                      onChange={(event) => updateAssignment(
                                        index,
                                        (current) => ({
                                          ...current,
                                          argument: event.target.value,
                                        }),
                                        `transform-argument-${transformNode.id}-${index}`,
                                      )}
                                    />
                                  </InspectorField>
                                ) : null}
                                <div className="flex justify-end">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => updateNodeData(transformNode.id, (data) => ({
                                      ...data,
                                      assignments: readAssignments(data).filter(
                                        (_, assignmentIndex) => assignmentIndex !== index
                                      ),
                                    }), { mergeKey: `transform-remove-${transformNode.id}-${index}` })}
                                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                  >
                                    Remove
                                  </Button>
                                </div>
                              </div>
                            )
                          })}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-testid="flow-transform-add-assignment"
                            onClick={() => updateNodeData(transformNode.id, (data) => ({
                              ...data,
                              assignments: [
                                ...readAssignments(data),
                                {
                                  key: "",
                                  source: "metadata.changed_files",
                                  operation: "array_length",
                                },
                              ],
                            }), { mergeKey: `transform-add-${transformNode.id}` })}
                          >
                            Add transformation
                          </Button>
                        </div>
                        <InspectorCallout variant="hint" icon={<InfoCircle />}>
                          Transform reads trigger metadata or existing workflow state and writes
                          typed results to <span className="font-mono text-foreground">state.&lt;key&gt;</span>.
                          Use a second Transform node when one result feeds another.
                        </InspectorCallout>
                        <div className="flex justify-end border-t border-border/60 pt-3">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteSelectedNode()}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash />
                            Delete node
                          </Button>
                        </div>
                      </>
                    )
                  })()}

                  {selectedEndNode && (
                    <InspectorField label="Label">
                      <Input
                        value={String(selectedEndNode.data.label || "")}
                        onChange={(event) => updateNodeData(selectedEndNode.id, (data) => ({
                          ...data,
                          label: event.target.value,
                        }), { mergeKey: `end-label-${selectedEndNode.id}` })}
                      />
                    </InspectorField>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                  Select a node to edit its properties. Agent overrides only change this flow node, never the master agent.
                </div>
              )}
            </section>

            <div className="space-y-5 border-t border-border pt-5">
              <div className="ui-kicker">Flow</div>

              <section className="space-y-2">
                <div className="ui-section-title">Notes</div>
                <Textarea
                  value={draft?.notes ?? ""}
                  onChange={(event) => {
                    updateDraft((current) => ({
                      ...current,
                      notes: event.target.value,
                    }), { mergeKey: "flow-notes" })
                  }}
                  rows={8}
                  placeholder="Capture intent, guardrails, and context for this flow."
                />
              </section>

              <section>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => toggleAssistantPanel()}
                  className="w-full"
                >
                  Open assistant
                </Button>
              </section>
            </div>
            </div>
          </div>
        )}
      </aside>
      </div>
      <Dialog open={saveTemplateOpen} onOpenChange={(open) => {
        if (!savingTemplate) setSaveTemplateOpen(open)
      }}>
        <DialogContent
          data-testid="flow-save-template-dialog"
          className="overflow-hidden border-border bg-popover p-0 shadow-2xl sm:max-w-md"
        >
          <DialogHeader className="border-b border-border px-5 py-4 text-left">
            <div className={cn(
              "mb-1 text-[9px] font-semibold tracking-[0.2em] uppercase",
              saveTemplateScope === "team" ? "text-sky-700 dark:text-sky-300/75" : "text-orange-700 dark:text-orange-300/70",
            )}>
              {saveTemplateScope === "team" ? "Team template" : "Personal template"}
            </div>
            <DialogTitle className="text-base text-foreground">
              Save a reusable workflow
            </DialogTitle>
            <DialogDescription className="text-[11px] leading-5 text-muted-foreground">
              {saveTemplateScope === "team"
                ? "The graph is shared with your active team. Private agents, GitHub scope, Slack channels, and webhook secrets are removed."
                : "The graph is preserved. GitHub scope, Slack channels, and webhook secrets are removed so every new workflow reconnects safely."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-5 py-4">
            {activeTeamId && teamTemplatesCanWrite ? (
              <fieldset>
                <legend className="mb-2 block text-[9px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                  Available to
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  <label className="cursor-pointer">
                    <input
                      type="radio"
                      name="flow-template-scope"
                      value="personal"
                      checked={saveTemplateScope === "personal"}
                      onChange={() => setSaveTemplateScope("personal")}
                      className="peer sr-only"
                      data-testid="flow-template-scope-personal"
                    />
                    <span className="flex min-h-20 flex-col rounded-lg border border-border bg-foreground/[0.02] px-3 py-2.5 transition-colors peer-checked:border-orange-400/45 peer-checked:bg-orange-400/[0.07]">
                      <span className="text-xs font-semibold text-foreground">Only you</span>
                      <span className="mt-1 text-[10px] leading-4 text-muted-foreground">
                        Keep agent assignments private
                      </span>
                    </span>
                  </label>
                  <label className="cursor-pointer">
                    <input
                      type="radio"
                      name="flow-template-scope"
                      value="team"
                      checked={saveTemplateScope === "team"}
                      onChange={() => setSaveTemplateScope("team")}
                      className="peer sr-only"
                      data-testid="flow-template-scope-team"
                    />
                    <span className="flex min-h-20 flex-col rounded-lg border border-border bg-foreground/[0.02] px-3 py-2.5 transition-colors peer-checked:border-sky-400/45 peer-checked:bg-sky-400/[0.07]">
                      <span className="text-xs font-semibold text-foreground">Active team</span>
                      <span className="mt-1 text-[10px] leading-4 text-muted-foreground">
                        Share the graph, reconnect agents
                      </span>
                    </span>
                  </label>
                </div>
              </fieldset>
            ) : null}
            <label htmlFor="flow-template-name">
              <span className="mb-2 block text-[9px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                Template name
              </span>
              <Input
                id="flow-template-name"
                value={saveTemplateName}
                onChange={(event) => setSaveTemplateName(event.target.value)}
                maxLength={80}
                autoFocus
                placeholder="Strict PR review"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void saveSelectedFlowAsTemplate()
                  }
                }}
              />
            </label>
          </div>
          <DialogFooter className="border-t border-border px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              disabled={savingTemplate}
              onClick={() => setSaveTemplateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              data-testid="flow-save-template-submit"
              disabled={!saveTemplateName.trim() || savingTemplate}
              onClick={() => void saveSelectedFlowAsTemplate()}
            >
              {savingTemplate ? "Saving…" : "Save template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(templateDeleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deletingTemplate) setTemplateDeleteTarget(null)
        }}
      >
        <DialogContent className="overflow-hidden border-border bg-popover p-0 shadow-2xl sm:max-w-sm">
          <DialogHeader className="border-b border-border px-5 py-4 text-left">
            <div className="mb-1 text-[9px] font-semibold tracking-[0.2em] text-red-700 dark:text-red-300/70 uppercase">
              Delete template
            </div>
            <DialogTitle className="text-base text-foreground">
              Remove {templateDeleteTarget?.template.name ?? "this template"}?
            </DialogTitle>
            <DialogDescription className="text-[11px] leading-5 text-muted-foreground">
              Existing workflows are unchanged. The template will no longer be
              available from Quick start.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-t border-border px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              disabled={deletingTemplate}
              onClick={() => setTemplateDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingTemplate}
              onClick={() => void deleteSavedTemplate()}
            >
              {deletingTemplate ? "Deleting…" : "Delete template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
