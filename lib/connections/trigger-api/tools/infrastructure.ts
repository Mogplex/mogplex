import { z } from "zod";
import {
  cursorInput,
  cursorQuery,
  defineTriggerTool,
  envKey,
  pageInput,
  queuePath,
  readTarget,
  scoped,
  writeTarget,
} from "../define";
import { capJson, summarizeDeployment } from "../format";
import type { TriggerEnvironmentTarget } from "../client";

const DEPLOYMENT_STATUSES = [
  "PENDING",
  "BUILDING",
  "DEPLOYING",
  "DEPLOYED",
  "FAILED",
  "CANCELED",
  "TIMED_OUT",
] as const;

const queueInput = {
  queue: z
    .string()
    .describe(
      "Queue id (queue_...) or, with queueType, the task id or custom queue name"
    ),
  queueType: z
    .enum(["id", "task", "custom"])
    .default("id")
    .describe("How `queue` names the queue"),
};

const envVarsPath = (target: TriggerEnvironmentTarget, name?: string) =>
  `/api/v1/projects/${encodeURIComponent(target.projectRef)}/envvars/${target.environment}${
    name === undefined ? "" : `/${encodeURIComponent(name)}`
  }`;

export const QUEUE_TOOLS = [
  defineTriggerTool({
    name: "list_queues",
    description:
      "List queues with how many runs are queued and running, the concurrency limit, and whether each is paused.",
    input: z.object({ ...readTarget, ...pageInput }),
    run: async (client, input) => {
      const page = await client.request<{
        data?: unknown[];
        pagination?: unknown;
      }>({
        auth: envKey(input),
        path: "/api/v1/queues",
        query: { page: input.page, perPage: input.perPage },
      });
      return { queues: capJson(page.data ?? []), pagination: page.pagination };
    },
  }),

  defineTriggerTool({
    name: "get_queue",
    description:
      "Get one queue's depth, running count, concurrency, and paused state.",
    input: z.object({ ...readTarget, ...queueInput }),
    run: async (client, input) => ({
      queue: await client.request({
        auth: envKey(input),
        path: `/api/v1/queues/${queuePath(input.queue)}`,
        query: { type: input.queueType },
      }),
    }),
  }),

  defineTriggerTool({
    name: "pause_queue",
    description:
      "Pause a queue so no new runs start from it; runs already executing continue. Resume it with resume_queue.",
    input: z.object({ ...writeTarget, ...queueInput }),
    run: async (client, input) => ({
      queue: await client.request({
        auth: envKey(input),
        method: "POST",
        path: `/api/v1/queues/${queuePath(input.queue)}/pause`,
        body: { type: input.queueType, action: "pause" },
      }),
    }),
  }),

  defineTriggerTool({
    name: "resume_queue",
    description: "Resume a paused queue.",
    input: z.object({ ...writeTarget, ...queueInput }),
    run: async (client, input) => ({
      queue: await client.request({
        auth: envKey(input),
        method: "POST",
        path: `/api/v1/queues/${queuePath(input.queue)}/pause`,
        body: { type: input.queueType, action: "resume" },
      }),
    }),
  }),

  defineTriggerTool({
    name: "override_queue_concurrency",
    description:
      "Temporarily set a queue's concurrency limit, overriding the value in code until it is reset.",
    input: z.object({
      ...writeTarget,
      ...queueInput,
      concurrencyLimit: z.number().int().min(0),
    }),
    run: async (client, input) => ({
      queue: await client.request({
        auth: envKey(input),
        method: "POST",
        path: `/api/v1/queues/${queuePath(input.queue)}/concurrency/override`,
        body: {
          type: input.queueType,
          concurrencyLimit: input.concurrencyLimit,
        },
      }),
    }),
  }),

  defineTriggerTool({
    name: "reset_queue_concurrency",
    description:
      "Remove a concurrency override so the queue uses the limit from code again.",
    input: z.object({ ...writeTarget, ...queueInput }),
    run: async (client, input) => ({
      queue: await client.request({
        auth: envKey(input),
        method: "POST",
        path: `/api/v1/queues/${queuePath(input.queue)}/concurrency/reset`,
        body: { type: input.queueType },
      }),
    }),
  }),
];

