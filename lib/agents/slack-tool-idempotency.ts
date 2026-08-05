import { createHash } from "node:crypto";
import type { ToolSet } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeTelemetryValue } from "@/lib/ai-telemetry";

export type SlackToolExecutionStatus = "started" | "completed" | "failed";

export type SlackToolExecutionRecord = {
  id: string;
  scopeKey: string;
  userId: string;
  toolName: string;
  inputHash: string;
  occurrence: number;
  status: SlackToolExecutionStatus;
  output: SlackToolExecutionJson | null;
  error: string | null;
};

type SlackToolExecutionIdentity = Pick<
  SlackToolExecutionRecord,
  "scopeKey" | "userId" | "toolName" | "inputHash" | "occurrence"
>;

export type SlackToolExecutionStore = {
  reserve: (
    input: SlackToolExecutionIdentity
  ) => Promise<{ acquired: boolean; record: SlackToolExecutionRecord }>;
  complete: (input: {
    executionId: string;
    output: SlackToolExecutionJson;
  }) => Promise<void>;
  fail: (input: { executionId: string; error: string }) => Promise<void>;
};

type SlackToolExecutionRow = {
  id: string;
  scope_key: string;
  user_id: string;
  tool_name: string;
  input_hash: string;
  occurrence: number;
  status: SlackToolExecutionStatus;
  output: SlackToolExecutionJson | null;
  error: string | null;
};

export type SlackToolExecutionJson =
  | string
  | number
  | boolean
  | null
  | { [key: string]: SlackToolExecutionJson | undefined }
  | SlackToolExecutionJson[];

export type SlackToolExecutionDatabase = {
  public: {
    Tables: {
      slack_tool_executions: {
        Row: SlackToolExecutionRow & {
          started_at: string;
          completed_at: string | null;
          output: SlackToolExecutionJson | null;
        };
        Insert: {
          id?: string;
          scope_key: string;
          user_id: string;
          tool_name: string;
          input_hash: string;
          occurrence: number;
          status?: SlackToolExecutionStatus;
          output?: SlackToolExecutionJson | null;
          error?: string | null;
          started_at?: string;
          completed_at?: string | null;
        };
        Update: {
          status?: SlackToolExecutionStatus;
          output?: SlackToolExecutionJson | null;
          error?: string | null;
          completed_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};

type SlackToolIdempotencyContext = {
  scopeKey: string;
  userId: string;
  mcpToolNames: ReadonlySet<string>;
  restToolNames: ReadonlySet<string>;
};

type SlackToolIdempotencyOptions = {
  store?: SlackToolExecutionStore;
};

export const MAX_SLACK_TOOL_EXECUTION_OUTPUT_BYTES = 64 * 1024;
export const MAX_SLACK_TOOL_EXECUTION_ERROR_CHARS = 4_096;

export const SLACK_STATIC_READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  "browse_skills",
  "browse_vercel_docs",
  "github_pr_search",
  "list_files",
  "list_memories",
  "read_file",
  "search_memories",
  "web_fetch",
  "web_search",
]);

export const SLACK_STATIC_MUTATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  "add_memory",
  "bash",
  "github_create_issue",
  "github_create_pull_request",
  "start_sandbox",
  "stop_sandbox",
  "virtual_exec",
  "write_file",
]);

export const SLACK_STATIC_METHOD_CLASSIFIED_TOOL_NAMES: ReadonlySet<string> =
  new Set(["github_api"]);

class SlackToolOutputReplayLimitError extends Error {
  constructor(
    readonly outputBytes: number,
    readonly limitBytes: number
  ) {
    super(
      `Slack tool output is ${outputBytes} bytes, exceeding the ${limitBytes}-byte replay limit`
    );
    this.name = "SlackToolOutputReplayLimitError";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

function hashToolInput(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(input)) ?? "null")
    .digest("hex");
}

