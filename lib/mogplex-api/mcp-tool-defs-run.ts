import type { McpToolDefinition } from "./mcp-types";
import { objectSchema, runIdProperty } from "./mcp-schemas";
import { MOGPLEX_API_RUN_HARNESSES, MOGPLEX_API_RUN_MODES } from "./runs-types";

/**
 * Tool definitions for Mogplex external agent runs.
 */
export const MCP_TOOLS_RUN: McpToolDefinition[] = [
  {
    name: "mogplex_start_agent_run",
    title: "Start Mogplex Agent Run",
    description:
      "Start a harness-backed Mogplex agent run in a repository sandbox.",
    inputSchema: objectSchema({
      properties: {
        repoId: {
          type: "string",
          description: "Mogplex repo id returned by mogplex_list_repos.",
        },
        prompt: {
          type: "string",
          description:
            "Task prompt for the Mogplex agent. Write $slug (from mogplex_list_skills) to have the agent follow one of the user's skills.",
        },
        harness: {
          type: "string",
          enum: [...MOGPLEX_API_RUN_HARNESSES],
          description: "Agent harness to run. Defaults to codex.",
        },
        baseBranch: {
          type: "string",
          description: "Base Git branch. Defaults to the repo default branch.",
        },
        workingBranch: {
          type: "string",
          description:
            "Working Git branch. Defaults to the base branch unless createBranch is true.",
        },
        createBranch: {
          type: "boolean",
          description:
            "When true, Mogplex creates or uses a generated branch for the run.",
        },
        rootDirectory: {
          type: ["string", "null"],
          description:
            "Optional repo subdirectory for monorepos. Pass null for repo root.",
        },
        agentId: {
          type: "string",
          description:
            "Roster agent id from mogplex_list_agents, or preset:<NAME>. The run loads that agent's system prompt, rules, and skills.",
        },
        mode: {
          type: "string",
          enum: [...MOGPLEX_API_RUN_MODES],
          description:
            "Codex and Claude Code only. SAFE: the harness does not change the checkout (Claude Code plans, Codex runs read-only), but MCP connection and Mogplex tools stay callable and can change other systems. AUTO (default): edits files and runs commands in the sandbox. YOLO: runs without approval prompts; Claude Code still blocks its deny-listed tools and commands, such as curl, ssh, and reading .env files.",
        },
        idempotencyKey: {
          type: "string",
          maxLength: 200,
          description:
            "Optional stable key from the calling chat app tool call. Generated when omitted.",
        },
      },
      required: ["repoId", "prompt"],
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_get_run",
    title: "Get Mogplex Run",
    description: "Get current status and metadata for a Mogplex external run.",
    inputSchema: objectSchema({
      properties: {
        runId: runIdProperty,
      },
      required: ["runId"],
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_get_run_events",
    title: "Get Mogplex Run Events",
    description:
      "Get recent append-only events for a Mogplex external run, ordered oldest first.",
    inputSchema: objectSchema({
      properties: {
        runId: runIdProperty,
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "Maximum events to return. Defaults to 100.",
        },
      },
      required: ["runId"],
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_cancel_run",
    title: "Cancel Mogplex Run",
    description:
      "Request cancellation for a one-off agent run. For Flow job runs, use mogplex_cancel_automation_run instead.",
    inputSchema: objectSchema({
      properties: {
        runId: runIdProperty,
      },
      required: ["runId"],
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_get_run_artifact",
    title: "Get Mogplex Run Artifact",
    description:
      "Read a committed JSON artifact from a successful Mogplex run. The artifact must be in .mogplex/artifacts/ and the run must have finished successfully on its own branch.",
    inputSchema: objectSchema({
      properties: {
        runId: runIdProperty,
        path: {
          type: "string",
          description:
            "Artifact path relative to the repository root, e.g. .mogplex/artifacts/result.json",
        },
      },
      required: ["runId", "path"],
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
];
