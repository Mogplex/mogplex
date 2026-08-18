import {
  capturedUsageAiCallColumns,
  EMPTY_CAPTURED_USAGE,
  hasCapturedUsage,
  type CapturedUsage,
} from "@/lib/observability/usage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CliCallOutcome } from "./types";

/**
 * Record a single CLI inference call in `ai_calls` so it surfaces in the
 * observability dashboard alongside automation and flow runs. The caller waits
 * for this write before closing the response so a serverless shutdown cannot
 * discard the usage record. Telemetry failures remain non-fatal.
 */
export async function recordCliInferenceCall(input: {
  userId: string;
  model: string;
  startedAt: string;
  startedAtMs: number;
  streaming: boolean;
  outcome: CliCallOutcome;
}): Promise<void> {
  const toolCalls =
    input.outcome.status === "success" ? input.outcome.toolCalls : [];
  const usage =
    input.outcome.status === "success"
      ? input.outcome.usage
      : (input.outcome.usage ?? EMPTY_CAPTURED_USAGE);
  const partialFailure =
    input.outcome.status === "failed" &&
    hasCapturedUsage(usage as CapturedUsage);
  const payload = {
    user_id: input.userId,
    type: "chat" as const,
    model: input.model,
    ...capturedUsageAiCallColumns(usage as CapturedUsage),
    duration_ms: Date.now() - input.startedAtMs,
    started_at: input.startedAt,
    completed_at: new Date().toISOString(),
    status: input.outcome.status,
    error: input.outcome.status === "failed" ? input.outcome.error : null,
    tool_calls_count: toolCalls.length,
    tool_calls: toolCalls,
    metadata: {
      source: "cli",
      streaming: input.streaming,
      ...(partialFailure ? { failed_with_partial_usage: true } : {}),
    },
  };
  const { error } = await supabaseAdmin.from("ai_calls").insert(payload);
  if (error) {
    console.error("[cli-inference] failed to record ai_call", error);
  }
}