function normalizeSlackToolExecutionOutput(
  output: unknown
): SlackToolExecutionJson {
  const serialized: unknown = JSON.stringify(output);
  if (typeof serialized !== "string") return null;
  const outputBytes = Buffer.byteLength(serialized, "utf8");
  if (outputBytes > MAX_SLACK_TOOL_EXECUTION_OUTPUT_BYTES) {
    throw new SlackToolOutputReplayLimitError(
      outputBytes,
      MAX_SLACK_TOOL_EXECUTION_OUTPUT_BYTES
    );
  }
  // Preserve legitimate result fields on both first execution and replay.
  // Access control, the size cap, and bounded retention protect stored output;
  // telemetry key redaction would corrupt fields such as client_secret.
  return JSON.parse(serialized) as SlackToolExecutionJson;
}

function truncateSlackToolExecutionError(error: string) {
  const sanitized = sanitizeTelemetryValue(error, {
    maxStringLength: MAX_SLACK_TOOL_EXECUTION_ERROR_CHARS,
  });
  return (
    typeof sanitized === "string" ? sanitized : "Tool execution failed"
  ).slice(0, MAX_SLACK_TOOL_EXECUTION_ERROR_CHARS);
}

function shouldProtectHttpMethodExecution(input: unknown): boolean {
  const method =
    input && typeof input === "object" && "method" in input
      ? String(input.method).toUpperCase()
      : "";
  return method !== "GET" && method !== "HEAD";
}

function shouldProtectToolExecution(
  toolName: string,
  input: unknown,
  context: Pick<SlackToolIdempotencyContext, "mcpToolNames" | "restToolNames">
): boolean {
  // MCP read-only annotations are not currently threaded into this context.
  // Protect every MCP tool by default so an unannotated write cannot escape.
  if (context.mcpToolNames.has(toolName)) return true;
  if (SLACK_STATIC_METHOD_CLASSIFIED_TOOL_NAMES.has(toolName)) {
    return shouldProtectHttpMethodExecution(input);
  }
  if (!context.restToolNames.has(toolName)) {
    if (SLACK_STATIC_READ_ONLY_TOOL_NAMES.has(toolName)) return false;
    if (SLACK_STATIC_MUTATION_TOOL_NAMES.has(toolName)) return true;
    // Known mutations are listed explicitly for auditability; unknown static
    // tools also fail closed so new writes cannot bypass the ledger.
    return true;
  }

  return shouldProtectHttpMethodExecution(input);
}

function fromRow(row: SlackToolExecutionRow): SlackToolExecutionRecord {
  return {
    id: row.id,
    scopeKey: row.scope_key,
    userId: row.user_id,
    toolName: row.tool_name,
    inputHash: row.input_hash,
    occurrence: row.occurrence,
    status: row.status,
    output: row.output,
    error: row.error,
  };
}

type SlackToolExecutionClient = Pick<
  SupabaseClient<SlackToolExecutionDatabase>,
  "from"
>;

async function getSupabaseAdmin(): Promise<SlackToolExecutionClient> {
  return (await import("@/lib/supabase/admin"))
    .supabaseAdmin as unknown as SlackToolExecutionClient;
}

