import { tool } from "ai";
import { z } from "zod";
import { TRIGGER_ENVIRONMENTS, TriggerApiError } from "./client";
import type {
  TriggerApiClient,
  TriggerAuth,
  TriggerEnvironmentTarget,
} from "./client";
import type { Tool } from "ai";

type ToolResult = Record<string, unknown>;

export type TriggerToolSpec = {
  name: string;
  description: string;
  input: z.ZodTypeAny;
  run: (client: TriggerApiClient, input: never) => Promise<ToolResult>;
};

/** Types `run`'s input from the schema, then erases it so specs fit one list. */
export function defineTriggerTool<S extends z.ZodTypeAny>(spec: {
  name: string;
  description: string;
  input: S;
  run: (client: TriggerApiClient, input: z.infer<S>) => Promise<ToolResult>;
}): TriggerToolSpec {
  return spec as TriggerToolSpec;
}

const projectRef = z
  .string()
  .describe("Project ref such as proj_abc123. Use list_projects to find it.");

const branch = z
  .string()
  .optional()
  .describe("Preview branch name. Only used with the preview environment.");

/** Reads default to production, where the runs an agent is asked about live. */
export const readTarget = {
  projectRef,
  environment: z.enum(TRIGGER_ENVIRONMENTS).default("prod"),
  branch,
};

/**
 * Writes name their environment: a default would let a task fire, or a
 * schedule change, in production on an omitted field.
 */
export const writeTarget = {
  projectRef,
  environment: z.enum(TRIGGER_ENVIRONMENTS),
  branch,
};

/** Offset pagination, used by schedules and queues. */
export const pageInput = {
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(1).max(100).default(20),
};

/** Cursor pagination, used by runs, deployments, waitpoints, and sessions. */
export const cursorInput = {
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().optional().describe("nextCursor from a previous call"),
};

export function cursorQuery(input: { limit?: number; cursor?: string }) {
  return { "page[size]": input.limit, "page[after]": input.cursor };
}

export function targetOf(input: TriggerEnvironmentTarget) {
  return {
    projectRef: input.projectRef,
    environment: input.environment,
    branch: input.branch,
  };
}

export function envKey(input: TriggerEnvironmentTarget): TriggerAuth {
  return { kind: "env_key", target: targetOf(input) };
}

export function scoped(
  input: TriggerEnvironmentTarget,
  scopes: string[]
): TriggerAuth {
  return { kind: "jwt", target: targetOf(input), scopes };
}

/** Models pass structured values as JSON strings; every provider accepts that. */
export function parseJsonInput(
  value: string | undefined,
  field: string,
  fallback: unknown
): unknown {
  if (value === undefined || value.trim() === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${field} must be a valid JSON string`);
  }
}

/** Queue routes address a queue by id or by typed name, slashes pre-encoded. */
export function queuePath(queue: string) {
  return encodeURIComponent(queue.replaceAll("/", "%2F"));
}

/** Report API failures to the model as data so it can correct the call. */
async function guarded(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof TriggerApiError) {
      return { error: error.message, status: error.status };
    }
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const defineTool = (def: Record<string, unknown>): Tool =>
  tool(def as unknown as Tool);

export function buildTriggerTools(
  client: TriggerApiClient,
  specs: TriggerToolSpec[]
): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  for (const spec of specs) {
    tools[spec.name] = defineTool({
      description: spec.description,
      inputSchema: spec.input,
      execute: (input: never) => guarded(() => spec.run(client, input)),
    });
  }
  return tools;
}
