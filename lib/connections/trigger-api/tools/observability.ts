import { z } from "zod";
import {
  cursorInput,
  cursorQuery,
  defineTriggerTool,
  envKey,
  parseJsonInput,
  readTarget,
  writeTarget,
} from "../define";
import { capJson } from "../format";

type CursorPage = { data?: unknown[]; pagination?: { next?: string } };

const errorId = z.string().describe("Error id from list_errors");

const errorPath = (id: string, suffix = "") =>
  `/api/v1/errors/${encodeURIComponent(id)}${suffix}`;

const waitpointPath = (id: string, suffix = "") =>
  `/api/v1/waitpoints/tokens/${encodeURIComponent(id)}${suffix}`;

const sessionPath = (id: string, suffix = "") =>
  `/api/v1/sessions/${encodeURIComponent(id)}${suffix}`;

function errorStatusTool(action: "resolve" | "ignore" | "unresolve") {
  const descriptions = {
    resolve:
      "Mark an error group as resolved. It reopens if the error happens again.",
    ignore: "Ignore an error group so it stops counting as unresolved.",
    unresolve: "Reopen an error group that was resolved or ignored.",
  };
  return defineTriggerTool({
    name: `${action}_error`,
    description: descriptions[action],
    input: z.object({ ...writeTarget, errorId }),
    run: async (client, input) => ({
      error: capJson(
        await client.request({
          auth: envKey(input),
          method: "POST",
          path: errorPath(input.errorId, `/${action}`),
        })
      ),
    }),
  });
}

export const ERROR_TOOLS = [
  defineTriggerTool({
    name: "list_errors",
    description:
      "List error groups: runs that failed the same way, grouped, with counts and first and last seen. Start here when asked what is failing.",
    input: z.object({
      ...readTarget,
      status: z.array(z.enum(["unresolved", "resolved", "ignored"])).optional(),
      taskIdentifier: z.array(z.string()).optional(),
      version: z.array(z.string()).optional(),
      search: z.string().max(1000).optional(),
      period: z.string().optional().describe("e.g. 1d, 7d"),
      ...cursorInput,
    }),
    run: async (client, input) => {
      const page = await client.request<CursorPage>({
        auth: envKey(input),
        path: "/api/v1/errors",
        query: {
          "filter[status]": input.status?.join(","),
          "filter[taskIdentifier]": input.taskIdentifier?.join(","),
          "filter[version]": input.version?.join(","),
          "filter[search]": input.search,
          "filter[period]": input.period,
          ...cursorQuery(input),
        },
      });
      return {
        errors: capJson(page.data ?? []),
        nextCursor: page.pagination?.next ?? null,
      };
    },
  }),

  defineTriggerTool({
    name: "get_error",
    description:
      "Get one error group with its message, stack trace, and affected runs.",
    input: z.object({ ...readTarget, errorId }),
    run: async (client, input) => ({
      error: capJson(
        await client.request({
          auth: envKey(input),
          path: errorPath(input.errorId),
        })
      ),
    }),
  }),

  errorStatusTool("resolve"),
  errorStatusTool("ignore"),
  errorStatusTool("unresolve"),
];