export const ENV_VAR_TOOLS = [
  defineTriggerTool({
    name: "list_env_vars",
    description:
      "List the environment variable names set for an environment and whether each is marked secret. Values are never returned.",
    input: z.object(readTarget),
    run: async (client, input) => {
      const variables = await client.requestWithPat<
        Array<{ name?: string; isSecret?: boolean }>
      >(envVarsPath(input), { branch: input.branch });
      return {
        // Values stay on Trigger.dev: a model transcript is no place for them.
        variables: variables.map(({ name, isSecret }) => ({ name, isSecret })),
      };
    },
  }),

  defineTriggerTool({
    name: "create_env_var",
    description:
      "Create an environment variable. Fails if the name already exists; use update_env_var then.",
    input: z.object({
      ...writeTarget,
      name: z.string(),
      value: z.string(),
      isSecret: z
        .boolean()
        .optional()
        .describe("Secret values are hidden in the Trigger.dev dashboard"),
    }),
    run: async (client, input) => ({
      result: await client.requestWithPat(envVarsPath(input), {
        method: "POST",
        body: {
          name: input.name,
          value: input.value,
          isSecret: input.isSecret,
        },
        branch: input.branch,
      }),
    }),
  }),

  defineTriggerTool({
    name: "update_env_var",
    description: "Change the value of an existing environment variable.",
    input: z.object({ ...writeTarget, name: z.string(), value: z.string() }),
    run: async (client, input) => ({
      result: await client.requestWithPat(envVarsPath(input, input.name), {
        method: "PUT",
        body: { value: input.value },
        branch: input.branch,
      }),
    }),
  }),

  defineTriggerTool({
    name: "delete_env_var",
    description: "Delete an environment variable.",
    input: z.object({ ...writeTarget, name: z.string() }),
    run: async (client, input) => ({
      result: await client.requestWithPat(envVarsPath(input, input.name), {
        method: "DELETE",
        branch: input.branch,
      }),
    }),
  }),

  defineTriggerTool({
    name: "import_env_vars",
    description:
      "Create or update many environment variables in one call. Existing names are left alone unless override is true.",
    input: z.object({
      ...writeTarget,
      variables: z.record(z.string(), z.string()).describe("Name to value map"),
      override: z.boolean().default(false),
      isSecret: z.boolean().optional(),
    }),
    run: async (client, input) => ({
      result: await client.requestWithPat(`${envVarsPath(input)}/import`, {
        method: "POST",
        body: {
          variables: input.variables,
          override: input.override,
          isSecret: input.isSecret,
        },
        branch: input.branch,
      }),
    }),
  }),
];

export const DEPLOYMENT_TOOLS = [
  defineTriggerTool({
    name: "list_deploys",
    description:
      "List deployments for an environment, newest first, with version, status, and git details.",
    input: z.object({
      ...readTarget,
      status: z.enum(DEPLOYMENT_STATUSES).optional(),
      period: z.string().optional().describe("e.g. 1d, 7d"),
      ...cursorInput,
      // The API serves no fewer than 5 per page.
      limit: z.number().int().min(5).max(50).default(10),
    }),
    run: async (client, input) => {
      const page = await client.request<{
        data?: unknown[];
        pagination?: { next?: string };
      }>({
        auth: scoped(input, ["read:deployments"]),
        path: "/api/v1/deployments",
        query: {
          status: input.status,
          period: input.period,
          ...cursorQuery(input),
        },
      });
      return {
        deployments: (page.data ?? []).map(summarizeDeployment),
        nextCursor: page.pagination?.next ?? null,
      };
    },
  }),

  defineTriggerTool({
    name: "get_deployment",
    description:
      "Get one deployment: status, version, the tasks it registered, and its error when it failed.",
    input: z.object({
      ...readTarget,
      deploymentId: z
        .string()
        .describe("Deployment id, starts with deployment_"),
    }),
    run: async (client, input) => ({
      deployment: capJson(
        await client.request({
          auth: envKey(input),
          path: `/api/v1/deployments/${encodeURIComponent(input.deploymentId)}`,
        })
      ),
    }),
  }),

  defineTriggerTool({
    name: "get_current_deployment",
    description:
      "Get the deployment that is serving new runs in an environment right now.",
    input: z.object(readTarget),
    run: async (client, input) => ({
      deployment: capJson(
        await client.request({
          auth: envKey(input),
          path: "/api/v1/deployments/current",
        })
      ),
    }),
  }),

  defineTriggerTool({
    name: "promote_deployment",
    description:
      "Make an already-built deployment version the current one, so new runs use it. Use it to roll back or forward without rebuilding.",
    input: z.object({
      ...writeTarget,
      version: z.string().describe("Deployment version, e.g. 20260921.1"),
    }),
    run: async (client, input) => ({
      result: await client.request({
        auth: envKey(input),
        method: "POST",
        path: `/api/v1/deployments/${encodeURIComponent(input.version)}/promote`,
      }),
    }),
  }),
];
