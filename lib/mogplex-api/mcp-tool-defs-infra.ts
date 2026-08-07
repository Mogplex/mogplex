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
      "List repositories available to the authenticated Mogplex API token.",
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
      "List environment variable keys and metadata for the Vercel project linked to a Mogplex repo. Values are never returned.",
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
      "Create or update an environment variable on the Vercel project linked to a Mogplex repo. Omitting target updates the value of every existing entry with the same key; creating defaults to all targets. Passing target when the key has multiple target-specific entries returns CONFLICT — delete the key first. Sandboxes on Vercel-linked env sync pick up changes on restart or resume.",
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
        target: {
          type: "array",
          items: {
            type: "string",
            enum: ["production", "preview", "development"],
          },
          description:
            "Deployment targets. Defaults to all targets on create; unchanged on update when omitted.",
        },
        type: {
          type: "string",
          enum: ["encrypted", "plain", "sensitive"],
          description:
            "Env var type on create. Defaults to encrypted. Ignored on update.",
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
      "Delete every entry of an environment variable key from the Vercel project linked to a Mogplex repo.",
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
      "Create or reuse a Mogplex sandbox for a repository and branch. The call consumes the launch event stream and returns when a sandbox record is ready or launch fails.",
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
