import { z } from "zod";
import {
  defineTriggerTool,
  envKey,
  pageInput,
  readTarget,
  writeTarget,
} from "../define";
import { capJson } from "../format";

const scheduleId = z.string().describe("Schedule id, starts with sched_");

const scheduleFields = {
  task: z.string().describe("Id of the scheduled task to attach to"),
  cron: z.string().describe("Five-field cron expression, e.g. 0 9 * * 1"),
  timezone: z
    .string()
    .optional()
    .describe("IANA timezone, e.g. America/New_York. Defaults to UTC."),
  externalId: z
    .string()
    .optional()
    .describe("Your own id, passed to the task on every run"),
};

const schedulePath = (id: string, suffix = "") =>
  `/api/v1/schedules/${encodeURIComponent(id)}${suffix}`;

export const SCHEDULE_TOOLS = [
  defineTriggerTool({
    name: "list_schedules",
    description:
      "List schedules with their task, cron, timezone, whether they are active, and the next run time.",
    input: z.object({ ...readTarget, ...pageInput }),
    run: async (client, input) => {
      const page = await client.request<{
        data?: unknown[];
        pagination?: unknown;
      }>({
        auth: envKey(input),
        path: "/api/v1/schedules",
        query: { page: input.page, perPage: input.perPage },
      });
      return {
        schedules: capJson(page.data ?? []),
        pagination: page.pagination,
      };
    },
  }),

  defineTriggerTool({
    name: "get_schedule",
    description: "Get one schedule.",
    input: z.object({ ...readTarget, scheduleId }),
    run: async (client, input) => ({
      schedule: await client.request({
        auth: envKey(input),
        path: schedulePath(input.scheduleId),
      }),
    }),
  }),

  defineTriggerTool({
    name: "create_schedule",
    description:
      "Create a schedule that runs a scheduled task on a cron. Calling it again with the same deduplicationKey updates that schedule instead of adding another.",
    input: z.object({
      ...writeTarget,
      ...scheduleFields,
      deduplicationKey: z
        .string()
        .describe("Stable key that makes this call safe to repeat"),
    }),
    run: async (client, input) => ({
      schedule: await client.request({
        auth: envKey(input),
        method: "POST",
        path: "/api/v1/schedules",
        body: {
          task: input.task,
          cron: input.cron,
          timezone: input.timezone,
          externalId: input.externalId,
          deduplicationKey: input.deduplicationKey,
        },
      }),
    }),
  }),

  defineTriggerTool({
    name: "update_schedule",
    description:
      "Replace a schedule's task, cron, timezone, and externalId. Only schedules created through the API or dashboard can be changed; ones declared in code cannot.",
    input: z.object({ ...writeTarget, scheduleId, ...scheduleFields }),
    run: async (client, input) => ({
      schedule: await client.request({
        auth: envKey(input),
        method: "PUT",
        path: schedulePath(input.scheduleId),
        body: {
          task: input.task,
          cron: input.cron,
          timezone: input.timezone,
          externalId: input.externalId,
        },
      }),
    }),
  }),

  defineTriggerTool({
    name: "activate_schedule",
    description: "Turn a deactivated schedule back on.",
    input: z.object({ ...writeTarget, scheduleId }),
    run: async (client, input) => ({
      schedule: await client.request({
        auth: envKey(input),
        method: "POST",
        path: schedulePath(input.scheduleId, "/activate"),
      }),
    }),
  }),

  defineTriggerTool({
    name: "deactivate_schedule",
    description:
      "Pause a schedule without deleting it. No runs start until it is activated again.",
    input: z.object({ ...writeTarget, scheduleId }),
    run: async (client, input) => ({
      schedule: await client.request({
        auth: envKey(input),
        method: "POST",
        path: schedulePath(input.scheduleId, "/deactivate"),
      }),
    }),
  }),

  defineTriggerTool({
    name: "delete_schedule",
    description:
      "Delete a schedule permanently. Only schedules created through the API or dashboard can be deleted.",
    input: z.object({ ...writeTarget, scheduleId }),
    run: async (client, input) => ({
      result: await client.request({
        auth: envKey(input),
        method: "DELETE",
        path: schedulePath(input.scheduleId),
      }),
    }),
  }),

  defineTriggerTool({
    name: "list_timezones",
    description: "List the IANA timezone names a schedule accepts.",
    input: z.object(readTarget),
    run: async (client, input) => ({
      ...(await client.request<{ timezones?: string[] }>({
        auth: envKey(input),
        path: "/api/v1/timezones",
      })),
    }),
  }),
];
