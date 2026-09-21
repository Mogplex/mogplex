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
import { capJson, flattenTrace, summarizeRun } from "../format";

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

const runId = z.string().describe("Run id, starts with run_");

const runFilters = {
  status: z.array(z.enum(RUN_STATUSES)).optional(),
  taskIdentifier: z.array(z.string()).optional(),
  tag: z.array(z.string()).optional(),
  version: z.string().optional(),
  period: z.string().optional().describe("e.g. 1h, 1d, 7d"),
};

type RunFilters = {
  status?: string[];
  taskIdentifier?: string[];
  tag?: string[];
  version?: string;
  period?: string;
};

function runFilterQuery(filters: RunFilters) {
  return {
    "filter[status]": filters.status?.join(","),
    "filter[taskIdentifier]": filters.taskIdentifier?.join(","),
    "filter[tag]": filters.tag?.join(","),
    "filter[version]": filters.version,
    "filter[createdAt][period]": filters.period,
  };
}

const runPath = (id: string, suffix = "") =>
  `/api/v1/runs/${encodeURIComponent(id)}${suffix}`;

export const RUN_TOOLS = [
  defineTriggerTool({
    name: "list_runs",
    description:
      "List runs in an environment, newest first. Filter by status, task, tag, version, or a period such as 1h or 7d.",
    input: z.object({ ...readTarget, ...runFilters, ...cursorInput }),
    run: async (client, input) => {
      const page = await client.request<{
        data?: unknown[];
        pagination?: { next?: string };
      }>({
        auth: scoped(input, ["read:runs"]),
        path: "/api/v1/runs",
        query: { ...runFilterQuery(input), ...cursorQuery(input) },
      });
      return {
        runs: (page.data ?? []).map(summarizeRun),
        nextCursor: page.pagination?.next ?? null,
      };
    },
  }),

  defineTriggerTool({
    name: "get_run_details",
    description:
      "Get one run: status, timing, cost, payload, output, error, and its trace of spans and logs. Use this to debug a failed run.",
    input: z.object({
      ...readTarget,
      runId,
      maxTraceLines: z.number().int().min(1).max(200).default(60),
    }),
    run: async (client, input) => {
      const auth = scoped(input, [`read:runs:${input.runId}`]);
      const [details, trace] = await Promise.all([
        client.request({
          auth,
          path: `/api/v3/runs/${encodeURIComponent(input.runId)}`,
        }),
        client.request<{ trace?: { rootSpan?: unknown } }>({
          auth,
          path: runPath(input.runId, "/trace"),
        }),
      ]);
      return {
        run: capJson(details),
        trace: flattenTrace(trace.trace?.rootSpan, input.maxTraceLines),
      };
    },
  }),

  defineTriggerTool({
    name: "list_run_events",
    description:
      "List a run's raw events: logs and span starts and ends, in order. Use get_run_details first; this is the unabridged record.",
    input: z.object({ ...readTarget, runId }),
    run: async (client, input) => ({
      events: capJson(
        await client.request({
          auth: envKey(input),
          path: runPath(input.runId, "/events"),
        })
      ),
    }),
  }),

  defineTriggerTool({
    name: "cancel_run",
    description:
      "Cancel a run that is queued or executing. Has no effect on a run that already finished.",
    input: z.object({ ...writeTarget, runId }),
    run: async (client, input) => {
      const auth = scoped(input, [
        `write:runs:${input.runId}`,
        `read:runs:${input.runId}`,
      ]);
      const run = encodeURIComponent(input.runId);
      await client.request({
        auth,
        method: "POST",
        path: `/api/v2/runs/${run}/cancel`,
      });
      return {
        run: summarizeRun(
          await client.request({ auth, path: `/api/v3/runs/${run}` })
        ),
      };
    },
  }),

  defineTriggerTool({
    name: "replay_run",
    description:
      "Start a new run with the same payload and options as an existing one. Returns the new run id.",
    input: z.object({ ...writeTarget, runId }),
    run: async (client, input) => {
      const { id } = await client.request<{ id: string }>({
        auth: envKey(input),
        method: "POST",
        path: runPath(input.runId, "/replay"),
      });
      return { runId: id, replayedFrom: input.runId };
    },
  }),

  defineTriggerTool({
    name: "reschedule_run",
    description:
      "Change when a delayed run starts. Only works while the run is still in the DELAYED state.",
    input: z.object({
      ...writeTarget,
      runId,
      delay: z
        .string()
        .describe("New delay, e.g. 30m or 2h, or an ISO date to run at"),
    }),
    run: async (client, input) => ({
      run: summarizeRun(
        await client.request({
          auth: envKey(input),
          method: "POST",
          path: runPath(input.runId, "/reschedule"),
          body: { delay: input.delay },
        })
      ),
    }),
  }),

  defineTriggerTool({
    name: "add_run_tags",
    description:
      "Add tags to a run. A run holds at most 10 tags; existing tags stay.",
    input: z.object({
      ...writeTarget,
      runId,
      tags: z.array(z.string().max(128)).min(1).max(10),
    }),
    run: async (client, input) => ({
      result: await client.request({
        auth: envKey(input),
        method: "POST",
        path: runPath(input.runId, "/tags"),
        body: { tags: input.tags },
      }),
    }),
  }),

  defineTriggerTool({
    name: "update_run_metadata",
    description:
      "Replace a run's metadata with the given JSON object. Metadata is what the task reads and writes through the metadata API.",
    input: z.object({
      ...writeTarget,
      runId,
      metadata: z.string().describe("The new metadata as a JSON object string"),
    }),
    run: async (client, input) => ({
      result: capJson(
        await client.request({
          auth: envKey(input),
          method: "PUT",
          path: runPath(input.runId, "/metadata"),
          body: { metadata: parseJsonInput(input.metadata, "metadata", {}) },
        })
      ),
    }),
  }),
];