export function createSupabaseSlackToolExecutionStore(
  loadClient: () => Promise<SlackToolExecutionClient> = getSupabaseAdmin
): SlackToolExecutionStore {
  return {
    async reserve(input) {
      const supabaseAdmin = await loadClient();
      const row: SlackToolExecutionDatabase["public"]["Tables"]["slack_tool_executions"]["Insert"] =
        {
          scope_key: input.scopeKey,
          user_id: input.userId,
          tool_name: input.toolName,
          input_hash: input.inputHash,
          occurrence: input.occurrence,
          status: "started",
        };
      const { data, error } = await supabaseAdmin
        .from("slack_tool_executions")
        .insert(row)
        .select(
          "id, scope_key, user_id, tool_name, input_hash, occurrence, status, output, error"
        )
        .single();

      if (!error) {
        return {
          acquired: true,
          record: fromRow(data as SlackToolExecutionRow),
        };
      }
      if (error.code !== "23505") {
        throw new Error(
          `Failed to reserve Slack tool execution: ${error.message}`
        );
      }

      const { data: existing, error: loadError } = await supabaseAdmin
        .from("slack_tool_executions")
        .select(
          "id, scope_key, user_id, tool_name, input_hash, occurrence, status, output, error"
        )
        .eq("scope_key", input.scopeKey)
        .eq("user_id", input.userId)
        .eq("tool_name", input.toolName)
        .eq("input_hash", input.inputHash)
        .eq("occurrence", input.occurrence)
        .single();
      if (loadError) {
        throw new Error(
          `Failed to load reserved Slack tool execution: ${loadError.message}`
        );
      }
      return {
        acquired: false,
        record: fromRow(existing as SlackToolExecutionRow),
      };
    },

    async complete(input) {
      const supabaseAdmin = await loadClient();
      const { data, error } = await supabaseAdmin
        .from("slack_tool_executions")
        .update({
          status: "completed",
          output: input.output,
          error: null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", input.executionId)
        .eq("status", "started")
        .select("id")
        .maybeSingle();
      if (error) {
        throw new Error(
          `Failed to complete Slack tool execution: ${error.message}`
        );
      }
      if (!data) {
        throw new Error(
          `Failed to complete Slack tool execution: no started execution found for ${input.executionId}`
        );
      }
    },

    async fail(input) {
      const supabaseAdmin = await loadClient();
      const { data, error } = await supabaseAdmin
        .from("slack_tool_executions")
        .update({
          status: "failed",
          error: truncateSlackToolExecutionError(input.error),
          completed_at: new Date().toISOString(),
        })
        .eq("id", input.executionId)
        .eq("status", "started")
        .select("id")
        .maybeSingle();
      if (error) {
        throw new Error(
          `Failed to fail Slack tool execution: ${error.message}`
        );
      }
      if (!data) {
        throw new Error(
          `Failed to fail Slack tool execution: no started execution found for ${input.executionId}`
        );
      }
    },
  };
}

const supabaseSlackToolExecutionStore = createSupabaseSlackToolExecutionStore();

function replayUncertainExecution() {
  return {
    ok: false,
    deduplicated: true,
    error:
      "This action already failed, was suppressed, or returned an uncertain result during this Slack event. It was not retried automatically.",
  };
}

async function runWithSlackToolReservationLock<T>(input: {
  locks: Map<string, Promise<void>>;
  counterKey: string;
  operation: () => Promise<T>;
}): Promise<T> {
  const previous = input.locks.get(input.counterKey) ?? Promise.resolve();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  input.locks.set(input.counterKey, tail);

  await previous;
  try {
    return await input.operation();
  } finally {
    release();
    if (input.locks.get(input.counterKey) === tail) {
      input.locks.delete(input.counterKey);
    }
  }
}

async function persistFailedSlackToolExecution(input: {
  store: SlackToolExecutionStore;
  record: SlackToolExecutionRecord;
  toolName: string;
  error: string;
}) {
  try {
    await input.store.fail({
      executionId: input.record.id,
      error: input.error,
    });
  } catch (persistError) {
    console.error(
      "[slack-tool-idempotency] failed to persist failed execution",
      {
        executionId: input.record.id,
        toolName: input.toolName,
        error: persistError,
      }
    );
  }
}

async function persistCompletedSlackToolExecution(input: {
  store: SlackToolExecutionStore;
  executionId: string;
  toolName: string;
  output: unknown;
}): Promise<unknown> {
  let replayableOutput: SlackToolExecutionJson;
  try {
    replayableOutput = normalizeSlackToolExecutionOutput(input.output);
  } catch (error) {
    const outputLimit =
      error instanceof SlackToolOutputReplayLimitError
        ? {
            reason: "output_too_large",
            outputBytes: error.outputBytes,
            limitBytes: error.limitBytes,
          }
        : { reason: "output_not_json_serializable" };
    console.error(
      "[slack-tool-idempotency] output cannot be durably replayed",
      {
        executionId: input.executionId,
        toolName: input.toolName,
        ...outputLimit,
        error,
      }
    );
    return input.output;
  }

  try {
    await input.store.complete({
      executionId: input.executionId,
      output: replayableOutput,
    });
  } catch (error) {
    console.error(
      "[slack-tool-idempotency] failed to persist completed execution",
      {
        executionId: input.executionId,
        toolName: input.toolName,
        reason: "completion_write_failed",
        error,
      }
    );
  }
  return replayableOutput;
}

/**
 * Gives each mutation occurrence within one Slack event an at-most-once
 * execution identity. A Trigger retry creates a fresh wrapper, so its
 * occurrence counters repeat and completed results are replayed from storage.
 *
 * Cross-run matching depends on the model reproducing the same canonicalized
 * tool arguments and occurrence order. Semantically equivalent calls with
 * different string content or fields receive different identities.
 * A scope must identify exactly one agent pass: reconstructing a wrapper with
 * the same scope is intentionally treated as a retry and replays prior calls.
 *
 * Protected tools must return JSON-serializable output. Successful outputs
 * are normalized through JSON and capped at 64 KiB so the first response and
 * any replay have the same shape. Non-serializable or oversized outputs leave
 * the reservation uncertain instead of risking an unsafe automatic retry.
 * A top-level `undefined` output is intentionally normalized to JSON `null`.
 */
export function wrapToolsWithSlackIdempotency(
  tools: ToolSet,
  context: SlackToolIdempotencyContext,
  options: SlackToolIdempotencyOptions = {}
): ToolSet {
  const store = options.store ?? supabaseSlackToolExecutionStore;
  const occurrences = new Map<string, number>();
  const blockedExecutions = new Map<string, SlackToolExecutionRecord>();
  const retryingExecutions = new Set<string>();
  const reservationLocks = new Map<string, Promise<void>>();

  return Object.fromEntries(
    Object.entries(tools).map(([toolName, currentTool]) => {
      if (!currentTool.execute) return [toolName, currentTool];

      const execute = currentTool.execute;
      return [
        toolName,
        {
          ...currentTool,
          async execute(input: never, toolCallOptions: never) {
            if (!shouldProtectToolExecution(toolName, input, context)) {
              return execute(input, toolCallOptions);
            }

            const inputHash = hashToolInput(input);
            const counterKey = `${toolName}:${inputHash}`;
            const blockedExecution = blockedExecutions.get(counterKey);
            if (blockedExecution) {
              return replayUncertainExecution();
            }
            const occurrence = (occurrences.get(counterKey) ?? 0) + 1;
            occurrences.set(counterKey, occurrence);

            // Deliberately fail closed if the durable ledger is unavailable:
            // executing without a reservation would reintroduce duplicate
            // mutations. Production deploys apply migrations before the app.
            const reservation = await runWithSlackToolReservationLock({
              locks: reservationLocks,
              counterKey,
              operation: async () => {
                const result = await store.reserve({
                  scopeKey: context.scopeKey,
                  userId: context.userId,
                  toolName,
                  inputHash,
                  occurrence,
                });
                if (!result.acquired) {
                  // Set the retry marker before releasing the per-key lock so
                  // a parallel later occurrence cannot execute first.
                  retryingExecutions.add(counterKey);
                }
                return result;
              },
            });
            if (!reservation.acquired) {
              if (reservation.record.status === "completed") {
                return reservation.record.output;
              }
              // Once one occurrence is skipped, later identical inputs cannot
              // be safely aligned with the original occurrence sequence.
              blockedExecutions.set(counterKey, reservation.record);
              return replayUncertainExecution();
            }
            if (retryingExecutions.has(counterKey)) {
              const message =
                "Suppressed an extra identical action requested during a retry.";
              const suppressedRecord: SlackToolExecutionRecord = {
                ...reservation.record,
                status: "failed",
                error: message,
              };
              blockedExecutions.set(counterKey, suppressedRecord);
              await persistFailedSlackToolExecution({
                store,
                record: suppressedRecord,
                toolName,
                error: message,
              });
              return replayUncertainExecution();
            }

            try {
              const output = await execute(input, toolCallOptions);
              return persistCompletedSlackToolExecution({
                store,
                executionId: reservation.record.id,
                toolName,
                output,
              });
            } catch (error) {
              // Conservatively treat every thrown mutation as potentially
              // applied; transport errors cannot reliably distinguish a
              // pre-write failure from a post-write response failure.
              const message = truncateSlackToolExecutionError(
                error instanceof Error ? error.message : String(error)
              );
              const failedRecord: SlackToolExecutionRecord = {
                ...reservation.record,
                status: "failed",
                error: message,
              };
              blockedExecutions.set(counterKey, failedRecord);
              await persistFailedSlackToolExecution({
                store,
                record: failedRecord,
                toolName,
                error: message,
              });
              throw error;
            }
          },
        },
      ];
    })
  ) as ToolSet;
}
