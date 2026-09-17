import type { McpToolDefinition } from "./mcp-types";
import { objectSchema } from "./mcp-schemas";
import { automationGraphSchema } from "./automation-schema";

/**
 * Tool definitions for Mogplex Flow automations.
 */
export const MCP_TOOLS_AUTOMATION: McpToolDefinition[] = [
  {
    name: "mogplex_get_automation_schema",
    title: "Get Automation Schema",
    description:
      "Read graph fields, trigger and role requirements, and a complete scheduled-task recipe. Call this before creating an automation; no source-code access is needed.",
    inputSchema: objectSchema({ properties: {} }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "mogplex_validate_automation",
    title: "Validate Automation",
    description:
      "Check graph structure, trigger and role compatibility, repository scope, agents, and models. Does not save, activate, or execute the automation. This is configuration validation, not a dry run.",
    inputSchema: objectSchema({
      properties: {
        installationId: { type: "integer", minimum: 1 },
        graph: automationGraphSchema,
      },
      required: ["installationId", "graph"],
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "mogplex_list_automations",
    title: "List Mogplex Automations",
    description:
      "List a bounded page of Mogplex Flow automation summaries. Use mogplex_get_automation to read full draft and published graphs.",
    inputSchema: objectSchema({
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Maximum summaries to return. Defaults to 50.",
        },
        cursor: {
          type: "string",
          description:
            "Opaque nextCursor from a previous mogplex_list_automations result.",
        },
      },
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_get_automation",
    title: "Get Mogplex Automation",
    description:
      "Read one automation's editable graph, published graph, status, and run summary.",
    inputSchema: objectSchema({
      properties: {
        automationId: {
          type: "string",
          description: "Automation id returned by mogplex_list_automations.",
        },
      },
      required: ["automationId"],
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_create_automation",
    title: "Create Mogplex Automation",
    description:
      "Create a Mogplex Flow automation. Use installationId from mogplex_list_repos. Optionally provide a complete graph and publish it.",
    inputSchema: objectSchema({
      properties: {
        installationId: {
          type: "integer",
          minimum: 1,
          description: "GitHub installation id from a listed repository.",
        },
        name: { type: "string", description: "Automation name." },
        description: {
          type: ["string", "null"],
          description: "Optional automation description.",
        },
        notes: {
          type: ["string", "null"],
          description: "Optional internal notes.",
        },
        graph: automationGraphSchema,
        publish: {
          type: "boolean",
          description:
            "Validate, publish, and activate immediately. Defaults to false.",
        },
      },
      required: ["installationId"],
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_update_automation",
    title: "Update Mogplex Automation",
    description:
      "Update automation metadata or replace its editable draft graph. Publishing is a separate explicit action.",
    inputSchema: objectSchema({
      properties: {
        automationId: { type: "string", description: "Automation id." },
        name: { type: "string", description: "New automation name." },
        description: {
          type: ["string", "null"],
          description: "New description.",
        },
        notes: { type: ["string", "null"], description: "New notes." },
        installationId: {
          type: "integer",
          minimum: 1,
          description: "Move the automation to another owned installation.",
        },
        graph: automationGraphSchema,
      },
      required: ["automationId"],
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_publish_automation",
    title: "Publish Mogplex Automation",
    description:
      "Validate the draft graph, create a version, and activate the automation.",
    inputSchema: objectSchema({
      properties: {
        automationId: { type: "string", description: "Automation id." },
      },
      required: ["automationId"],
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_set_automation_model",
    title: "Set Automation Model",
    description:
      "Set an agent node's model override, or null to use the configured Agent/API/MCP default at run time. Leave defaults unchanged unless an override is requested. Optionally publish the change.",
    inputSchema: objectSchema({
      properties: {
        automationId: { type: "string", description: "Automation id." },
        nodeId: { type: "string", description: "Agent node id." },
        modelId: {
          type: ["string", "null"],
          description:
            "Model id returned by mogplex_list_models, or null to inherit.",
        },
        publish: {
          type: "boolean",
          description: "Publish and activate the new model immediately.",
        },
      },
      required: ["automationId", "nodeId", "modelId"],
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_trigger_automation",
    title: "Trigger Mogplex Automation",
    description:
      "Trigger an active published automation for an owned repository. Optional input is merged into the run metadata for conditions and prompts.",
    inputSchema: objectSchema({
      properties: {
        automationId: { type: "string", description: "Automation id." },
        repoId: {
          type: "string",
          description: "Repository id within the automation installation.",
        },
        input: {
          type: "object",
          description: "Optional run input metadata.",
          additionalProperties: true,
        },
        idempotencyKey: {
          type: "string",
          maxLength: 200,
          description: "Optional stable caller key; generated when omitted.",
        },
      },
      required: ["automationId", "repoId"],
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_list_automation_runs",
    title: "List Automation Runs",
    description:
      "List recent executions for an automation, including node and dispatch summaries.",
    inputSchema: objectSchema({
      properties: {
        automationId: { type: "string", description: "Automation id." },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Maximum runs to return. Defaults to 20.",
        },
      },
      required: ["automationId"],
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_get_automation_run_logs",
    title: "Get Automation Run Logs",
    description:
      "Read complete automation run diagnostics: node runs, dispatch events, AI calls, AI call events, errors, token usage, and review findings.",
    inputSchema: objectSchema({
      properties: {
        automationId: { type: "string", description: "Automation id." },
        runId: {
          type: "string",
          description: "Job run id from mogplex_list_automation_runs.",
        },
      },
      required: ["automationId", "runId"],
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_cancel_automation_run",
    title: "Cancel Automation Run",
    description:
      "Cancel one Flow automation job run, including its runtime, active AI calls, and pending waits. Use the job run ID from mogplex_list_automation_runs or mogplex_trigger_automation. This does not disable future scheduled runs or undo completed changes.",
    inputSchema: objectSchema({
      properties: {
        automationId: {
          type: "string",
          format: "uuid",
          description: "Automation id.",
        },
        runId: {
          type: "string",
          format: "uuid",
          description:
            "Flow job run id, not a one-off agent run id or Trigger runtime id.",
        },
      },
      required: ["automationId", "runId"],
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "mogplex_rerun_pr_review",
    title: "Rerun Mogplex PR Review",
    description:
      'Queue another Mogplex PR Review run for a pull request. Equivalent to clicking the "Re-run review" button on the Mogplex PR Review GitHub check run.',
    inputSchema: objectSchema({
      properties: {
        repoId: {
          type: "string",
          description: "Repository id from mogplex_list_repos.",
        },
        prNumber: {
          type: "integer",
          minimum: 1,
          description: "Pull request number in the repository.",
        },
      },
      required: ["repoId", "prNumber"],
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
];