export const QUERY_TOOLS = [
  defineTriggerTool({
    name: "get_query_schema",
    description:
      "List the tables and columns the query tool can read. Call this before writing a query.",
    input: z.object(readTarget),
    run: async (client, input) => ({
      schema: capJson(
        await client.request({
          auth: envKey(input),
          path: "/api/v1/query/schema",
        }),
        12_000
      ),
    }),
  }),

  defineTriggerTool({
    name: "query",
    description:
      "Run a TRQL (SQL-like) query over runs and metrics, e.g. SELECT task_identifier, count() FROM runs GROUP BY task_identifier. Read-only. Use get_query_schema for table and column names.",
    input: z.object({
      ...readTarget,
      query: z.string(),
      scope: z
        .enum(["environment", "project", "organization"])
        .default("environment"),
      period: z
        .string()
        .optional()
        .describe("e.g. 1d, 7d. Ignored when from/to are set."),
      from: z.string().optional().describe("ISO date"),
      to: z.string().optional().describe("ISO date"),
    }),
    run: async (client, input) => ({
      result: capJson(
        await client.request({
          auth: envKey(input),
          method: "POST",
          path: "/api/v1/query",
          body: {
            query: input.query,
            scope: input.scope,
            period: input.period,
            from: input.from,
            to: input.to,
            format: "json",
          },
        }),
        12_000
      ),
    }),
  }),

  defineTriggerTool({
    name: "list_dashboards",
    description:
      "List the built-in dashboards and the queries behind their widgets.",
    input: z.object(readTarget),
    run: async (client, input) => ({
      dashboards: capJson(
        await client.request({
          auth: envKey(input),
          path: "/api/v1/query/dashboards",
        }),
        12_000
      ),
    }),
  }),
];

export const WAITPOINT_TOOLS = [
  defineTriggerTool({
    name: "list_waitpoint_tokens",
    description:
      "List waitpoint tokens: the handles a run waits on until something outside completes them.",
    input: z.object({
      ...readTarget,
      status: z.array(z.enum(["WAITING", "COMPLETED", "TIMED_OUT"])).optional(),
      tags: z.array(z.string()).optional(),
      idempotencyKey: z.string().optional(),
      period: z.string().optional().describe("e.g. 1d, 7d"),
      ...cursorInput,
    }),
    run: async (client, input) => {
      const page = await client.request<CursorPage>({
        auth: envKey(input),
        path: "/api/v1/waitpoints/tokens",
        query: {
          "filter[status]": input.status?.join(","),
          "filter[tags]": input.tags?.join(","),
          "filter[idempotencyKey]": input.idempotencyKey,
          "filter[createdAt][period]": input.period,
          ...cursorQuery(input),
        },
      });
      return {
        tokens: capJson(page.data ?? []),
        nextCursor: page.pagination?.next ?? null,
      };
    },
  }),

  defineTriggerTool({
    name: "get_waitpoint_token",
    description:
      "Get one waitpoint token, including its output once completed.",
    input: z.object({
      ...readTarget,
      tokenId: z.string().describe("Token id, starts with waitpoint_"),
    }),
    run: async (client, input) => ({
      token: capJson(
        await client.request({
          auth: envKey(input),
          path: waitpointPath(input.tokenId),
        })
      ),
    }),
  }),

  defineTriggerTool({
    name: "create_waitpoint_token",
    description:
      "Create a waitpoint token a run can wait on. Whoever holds the id can complete it later.",
    input: z.object({
      ...writeTarget,
      timeout: z.string().optional().describe("e.g. 30s, 1h, 3d"),
      tags: z.array(z.string().max(128)).max(10).optional(),
      idempotencyKey: z.string().optional(),
      idempotencyKeyTTL: z.string().optional(),
    }),
    run: async (client, input) => ({
      token: await client.request({
        auth: envKey(input),
        method: "POST",
        path: "/api/v1/waitpoints/tokens",
        body: {
          timeout: input.timeout,
          tags: input.tags,
          idempotencyKey: input.idempotencyKey,
          idempotencyKeyTTL: input.idempotencyKeyTTL,
        },
      }),
    }),
  }),

  defineTriggerTool({
    name: "complete_waitpoint_token",
    description:
      "Complete a waitpoint token, which resumes the run waiting on it. `data` becomes the value the run receives.",
    input: z.object({
      ...writeTarget,
      tokenId: z.string().describe("Token id, starts with waitpoint_"),
      data: z.string().optional().describe("Result as a JSON string"),
    }),
    run: async (client, input) => ({
      result: await client.request({
        auth: envKey(input),
        method: "POST",
        path: waitpointPath(input.tokenId, "/complete"),
        body: { data: parseJsonInput(input.data, "data", null) },
      }),
    }),
  }),
];

