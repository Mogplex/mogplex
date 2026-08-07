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

export type SlackToolExecutionIdentity = Pick<
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

export const MAX_SLACK_TOOL_EXECUTION_OUTPUT_BYTES = 64 * 1024;
export const MAX_SLACK_TOOL_EXECUTION_ERROR_CHARS = 4_096;

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

export function normalizeSlackToolExecutionOutput(
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

export function truncateSlackToolExecutionError(error: string) {
  const sanitized = sanitizeTelemetryValue(error, {
    maxStringLength: MAX_SLACK_TOOL_EXECUTION_ERROR_CHARS,
  });
  return (
    typeof sanitized === "string" ? sanitized : "Tool execution failed"
  ).slice(0, MAX_SLACK_TOOL_EXECUTION_ERROR_CHARS);
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

export const supabaseSlackToolExecutionStore =
  createSupabaseSlackToolExecutionStore();
