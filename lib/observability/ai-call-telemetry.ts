import type { AiCallType } from "@/lib/ai-call-types";
import type { AiCall } from "@/lib/types";
import {
  capturedUsageAiCallColumns,
  type CapturedUsage,
} from "@/lib/observability/usage";
import { supabaseAdmin } from "@/lib/supabase/admin";

type FinishedAiCallStatus = Extract<AiCall["status"], "success" | "failed">;

export async function recordAiCallTelemetry(input: {
  userId: string;
  type: AiCallType;
  model: string;
  usage: CapturedUsage;
  startedAtMs: number;
  startedAt: string;
  status: FinishedAiCallStatus;
  error?: string | null;
  metadata: Record<string, unknown>;
  logPrefix: string;
}) {
  try {
    const { error } = await supabaseAdmin.from("ai_calls").insert({
      user_id: input.userId,
      type: input.type,
      model: input.model,
      ...capturedUsageAiCallColumns(input.usage),
      duration_ms: Date.now() - input.startedAtMs,
      started_at: input.startedAt,
      completed_at: new Date().toISOString(),
      status: input.status,
      error: input.error ?? null,
      metadata: input.metadata,
    });
    if (error) {
      console.error(`${input.logPrefix} failed to record ai_call`, error);
    }
  } catch (error) {
    console.error(`${input.logPrefix} failed to record ai_call`, error);
  }
}
