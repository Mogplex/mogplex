import { tool } from "ai";
import { z } from "zod";
import { FLOW_ASSISTANT_GRAPH_STATE_TOOL } from "@/lib/flows/assistant-chat-payload";
import {
  CONDITION_HANDLE_IDS,
  cloneFlowGraph,
  createDefaultFlowGraph,
  FAILURE_HANDLE_ID,
  validateFlowGraph,
} from "@/lib/flows/graph";
import { FLOW_OPERATOR_REGISTRY } from "@/lib/flows/operators/registry";
import { DEFAULT_NEW_AGENT_MODEL_ID } from "@/lib/agents/model-options";
import type {
  FlowAgentNodeRole,
  FlowConditionOperator,
  FlowGraph,
  FlowNode,
  FlowNodeType,
  FlowTransformOperation,
  TriggerEvent,
} from "@/lib/types";
import type { Tool } from "ai";

const TRIGGER_EVENTS = [
  "mention",
  "pr_opened",
  "issue_opened",
  "pr_comment",
  "issue_comment",
  "push",
  "ci_failure",
  "labeled",
  "tag_push",
  "schedule",
  "webhook",
  "slack_mention",
] as const satisfies ReadonlyArray<TriggerEvent>;

const AGENT_ROLES = [
  "review",
  "edit",
  "triage",
] as const satisfies ReadonlyArray<FlowAgentNodeRole>;

const CONDITION_OPERATORS = [
  "exists",
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
  "is_empty",
  "is_not_empty",
] as const satisfies ReadonlyArray<FlowConditionOperator>;

const positionSchema = z
  .object({ x: z.number(), y: z.number() })
  .optional()
  .describe("Optional canvas position; auto-assigned when omitted.");

type AllowedAgent = { id: string; name: string; slug: string };

export type FlowAssistantResult = {
  done: boolean;
  summary: string | null;
  graph: FlowGraph;
  hydrated: boolean;
};

export type FlowAssistantToolset = {
  tools: Record<string, Tool>;
  getResult: () => FlowAssistantResult;
};

const setStartParams = z.object({
  label: z.string().describe("Short label shown on the node."),
  event: z.enum(TRIGGER_EVENTS).describe("Workflow trigger event."),
  isDefault: z
    .boolean()
    .optional()
    .describe("Mark as the default trigger for the agent."),
  labelName: z
    .string()
    .optional()
    .describe(
      "For event 'labeled' only: exact GitHub label name that starts the flow. Empty or omitted matches any label."
    ),
  labelPrOnly: z
    .boolean()
    .optional()
    .describe(
      "For event 'labeled' only: fire only when the label lands on a pull request, not an issue."
    ),
  tagPattern: z
    .string()
    .optional()
    .describe(
      "For event 'tag_push' only: minimal glob over the tag name (* matches any run of characters). Empty or omitted matches any tag."
    ),
  repos: z
    .array(z.string())
    .optional()
    .describe(
      "Optional owner/repo scope. schedule, webhook, and slack_mention require exactly one repository."
    ),
  authorFilter: z
    .enum(["any", "humans_only", "exclude_dependabot", "dependabot_only"])
    .optional()
    .describe("For pr_opened only: optional PR author filter."),
  scheduleCron: z
    .string()
    .optional()
    .describe("For schedule only: five-field cron expression."),
  scheduleTimezone: z
    .string()
    .optional()
    .describe("For schedule only: IANA timezone."),
  slackTeamId: z
    .string()
    .optional()
    .describe("For slack_mention only: connected Slack workspace team id."),
  slackChannelId: z
    .string()
    .optional()
    .describe("For slack_mention only: Slack channel id."),
  position: positionSchema,
});

const setEndParams = z.object({
  label: z.string(),
  position: positionSchema,
});

const addAgentNodeParams = z.object({
  label: z.string(),
  agentId: z.string(),
  role: z.enum(AGENT_ROLES).optional(),
  autofix: z.boolean().optional(),
  autoMerge: z
    .boolean()
    .optional()
    .describe(
      "Review nodes only: squash-merge the PR automatically when the review passes and GitHub reports it clean (checks green, no conflicts)."
    ),
  autoRevert: z
    .boolean()
    .optional()
    .describe(
      "ci_failure flows only: let the agent open a revert PR when the pushed commit broke CI (only while that commit is still the branch head)."
    ),
  model: z
    .string()
    .optional()
    .describe(
      'Model id this step runs on, e.g. "anthropic/claude-opus-5". Every agent node needs one, and it must be a model the workspace can invoke — the tool rejects an unrecognised id and lists the valid ones. Omit to accept whichever model this workspace defaults to.'
    ),
  position: positionSchema,
});

const conditionRuleSchema = z.object({
  field: z.string().describe("Dot-path into the flow state."),
  operator: z.enum(CONDITION_OPERATORS),
  value: z
    .string()
    .describe(
      "Compare value; ignored when operator is 'exists', 'is_empty', or 'is_not_empty'. For 'in'/'not_in', use a comma-separated list."
    ),
});

