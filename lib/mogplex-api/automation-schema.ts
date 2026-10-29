import {
  TRIGGER_EVENTS,
  AGENT_ROLES,
  CONDITION_OPERATORS,
  TRANSFORM_OPERATIONS,
} from "@/lib/flows/assistant-tools-constants";
import {
  oneTimeTaskExample,
  scheduledTaskExample,
} from "./automation-examples";

export { scheduledTaskExample } from "./automation-examples";

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
                    description:
                      "GitHub event triggers: omit to run for every connected account, including ones connected later; list ids only to restrict. Schedule, webhook, and slack_mention require exactly one.",
                  },
                  repos: {
                    ...strings,
                    description:
                      "Full owner/repo names, not repo IDs. Schedule, webhook, and slack_mention require exactly one. For api, the repositories an integration may trigger it for.",
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
                  "Recurring schedule: five-field cron, for example 10 7 * * *. Omit when using scheduleRunAt.",
              },
              scheduleRunAt: {
                ...string,
                description:
                  "Run once at this future ISO timestamp with explicit offset, for example 2027-01-15T15:00:00-05:00. Mutually exclusive with scheduleCron. Publishing arms the run; draft tests do not consume it.",
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
              inputFields: {
                type: "array",
                maxItems: 32,
                description:
                  "api only: the inputs an integration may supply. Callers can't pass undeclared keys, and inputs reach the agent as data, never as instructions.",
                items: {
                  type: "object",
                  required: ["key", "type"],
                  properties: {
                    key: { ...string, pattern: "^[a-z][a-z0-9_]{0,63}$" },
                    type: { enum: ["string", "integer", "boolean", "json"] },
                    required: boolean,
                    description: string,
                    maxLength: { type: "integer", minimum: 1 },
                    pattern: {
                      ...string,
                      description:
                        "string only; matched against the whole value.",
                    },
                    enum: strings,
                    maxBytes: { type: "integer", minimum: 1 },
                  },
                },
              },
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
                "Optional. Omit or use null to inherit the current Agent/API/MCP default from settings. Set an enabled ID from mogplex_list_models only for an explicit override. CLI harnesses choose their own model.",
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
          node(
            "classify",
            {
              input: {
                ...string,
                description:
                  "Template for the state to judge, e.g. {{previous_outputs}} or {{metadata.title}}.",
              },
              question: {
                ...string,
                description:
                  "One closed question, read literally. Ask one thing, phrased positively.",
              },
              output: {
                oneOf: [
                  {
                    type: "object",
                    properties: { kind: { const: "boolean" } },
                    required: ["kind"],
                  },
                  {
                    type: "object",
                    properties: {
                      kind: { const: "choice" },
                      options: {
                        type: "array",
                        minItems: 2,
                        maxItems: 255,
                        items: {
                          type: "object",
                          properties: {
                            id: string,
                            label: string,
                            description: string,
                          },
                          required: ["id", "label"],
                        },
                      },
                    },
                    required: ["kind", "options"],
                  },
                  {
                    type: "object",
                    properties: {
                      kind: { const: "scale" },
                      levels: {
                        type: "array",
                        minItems: 2,
                        maxItems: 10,
                        items: string,
                        description: "Ordered lowest to highest.",
                      },
                    },
                    required: ["kind", "levels"],
                  },
                ],
              },
              resultKey: {
                ...string,
                description:
                  "Variable name. Later nodes read state.<resultKey>.answer, .confidence, .probabilities.",
              },
              minConfidence: {
                type: ["number", "null"],
                exclusiveMinimum: 0,
                exclusiveMaximum: 1,
                description:
                  "Optional. Answers below it leave through the uncertain handle, which must then be wired.",
              },
            },
            ["input", "question", "output", "resultKey"]
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
              "condition: true or false; classify: true or false (boolean), option:<id> per option (choice), omit for scale, uncertain when minConfidence is set; error recovery: error; otherwise omit.",
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

export const automationSchemaGuide = {
  graphSchema: automationGraphSchema,
  examples: {
    scheduledTask: scheduledTaskExample,
    oneTimeTask: oneTimeTaskExample(scheduledTaskExample),
  },
  instructions: [
    "Discover the repository with mogplex_list_repos. Replace owner/repo and installationIds in the example with its full_name and installation_id.",
    "For Mogplex, use agentId from mogplex_list_agents. preset: IDs work without a separate agent creation call. Leave modelOverride omitted or null to keep the configured Agent/API/MCP default; set an enabled ID only when an override is requested. Defaults resolve at run time; the graph stays unpinned.",
    "Use the requested harness. Do not switch to Claude Code or Codex to avoid choosing a Mogplex agent. CLI harnesses use agentId: null and modelOverride: null.",
    "Task nodes run on a new branch from the default branch. They require a schedule or API trigger and systemPromptOverride.",
    "Edit nodes fix an existing PR and require an upstream review, except on mention and pr_comment triggers. They do not support schedule triggers.",
    "Use a classify node to branch on meaning instead of an agent node: it answers one closed question about run state as true/false, a single choice, or a scale position (1-based), in well under a second. Wire every answer handle. A scale has one outgoing edge; branch on state.<resultKey>.answer with a condition node.",
    "Call mogplex_validate_automation with installationId and graph. It does not save, publish, run a model, or create a sandbox.",
    "Save the draft without publishing. Call mogplex_test_automation with representative input for ANY trigger type, then inspect mogplex_get_automation_run_logs for completion and node errors. Fix failures and retest each changed setup before publishing. Tests execute the saved draft with real billing and configured write actions, without activating triggers or consuming a one-time schedule.",
    "For one-time scheduling, set event: schedule and scheduleRunAt to a future ISO timestamp with explicit timezone offset, and omit scheduleCron. Publish after testing to arm exactly one run. Pausing cancels the pending dispatch; republishing replaces it. The automation becomes inactive after its job is queued. A test does not prove webhook delivery, GitHub routing, or cron delivery.",
    "mogplex_trigger_automation starts a real billed run with the configured write access. There is no dry-run flag. Inspect runs and logs to verify execution.",
    "A prompt to check open PRs is not an atomic duplicate-work lock. Stop overlapping external schedules before handing recurring work to this automation.",
    "Task commands have repository write access. autoMerge: false disables built-in auto-merge, not shell permissions. Use GitHub branch rules to enforce required human review.",
  ],
};
