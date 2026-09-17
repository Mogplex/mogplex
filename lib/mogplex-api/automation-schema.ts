import {
  TRIGGER_EVENTS,
  AGENT_ROLES,
  CONDITION_OPERATORS,
  TRANSFORM_OPERATIONS,
} from "@/lib/flows/assistant-tools-constants";
import type { FlowGraph } from "@/lib/types";

const string = { type: "string" };
const boolean = { type: "boolean" };
const nullableString = { type: ["string", "null"] };
const position = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"],
};
const strings = { type: "array", items: string };

function node(
  type: string,
  properties: Record<string, unknown>,
  required: string[] = []
) {
  return {
    type: "object",
    required: ["id", "type", "position", "data"],
    properties: {
      id: string,
      type: { const: type },
      position,
      data: {
        type: "object",
        properties: { label: string, ...properties },
        required: ["label", ...required],
        additionalProperties: true,
      },
    },
  };
}

export const automationGraphSchema = {
  type: "object",
  description:
    "Complete Flow graph. Call mogplex_get_automation_schema for recipes and mogplex_validate_automation before publishing.",
  required: ["nodes", "edges"],
  additionalProperties: false,
  properties: {
    nodes: {
      type: "array",
      items: {
        oneOf: [
          node(
            "start",
            {
              event: { type: "string", enum: TRIGGER_EVENTS },
              isDefault: boolean,
              filter: {
                type: "object",
                properties: {
                  scope: { enum: ["all", "org", "personal"] },
                  installationIds: {
                    type: "array",
                    items: { type: "integer", minimum: 1 },
                  },
                  repos: {
                    ...strings,
                    description:
                      "Full owner/repo names, not repo IDs. Schedule, webhook, and slack_mention require exactly one.",
                  },
                  authorFilter: {
                    enum: [
                      "any",
                      "humans_only",
                      "exclude_dependabot",
                      "dependabot_only",
                    ],
                  },
                },
                required: ["scope"],
              },
              scheduleCron: {
                ...string,
                description:
                  "Required for schedule: five-field cron, for example 10 7 * * *.",
              },
              scheduleTimezone: {
                ...string,
                description:
                  "IANA timezone, for example America/New_York. Defaults to UTC.",
              },
              labelName: string,
              labelPrOnly: boolean,
              tagPattern: string,
              dependabotAlertActions: {
                type: "array",
                items: {
                  enum: [
                    "created",
                    "dismissed",
                    "fixed",
                    "reopened",
                    "reintroduced",
                    "auto_dismissed",
                  ],
                },
              },
              slackTeamId: string,
              slackChannelId: string,
            },
            ["event"]
          ),
          node("agent", {
            agentId: {
              ...nullableString,
              description:
                "Mogplex: ID from mogplex_list_agents, including preset: IDs which are provisioned on save. CLI harnesses: null.",
            },
            harness: {
              enum: ["mogplex", "claude-code", "codex"],
              default: "mogplex",
            },
            role: {
              enum: AGENT_ROLES,
              description:
                "task runs scheduled checkout work and can open a new PR. edit fixes an existing PR. review reports findings. triage responds to events.",
            },
            modelOverride: {
              ...nullableString,
              description:
                "Required for Mogplex: enabled ID from mogplex_list_models. CLI harnesses choose their own model.",
            },
            fallbackModelOverride: nullableString,
            systemPromptOverride: {
              ...nullableString,
              description:
                "Node-local instructions. Required for task. Does not change the base agent.",
            },
            timeoutMsOverride: {
              type: ["number", "null"],
              exclusiveMinimum: 0,
            },
            autofix: boolean,
            autofixSandbox: boolean,
            autoMerge: boolean,
            autoRevert: boolean,
            requireApproval: {
              ...boolean,
              description:
                "Mogplex only: wait for approval before each tool call. Not a PR review gate.",
            },
          }),
          node(
            "condition",
            {
              mode: { enum: ["all", "any"] },
              rules: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    field: string,
                    operator: { enum: CONDITION_OPERATORS },
                    value: string,
                  },
                  required: ["field", "operator", "value"],
                },
              },
            },
            ["rules"]
          ),
          node("parallel", {}),
          node("join", {
            policy: { enum: ["wait_for_all", "wait_for_any", "quorum"] },
            quorum: { type: ["integer", "null"], minimum: 2 },
          }),
          node(
            "delay",
            {
              duration: { type: "number", exclusiveMinimum: 0 },
              unit: { enum: ["seconds", "minutes", "hours"] },
            },
            ["duration", "unit"]
          ),
          node(
            "await_event",
            {
              config: {
                type: "object",
                properties: {
                  kind: {
                    enum: [
                      "github_label_added",
                      "github_comment_added",
                      "ci_workflow_completed",
                      "vercel_preview_ready",
                      "manual_approval",
                    ],
                  },
                  labelName: string,
                  prOnly: boolean,
                  bodyContains: string,
                  authorLogin: string,
                  matchTriggerIssue: boolean,
                  workflowName: string,
                  conclusion: {
                    enum: ["any", "success", "failure", "cancelled"],
                  },
                  environment: string,
                  matchTriggerSha: boolean,
                  prompt: string,
                },
                required: ["kind"],
              },
              timeout: {
                type: ["object", "null"],
                properties: {
                  value: { type: "number", exclusiveMinimum: 0 },
                  unit: { enum: ["minutes", "hours", "days"] },
                },
                required: ["value", "unit"],
              },
            },
            ["config"]
          ),
          node(
            "set_variable",
            {
              assignments: {
                type: "array",
                items: {
                  type: "object",
                  properties: { key: string, template: string },
                  required: ["key", "template"],
                },
              },
            },
            ["assignments"]
          ),
          node(
            "transform",
            {
              assignments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    key: string,
                    source: string,
                    operation: { enum: TRANSFORM_OPERATIONS },
                    argument: string,
                  },
                  required: ["key", "source", "operation"],
                },
              },
            },
            ["assignments"]
          ),
          node(
            "action",
            {
              operation: {
                enum: [
                  "sandbox.run_command",
                  "slack.send_message",
                  "github.post_comment",
                  "github.create_issue",
                  "github.update_labels",
                  "github.set_status",
                  "github.submit_review",
                  "github.merge_pull_request",
                ],
              },
              command: string,
              workingDirectory: nullableString,
              destination: { enum: ["channel", "trigger_thread"] },
              teamId: string,
              channelId: string,
              channelName: nullableString,
              message: string,
              unfurlLinks: boolean,
              targetNumber: nullableString,
              body: string,
              title: string,
              labels: strings,
              addLabels: strings,
              removeLabels: strings,
              commitSha: nullableString,
              state: { enum: ["pending", "success", "failure", "error"] },
              context: string,
              description: nullableString,
              targetUrl: nullableString,
              pullRequestNumber: nullableString,
              event: { enum: ["COMMENT", "APPROVE", "REQUEST_CHANGES"] },
              commitTitle: nullableString,
            },
            ["operation"]
          ),
          node("end", {}),
        ],
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: string,
          source: string,
          target: string,
          sourceHandle: {
            ...nullableString,
            description:
              "condition: true or false; error recovery: error; otherwise omit.",
          },
          targetHandle: nullableString,
        },
        required: ["id", "source", "target"],
      },
    },
    viewport: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        zoom: { type: "number", exclusiveMinimum: 0 },
      },
      required: ["x", "y", "zoom"],
    },
  },
};