const addConditionNodeParams = z.object({
  label: z.string(),
  // Legacy single-rule fields kept for compatibility with older assistant
  // tool-calls. New calls should use `rules` + `mode` instead.
  field: z.string().optional(),
  operator: z.enum(CONDITION_OPERATORS).optional(),
  value: z.string().optional(),
  mode: z
    .enum(["all", "any"])
    .optional()
    .describe(
      "Combine multiple rules with 'all' (and) or 'any' (or). Defaults to 'all'."
    ),
  rules: z
    .array(conditionRuleSchema)
    .optional()
    .describe(
      "List of rules to evaluate. Provide this for new If nodes; the legacy field/operator/value triple is still accepted for one-rule branches."
    ),
  position: positionSchema,
});

const addParallelNodeParams = z.object({
  label: z.string(),
  position: positionSchema,
});

const addJoinNodeParams = z.object({
  label: z.string(),
  policy: z
    .enum(["wait_for_all", "wait_for_any", "quorum"])
    .optional()
    .describe(
      "Merge policy. wait_for_all (default): emit once every branch reports. wait_for_any: emit on the first active branch and ignore later arrivals. quorum: emit once `quorum` active branches have reported, or skip when that becomes impossible."
    ),
  quorum: z
    .number()
    .int()
    .min(2)
    .optional()
    .describe(
      "Required when policy is 'quorum'. Must be at least 2 and at most the number of incoming edges."
    ),
  position: positionSchema,
});

const addDelayNodeParams = z.object({
  label: z.string(),
  duration: z.number().positive(),
  unit: z.enum(["seconds", "minutes", "hours"]),
  position: positionSchema,
});

const AWAIT_EVENT_KINDS = [
  "github_label_added",
  "github_comment_added",
  "ci_workflow_completed",
  "vercel_preview_ready",
  "manual_approval",
] as const;
const AWAIT_TIMEOUT_UNITS = ["minutes", "hours", "days"] as const;

