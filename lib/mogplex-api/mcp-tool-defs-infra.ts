import type { McpToolDefinition } from "./mcp-types";
import { emptyObjectSchema, objectSchema } from "./mcp-schemas";

/**
 * Tool definitions for repositories, environment variables, agents, models,
 * and sandboxes.
 */
export const MCP_TOOLS_INFRA: McpToolDefinition[] = [
  {
    name: "mogplex_list_repos",
    title: "List Mogplex Repos",
    description:
      "List repositories available to the authenticated Mogplex API token, including repos removed from the dashboard (hidden: true), which still receive automation runs.",
    inputSchema: objectSchema({
      properties: {
        query: {
          type: "string",
          description:
            "Optional case-insensitive substring filter for repo name.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "Maximum repos to return. Defaults to 100.",
        },
      },
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_list_env_vars",
    title: "List Mogplex Env Vars",
    description:
      "List environment variable keys and metadata saved in a Mogplex repository's sandbox settings. Values are never returned. No Vercel connection is required.",
    inputSchema: objectSchema({
      properties: {
        repoId: {
          type: "string",
          description: "Mogplex repo id returned by mogplex_list_repos.",
        },
      },
      required: ["repoId"],
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_set_env_var",
    title: "Set Mogplex Env Var",
    description:
      "Set one variable in a Mogplex repository's sandbox environment settings. Other keys stay unchanged. No Vercel connection is required. This does not change Vercel deployment variables. New sandbox launches use these settings. Existing processes keep their current environment. Values are never returned.",
    inputSchema: objectSchema({
      properties: {
        repoId: {
          type: "string",
          description: "Mogplex repo id returned by mogplex_list_repos.",
        },
        key: {
          type: "string",
          description:
            "Env var name. Letters, digits, and underscores; must not start with a digit.",
        },
        value: {
          type: "string",
          description: "Env var value.",
        },
      },
      required: ["repoId", "key", "value"],
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_delete_env_var",
    title: "Delete Mogplex Env Var",
    description:
      "Delete one environment variable from a Mogplex repository's sandbox settings, preserving other keys. Does not modify Vercel deployment variables or restart active sandboxes.",
    inputSchema: objectSchema({
      properties: {
        repoId: {
          type: "string",
          description: "Mogplex repo id returned by mogplex_list_repos.",
        },
        key: {
          type: "string",
          description: "Env var name to delete.",
        },
      },
      required: ["repoId", "key"],
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_list_agents",
    title: "List Mogplex Agents",
    description:
      "List user-owned and preset agents that can be bound to automation graph nodes.",
    inputSchema: emptyObjectSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_list_skills",
    title: "List Mogplex Skills",
    description:
      "Search the user's skills: written procedures for recurring work. Returns slug, name, and description. Put $slug in a run or automation prompt to make the agent follow that skill, or read it with mogplex_get_skill.",
    inputSchema: objectSchema({
      properties: {
        query: {
          type: "string",
          description:
            "What the task involves, in a few words. Omit to list every skill.",
        },
        repoId: {
          type: "string",
          description:
            "Optional repo id from mogplex_list_repos. Applies that repo's skill exclusions and adds its own skills.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "Maximum skills to return. Defaults to 50.",
        },
      },
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_get_skill",
    title: "Get Mogplex Skill",
    description:
      "Read one skill's full instructions by slug from mogplex_list_skills.",
    inputSchema: objectSchema({
      properties: {
        slug: {
          type: "string",
          description: "Skill slug, with or without its leading $.",
        },
        repoId: {
          type: "string",
          description:
            "Optional repo id, required to reach a skill the repo defines.",
        },
      },
      required: ["slug"],
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_list_models",
    title: "List Mogplex Models",
    description:
      "List enabled models the authenticated user can run through Mogplex.",
    inputSchema: emptyObjectSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_list_sandboxes",
    title: "List Mogplex Sandboxes",
    description:
      "List active or recent Mogplex sandboxes for the authenticated user.",
    inputSchema: objectSchema({
      properties: {
        repoId: {
          type: "string",
          description: "Optional Mogplex repo id filter.",
        },
        status: {
          type: "string",
          description: "Optional sandbox status filter, for example running.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "Maximum sandboxes to return. Defaults to 100.",
        },
      },
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_create_sandbox",
    title: "Create Mogplex Sandbox",
    description:
      "Create or reuse a Mogplex sandbox for a repository and branch. The call consumes the launch event stream and returns when a sandbox record is ready or launch fails. A Mogplex API key set to Automations only, or any key on a team whose owner holds keys to automations, is refused with AUTOMATION_REQUIRED.",
    inputSchema: objectSchema({
      properties: {
        repoId: {
          type: "string",
          description: "Mogplex repo id returned by mogplex_list_repos.",
        },
        baseBranch: {
          type: "string",
          description: "Base branch. Defaults to the repository default.",
        },
        workingBranch: {
          type: "string",
          description: "Branch to check out or create in the sandbox.",
        },
        createBranch: {
          type: "boolean",
          description: "Create and push workingBranch when true.",
        },
        rootDirectory: {
          type: ["string", "null"],
          description: "Optional monorepo subdirectory, or null for repo root.",
        },
      },
      required: ["repoId"],
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "mogplex_get_sandbox_logs",
    title: "Get Mogplex Sandbox Logs",
    description:
      "Read stored install, dev-server, error, and lifecycle logs for a Mogplex sandbox record.",
    inputSchema: objectSchema({
      properties: {
        sandboxId: {
          type: "string",
          description:
            "Sandbox record id returned as id by mogplex_list_sandboxes or mogplex_create_sandbox.",
        },
      },
      required: ["sandboxId"],
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
];