export const SESSION_TOOLS = [
  defineTriggerTool({
    name: "list_sessions",
    description:
      "List sessions: long-lived conversations, such as chat agents, that trigger runs of one task.",
    input: z.object({
      ...readTarget,
      type: z.array(z.string()).optional(),
      status: z.array(z.string()).optional(),
      taskIdentifier: z.array(z.string()).optional(),
      tag: z.array(z.string()).optional(),
      externalId: z.string().optional(),
      period: z.string().optional().describe("e.g. 1d, 7d"),
      ...cursorInput,
    }),
    run: async (client, input) => {
      const page = await client.request<CursorPage>({
        auth: envKey(input),
        path: "/api/v1/sessions",
        query: {
          "filter[type]": input.type?.join(","),
          "filter[status]": input.status?.join(","),
          "filter[taskIdentifier]": input.taskIdentifier?.join(","),
          "filter[tags]": input.tag?.join(","),
          "filter[externalId]": input.externalId,
          "filter[createdAt][period]": input.period,
          ...cursorQuery(input),
        },
      });
      return {
        sessions: capJson(page.data ?? []),
        nextCursor: page.pagination?.next ?? null,
      };
    },
  }),

  defineTriggerTool({
    name: "get_session",
    description: "Get one session by its id or your externalId.",
    input: z.object({ ...readTarget, sessionId: z.string() }),
    run: async (client, input) => ({
      session: capJson(
        await client.request({
          auth: envKey(input),
          path: sessionPath(input.sessionId),
        })
      ),
    }),
  }),

  defineTriggerTool({
    name: "create_session",
    description:
      "Create a session bound to a task. Reusing an externalId returns the existing session.",
    input: z.object({
      ...writeTarget,
      type: z
        .string()
        .min(1)
        .max(64)
        .describe('Kind of session, e.g. "chat.agent"'),
      taskIdentifier: z.string().describe("Task the session triggers runs of"),
      triggerConfig: z
        .string()
        .describe(
          "Trigger config for the session's runs, as a JSON object string"
        ),
      externalId: z.string().optional(),
      tags: z.array(z.string().max(128)).max(10).optional(),
      metadata: z.string().optional().describe("JSON object string"),
    }),
    run: async (client, input) => ({
      session: capJson(
        await client.request({
          auth: envKey(input),
          method: "POST",
          path: "/api/v1/sessions",
          body: {
            type: input.type,
            taskIdentifier: input.taskIdentifier,
            triggerConfig: parseJsonInput(
              input.triggerConfig,
              "triggerConfig",
              {}
            ),
            externalId: input.externalId,
            tags: input.tags,
            metadata: parseJsonInput(input.metadata, "metadata", undefined),
          },
        })
      ),
    }),
  }),

  defineTriggerTool({
    name: "update_session",
    description: "Change a session's tags, metadata, or externalId.",
    input: z.object({
      ...writeTarget,
      sessionId: z.string(),
      tags: z.array(z.string().max(128)).max(10).optional(),
      metadata: z.string().optional().describe("JSON object string"),
      externalId: z.string().optional(),
    }),
    run: async (client, input) => ({
      session: capJson(
        await client.request({
          auth: envKey(input),
          method: "PATCH",
          path: sessionPath(input.sessionId),
          body: {
            tags: input.tags,
            metadata: parseJsonInput(input.metadata, "metadata", undefined),
            externalId: input.externalId,
          },
        })
      ),
    }),
  }),

  defineTriggerTool({
    name: "close_session",
    description:
      "Close a session so it accepts no more input. This cannot be undone.",
    input: z.object({
      ...writeTarget,
      sessionId: z.string(),
      reason: z.string().max(256).optional(),
    }),
    run: async (client, input) => ({
      session: capJson(
        await client.request({
          auth: envKey(input),
          method: "POST",
          path: sessionPath(input.sessionId, "/close"),
          body: { reason: input.reason },
        })
      ),
    }),
  }),
];
