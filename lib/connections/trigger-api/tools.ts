import { tool } from "ai";
import { z } from "zod";
import {
  TRIGGER_ENVIRONMENTS,
  TriggerApiError,
  createTriggerApiClient,
} from "./client";
import {
  capJson,
  capText,
  flattenTrace,
  summarizeDeployment,
  summarizeProject,
  summarizeRun,
  summarizeTask,
} from "./format";
import type { Tool } from "ai";

const defineTool = (def: Record<string, unknown>): Tool =>
  tool(def as unknown as Tool);

const projectRef = z
  .string()
  .describe("Project ref such as proj_abc123. Use list_projects to find it.");

const environment = z.enum(TRIGGER_ENVIRONMENTS);

const branch = z
  .string()
  .optional()
  .describe("Preview branch name. Only used with the preview environment.");

const readTarget = {
  projectRef,
  environment: environment.default("prod"),
  branch,
};

// Writes name their environment: a default would let a task fire in
// production on an omitted field.
const writeTarget = { projectRef, environment, branch };

const RUN_STATUSES = [
  "PENDING_VERSION",
  "QUEUED",
  "DEQUEUED",
  "EXECUTING",
  "WAITING",
  "COMPLETED",
  "CANCELED",
  "FAILED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "DELAYED",
  "EXPIRED",
  "TIMED_OUT",
] as const;

const DEPLOYMENT_STATUSES = [
  "PENDING",
  "BUILDING",
  "DEPLOYING",
  "DEPLOYED",
  "FAILED",
  "CANCELED",
  "TIMED_OUT",
] as const;

const workerInput = z.object(readTarget);

const triggerTaskInput = z.object({
  ...writeTarget,
  taskId: z.string().describe("Task id, e.g. send-welcome-email"),
  payload: z
    .string()
    .optional()
    .describe("Task payload as a JSON string. Defaults to {}."),
  tags: z.array(z.string()).max(10).optional(),
  delay: z
    .string()
    .optional()
    .describe("Delay before the run starts, e.g. 30m or an ISO date"),
  idempotencyKey: z.string().optional(),
});

const listRunsInput = z.object({
  ...readTarget,
  status: z.array(z.enum(RUN_STATUSES)).optional(),
  taskIdentifier: z.array(z.string()).optional(),
  tag: z.array(z.string()).optional(),
  version: z.string().optional(),
  period: z.string().optional().describe("e.g. 1h, 1d, 7d"),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().optional().describe("nextCursor from a previous call"),
});

const runDetailsInput = z.object({
  ...readTarget,
  runId: z.string().describe("Run id, starts with run_"),
  maxTraceLines: z.number().int().min(1).max(200).default(60),
});

const cancelRunInput = z.object({
  ...writeTarget,
  runId: z.string().describe("Run id, starts with run_"),
});

const listDeploysInput = z.object({
  ...readTarget,
  status: z.enum(DEPLOYMENT_STATUSES).optional(),
  period: z.string().optional().describe("e.g. 1d, 7d"),
  limit: z.number().int().min(1).max(50).default(10),
  cursor: z.string().optional().describe("nextCursor from a previous call"),
});

const searchDocsInput = z.object({ query: z.string().min(2) });

type ToolResult = Record<string, unknown>;

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

function parsePayload(payload: string | undefined): unknown {
  if (payload === undefined || payload.trim() === "") return {};
  try {
    return JSON.parse(payload);
  } catch {
    throw new Error("payload must be a valid JSON string");
  }
}

/**
 * Trigger.dev tools that run in any turn, backed by the REST API and the saved
 * Personal Access Token. Deploys and the dev server stay with the stdio MCP
 * server because they need the repository on disk.
 */
export function createTriggerApiTools(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Record<string, Tool> {
  const client = createTriggerApiClient(accessToken, fetchImpl);

  return {
    list_projects: defineTool({
      description:
        "List the Trigger.dev projects this account can access, with the project ref the other tools need.",
      inputSchema: z.object({}),
      execute: () =>
        guarded(async () => ({
          projects: (await client.listProjects()).map(summarizeProject),
        })),
    }),

    get_current_worker: defineTool({
      description:
        "Show the deployed worker for an environment: its version and every task with its id, file, and payload schema. Call this before trigger_task to learn the task id and payload shape.",
      inputSchema: workerInput,
      execute: (input: z.infer<typeof workerInput>) =>
        guarded(async () => {
          const { worker } = await client.getCurrentWorker(input);
          if (!worker) return { error: "No worker is deployed here yet" };
          const { tasks, ...rest } = worker;
          return {
            worker: rest,
            tasks: Array.isArray(tasks) ? tasks.map(summarizeTask) : [],
          };
        }),
    }),

    trigger_task: defineTool({
      description:
        "Start a run of a task. Returns the run id right away; the run executes in the background, so check it later with get_run_details. The dev environment only executes while someone's dev server is running.",
      inputSchema: triggerTaskInput,
      execute: (input: z.infer<typeof triggerTaskInput>) =>
        guarded(async () => {
          const { id } = await client.triggerTask(input, input.taskId, {
            payload: parsePayload(input.payload),
            options: {
              tags: input.tags,
              delay: input.delay,
              idempotencyKey: input.idempotencyKey,
            },
          });
          return { runId: id, taskId: input.taskId };
        }),
    }),

    list_runs: defineTool({
      description:
        "List runs in an environment, newest first. Filter by status, task, tag, version, or a period such as 1h or 7d.",
      inputSchema: listRunsInput,
      execute: (input: z.infer<typeof listRunsInput>) =>
        guarded(async () => {
          const page = await client.listRuns(input, input);
          return {
            runs: (page.data ?? []).map(summarizeRun),
            nextCursor: page.pagination?.next ?? null,
          };
        }),
    }),

    get_run_details: defineTool({
      description:
        "Get one run: status, timing, cost, payload, output, error, and its trace of spans and logs. Use this to debug a failed run.",
      inputSchema: runDetailsInput,
      execute: (input: z.infer<typeof runDetailsInput>) =>
        guarded(async () => {
          const { details, trace } = await client.retrieveRunWithTrace(
            input,
            input.runId
          );
          return {
            run: capJson(details),
            trace: flattenTrace(trace?.rootSpan, input.maxTraceLines),
          };
        }),
    }),

    cancel_run: defineTool({
      description:
        "Cancel a run that is queued or executing. Has no effect on a run that already finished.",
      inputSchema: cancelRunInput,
      execute: (input: z.infer<typeof cancelRunInput>) =>
        guarded(async () => ({
          run: summarizeRun(await client.cancelRun(input, input.runId)),
        })),
    }),

    list_deploys: defineTool({
      description:
        "List deployments for an environment, newest first, with version, status, and git details.",
      inputSchema: listDeploysInput,
      execute: (input: z.infer<typeof listDeploysInput>) =>
        guarded(async () => {
          const page = await client.listDeployments(input, input);
          return {
            deployments: (page.data ?? []).map(summarizeDeployment),
            nextCursor: page.pagination?.next ?? null,
          };
        }),
    }),

    search_docs: defineTool({
      description:
        "Search the Trigger.dev documentation. Use it for SDK usage, configuration, and API questions.",
      inputSchema: searchDocsInput,
      execute: (input: z.infer<typeof searchDocsInput>) =>
        guarded(async () => ({
          results: capText(await client.searchDocs(input.query)),
        })),
    }),
  };
}
