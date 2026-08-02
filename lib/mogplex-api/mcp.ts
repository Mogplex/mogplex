import { randomUUID } from "node:crypto";
import { z } from "zod";
import { flowGraphPayloadSchema } from "@/lib/mogplex-api/automation-request";
import { MogplexApiClientError, type MogplexApiClient } from "./client";

export const MOGPLEX_MCP_PROTOCOL_VERSION = "2025-11-25";
export const MOGPLEX_MCP_SERVER_NAME = "mogplex";
export const MOGPLEX_MCP_SERVER_VERSION = "0.1.0";

type JsonRpcId = number | string | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcResultResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
};

type JsonRpcErrorResponse = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type JsonRpcResponse = JsonRpcErrorResponse | JsonRpcResultResponse;

type McpTextContent = {
  type: "text";
  text: string;
};

type McpToolResult = {
  content: McpTextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint: boolean;
  };
};

type ToolCallParams = {
  name: string;
  arguments?: Record<string, unknown>;
};

export type MogplexMcpClient = Pick<
  MogplexApiClient,
  | "cancelRun"
  | "createAutomation"
  | "createSandbox"
  | "deleteRepoEnvVar"
  | "getAutomation"
  | "getAutomationRunLogs"
  | "getRun"
  | "getRunEvents"
  | "getSandboxLogs"
  | "listAgents"
  | "listAutomationRuns"
  | "listAutomations"
  | "listModels"
  | "listRepoEnvVars"
  | "listRepos"
  | "listSandboxes"
  | "publishAutomation"
  | "setAutomationModel"
  | "startAgentRun"
  | "triggerAutomation"
  | "updateAutomation"
  | "upsertRepoEnvVar"
>;

type MogplexMcpContext = {
  client: MogplexMcpClient;
};

class McpToolArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolArgumentError";
    Object.setPrototypeOf(this, McpToolArgumentError.prototype);
  }
}

const limitSchema = z.number().int().min(1).max(200).optional();

const listReposArgsSchema = z
  .object({
    query: z.string().trim().min(1).optional(),
    limit: limitSchema,
  })
  .strict();

const listSandboxesArgsSchema = z
  .object({
    repoId: z.string().trim().min(1).optional(),
    status: z.string().trim().min(1).optional(),
    limit: limitSchema,
  })
  .strict();

const createSandboxArgsSchema = z
  .object({
    repoId: z.string().trim().min(1),
    baseBranch: z.string().trim().min(1).optional(),
    workingBranch: z.string().trim().min(1).optional(),
    createBranch: z.boolean().optional(),
    rootDirectory: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

const envVarTargetSchema = z.enum(["production", "preview", "development"]);

const repoIdArgsSchema = z
  .object({ repoId: z.string().trim().min(1) })
  .strict();

const setEnvVarArgsSchema = z
  .object({
    repoId: z.string().trim().min(1),
    key: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(
        /^[A-Za-z_]\w*$/,
        "key must contain only letters, digits, and underscores and not start with a digit"
      ),
    value: z.string().max(65_536),
    target: z.array(envVarTargetSchema).min(1).optional(),
    type: z.enum(["encrypted", "plain", "sensitive"]).optional(),
  })
  .strict();

const deleteEnvVarArgsSchema = z
  .object({
    repoId: z.string().trim().min(1),
    key: z.string().trim().min(1).max(256),
  })
  .strict();

const sandboxIdArgsSchema = z
  .object({ sandboxId: z.string().trim().min(1) })
  .strict();

const automationIdArgsSchema = z
  .object({ automationId: z.string().trim().min(1) })
  .strict();

const listAutomationsArgsSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().trim().min(1).optional(),
  })
  .strict();

const createAutomationArgsSchema = z
  .object({
    installationId: z.number().int().positive(),
    name: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    graph: flowGraphPayloadSchema.optional(),
    publish: z.boolean().optional(),
  })
  .strict();

const updateAutomationArgsSchema = z
  .object({
    automationId: z.string().trim().min(1),
    name: z.string().trim().min(1).optional(),
    description: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    installationId: z.number().int().positive().optional(),
    graph: flowGraphPayloadSchema.optional(),
  })
  .strict();

