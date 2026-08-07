import assert from "node:assert/strict";
import type { ToolSet } from "ai";
import type {
  SlackToolExecutionRecord,
  SlackToolExecutionStore,
} from "../../../lib/agents/slack-tool-idempotency";

export const UNCERTAIN_REPLAY_ERROR =
  "This action already failed, was suppressed, or returned an uncertain result during this Slack event. It was not retried automatically.";

export function executionKey(
  input: Pick<
    SlackToolExecutionRecord,
    "scopeKey" | "userId" | "toolName" | "inputHash" | "occurrence"
  >
) {
  return [
    input.scopeKey,
    input.userId,
    input.toolName,
    input.inputHash,
    input.occurrence,
  ].join(":");
}

export function createMemoryStore() {
  const records = new Map<string, SlackToolExecutionRecord>();
  const store: SlackToolExecutionStore = {
    reserve: async (input) => {
      const key = executionKey(input);
      const existing = records.get(key);
      if (existing) return { acquired: false, record: existing };

      const record: SlackToolExecutionRecord = {
        id: `execution-${records.size + 1}`,
        ...input,
        status: "started",
        output: null,
        error: null,
      };
      records.set(key, record);
      return { acquired: true, record };
    },
    complete: async (input) => {
      const record = Array.from(records.values()).find(
        (candidate) => candidate.id === input.executionId
      );
      assert.ok(record);
      record.status = "completed";
      record.output = input.output;
    },
    fail: async (input) => {
      const record = Array.from(records.values()).find(
        (candidate) => candidate.id === input.executionId
      );
      assert.ok(record);
      record.status = "failed";
      record.error = input.error;
    },
  };
  return { store, records };
}

export function executableTool(execute: (input: unknown) => unknown) {
  return {
    description: "test tool",
    inputSchema: {},
    execute,
  };
}

export async function callTool(tools: ToolSet, name: string, input?: unknown) {
  const execute = tools[name]?.execute;
  assert.equal(typeof execute, "function");
  return execute!((input ?? { title: "Fix billing metadata" }) as never, {
    toolCallId: `${name}-call`,
    messages: [],
  });
}

export type SupabaseCall = {
  method: string;
  args: unknown[];
};

export function createSupabaseStoreHarness(
  createStore: typeof import("@/lib/agents/slack-tool-idempotency").createSupabaseSlackToolExecutionStore,
  results: Array<{
    data?: unknown;
    error: { code?: string; message: string } | null;
  }>
) {
  const calls: SupabaseCall[] = [];
  let resultIndex = 0;
  const client = {
    from(...args: unknown[]) {
      calls.push({ method: "from", args });
      const result = results[resultIndex++];
      assert.ok(result, "missing planned Supabase result");
      const query = {
        insert(...methodArgs: unknown[]) {
          calls.push({ method: "insert", args: methodArgs });
          return query;
        },
        select(...methodArgs: unknown[]) {
          calls.push({ method: "select", args: methodArgs });
          return query;
        },
        update(...methodArgs: unknown[]) {
          calls.push({ method: "update", args: methodArgs });
          return query;
        },
        eq(...methodArgs: unknown[]) {
          calls.push({ method: "eq", args: methodArgs });
          return query;
        },
        async single() {
          calls.push({ method: "single", args: [] });
          return result;
        },
        async maybeSingle() {
          calls.push({ method: "maybeSingle", args: [] });
          return result;
        },
        then(
          onfulfilled?: ((value: typeof result) => unknown) | null,
          _onrejected?: ((reason: unknown) => unknown) | null
        ) {
          return Promise.resolve(onfulfilled ? onfulfilled(result) : result);
        },
      };
      return query;
    },
  };
  const store = createStore(async () => client as never);
  return { store, calls };
}

export const storedExecutionRow = {
  id: "execution-existing",
  scope_key: "slack:T1:Ev123",
  user_id: "user-1",
  tool_name: "github_create_issue",
  input_hash: "a".repeat(64),
  occurrence: 1,
  status: "completed" as const,
  output: { issueNumber: 123 },
  error: null,
};