const addAwaitEventNodeParams = z
  .object({
    label: z.string(),
    kind: z.enum(AWAIT_EVENT_KINDS),
    labelName: z
      .string()
      .optional()
      .describe("Required when kind is 'github_label_added'."),
    prOnly: z
      .boolean()
      .optional()
      .describe(
        "For GitHub label and comment waits, only fire on pull requests. Defaults to true; set false to also match issues."
      ),
    bodyContains: z
      .string()
      .optional()
      .describe(
        "For github_comment_added, optionally require this case-insensitive text in the comment."
      ),
    authorLogin: z
      .string()
      .optional()
      .describe(
        "For github_comment_added, optionally require this exact GitHub login."
      ),
    matchTriggerIssue: z
      .boolean()
      .optional()
      .describe(
        "For github_comment_added, match the issue or pull request that started the run. Defaults to true."
      ),
    workflowName: z
      .string()
      .optional()
      .describe(
        "Required when kind is 'ci_workflow_completed'. Exact GitHub Actions workflow or check name."
      ),
    conclusion: z
      .enum(["any", "success", "failure", "cancelled"])
      .optional()
      .describe(
        "CI conclusion to match. Defaults to success for ci_workflow_completed."
      ),
    environment: z
      .string()
      .optional()
      .describe("Vercel deployment environment to match. Defaults to Preview."),
    prompt: z
      .string()
      .optional()
      .describe("Required when kind is 'manual_approval'."),
    matchTriggerSha: z
      .boolean()
      .optional()
      .describe(
        "For CI and Vercel waits, match the commit that started this run when available. Defaults to true."
      ),
    timeoutValue: z.number().positive().optional(),
    timeoutUnit: z.enum(AWAIT_TIMEOUT_UNITS).optional(),
    position: positionSchema,
  })
  .superRefine((input, context) => {
    if (input.kind === "github_comment_added") return;
    const required =
      input.kind === "github_label_added"
        ? input.labelName
        : input.kind === "ci_workflow_completed"
          ? input.workflowName
          : input.kind === "manual_approval"
            ? input.prompt
            : (input.environment ?? "Preview");
    if (!required?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Missing configuration for ${input.kind}`,
      });
    }
  });

const addSetVariableNodeParams = z.object({
  label: z.string(),
  assignments: z
    .array(
      z.object({
        key: z
          .string()
          .regex(/^[a-zA-Z_]\w*$/)
          .describe(
            "Variable name. Must start with a letter or underscore and contain only letters, digits, and underscores. Read downstream as `state.<key>`."
          ),
        template: z
          .string()
          .describe(
            "Value template. A whole-string `{{ path }}` expression preserves the source type (number stays number). Mixed text or multiple substitutions interpolate as a string. Resolves against metadata, repo, outputs, outputs_by_label, previous_outputs, and the current state."
          ),
      })
    )
    .min(1),
  position: positionSchema,
});

const TRANSFORM_OPERATIONS = [
  "copy",
  "string_contains",
  "string_split",
  "array_join",
  "array_length",
  "array_includes",
  "files_match_glob",
  "cast_boolean",
  "cast_number",
] as const satisfies ReadonlyArray<FlowTransformOperation>;

const addTransformNodeParams = z.object({
  label: z.string(),
  assignments: z
    .array(
      z
        .object({
          key: z
            .string()
            .regex(/^[a-zA-Z_]\w*$/)
            .describe("State key written as `state.<key>`."),
          source: z
            .string()
            .regex(/^[a-zA-Z_]\w*(?:\.\w+)*$/)
            .describe(
              "Dot-path into metadata, repo, outputs, outputs_by_label, previous_outputs, or state."
            ),
          operation: z.enum(TRANSFORM_OPERATIONS),
          argument: z
            .string()
            .optional()
            .describe(
              "Substring, split/join delimiter, array value, or file glob. Omit for copy, array_length, and casts."
            ),
        })
        .superRefine((assignment, context) => {
          const needsArgument = [
            "string_contains",
            "string_split",
            "array_join",
            "array_includes",
            "files_match_glob",
          ].includes(assignment.operation);
          const needsNonemptyArgument = [
            "string_contains",
            "array_includes",
            "files_match_glob",
          ].includes(assignment.operation);
          if (needsArgument && assignment.argument === undefined) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${assignment.operation} requires an argument`,
              path: ["argument"],
            });
          } else if (needsNonemptyArgument && !assignment.argument?.length) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${assignment.operation} requires a non-empty argument`,
              path: ["argument"],
            });
          }
        })
    )
    .min(1),
  position: positionSchema,
});

const addRunCommandNodeParams = z.object({
  label: z.string(),
  command: z
    .string()
    .min(1)
    .describe(
      "Static shell command to execute in the reusable sandbox. Do not place workflow templates in command source."
    ),
  workingDirectory: z
    .string()
    .optional()
    .describe("Optional repo-relative working directory, such as apps/web."),
  position: positionSchema,
});

const addSlackMessageNodeParams = z
  .object({
    label: z.string(),
    destination: z
      .enum(["channel", "trigger_thread"])
      .optional()
      .describe(
        "Use trigger_thread to reply to the Slack thread that started the workflow; otherwise use channel."
      ),
    teamId: z
      .string()
      .optional()
      .describe("Connected Slack workspace team id."),
    channelId: z.string().optional().describe("Slack channel id."),
    channelName: z
      .string()
      .optional()
      .describe("Optional channel name used only for display."),
    message: z
      .string()
      .min(1)
      .describe(
        "Message text. Supports {{ path }} templates for trigger metadata, outputs, and workflow state."
      ),
    unfurlLinks: z.boolean().optional(),
    position: positionSchema,
  })
  .superRefine((input, context) => {
    if (input.destination === "trigger_thread") return;
    if (!input.teamId?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "channel destination requires teamId",
        path: ["teamId"],
      });
    }
    if (!input.channelId?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "channel destination requires channelId",
        path: ["channelId"],
      });
    }
  });

const addGithubCommentNodeParams = z.object({
  label: z.string(),
  targetNumber: z
    .string()
    .optional()
    .describe(
      "Optional issue/PR number or {{ path }} template. Omit to use the triggering issue or PR."
    ),
  body: z.string().min(1).describe("Templated Markdown comment body."),
  position: positionSchema,
});

const addGithubIssueNodeParams = z.object({
  label: z.string(),
  title: z.string().min(1).describe("Templated issue title."),
  body: z.string().describe("Templated Markdown issue body."),
  labels: z.array(z.string().min(1)).optional(),
  position: positionSchema,
});

const addGithubLabelsNodeParams = z
  .object({
    label: z.string(),
    targetNumber: z
      .string()
      .optional()
      .describe(
        "Optional issue/PR number or {{ path }} template. Omit to use the triggering issue or PR."
      ),
    addLabels: z.array(z.string().min(1)).optional(),
    removeLabels: z.array(z.string().min(1)).optional(),
    position: positionSchema,
  })
  .refine(
    (input) =>
      (input.addLabels?.length ?? 0) + (input.removeLabels?.length ?? 0) > 0,
    { message: "At least one label must be added or removed" }
  );

const addGithubStatusNodeParams = z.object({
  label: z.string(),
  commitSha: z
    .string()
    .optional()
    .describe(
      "Optional commit SHA or {{ path }} template. Omit to use the triggering commit."
    ),
  state: z.enum(["pending", "success", "failure", "error"]),
  context: z.string().min(1).describe("Named GitHub status context."),
  description: z.string().optional().describe("Templated status description."),
  targetUrl: z.string().optional().describe("Templated http(s) details URL."),
  position: positionSchema,
});

const addGithubReviewNodeParams = z.object({
  label: z.string(),
  pullRequestNumber: z
    .string()
    .optional()
    .describe(
      "Optional PR number or {{ path }} template. Omit to use the triggering pull request."
    ),
  event: z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
  body: z.string().min(1).describe("Templated Markdown review body."),
  position: positionSchema,
});

const addGithubMergeNodeParams = z.object({
  label: z.string(),
  pullRequestNumber: z
    .string()
    .optional()
    .describe(
      "Optional PR number or {{ path }} template. Omit to use the triggering pull request."
    ),
  commitTitle: z
    .string()
    .optional()
    .describe("Optional templated squash commit title."),
  position: positionSchema,
});

const connectParams = z.object({
  source: z.string(),
  target: z.string(),
  sourceHandle: z
    .enum([
      CONDITION_HANDLE_IDS.true,
      CONDITION_HANDLE_IDS.false,
      FAILURE_HANDLE_ID,
    ])
    .optional(),
  targetHandle: z.string().optional(),
});

const disconnectParams = z.object({ edgeId: z.string() });

const removeNodeParams = z.object({ id: z.string() });

const updateNodeLabelParams = z.object({ id: z.string(), label: z.string() });

const getGraphParams = z.object({});

const finalizeParams = z.object({
  summary: z
    .string()
    .describe("One-sentence description of what this flow does."),
});

export function createFlowAssistantTools(input: {
  initialGraph: FlowGraph | null;
  allowedAgents: AllowedAgent[];
  // Model ids this scope can invoke. The assistant picks a step's model and the
  // node is the only source of truth for it, so an unconstrained id would
  // publish cleanly and fail at run time — validate it here the same way
  // agentId is validated. Empty/omitted disables the check and falls back to
  // the default model, which keeps callers that have no catalog working.
  allowedModelIds?: readonly string[];
  includeGraphStateTool?: boolean;
}): FlowAssistantToolset {
  const graph: FlowGraph = cloneFlowGraph(
    input.initialGraph ?? createDefaultFlowGraph()
  );
  const graphHydrated = input.initialGraph !== null;
  const allowedAgentIds = new Set(input.allowedAgents.map((a) => a.id));
  const allowedModelIds = new Set<string>(input.allowedModelIds);
  // Prefer the product default when the scope can invoke it, otherwise the
  // first model it can — falling back to the constant only when there is no
  // catalog to choose from at all.
  const defaultModelId = allowedModelIds.has(DEFAULT_NEW_AGENT_MODEL_ID)
    ? DEFAULT_NEW_AGENT_MODEL_ID
    : (input.allowedModelIds?.[0] ?? DEFAULT_NEW_AGENT_MODEL_ID);
  let finalizedSummary: string | null = null;

  const mintId = (type: FlowNodeType) => `${type}-${randomId()}`;
  const mintEdgeId = () => `edge-${randomId()}`;

  const autoPosition = () => {
    const count = graph.nodes.length;
    return { x: 80 + count * 220, y: 140 };
  };

  const findNode = (id: string) => graph.nodes.find((n) => n.id === id);

  const removeNodeById = (id: string) => {
    const exists = findNode(id);
    if (!exists) return false;
    graph.nodes = graph.nodes.filter((n) => n.id !== id);
    graph.edges = graph.edges.filter((e) => e.source !== id && e.target !== id);
    return true;
  };

  function removeNodeByType(type: "start" | "end") {
    graph.nodes = graph.nodes.filter((n) => n.type !== type);
    const remainingIds = new Set(graph.nodes.map((n) => n.id));
    graph.edges = graph.edges.filter(
      (e) => remainingIds.has(e.source) && remainingIds.has(e.target)
    );
  }

  const requireGraphHydrated = () => {
    if (graphHydrated) return null;
    return {
      error:
        "Call getGraphState first so the live canvas graph can be loaded before editing.",
    };
  };

  const setStart = tool({
    description:
      "Replace or create the flow's single start node. Use exactly one of the supported trigger events.",
    inputSchema: setStartParams,
    execute: async ({
      label,
      event,
      isDefault,
      labelName,
      labelPrOnly,
      tagPattern,
      repos,
      authorFilter,
      scheduleCron,
      scheduleTimezone,
      slackTeamId,
      slackChannelId,
      position,
    }: z.infer<typeof setStartParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      removeNodeByType("start");
      const trimmedLabelName =
        event === "labeled" ? (labelName?.trim() ?? "") : "";
      const trimmedTagPattern =
        event === "tag_push" ? (tagPattern?.trim() ?? "") : "";
      const scopedRepos = Array.from(
        new Set((repos ?? []).map((repo) => repo.trim()).filter(Boolean))
      );
      const node: FlowNode = {
        id: "start",
        type: "start",
        position: position ?? { x: 80, y: 140 },
        data: {
          label,
          event,
          isDefault: isDefault ?? false,
          ...(trimmedLabelName ? { labelName: trimmedLabelName } : {}),
          ...(event === "labeled" && labelPrOnly === true
            ? { labelPrOnly: true }
            : {}),
          ...(trimmedTagPattern ? { tagPattern: trimmedTagPattern } : {}),
          ...(scopedRepos.length > 0 ||
          (event === "pr_opened" && authorFilter && authorFilter !== "any")
            ? {
                filter: {
                  scope: "all",
                  ...(scopedRepos.length > 0 ? { repos: scopedRepos } : {}),
                  ...(event === "pr_opened" &&
                  authorFilter &&
                  authorFilter !== "any"
                    ? { authorFilter }
                    : {}),
                },
              }
            : {}),
          ...(event === "schedule"
            ? {
                scheduleCron: scheduleCron?.trim() || "0 9 * * 1-5",
                scheduleTimezone: scheduleTimezone?.trim() || "UTC",
              }
            : {}),
          ...(event === "slack_mention" && slackTeamId?.trim()
            ? { slackTeamId: slackTeamId.trim() }
            : {}),
          ...(event === "slack_mention" && slackChannelId?.trim()
            ? { slackChannelId: slackChannelId.trim() }
            : {}),
        },
      };
      graph.nodes.push(node);
      return { id: node.id };
    },
  });

  const setEnd = tool({
    description: "Replace or create the flow's single end node.",
    inputSchema: setEndParams,
    execute: async ({ label, position }: z.infer<typeof setEndParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      removeNodeByType("end");
      const node: FlowNode = {
        id: "end",
        type: "end",
        position: position ?? autoPosition(),
        data: { label },
      };
      graph.nodes.push(node);
      return { id: node.id };
    },
  });

  const addAgentNode = tool({
    description:
      "Add an agent node bound to one of the user's existing agents. agentId must come from the available agents list.",
    inputSchema: addAgentNodeParams,
    execute: async ({
      label,
      agentId,
      role,
      autofix,
      autoMerge,
      autoRevert,
      model,
      position,
    }: z.infer<typeof addAgentNodeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      if (!allowedAgentIds.has(agentId)) {
        return {
          error: `Unknown agentId "${agentId}". Choose one from the available agents list.`,
        };
      }
      const requestedModel = model?.trim();
      if (
        requestedModel &&
        allowedModelIds.size > 0 &&
        !allowedModelIds.has(requestedModel)
      ) {
        return {
          error: `Unknown model "${requestedModel}". Choose one of: ${[...allowedModelIds].join(", ")}.`,
        };
      }
      const id = mintId("agent");
      graph.nodes.push({
        id,
        type: "agent",
        position: position ?? autoPosition(),
        data: {
          label,
          agentId,
          harness: "mogplex",
          role,
          autofix,
          autoMerge,
          autoRevert,
          // Publish rejects an agent node with no model, so never emit one.
          modelOverride: requestedModel || defaultModelId,
          maxStepsOverride: null,
          timeoutMsOverride: null,
          systemPromptOverride: null,
        },
      });
      return { id };
    },
  });

  const addConditionNode = tool({
    description:
      "Add an If branching node. Always connect both outgoing handles ('true' for the then branch and 'false' for the else branch) using the connect tool. Use the `rules` array for multi-rule logic, or pass field/operator/value for a single-rule branch.",
    inputSchema: addConditionNodeParams,
    execute: async ({
      label,
      field,
      operator,
      value,
      mode,
      rules,
      position,
    }: z.infer<typeof addConditionNodeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const resolvedRules =
        rules && rules.length > 0
          ? rules
          : field !== undefined || operator !== undefined || value !== undefined
            ? [
                {
                  field: field ?? "",
                  operator: operator ?? "equals",
                  value: value ?? "",
                },
              ]
            : [];
      if (resolvedRules.length === 0) {
        return {
          error:
            "addConditionNode requires either a non-empty `rules` array or the legacy field/operator/value triple.",
        };
      }
      const id = mintId("condition");
      graph.nodes.push({
        id,
        type: "condition",
        position: position ?? autoPosition(),
        data: {
          label,
          mode: mode ?? "all",
          rules: resolvedRules,
        },
      });
      return {
        id,
        handles: {
          then: CONDITION_HANDLE_IDS.true,
          else: CONDITION_HANDLE_IDS.false,
        },
      };
    },
  });

  const addParallelNode = tool({
    description:
      "Add a fan-out node. Needs exactly one incoming edge and at least two outgoing edges.",
    inputSchema: addParallelNodeParams,
    execute: async ({
      label,
      position,
    }: z.infer<typeof addParallelNodeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = mintId("parallel");
      graph.nodes.push({
        id,
        type: "parallel",
        position: position ?? autoPosition(),
        data: { label },
      });
      return { id };
    },
  });

  const addJoinNode = tool({
    description:
      "Add a fan-in node. Needs at least two incoming edges and exactly one outgoing edge. Choose a policy: wait_for_all (default), wait_for_any, or quorum (with required quorum count).",
    inputSchema: addJoinNodeParams,
    execute: async ({
      label,
      policy,
      quorum,
      position,
    }: z.infer<typeof addJoinNodeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = mintId("join");
      const resolvedPolicy = policy ?? "wait_for_all";
      graph.nodes.push({
        id,
        type: "join",
        position: position ?? autoPosition(),
        data: {
          label,
          policy: resolvedPolicy,
          quorum: resolvedPolicy === "quorum" ? (quorum ?? null) : null,
        },
      });
      return { id };
    },
  });

  const addDelayNode = tool({
    description:
      "Add a Wait (timed) node. Use this for fixed-time pauses; for waits that depend on a GitHub event, use addAwaitEventNode instead. Duration must be greater than zero.",
    inputSchema: addDelayNodeParams,
    execute: async ({
      label,
      duration,
      unit,
      position,
    }: z.infer<typeof addDelayNodeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = mintId("delay");
      graph.nodes.push({
        id,
        type: "delay",
        position: position ?? autoPosition(),
        data: { label, duration, unit },
      });
      return { id };
    },
  });

  const addAwaitEventNode = tool({
    description:
      "Add an Await event node that suspends the flow until a matching external event arrives. Supported kinds: github_label_added, github_comment_added, ci_workflow_completed, vercel_preview_ready, and manual_approval. Comment waits match the triggering issue or PR by default; CI and Vercel waits match the triggering commit by default. Optionally pass timeoutValue + timeoutUnit to fail the wait after a duration.",
    inputSchema: addAwaitEventNodeParams,
    execute: async ({
      label,
      kind,
      labelName,
      prOnly,
      bodyContains,
      authorLogin,
      matchTriggerIssue,
      workflowName,
      conclusion,
      environment,
      prompt,
      matchTriggerSha,
      timeoutValue,
      timeoutUnit,
      position,
    }: z.infer<typeof addAwaitEventNodeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = mintId("await_event");
      const timeout =
        typeof timeoutValue === "number" && timeoutValue > 0
          ? { value: timeoutValue, unit: timeoutUnit ?? "hours" }
          : null;
      const config =
        kind === "github_comment_added"
          ? {
              kind,
              bodyContains: bodyContains?.trim() ?? "",
              authorLogin: authorLogin?.trim().replace(/^@/, "") ?? "",
              prOnly: prOnly ?? true,
              matchTriggerIssue: matchTriggerIssue ?? true,
            }
          : kind === "ci_workflow_completed"
            ? {
                kind,
                workflowName: workflowName ?? "",
                conclusion: conclusion ?? "success",
                matchTriggerSha: matchTriggerSha ?? true,
              }
            : kind === "vercel_preview_ready"
              ? {
                  kind,
                  environment: environment ?? "Preview",
                  matchTriggerSha: matchTriggerSha ?? true,
                }
              : kind === "manual_approval"
                ? {
                    kind,
                    prompt: prompt ?? "",
                  }
                : {
                    kind: "github_label_added" as const,
                    labelName: labelName ?? "",
                    prOnly: prOnly ?? true,
                  };
      graph.nodes.push({
        id,
        type: "await_event",
        position: position ?? autoPosition(),
        data: {
          label,
          config,
          timeout,
        },
      });
      return { id };
    },
  });

  const addSetVariableNode = tool({
    description:
      "Add a Set variable node that writes deterministic values into per-run state. Each assignment has a `key` (read downstream as `state.<key>`) and a `template`. A whole-string `{{ path }}` template preserves the source type; mixed text interpolates as a string. Use this for branching on derived state without spending an agent call.",
    inputSchema: addSetVariableNodeParams,
    execute: async ({
      label,
      assignments,
      position,
    }: z.infer<typeof addSetVariableNodeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = mintId("set_variable");
      graph.nodes.push({
        id,
        type: "set_variable",
        position: position ?? autoPosition(),
        data: { label, assignments },
      });
      return { id };
    },
  });

  const addTransformNode = tool({
    description:
      "Add a deterministic Transform node that derives workflow state without an agent call. Supported operations: copy, string contains/split, array join/length/includes, changed-file glob matching, and boolean/number casts. Each result is written as state.<key> for downstream If nodes.",
    inputSchema: addTransformNodeParams,
    execute: async ({
      label,
      assignments,
      position,
    }: z.infer<typeof addTransformNodeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = mintId("transform");
      graph.nodes.push({
        id,
        type: "transform",
        position: position ?? autoPosition(),
        data: { label, assignments },
      });
      return { id };
    },
  });

  const addRunCommandNode = tool({
    description:
      "Add a deterministic action that runs a shell command in the trigger branch's sandbox. Sequential command actions reuse the same sandbox workspace.",
    inputSchema: addRunCommandNodeParams,
    execute: async ({
      label,
      command,
      workingDirectory,
      position,
    }: z.infer<typeof addRunCommandNodeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = mintId("action");
      graph.nodes.push({
        id,
        type: "action",
        position: position ?? autoPosition(),
        data: {
          label,
          operation: "sandbox.run_command",
          command,
          workingDirectory: workingDirectory?.trim() || null,
        },
      });
      return { id };
    },
  });

  const addSlackMessageNode = tool({
    description:
      "Add a deterministic action that posts a templated message to a channel in a connected Slack workspace.",
    inputSchema: addSlackMessageNodeParams,
    execute: async ({
      label,
      destination,
      teamId,
      channelId,
      channelName,
      message,
      unfurlLinks,
      position,
    }: z.infer<typeof addSlackMessageNodeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = mintId("action");
      graph.nodes.push({
        id,
        type: "action",
        position: position ?? autoPosition(),
        data: {
          label,
          operation: "slack.send_message",
          destination: destination ?? "channel",
          teamId: teamId ?? "",
          channelId: channelId ?? "",
          channelName: channelName?.trim() || null,
          message,
          unfurlLinks: unfurlLinks === true,
        },
      });
      return { id };
    },
  });

  const addGithubCommentNode = tool({
    description:
      "Add a deterministic action that posts a templated comment on the triggering GitHub issue or pull request.",
    inputSchema: addGithubCommentNodeParams,
    execute: async ({
      label,
      targetNumber,
      body,
      position,
    }: z.infer<typeof addGithubCommentNodeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = mintId("action");
      graph.nodes.push({
        id,
        type: "action",
        position: position ?? autoPosition(),
        data: {
          label,
          operation: "github.post_comment",
          targetNumber: targetNumber?.trim() || null,
          body,
        },
      });
      return { id };
    },
  });

  const addGithubIssueNode = tool({
    description:
      "Add a deterministic action that creates an issue in the workflow repository.",
    inputSchema: addGithubIssueNodeParams,
    execute: async ({
      label,
      title,
      body,
      labels,
      position,
    }: z.infer<typeof addGithubIssueNodeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = mintId("action");
      graph.nodes.push({
        id,
        type: "action",
        position: position ?? autoPosition(),
        data: {
          label,
          operation: "github.create_issue",
          title,
          body,
          labels: labels ?? [],
        },
      });
      return { id };
    },
  });

  const addGithubLabelsNode = tool({
    description:
      "Add a deterministic action that adds or removes labels on the triggering GitHub issue or pull request.",
    inputSchema: addGithubLabelsNodeParams,
    execute: async ({
      label,
      targetNumber,
      addLabels,
      removeLabels,
      position,
    }: z.infer<typeof addGithubLabelsNodeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = mintId("action");
      graph.nodes.push({
        id,
        type: "action",
        position: position ?? autoPosition(),
        data: {
          label,
          operation: "github.update_labels",
          targetNumber: targetNumber?.trim() || null,
          addLabels: addLabels ?? [],
          removeLabels: removeLabels ?? [],
        },
      });
      return { id };
    },
  });

  const addGithubStatusNode = tool({
    description:
      "Add a deterministic action that publishes a named GitHub commit status on the triggering commit.",
    inputSchema: addGithubStatusNodeParams,
    execute: async ({
      label,
      commitSha,
      state,
      context,
      description,
      targetUrl,
      position,
    }: z.infer<typeof addGithubStatusNodeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = mintId("action");
      graph.nodes.push({
        id,
        type: "action",
        position: position ?? autoPosition(),
        data: {
          label,
          operation: "github.set_status",
          commitSha: commitSha?.trim() || null,
          state,
          context,
          description: description?.trim() || null,
          targetUrl: targetUrl?.trim() || null,
        },
      });
      return { id };
    },
  });

  const addGithubReviewNode = tool({
    description:
      "Add a deterministic action that submits a comment, approval, or change request on the triggering pull request.",
    inputSchema: addGithubReviewNodeParams,
    execute: async ({
      label,
      pullRequestNumber,
      event,
      body,
      position,
    }: z.infer<typeof addGithubReviewNodeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = mintId("action");
      graph.nodes.push({
        id,
        type: "action",
        position: position ?? autoPosition(),
        data: {
          label,
          operation: "github.submit_review",
          pullRequestNumber: pullRequestNumber?.trim() || null,
          event,
          body,
        },
      });
      return { id };
    },
  });

  const addGithubMergeNode = tool({
    description:
      "Add an action that requests a squash merge after the workflow completes. Mogplex waits for its own review check to finish, requires an explicit no-issues verdict for PR-review flows, then merges only when GitHub reports the pull request open, non-draft, conflict-free, and clean under branch protection.",
    inputSchema: addGithubMergeNodeParams,
    execute: async ({
      label,
      pullRequestNumber,
      commitTitle,
      position,
    }: z.infer<typeof addGithubMergeNodeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const id = mintId("action");
      graph.nodes.push({
        id,
        type: "action",
        position: position ?? autoPosition(),
        data: {
          label,
          operation: "github.merge_pull_request",
          pullRequestNumber: pullRequestNumber?.trim() || null,
          commitTitle: commitTitle?.trim() || null,
        },
      });
      return { id };
    },
  });

  const connect = tool({
    description:
      "Create an edge between two existing nodes. For If (condition) sources pass sourceHandle as 'true' for the then branch or 'false' for the else branch. To route a recovery branch from a failure-aware node (agent, action, condition, delay, await_event, set_variable, transform), pass sourceHandle as 'error'.",
    inputSchema: connectParams,
    execute: async ({
      source,
      target,
      sourceHandle,
      targetHandle,
    }: z.infer<typeof connectParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const sourceNode = findNode(source);
      if (!sourceNode) return { error: `No node with id "${source}".` };
      if (!findNode(target)) return { error: `No node with id "${target}".` };
      if (source === target)
        return { error: "A node cannot connect to itself." };
      if (sourceHandle === FAILURE_HANDLE_ID) {
        const operator = FLOW_OPERATOR_REGISTRY[sourceNode.type];
        if (operator?.canFail !== true) {
          return {
            error: `Node "${source}" cannot have an error edge — its operator does not support failure recovery.`,
          };
        }
        const existingErrorEdge = graph.edges.find(
          (e) => e.source === source && e.sourceHandle === FAILURE_HANDLE_ID
        );
        if (existingErrorEdge) {
          return {
            error: `Node "${source}" already has an error edge (id "${existingErrorEdge.id}").`,
          };
        }
      }
      const normalizedSourceHandle = sourceHandle ?? null;
      const normalizedTargetHandle = targetHandle ?? null;
      const duplicate = graph.edges.some(
        (e) =>
          e.source === source &&
          e.target === target &&
          (e.sourceHandle ?? null) === normalizedSourceHandle &&
          (e.targetHandle ?? null) === normalizedTargetHandle
      );
      if (duplicate) {
        return {
          error: `Edge from "${source}" to "${target}" already exists.`,
        };
      }
      const id = mintEdgeId();
      graph.edges.push({
        id,
        source,
        target,
        sourceHandle: normalizedSourceHandle,
        targetHandle: normalizedTargetHandle,
      });
      return { id };
    },
  });

  const disconnect = tool({
    description: "Remove an edge by id.",
    inputSchema: disconnectParams,
    execute: async ({ edgeId }: z.infer<typeof disconnectParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const before = graph.edges.length;
      graph.edges = graph.edges.filter((e) => e.id !== edgeId);
      if (graph.edges.length === before) {
        return { error: `No edge with id "${edgeId}".` };
      }
      return { ok: true };
    },
  });

  const removeNode = tool({
    description:
      "Remove a node and all edges connected to it. Cannot remove nodes with id 'start' or 'end' — call setStart/setEnd instead.",
    inputSchema: removeNodeParams,
    execute: async ({ id }: z.infer<typeof removeNodeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      if (id === "start" || id === "end") {
        return {
          error: "Use setStart/setEnd to replace the start or end node.",
        };
      }
      const ok = removeNodeById(id);
      if (!ok) return { error: `No node with id "${id}".` };
      return { ok: true };
    },
  });

  const updateNodeLabel = tool({
    description: "Change the label of an existing node.",
    inputSchema: updateNodeLabelParams,
    execute: async ({ id, label }: z.infer<typeof updateNodeLabelParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const node = findNode(id);
      if (!node) return { error: `No node with id "${id}".` };
      node.data = { ...node.data, label };
      return { ok: true };
    },
  });

  const getGraph = tool({
    description:
      "Return the current working graph as JSON. Call this whenever you need to inspect state before making changes.",
    inputSchema: getGraphParams,
    execute: async () => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      return { graph: cloneFlowGraph(graph) };
    },
  });

  const getGraphState = tool({
    description:
      "Request the live canvas graph from the client. Call this before inspecting or editing the graph in chat.",
    inputSchema: getGraphParams,
    outputSchema: z.object({ graph: z.unknown() }),
  });

  const finalize = tool({
    description:
      "Validate the graph and finish. On validation errors, fix them with other tools and call finalize again. On success, the flow is saved as the assistant's suggestion.",
    inputSchema: finalizeParams,
    execute: async ({ summary }: z.infer<typeof finalizeParams>) => {
      const hydrationError = requireGraphHydrated();
      if (hydrationError) return hydrationError;
      const validation = validateFlowGraph(graph, {
        requireRunnableConfig: true,
      });
      if (!validation.valid) {
        return { ok: false, errors: validation.errors };
      }
      finalizedSummary = summary;
      return { ok: true };
    },
  });

  const tools: Record<string, Tool> = {
    setStart,
    setEnd,
    addAgentNode,
    addConditionNode,
    addParallelNode,
    addJoinNode,
    addDelayNode,
    addAwaitEventNode,
    addSetVariableNode,
    addTransformNode,
    addRunCommandNode,
    addSlackMessageNode,
    addGithubCommentNode,
    addGithubIssueNode,
    addGithubLabelsNode,
    addGithubStatusNode,
    addGithubReviewNode,
    addGithubMergeNode,
    connect,
    disconnect,
    removeNode,
    updateNodeLabel,
    getGraph,
    finalize,
  };
  if (input.includeGraphStateTool) {
    tools[FLOW_ASSISTANT_GRAPH_STATE_TOOL] = getGraphState;
  }

  return {
    tools,
    getResult: () => ({
      done: finalizedSummary !== null,
      summary: finalizedSummary,
      graph: cloneFlowGraph(graph),
      hydrated: graphHydrated,
    }),
  };
}

function randomId() {
  return crypto.randomUUID().slice(0, 8);
}
