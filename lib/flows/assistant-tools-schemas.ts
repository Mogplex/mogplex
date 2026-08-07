import { z } from "zod";
import {
  AGENT_ROLES,
  AWAIT_EVENT_KINDS,
  AWAIT_TIMEOUT_UNITS,
  CONDITION_OPERATORS,
  TRANSFORM_OPERATIONS,
  TRIGGER_EVENTS,
} from "./assistant-tools-constants";
import { CONDITION_HANDLE_IDS, FAILURE_HANDLE_ID } from "@/lib/flows/graph";

export const positionSchema = z
  .object({ x: z.number(), y: z.number() })
  .optional()
  .describe("Optional canvas position; auto-assigned when omitted.");

export const setStartParams = z.object({
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

export const setEndParams = z.object({
  label: z.string(),
  position: positionSchema,
});

export const addAgentNodeParams = z.object({
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

export const conditionRuleSchema = z.object({
  field: z.string().describe("Dot-path into the flow state."),
  operator: z.enum(CONDITION_OPERATORS),
  value: z
    .string()
    .describe(
      "Compare value; ignored when operator is 'exists', 'is_empty', or 'is_not_empty'. For 'in'/'not_in', use a comma-separated list."
    ),
});

export const addConditionNodeParams = z.object({
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

export const addParallelNodeParams = z.object({
  label: z.string(),
  position: positionSchema,
});

export const addJoinNodeParams = z.object({
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

export const addDelayNodeParams = z.object({
  label: z.string(),
  duration: z.number().positive(),
  unit: z.enum(["seconds", "minutes", "hours"]),
  position: positionSchema,
});

export const addAwaitEventNodeParams = z
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

export const addSetVariableNodeParams = z.object({
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

export const addTransformNodeParams = z.object({
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

export const connectParams = z.object({
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

export const disconnectParams = z.object({ edgeId: z.string() });

export const removeNodeParams = z.object({ id: z.string() });

export const updateNodeLabelParams = z.object({
  id: z.string(),
  label: z.string(),
});

export const getGraphParams = z.object({});

export const finalizeParams = z.object({
  summary: z
    .string()
    .describe("One-sentence description of what this flow does."),
});