export const scheduledTaskExample: FlowGraph = {
  nodes: [
    {
      id: "start",
      type: "start",
      position: { x: 0, y: 0 },
      data: {
        label: "Daily",
        event: "schedule",
        scheduleCron: "10 7 * * *",
        scheduleTimezone: "UTC",
        filter: { scope: "org", installationIds: [123], repos: ["owner/repo"] },
      },
    },
    {
      id: "task",
      type: "agent",
      position: { x: 300, y: 0 },
      data: {
        label: "Repository task",
        role: "task",
        harness: "mogplex",
        agentId: "REPLACE_WITH_AGENT_ID",
        modelOverride: "REPLACE_WITH_MODEL_ID",
        systemPromptOverride:
          "Inspect the repository for the requested maintenance. Check open PRs first. Apply only needed changes, run the repository checks, and open a PR for human review. If no change is needed, report NO_ACTION.",
        autoMerge: false,
        autofix: false,
        autoRevert: false,
        requireApproval: false,
      },
    },
    {
      id: "end",
      type: "end",
      position: { x: 600, y: 0 },
      data: { label: "Done" },
    },
  ],
  edges: [
    { id: "start-task", source: "start", target: "task" },
    { id: "task-end", source: "task", target: "end" },
  ],
};

export const automationSchemaGuide = {
  graphSchema: automationGraphSchema,
  examples: { scheduledTask: scheduledTaskExample },
  instructions: [
    "Discover the repository with mogplex_list_repos. Replace owner/repo and installationIds in the example with its full_name and installation_id.",
    "For Mogplex, use agentId from mogplex_list_agents and modelOverride from mogplex_list_models. preset: IDs work without a separate agent creation call.",
    "Use the requested harness. Do not switch to Claude Code or Codex to avoid choosing a Mogplex agent or model. CLI harnesses use agentId: null and modelOverride: null.",
    "Task nodes run on a new branch from the default branch. They can run commands and open PRs without an upstream review node. They require a schedule trigger and systemPromptOverride.",
    "Edit nodes fix an existing PR and require an upstream review, except on mention and pr_comment triggers. They do not support schedule triggers.",
    "Call mogplex_validate_automation with installationId and graph. It does not save, publish, run a model, or create a sandbox.",
    "Create or update the draft, then publish it. Publishing activates the schedule. Published status is not evidence of successful execution.",
    "mogplex_trigger_automation starts a real billed run with the configured write access. There is no dry-run flag. Inspect runs and logs to verify execution.",
    "A prompt to check open PRs is not an atomic duplicate-work lock. Stop overlapping external schedules before handing recurring work to this automation.",
  ],
};
