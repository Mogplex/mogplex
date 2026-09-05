import type { McpToolDefinition } from "./mcp-types";
import { objectSchema, runIdProperty } from "./mcp-schemas";

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
          description: "Task prompt for the Mogplex agent.",
        },
        harness: {
          type: "string",
          enum: ["mogplex", "codex", "claude-code"],
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
    description: "Request cancellation for an active Mogplex external run.",
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
];
