import { z } from "zod";
import {
  cursorInput,
  cursorQuery,
  defineTriggerTool,
  envKey,
  parseJsonInput,
  readTarget,
  scoped,
  writeTarget,
} from "../define";
import { capJson, capText, summarizeProject, summarizeTask } from "../format";

const BULK_RUN_FILTER_HINT =
  'Run filter as a JSON object string, e.g. {"status":["FAILED"],"taskIdentifier":["sync"],"period":"1d"}';

export const TASK_TOOLS = [
  defineTriggerTool({
    name: "list_projects",
    description:
      "List the Trigger.dev projects this account can access, with the project ref the other tools need.",
    input: z.object({}),
    run: async (client) => {
      const projects = await client.request<unknown[]>({
        auth: { kind: "pat" },
        path: "/api/v1/projects",
      });
      return { projects: projects.map(summarizeProject) };
    },
  }),

  defineTriggerTool({
    name: "get_current_worker",
    description:
      "Show the deployed worker for an environment: its version and every task with its id, file, and payload schema. Call this before trigger_task to learn the task id and payload shape.",
    input: z.object(readTarget),
    run: async (client, input) => {
      const project = encodeURIComponent(input.projectRef);
      const { worker } = await client.requestWithPat<{
        worker?: Record<string, unknown>;
      }>(`/api/v1/projects/${project}/${input.environment}/workers/current`, {
        branch: input.branch,
      });
      if (!worker) return { error: "No worker is deployed here yet" };
      const { tasks, ...rest } = worker;
      return {
        worker: rest,
        tasks: Array.isArray(tasks) ? tasks.map(summarizeTask) : [],
      };
    },
  }),

  defineTriggerTool({
    name: "trigger_task",
    description:
      "Start a run of a task. Returns the run id right away; the run executes in the background, so check it later with get_run_details. The dev environment only executes while someone's dev server is running.",
    input: z.object({
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
      queue: z.string().optional().describe("Queue name to run on"),
      machine: z.string().optional().describe("Machine preset, e.g. small-2x"),
      ttl: z.string().optional().describe("Expire if not started in, e.g. 1h"),
    }),
    run: async (client, input) => {
      const { id } = await client.request<{ id: string }>({
        auth: scoped(input, ["write:tasks"]),
        method: "POST",
        path: `/api/v1/tasks/${encodeURIComponent(input.taskId)}/trigger`,
        body: {
          payload: parseJsonInput(input.payload, "payload", {}),
          options: {
            tags: input.tags,
            delay: input.delay,
            idempotencyKey: input.idempotencyKey,
            queue: input.queue ? { name: input.queue } : undefined,
            machine: input.machine,
            ttl: input.ttl,
          },
        },
      });
      return { runId: id, taskId: input.taskId };
    },
  }),

  defineTriggerTool({
    name: "batch_trigger_tasks",
    description:
      "Start many runs in one call, across one or several tasks. Returns the batch id; follow it with get_batch.",
    input: z.object({
      ...writeTarget,
      items: z
        .string()
        .describe(
          'JSON array string of items, each {"task":"task-id","payload":{...},"options":{...}}. Up to 500 items.'
        ),
    }),
    run: async (client, input) => {
      const items = parseJsonInput(input.items, "items", []);
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error("items must be a non-empty JSON array");
      }
      return {
        batch: capJson(
          await client.request({
            auth: envKey(input),
            method: "POST",
            path: "/api/v2/tasks/batch",
            body: { items },
          })
        ),
      };
    },
  }),

  defineTriggerTool({
    name: "get_batch",
    description: "Get a batch: its status, run count, and when it was created.",
    input: z.object({
      ...readTarget,
      batchId: z.string().describe("Batch id, starts with batch_"),
    }),
    run: async (client, input) => ({
      batch: capJson(
        await client.request({
          auth: envKey(input),
          path: `/api/v2/batches/${encodeURIComponent(input.batchId)}`,
        })
      ),
    }),
  }),

  defineTriggerTool({
    name: "get_batch_results",
    description: "Get the output or error of every run in a finished batch.",
    input: z.object({
      ...readTarget,
      batchId: z.string().describe("Batch id, starts with batch_"),
    }),
    run: async (client, input) => ({
      results: capJson(
        await client.request({
          auth: envKey(input),
          path: `/api/v1/batches/${encodeURIComponent(input.batchId)}/results`,
        })
      ),
    }),
  }),

  defineTriggerTool({
    name: "reset_idempotency_key",
    description:
      "Clear an idempotency key for a task so the next trigger with that key starts a new run instead of returning the old one.",
    input: z.object({
      ...writeTarget,
      taskId: z.string(),
      idempotencyKey: z.string(),
    }),
    run: async (client, input) => ({
      result: await client.request({
        auth: envKey(input),
        method: "POST",
        path: `/api/v1/idempotencyKeys/${encodeURIComponent(input.idempotencyKey)}/reset`,
        body: { taskIdentifier: input.taskId },
      }),
    }),
  }),

  defineTriggerTool({
    name: "create_bulk_action",
    description:
      "Cancel or replay many runs at once, chosen by run ids or by a filter. Give exactly one of runIds or filter. Runs in the background; follow it with get_bulk_action.",
    input: z.object({
      ...writeTarget,
      action: z.enum(["cancel", "replay"]),
      runIds: z.array(z.string()).min(1).optional(),
      filter: z.string().optional().describe(BULK_RUN_FILTER_HINT),
      name: z.string().max(255).optional(),
    }),
    run: async (client, input) => {
      const filter = parseJsonInput(input.filter, "filter", undefined);
      if ((filter ? 1 : 0) + (input.runIds ? 1 : 0) !== 1) {
        throw new Error("Give exactly one of runIds or filter");
      }
      return {
        bulkAction: capJson(
          await client.request({
            auth: envKey(input),
            method: "POST",
            path: "/api/v1/bulk-actions",
            body: {
              action: input.action,
              runIds: input.runIds,
              filter,
              name: input.name,
            },
          })
        ),
      };
    },
  }),

  defineTriggerTool({
    name: "list_bulk_actions",
    description: "List bulk actions in an environment, newest first.",
    input: z.object({ ...readTarget, ...cursorInput }),
    run: async (client, input) => {
      const page = await client.request<{
        data?: unknown[];
        pagination?: { next?: string };
      }>({
        auth: envKey(input),
        path: "/api/v1/bulk-actions",
        query: cursorQuery(input),
      });
      return {
        bulkActions: capJson(page.data ?? []),
        nextCursor: page.pagination?.next ?? null,
      };
    },
  }),

  defineTriggerTool({
    name: "get_bulk_action",
    description:
      "Get a bulk action's progress: how many runs succeeded and failed.",
    input: z.object({ ...readTarget, bulkActionId: z.string() }),
    run: async (client, input) => ({
      bulkAction: capJson(
        await client.request({
          auth: envKey(input),
          path: `/api/v1/bulk-actions/${encodeURIComponent(input.bulkActionId)}`,
        })
      ),
    }),
  }),

  defineTriggerTool({
    name: "abort_bulk_action",
    description:
      "Stop a bulk action that is still working. Runs it already handled stay as they are.",
    input: z.object({ ...writeTarget, bulkActionId: z.string() }),
    run: async (client, input) => ({
      result: await client.request({
        auth: envKey(input),
        method: "POST",
        path: `/api/v1/bulk-actions/${encodeURIComponent(input.bulkActionId)}/abort`,
      }),
    }),
  }),

  defineTriggerTool({
    name: "search_docs",
    description:
      "Search the Trigger.dev documentation. Use it for SDK usage, configuration, and API questions.",
    input: z.object({ query: z.string().min(2) }),
    run: async (client, input) => ({
      results: capText(await client.searchDocs(input.query)),
    }),
  }),
];