const setAutomationModelArgsSchema = z
  .object({
    automationId: z.string().trim().min(1),
    nodeId: z.string().trim().min(1),
    modelId: z.string().trim().min(1).nullable(),
    publish: z.boolean().optional(),
  })
  .strict();

const triggerAutomationArgsSchema = z
  .object({
    automationId: z.string().trim().min(1),
    repoId: z.string().trim().min(1),
    input: z.record(z.string(), z.unknown()).optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const automationRunsArgsSchema = automationIdArgsSchema.extend({
  limit: z.number().int().min(1).max(50).optional(),
});

const automationRunLogsArgsSchema = automationIdArgsSchema.extend({
  runId: z.string().trim().min(1),
});

const startAgentRunArgsSchema = z
  .object({
    repoId: z.string().trim().min(1),
    prompt: z.string().trim().min(1).max(100_000),
    harness: z.enum(["codex", "claude-code"]).optional(),
    baseBranch: z.string().trim().min(1).optional(),
    workingBranch: z.string().trim().min(1).optional(),
    createBranch: z.boolean().optional(),
    rootDirectory: z.string().trim().min(1).nullable().optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const runIdArgsSchema = z
  .object({
    runId: z.string().trim().min(1),
  })
  .strict();

const runEventsArgsSchema = runIdArgsSchema.extend({
  limit: limitSchema,
});

const emptyObjectSchema = {
  type: "object",
  additionalProperties: false,
} as const;

function objectSchema(input: {
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
}) {
  return {
    type: "object",
    properties: input.properties,
    required: input.required,
    additionalProperties: false,
  };
}

const runIdProperty = {
  type: "string",
  description: "Mogplex external run id returned by mogplex_start_agent_run.",
};

export const MOGPLEX_MCP_TOOLS = [
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
        graph: {
          type: "object",
          description:
            "Optional complete Flow graph with nodes, edges, and viewport.",
          additionalProperties: true,
        },
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
        graph: {
          type: "object",
          description: "Complete replacement draft graph.",
          additionalProperties: true,
        },
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
      "Set an agent node's model override to an enabled Mogplex model, or null to inherit the agent model. Optionally publish the change.",
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
          enum: ["codex", "claude-code"],
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
] satisfies McpToolDefinition[];

export type MogplexMcpToolName = (typeof MOGPLEX_MCP_TOOLS)[number]["name"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResultResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

export function jsonRpcError(
  id: JsonRpcId | undefined,
  code: number,
  message: string,
  data?: unknown
): JsonRpcErrorResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

function getJsonRpcId(value: unknown): JsonRpcId | undefined {
  if (!isRecord(value) || !("id" in value)) return undefined;
  const id = value.id;
  if (typeof id === "string" || typeof id === "number" || id === null) {
    return id;
  }
  return null;
}

function getJsonRpcIdSafely(value: unknown): JsonRpcId | undefined {
  try {
    return getJsonRpcId(value);
  } catch {
    return undefined;
  }
}

function parseJsonRpcRequest(
  value: unknown
): JsonRpcErrorResponse | JsonRpcRequest {
  const id = getJsonRpcId(value);
  if (!isRecord(value)) {
    return jsonRpcError(null, -32600, "Invalid Request");
  }
  if (value.jsonrpc !== "2.0" || typeof value.method !== "string") {
    return jsonRpcError(id ?? null, -32600, "Invalid Request");
  }
  return value as JsonRpcRequest;
}

function parseToolCallParams(params: unknown): ToolCallParams {
  if (!isRecord(params) || typeof params.name !== "string") {
    throw new McpToolArgumentError("tools/call requires params.name");
  }
  if (
    params.arguments !== undefined &&
    params.arguments !== null &&
    !isRecord(params.arguments)
  ) {
    throw new McpToolArgumentError(
      "tools/call params.arguments must be an object"
    );
  }

  return {
    name: params.name,
    arguments: params.arguments ?? {},
  };
}

function parseArgs<T extends z.ZodTypeAny>(
  schema: T,
  args: Record<string, unknown> | undefined
): z.infer<T> {
  const result = schema.safeParse(args ?? {});
  if (result.success) return result.data;

  throw new McpToolArgumentError(
    result.error.issues
      .map(
        (issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`
      )
      .join("; ")
  );
}

function textResult(
  text: string,
  structuredContent?: Record<string, unknown>,
  isError = false
): McpToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structuredContent ? { structuredContent } : {}),
    ...(isError ? { isError: true } : { isError: false }),
  };
}

function getMogplexApiErrorSuggestion(error: MogplexApiClientError) {
  switch (error.code) {
    case "UNAUTHORIZED":
      return "Check the Mogplex API token used for this MCP server.";
    case "NOT_FOUND":
      return "List repos or runs again and pass an id owned by this token.";
    case "IDEMPOTENCY_CONFLICT":
      return "Retry with a new idempotency key or reuse the original request.";
    case "BAD_REQUEST":
      return "Check the tool arguments and retry.";
    case "CONFLICT":
      return "Refresh the run state; it may no longer be active.";
    default:
      return "Retry later or inspect Mogplex API logs for this request.";
  }
}

function errorToolResult(error: unknown): McpToolResult {
  if (error instanceof MogplexApiClientError) {
    const suggestion = getMogplexApiErrorSuggestion(error);
    return textResult(
      `${error.message}. ${suggestion}`,
      {
        error: {
          code: error.code,
          status: error.status,
          message: error.message,
          suggestion,
        },
      },
      true
    );
  }

  const message =
    error instanceof Error ? error.message : "Mogplex MCP tool failed";
  return textResult(
    `${message}. Retry later or inspect Mogplex API logs for this request.`,
    {
      error: {
        code: "INTERNAL_ERROR",
        message,
      },
    },
    true
  );
}

async function callMogplexTool(
  name: string,
  args: Record<string, unknown> | undefined,
  context: MogplexMcpContext
): Promise<McpToolResult> {
  try {
    switch (name) {
      case "mogplex_list_repos": {
        const input = parseArgs(listReposArgsSchema, args);
        const result = await context.client.listRepos(input);
        return textResult(
          `Found ${result.repos.length} Mogplex repos.`,
          result
        );
      }
      case "mogplex_list_env_vars": {
        const input = parseArgs(repoIdArgsSchema, args);
        const result = await context.client.listRepoEnvVars(input);
        return textResult(
          `Found ${result.envVars.length} env vars on the linked Vercel project. Values are not returned.`,
          result
        );
      }
      case "mogplex_set_env_var": {
        const input = parseArgs(setEnvVarArgsSchema, args);
        const result = await context.client.upsertRepoEnvVar(input);
        return textResult(
          result.action === "created"
            ? `Created env var ${result.key} on the linked Vercel project.`
            : `Updated ${result.updatedCount} ${result.key} env var ${result.updatedCount === 1 ? "entry" : "entries"} on the linked Vercel project.`,
          result
        );
      }
      case "mogplex_delete_env_var": {
        const input = parseArgs(deleteEnvVarArgsSchema, args);
        const result = await context.client.deleteRepoEnvVar(input);
        return textResult(
          `Deleted ${result.deletedCount} ${result.key} env var ${result.deletedCount === 1 ? "entry" : "entries"} from the linked Vercel project.`,
          result
        );
      }
      case "mogplex_list_agents": {
        parseArgs(z.object({}).strict(), args);
        const result = await context.client.listAgents();
        return textResult(
          `Found ${result.agents.length} Mogplex agents.`,
          result
        );
      }
      case "mogplex_list_models": {
        parseArgs(z.object({}).strict(), args);
        const result = await context.client.listModels();
        return textResult(
          `Found ${result.models.length} enabled Mogplex models.`,
          result
        );
      }
      case "mogplex_list_sandboxes": {
        const input = parseArgs(listSandboxesArgsSchema, args);
        const result = await context.client.listSandboxes(input);
        return textResult(
          `Found ${result.sandboxes.length} Mogplex sandboxes.`,
          result
        );
      }
      case "mogplex_create_sandbox": {
        const input = parseArgs(createSandboxArgsSchema, args);
        const result = await context.client.createSandbox(input);
        return textResult(
          `Mogplex sandbox ${result.sandbox.id} is ${result.sandbox.status} on branch ${result.sandbox.working_branch}.`,
          result
        );
      }
      case "mogplex_get_sandbox_logs": {
        const input = parseArgs(sandboxIdArgsSchema, args);
        const result = await context.client.getSandboxLogs(input);
        return textResult(
          `Loaded sandbox logs and ${result.lifecycle_events.length} lifecycle events for ${result.sandbox.id}.`,
          result
        );
      }
      case "mogplex_list_automations": {
        const input = parseArgs(listAutomationsArgsSchema, args);
        const result = await context.client.listAutomations(input);
        return textResult(
          `Found ${result.automations.length} Mogplex automation summaries.${result.nextCursor ? " More are available with nextCursor." : ""}`,
          result
        );
      }
      case "mogplex_get_automation": {
        const input = parseArgs(automationIdArgsSchema, args);
        const result = await context.client.getAutomation(input);
        return textResult(
          `Mogplex automation ${result.automation.name} is ${result.automation.status}.`,
          result
        );
      }
      case "mogplex_create_automation": {
        const input = parseArgs(createAutomationArgsSchema, args);
        const result = await context.client.createAutomation(input);
        return textResult(
          `Created Mogplex automation ${result.automation.id} (${result.automation.name}). Status: ${result.automation.status}.`,
          result
        );
      }
      case "mogplex_update_automation": {
        const input = parseArgs(updateAutomationArgsSchema, args);
        const result = await context.client.updateAutomation(input);
        return textResult(
          `Updated draft for Mogplex automation ${result.automation.id}.`,
          result
        );
      }
      case "mogplex_publish_automation": {
        const input = parseArgs(automationIdArgsSchema, args);
        const result = await context.client.publishAutomation(input);
        return textResult(
          `Published and activated Mogplex automation ${result.automation.id}.`,
          result
        );
      }
      case "mogplex_set_automation_model": {
        const input = parseArgs(setAutomationModelArgsSchema, args);
        const result = await context.client.setAutomationModel(input);
        const published = input.publish ? " and published it" : "";
        return textResult(
          `Updated model for node ${input.nodeId} in automation ${result.automation.id}${published}.`,
          result
        );
      }
      case "mogplex_trigger_automation": {
        const input = parseArgs(triggerAutomationArgsSchema, args);
        const result = await context.client.triggerAutomation({
          ...input,
          idempotencyKey: input.idempotencyKey ?? `mcp:${randomUUID()}`,
        });
        return textResult(
          `Automation ${result.run.automationId} trigger outcome: ${result.run.outcome}. Job run: ${result.run.jobRunId ?? "none"}.`,
          result
        );
      }
      case "mogplex_list_automation_runs": {
        const input = parseArgs(automationRunsArgsSchema, args);
        const result = await context.client.listAutomationRuns(input);
        return textResult(
          `Found ${result.runs.length} runs for automation ${input.automationId}.`,
          result
        );
      }
      case "mogplex_get_automation_run_logs": {
        const input = parseArgs(automationRunLogsArgsSchema, args);
        const result = await context.client.getAutomationRunLogs(input);
        return textResult(
          `Loaded logs for automation run ${result.run.id}. Status: ${result.run.status}.`,
          result
        );
      }
      case "mogplex_start_agent_run": {
        const input = parseArgs(startAgentRunArgsSchema, args);
        const result = await context.client.startAgentRun({
          ...input,
          idempotencyKey: input.idempotencyKey ?? `mcp:${randomUUID()}`,
        });
        return textResult(
          `Started Mogplex run ${result.runId} on branch ${result.branch.working}. Status: ${result.status}.`,
          { run: result }
        );
      }
      case "mogplex_get_run": {
        const input = parseArgs(runIdArgsSchema, args);
        const result = await context.client.getRun(input);
        return textResult(
          `Mogplex run ${result.run.runId} is ${result.run.status} on branch ${result.run.branch.working}.`,
          result
        );
      }
      case "mogplex_get_run_events": {
        const input = parseArgs(runEventsArgsSchema, args);
        const result = await context.client.getRunEvents(input);
        const latest = result.events.at(-1);
        const latestLabel = latest?.message ?? latest?.type ?? "none";
        return textResult(
          `Found ${result.events.length} events for Mogplex run ${result.run.runId}. Latest: ${latestLabel}.`,
          result
        );
      }
      case "mogplex_cancel_run": {
        const input = parseArgs(runIdArgsSchema, args);
        const result = await context.client.cancelRun(input);
        return textResult(
          `Cancellation requested for Mogplex run ${result.run.runId}. Status: ${result.status}.`,
          result
        );
      }
      default:
        throw new McpToolArgumentError(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpToolArgumentError) throw error;
    return errorToolResult(error);
  }
}

function initializeResult() {
  return {
    protocolVersion: MOGPLEX_MCP_PROTOCOL_VERSION,
    capabilities: {
      tools: {
        listChanged: false,
      },
    },
    serverInfo: {
      name: MOGPLEX_MCP_SERVER_NAME,
      version: MOGPLEX_MCP_SERVER_VERSION,
    },
    instructions:
      "Use Mogplex tools to discover repos, agents, and models; manage env vars on a repo's linked Vercel project; build, publish, trigger, and inspect automations; create sandboxes and read their logs; or start and control one-off repo-bound agent runs.",
  };
}

export async function handleMogplexMcpMessage(
  payload: unknown,
  context: MogplexMcpContext
): Promise<JsonRpcResponse | null> {
  const parsed = parseJsonRpcRequest(payload);
  if ("error" in parsed) return parsed;
  if (!("id" in parsed)) return null;

  switch (parsed.method) {
    case "initialize":
      return jsonRpcResult(parsed.id ?? null, initializeResult());
    case "ping":
      return jsonRpcResult(parsed.id ?? null, {});
    case "tools/list":
      return jsonRpcResult(parsed.id ?? null, {
        tools: MOGPLEX_MCP_TOOLS,
      });
    case "tools/call": {
      try {
        const params = parseToolCallParams(parsed.params);
        const result = await callMogplexTool(
          params.name,
          params.arguments,
          context
        );
        return jsonRpcResult(parsed.id ?? null, result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid tool arguments";
        return jsonRpcError(parsed.id ?? null, -32602, message);
      }
    }
    default:
      return jsonRpcError(
        parsed.id ?? null,
        -32601,
        `Method not found: ${parsed.method}`
      );
  }
}

async function handleMogplexMcpMessageSafely(
  payload: unknown,
  context: MogplexMcpContext
) {
  try {
    return await handleMogplexMcpMessage(payload, context);
  } catch (error) {
    console.error("[mogplex-mcp] unexpected message failure", { error });
    return jsonRpcError(
      getJsonRpcIdSafely(payload) ?? null,
      -32603,
      "Mogplex MCP request failed",
      {
        code: "INTERNAL_ERROR",
      }
    );
  }
}

export async function handleMogplexMcpPayload(
  payload: unknown,
  context: MogplexMcpContext
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (!Array.isArray(payload)) {
    // The API route authenticates once before dispatch. Keep the wrapper here
    // only to convert per-message parser/tool crashes into JSON-RPC errors.
    return handleMogplexMcpMessageSafely(payload, context);
  }
  if (payload.length === 0) {
    return jsonRpcError(null, -32600, "Invalid Request");
  }

  // The hosted route authenticates the bearer token once before dispatching
  // the batch. Keep auth at that boundary so individual messages cannot
  // partially succeed under different credentials.
  const responses = (
    await Promise.all(
      payload.map((message) => handleMogplexMcpMessageSafely(message, context))
    )
  ).filter(isJsonRpcResponse);

  return responses.length > 0 ? responses : null;
}

export const MOGPLEX_MCP_EMPTY_OBJECT_SCHEMA = emptyObjectSchema;

function isJsonRpcResponse(
  message: JsonRpcResponse | null
): message is JsonRpcResponse {
  return message !== null;
}
